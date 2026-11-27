"""Public-source collectors: immutable archives, explicit windows, preserved vintages."""

from __future__ import annotations

import hashlib
import json
import math
import re
import time
import uuid
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import httpx
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert

from app.config import DATA, settings
from app.db import Observation, PipelineEvent, WeatherVintage, iso, now, session_scope, utc
from app.repository import observation_id

LOCATIONS = [
    ("London", 51.5074, -0.1278),
    ("Birmingham", 52.4862, -1.8904),
    ("Manchester", 53.4808, -2.2426),
    ("Glasgow", 55.8642, -4.2518),
    ("Bristol", 51.4545, -2.5879),
    ("Newcastle", 54.9783, -1.6178),
]


class ProviderError(RuntimeError):
    pass


def fetch_json(url: str, params: dict | None = None) -> tuple[dict | list, str, datetime]:
    """Bounded retry, no retries for bad requests; never log credentialed URLs."""
    params = params or {}
    with httpx.Client(
        timeout=httpx.Timeout(45, connect=15),
        follow_redirects=False,
        headers={"User-Agent": "ETIP/1.0 local research; public data ingestion"},
    ) as client:
        for attempt in range(4):
            try:
                response = client.get(url, params=params)
                if response.status_code in (408, 425, 429) or response.status_code >= 500:
                    if attempt == 3:
                        raise ProviderError(f"Provider temporarily unavailable (HTTP {response.status_code})")
                    retry = response.headers.get("Retry-After", "")
                    time.sleep(min(float(retry) if retry.isdigit() else 2**attempt, 15))
                    continue
                if response.status_code >= 300:
                    raise ProviderError(
                        f"Provider rejected request (HTTP {response.status_code}); check endpoint contract"
                    )
                payload = response.json()
                fetched = now()
                digest = hashlib.sha256(response.content).hexdigest()
                provider = "elexon" if "elexon" in url else "open-meteo"
                folder = DATA / "raw" / provider / fetched.strftime("%Y-%m-%d")
                folder.mkdir(parents=True, exist_ok=True)
                path = folder / f"{digest}.json"
                if not path.exists():
                    path.write_bytes(response.content)
                    safe_params = {k: v for k, v in params.items() if "key" not in k.lower()}
                    path.with_suffix(".meta.json").write_text(
                        json.dumps(
                            {
                                "source_url": url,
                                "parameters": safe_params,
                                "retrieved_at": iso(fetched),
                                "sha256": digest,
                                "http_status": response.status_code,
                            },
                            indent=2,
                        ),
                        encoding="utf-8",
                    )
                return payload, str(path.relative_to(DATA)).replace("\\", "/"), fetched
            except (httpx.TransportError, json.JSONDecodeError) as exc:
                if attempt == 3:
                    raise ProviderError(f"Provider request failed: {type(exc).__name__}") from exc
                time.sleep(2**attempt)
    raise ProviderError("Provider request did not complete")


def validate_point(
    metric: str, value, timestamp, published, start: datetime, end: datetime, fetched: datetime
) -> tuple[float, datetime, datetime]:
    if isinstance(value, bool) or value is None:
        raise ValueError("missing or boolean numeric value")
    number = float(value)
    if not math.isfinite(number):
        raise ValueError("non-finite value")
    timestamp, published = utc(timestamp), utc(published)
    if not start <= timestamp < end:
        raise ValueError("outside requested window")
    if timestamp.minute not in (0, 30) or timestamp.second or timestamp.microsecond:
        raise ValueError("unexpected settlement timestamp; never silently floor")
    if published > fetched + timedelta(minutes=5):
        raise ValueError("publication in the future")
    if metric in ("demand", "transmission_demand") and not 0 < number < 150_000:
        raise ValueError("demand outside physical validation envelope")
    if metric.startswith("generation_") and not -20_000 < number < 100_000:
        raise ValueError("generation outside validation envelope")
    # Negative prices, negative net imbalance, and signed generation can be legitimate.
    return number, timestamp, published


