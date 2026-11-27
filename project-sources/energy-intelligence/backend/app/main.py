"""Local-only API for stored market data, research, operations and durable jobs."""

from __future__ import annotations

import csv
import io
import json
import logging
import secrets
from contextlib import asynccontextmanager
from datetime import timedelta
from typing import Literal

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from pydantic import BaseModel, Field
from sqlalchemy import select, text
from starlette.middleware.trustedhost import TrustedHostMiddleware

from app.config import DATA, ROOT, settings
from app.db import (
    AppSetting,
    ForecastPoint,
    ModelRun,
    Report,
    WeatherVintage,
    WorkerState,
    engine,
    initialize,
    iso,
    now,
    record_to_dict,
    session_scope,
    utc,
)
from app.jobs import enqueue, job_list
from app.operations import quality_report, research
from app.repository import METRICS, latest_rows, metric_inventory

log = logging.getLogger("etip.api")


@asynccontextmanager
async def lifespan(app):
    initialize()
    yield
    engine.dispose()


app = FastAPI(title="ETIP · Energy Intelligence", version="1.0.0", lifespan=lifespan)
app.add_middleware(TrustedHostMiddleware, allowed_hosts=["localhost", "127.0.0.1", "testserver"])
app.add_middleware(
    CORSMiddleware,
    allow_origins=list(settings.origins),
    allow_methods=["GET", "POST", "PUT"],
    allow_headers=["Content-Type", "X-ETIP-Token"],
)


@app.middleware("http")
async def local_security(request: Request, call_next):
    if request.method in ("POST", "PUT", "DELETE", "PATCH"):
        origin = request.headers.get("origin")
        if origin and origin not in settings.origins:
            return JSONResponse({"detail": "Origin is not allowed"}, status_code=403)
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Cache-Control"] = "no-store"
    return response


@app.exception_handler(ValueError)
async def value_error(request: Request, exc: ValueError):
    return JSONResponse({"detail": str(exc)}, status_code=422)


def require_local_token(request: Request):
    if not secrets.compare_digest(request.headers.get("X-ETIP-Token", ""), settings.api_token):
        raise HTTPException(401, "Local session token is missing or invalid")


@app.get("/ping")
def ping():
    return {"pong": True}


@app.get("/api/v1/session")
def local_session():
    # Only same-origin browser code can read this response; writes also check Origin.
    return {"token": settings.api_token, "mode": "local", "market": "GB"}


@app.get("/api/v1/health")
def health():
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
        with session_scope() as session:
            worker = session.get(WorkerState, "local")
            alive = bool(worker and worker.running and now() - utc(worker.heartbeat) < timedelta(seconds=45))
        return {
            "database": "connected",
            "worker": "running" if alive else "offline",
            "time": iso(now()),
            "version": "1.0.0",
        }
    except Exception:
        return JSONResponse({"database": "unavailable", "worker": "unknown"}, status_code=503)


@app.get("/api/v1/overview")
def overview():
    reference = now()
    summaries = []
    for metric, meta in METRICS.items():
        if metric == "transmission_demand":
            continue
        rows = latest_rows(metric, reference - timedelta(days=3), reference)
        item = {"metric": metric, **meta, "value": None, "time": None, "change": None, "status": "missing"}
        if rows:
            last = rows[-1]
            previous_time = utc(last["time"]) - timedelta(days=1)
            previous = next((r for r in rows if utc(r["time"]) == previous_time), None)
            item.update(
                {
                    "value": last["value"],
                    "time": last["time"],
                    "published_at": last["published_at"],
                    "change": last["value"] - previous["value"] if previous else None,
                    "status": "fresh" if reference - utc(last["time"]) <= timedelta(hours=3) else "stale",
                }
            )
        summaries.append(item)
    inventory = metric_inventory()
    generation = []
    # Only compare fuel types at the same common published settlement timestamp.
    fuels = [i for i in inventory if i["metric"].startswith("generation_")]
    common_time = min((utc(i["latest"]) for i in fuels), default=None)
    if common_time:
        for fuel in fuels:
            row = latest_rows(fuel["metric"], common_time, common_time + timedelta(minutes=30))
            if row:
                generation.append(
                    {
                        "name": fuel["label"],
                        "metric": fuel["metric"],
                        "value": row[-1]["value"],
                        "time": iso(common_time),
                    }
                )
    active = [j for j in job_list(20) if j["status"] in ("queued", "running")]
    return {
        "as_of": iso(reference),
        "market": "GB",
        "summaries": summaries,
        "generation": generation,
        "generation_time": iso(common_time),
        "inventory": inventory,
        "active_jobs": active,
        "data_mode": "real",
        "timezone": "UTC",
        "currency": "GBP",
    }