def parse_elexon(
    payload: dict | list, dataset: str, start: datetime, end: datetime, fetched: datetime, archive: str
) -> tuple[list[dict], list[str]]:
    raw = payload.get("data", []) if isinstance(payload, dict) else payload
    if not isinstance(raw, list):
        raise ProviderError("Provider schema changed: expected a data array")
    rows: dict[str, dict] = {}
    errors = []
    for record in raw:
        timestamp = record.get("startTime")
        if not timestamp:
            errors.append("missing startTime")
            continue
        if dataset == "demand":
            fields = [
                ("demand", record.get("initialDemandOutturn"), "MW"),
                ("transmission_demand", record.get("initialTransmissionSystemDemandOutturn"), "MW"),
            ]
        elif dataset == "prices":
            fields = [
                ("imbalance_price", record.get("systemSellPrice"), "GBP/MWh"),
                ("net_imbalance", record.get("netImbalanceVolume"), "MWh"),
            ]
        else:
            fields = [
                (
                    "generation_"
                    + re.sub(r"[^a-z0-9]+", "_", str(r.get("psrType", "unknown")).lower()).strip("_"),
                    r.get("quantity"),
                    "MW",
                )
                for r in record.get("data", [])
            ]
        publication = record.get("publishTime") or record.get("createdDateTime")
        for metric, value, unit in fields:
            try:
                number, timestamp_dt, published = validate_point(
                    metric, value, timestamp, publication or fetched, start, end, fetched
                )
                identifier = observation_id(
                    metric, "Elexon", timestamp_dt, published if publication else timestamp_dt, number
                )
                rows[identifier] = {
                    "id": identifier,
                    "metric": metric,
                    "source": "Elexon",
                    "market": "GB",
                    "time": timestamp_dt,
                    "published_at": published,
                    "fetched_at": fetched,
                    "value": number,
                    "unit": unit,
                    "archive": archive,
                    "quality": "published" if publication else "retrieved-at",
                }
            except (ValueError, TypeError, OverflowError) as exc:
                errors.append(f"{metric}: {exc}")
    return list(rows.values()), errors


def store_observations(rows: list[dict]) -> int:
    inserted = 0
    with session_scope() as session:
        for i in range(0, len(rows), 500):
            stmt = insert(Observation).values(rows[i : i + 500]).on_conflict_do_nothing(index_elements=["id"])
            inserted += len(session.execute(stmt.returning(Observation.id)).all())
    return inserted


def event(
    job_id: str, source: str, dataset: str, status: str, accepted=0, rejected=0, detail="", archive=None
):
    with session_scope() as session:
        session.add(
            PipelineEvent(
                id=str(uuid.uuid4()),
                job_id=job_id,
                source=source,
                dataset=dataset,
                status=status,
                accepted=accepted,
                rejected=rejected,
                detail=detail[:3000],
                archive=archive,
            )
        )


def settlement_windows(start: datetime, end: datetime):
    """GB settlement dates span local midnight to midnight, including DST transitions."""
    london = ZoneInfo("Europe/London")
    day = start.astimezone(london).date()
    last = (end - timedelta(microseconds=1)).astimezone(london).date()
    while day <= last:
        local_start = datetime(day.year, day.month, day.day, tzinfo=london)
        local_end = local_start + timedelta(days=1)
        yield day.isoformat(), max(start, utc(local_start)), min(end, utc(local_end))
        day += timedelta(days=1)


def ingest_elexon(job_id: str, start: datetime, end: datetime, progress=lambda *args: None) -> dict:
    cursor = start.replace(hour=0, minute=0, second=0, microsecond=0)
    tasks = []
    while cursor < end:
        chunk_end = min(cursor + timedelta(days=7), end)
        tasks.append(
            (
                "demand",
                "/demand/outturn",
                {
                    "settlementDateFrom": cursor.astimezone(ZoneInfo("Europe/London")).date().isoformat(),
                    "settlementDateTo": (chunk_end - timedelta(microseconds=1))
                    .astimezone(ZoneInfo("Europe/London"))
                    .date()
                    .isoformat(),
                    "format": "json",
                },
                cursor,
                chunk_end,
            )
        )
        cursor = chunk_end
    context_start = start
    for settlement_date, window_start, window_end in settlement_windows(context_start, end):
        tasks.append(
            (
                "prices",
                f"/balancing/settlement/system-prices/{settlement_date}",
                {"format": "json"},
                window_start,
                window_end,
            )
        )
    cursor = context_start
    while cursor < end:
        chunk_end = min(cursor + timedelta(days=7), end)
        tasks.append(
            (
                "generation",
                "/generation/actual/per-type",
                {"from": iso(cursor), "to": iso(chunk_end), "format": "json"},
                cursor,
                chunk_end,
            )
        )
        cursor = chunk_end
    counts, failures = {}, []
    for i, (dataset, path, parameters, window_start, window_end) in enumerate(tasks):
        progress(int(5 + 80 * i / len(tasks)), f"Fetching {dataset}: {window_start:%Y-%m-%d}")
        try:
            payload, archive, fetched = fetch_json(settings.elexon_url + path, parameters)
            rows, errors = parse_elexon(
                payload, dataset, max(start, window_start), window_end, fetched, archive
            )
            inserted = store_observations(rows)
            counts[dataset] = counts.get(dataset, 0) + inserted
            status = "success" if rows else "empty"
            event(
                job_id,
                "Elexon",
                dataset,
                status,
                inserted,
                len(errors),
                f"{len(rows)} valid records; {inserted} new vintages. " + "; ".join(errors[:3]),
                archive,
            )
            if not rows:
                failures.append(f"{dataset} {window_start:%Y-%m-%d}: no valid rows")
        except (ProviderError, httpx.HTTPError, ValueError) as exc:
            failures.append(f"{dataset}: {exc}")
            event(job_id, "Elexon", dataset, "failed", detail=str(exc))
    return {
        "new_vintages": counts,
        "failures": failures,
        "requested_from": iso(start),
        "requested_to": iso(end),
    }


def ingest_weather(job_id: str, run: datetime | None = None) -> dict:
    parameters = {
        "latitude": ",".join(str(x[1]) for x in LOCATIONS),
        "longitude": ",".join(str(x[2]) for x in LOCATIONS),
        "hourly": "temperature_2m,wind_speed_100m,shortwave_radiation",
        "wind_speed_unit": "ms",
        "timezone": "UTC",
        "forecast_days": 3,
    }
    if run:
        parameters.update({"run": run.strftime("%Y-%m-%dT%H:%M"), "models": "ecmwf_ifs"})
        url = "https://single-runs-api.open-meteo.com/v1/forecast"
    else:
        url = "https://api.open-meteo.com/v1/forecast"
    try:
        payload, archive, fetched = fetch_json(url, parameters)
        locations = payload if isinstance(payload, list) else [payload]
        if len(locations) != len(LOCATIONS):
            raise ProviderError("Weather response location count does not match request")
        rows = []
        available = run + timedelta(hours=8) if run else fetched
        for location, response in zip(LOCATIONS, locations, strict=True):
            hourly = response.get("hourly", {})
            for i, timestamp in enumerate(hourly.get("time", [])):
                values = [
                    hourly.get(key, [])[i]
                    for key in ("temperature_2m", "wind_speed_100m", "shortwave_radiation")
                ]
                if any(v is None or not math.isfinite(float(v)) for v in values):
                    continue
                valid = utc(timestamp)
                identifier = hashlib.sha256(
                    f"{location[0]}|{iso(run or fetched)}|{iso(valid)}".encode()
                ).hexdigest()
                rows.append(
                    {
                        "id": identifier,
                        "location": location[0],
                        "run_time": run or fetched,
                        "available_at": available,
                        "valid_time": valid,
                        "temperature": values[0],
                        "wind_speed": values[1],
                        "radiation": values[2],
                        "archive": archive,
                        "basis": "assumed-run-plus-8h" if run else "retrieved-at",
                    }
                )
        inserted = 0
        with session_scope() as session:
            for i in range(0, len(rows), 500):
                stmt = (
                    insert(WeatherVintage)
                    .values(rows[i : i + 500])
                    .on_conflict_do_nothing(index_elements=["id"])
                )
                inserted += len(session.execute(stmt.returning(WeatherVintage.id)).all())
        event(
            job_id,
            "Open-Meteo",
            "weather_archive" if run else "weather_forecast",
            "success",
            inserted,
            archive=archive,
        )
        return {"weather_points": inserted, "basis": "assumed-run-plus-8h" if run else "retrieved-at"}
    except (ProviderError, ValueError, KeyError, IndexError) as exc:
        event(job_id, "Open-Meteo", "weather", "failed", detail=str(exc))
        return {"weather_points": 0, "error": str(exc)}


def weather_history(job_id: str, days: int, progress=lambda *args: None) -> dict:
    end = now().replace(hour=0, minute=0, second=0, microsecond=0)
    results = []
    for i in range(days):
        run = end - timedelta(days=days - i)
        progress(int(100 * i / days), f"Archiving weather run {run:%Y-%m-%d}")
        with session_scope() as session:
            count = session.scalar(
                select(func.count()).select_from(WeatherVintage).where(WeatherVintage.run_time == run)
            )
        if count and count >= 6 * 72:
            results.append({"weather_points": 0, "skipped_complete_run": True})
            continue
        results.append(ingest_weather(job_id, run))
    failures = [r["error"] for r in results if "error" in r]
    return {
        "weather_points": sum(r["weather_points"] for r in results),
        "failures": failures,
        "availability_assumption": "Archived model initialization + 8h, not measured historical publication. Reported explicitly in model cards.",
    }