@app.get("/api/v1/series")
def series(
    metric: str = "demand",
    days: int = Query(7, ge=1, le=730),
    start: str | None = None,
    end: str | None = None,
    as_of: str | None = None,
    recorded_as_of: bool = False,
):
    if metric not in METRICS and not metric.startswith("generation_"):
        raise HTTPException(422, "Unknown metric")
    end_dt = utc(end) if end else now()
    start_dt = utc(start) if start else end_dt - timedelta(days=days)
    if start_dt >= end_dt or end_dt - start_dt > timedelta(days=731):
        raise HTTPException(422, "Choose a positive date range of at most 730 days")
    rows = latest_rows(metric, start_dt, end_dt, utc(as_of) if as_of else None, recorded_as_of)
    return {
        "metric": metric,
        "unit": METRICS.get(metric, {}).get("unit", "MW"),
        "points": rows,
        "start": iso(start_dt),
        "end": iso(end_dt),
        "count": len(rows),
    }


@app.get("/api/v1/export")
def export(metric: str = "demand", days: int = Query(30, ge=1, le=730)):
    result = series(metric=metric, days=days, start=None, end=None, as_of=None, recorded_as_of=False)
    stream = io.StringIO(newline="")
    writer = csv.writer(stream)
    writer.writerow(["time_utc", "value", "unit", "source", "published_at", "fetched_at", "quality"])
    for row in result["points"]:
        writer.writerow(
            [row[k] for k in ("time", "value", "unit", "source", "published_at", "fetched_at", "quality")]
        )
    return Response(
        stream.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="etip-{metric}-{days}d.csv"'},
    )


@app.get("/api/v1/forecasts/latest")
def forecast_latest():
    with session_scope() as session:
        run = session.scalar(
            select(ModelRun)
            .where(ModelRun.status == "complete")
            .order_by(ModelRun.created_at.desc())
            .limit(1)
        )
        if not run:
            return {
                "available": False,
                "reason": "No completed forecast run. Backfill real history and run evaluation.",
                "points": [],
            }
        points = session.scalars(
            select(ForecastPoint).where(ForecastPoint.run_id == run.id).order_by(ForecastPoint.time)
        ).all()
        return {
            "available": True,
            "id": run.id,
            "model": run.model,
            "created_at": iso(run.created_at),
            "cutoff": iso(run.cutoff),
            "metadata": run.metadata_json,
            "points": [
                record_to_dict(p, ("time", "value", "lower", "upper", "baseline", "actual")) for p in points
            ],
        }


@app.get("/api/v1/models")
def models():
    with session_scope() as session:
        rows = session.scalars(select(ModelRun).order_by(ModelRun.created_at.desc()).limit(20)).all()
        return [
            {
                "id": r.id,
                "created_at": iso(r.created_at),
                "cutoff": iso(r.cutoff),
                "model": r.model,
                "status": r.status,
                "metadata": {k: v for k, v in r.metadata_json.items() if k != "test_points"},
            }
            for r in rows
        ]


@app.get("/api/v1/weather")
def weather():
    with session_scope() as session:
        rows = session.scalars(
            select(WeatherVintage)
            .where(
                WeatherVintage.available_at <= now(),
                WeatherVintage.valid_time >= now() - timedelta(hours=1),
                WeatherVintage.valid_time < now() + timedelta(hours=48),
            )
            .order_by(WeatherVintage.available_at)
        ).all()
        latest = {(r.location, r.valid_time): r for r in rows}
        return {
            "locations": sorted({r.location for r in rows}),
            "points": [
                record_to_dict(
                    r,
                    (
                        "location",
                        "valid_time",
                        "available_at",
                        "temperature",
                        "wind_speed",
                        "radiation",
                        "basis",
                    ),
                )
                for r in sorted(latest.values(), key=lambda r: (r.valid_time, r.location))
            ],
            "aggregation": "Six-city equal-weight sample; not a national spatial average",
        }


@app.get("/api/v1/research")
def research_endpoint(days: int = Query(14, ge=2, le=90)):
    return research(days)


@app.get("/api/v1/quality")
def quality():
    return quality_report()


@app.get("/api/v1/jobs")
def jobs():
    return job_list(50)


class JobRequest(BaseModel):
    kind: Literal["sync", "backfill", "forecast", "weather_history", "report", "backup"]
    days: int = Field(120, ge=1, le=730)
    use_llm: bool = False


@app.post("/api/v1/jobs", dependencies=[Depends(require_local_token)], status_code=202)
def submit_job(body: JobRequest):
    if body.kind == "weather_history" and body.days > 180:
        raise HTTPException(422, "Weather archive requests are limited to 180 days per job")
    return enqueue(body.kind, {"days": body.days, "use_llm": body.use_llm})


@app.get("/api/v1/reports")
def reports():
    with session_scope() as session:
        rows = session.scalars(select(Report).order_by(Report.created_at.desc()).limit(30)).all()
        return [record_to_dict(r, ("id", "created_at", "title", "engine", "status", "payload")) for r in rows]


@app.get("/api/v1/settings")
def get_settings():
    with session_scope() as session:
        automation = session.get(AppSetting, "automation").value
    return {
        "automation": automation,
        "llm_configured": bool(settings.groq_key or settings.openrouter_key),
        "storage": "Local PostgreSQL + data/raw + data/models",
        "market": "GB",
        "synthetic_data": False,
        "sources": [
            {
                "name": "Elexon Insights",
                "role": "National/transmission demand, generation, imbalance price and volume",
                "access": "Public API; no key",
                "url": "https://developer.data.elexon.co.uk/",
                "licence": "BMRS Data Licence; attribution required",
            },
            {
                "name": "Open-Meteo",
                "role": "Operational and archived weather forecasts",
                "access": "Noncommercial free API, subject to limits",
                "url": "https://open-meteo.com/en/pricing",
                "licence": "CC BY 4.0 data; API commercial use requires subscription",
            },
            {
                "name": "NESO",
                "role": "Reference source; not joined to INDO or ingested by this version",
                "access": "Public dataset; historic demand is delayed 21 days",
                "url": "https://www.neso.energy/data-portal/historic-demand-data",
                "licence": "NESO Open Data Licence",
            },
            {
                "name": "ENTSO-E",
                "role": "Future continental Europe adapter; not connected",
                "access": "Registration and approved API token required",
                "url": "https://transparency.entsoe.eu/",
                "licence": "Provider terms apply",
            },
        ],
    }


class AutomationRequest(BaseModel):
    enabled: bool
    interval_minutes: Literal[15, 30, 60] = 30


@app.put("/api/v1/settings/automation", dependencies=[Depends(require_local_token)])
def set_automation(body: AutomationRequest):
    with session_scope() as session:
        session.get(AppSetting, "automation").value = body.model_dump()
    return body.model_dump()


@app.get("/api/v1/project-log")
def project_log():
    return json.loads((ROOT / "docs" / "ENGINEERING_LOG.json").read_text(encoding="utf-8"))


@app.get("/api/v1/archive")
def source_archive(path: str):
    candidate = (DATA / path).resolve()
    if (
        not candidate.is_relative_to((DATA / "raw").resolve())
        or candidate.suffix != ".json"
        or not candidate.is_file()
    ):
        raise HTTPException(404, "Source archive not found")
    return FileResponse(candidate, media_type="application/json", content_disposition_type="inline")
