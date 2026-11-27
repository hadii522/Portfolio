from __future__ import annotations

import json
import os
import shutil
import subprocess
import zipfile
from datetime import timedelta
from pathlib import Path

import numpy as np
import pandas as pd
from sqlalchemy import DateTime, func, select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.engine import make_url

from app.config import DATA, ROOT, settings
from app.db import Base, PipelineEvent, WeatherVintage, engine, iso, now, record_to_dict, session_scope, utc
from app.repository import latest_rows, metric_inventory


def quality_report() -> dict:
    inventory = metric_inventory()
    checks = []
    reference = now()
    for item in inventory:
        first, last = utc(item["first"]), utc(item["latest"])
        expected = int((last - first).total_seconds() / 1800) + 1
        age = max(0, (reference - last).total_seconds() / 60)
        checks.append(
            {
                **item,
                "expected": expected,
                "missing": max(0, expected - item["points"]),
                "coverage": min(100, item["points"] / expected * 100),
                "age_minutes": age,
                "status": "fresh" if age <= 180 else "stale",
                "revisions": item["vintages"] - item["points"],
            }
        )
    with session_scope() as session:
        events = session.scalars(select(PipelineEvent).order_by(PipelineEvent.time.desc()).limit(100)).all()
        weather_count = session.query(WeatherVintage).count()
        event_list = [
            record_to_dict(
                e,
                (
                    "id",
                    "job_id",
                    "source",
                    "dataset",
                    "time",
                    "status",
                    "accepted",
                    "rejected",
                    "detail",
                    "archive",
                ),
            )
            for e in events
        ]
    return {
        "metrics": checks,
        "events": event_list,
        "weather_vintages": weather_count,
        "total_observations": sum(i["points"] for i in inventory),
        "total_vintages": sum(i["vintages"] for i in inventory),
        "as_of": iso(reference),
        "policy": "No synthetic substitution. Latest vintage per period. Missing intervals stay missing.",
    }


def research(days=14) -> dict:
    reference = now()
    demand = latest_rows("demand", reference - timedelta(days=days), reference)
    price = latest_rows("imbalance_price", reference - timedelta(days=days), reference)
    joined = {r["time"]: {"time": r["time"], "demand": r["value"]} for r in demand}
    pairs = []
    anomalies = []
    historical = []
    for r in price:
        if r["time"] in joined:
            pairs.append({**joined[r["time"]], "price": r["value"]})
        trailing = np.asarray(historical[-336:])
        if len(trailing) >= 48:
            center = float(np.median(trailing))
            mad = float(np.median(np.abs(trailing - center)))
            score = abs(r["value"] - center) / (1.4826 * mad) if mad > 0 else 0
            if score >= 4:
                anomalies.append(
                    {
                        "time": r["time"],
                        "value": r["value"],
                        "metric": "imbalance_price",
                        "score": round(score, 2),
                        "baseline": center,
                        "unit": "GBP/MWh",
                    }
                )
        historical.append(r["value"])
    correlation = None
    if len(pairs) >= 30:
        x, y = np.array([r["demand"] for r in pairs]), np.array([r["price"] for r in pairs])
        if x.std() > 0 and y.std() > 0:
            correlation = float(np.corrcoef(x, y)[0, 1])
    heatmap = []
    if price:
        frame = pd.DataFrame(price)
        local = pd.to_datetime(frame.time, utc=True).dt.tz_convert("Europe/London")
        frame["weekday"], frame["hour"] = local.dt.dayofweek, local.dt.hour
        heatmap = [
            {"weekday": int(w), "hour": int(h), "mean": float(g.value.mean()), "n": len(g)}
            for (w, h), g in frame.groupby(["weekday", "hour"])
        ]
    return {
        "pairs": pairs,
        "correlation": correlation,
        "paired_periods": len(pairs),
        "heatmap": heatmap,
        "anomalies": sorted(anomalies, key=lambda r: r["score"], reverse=True)[:20],
        "days": days,
        "notes": [
            "Pearson correlation is descriptive association, not causal evidence or a trading signal.",
            "Only matching observed settlement timestamps are paired; gaps are not interpolated.",
            "Anomalies use a trailing robust median/MAD score; the current point is excluded from its own reference.",
            "Market observations can be revised; research uses the latest stored vintages.",
        ],
    }


def backup() -> dict:
    url = make_url(settings.database_url)
    binary = shutil.which("pg_dump")
    if not binary:
        suffix = "pg_dump.exe" if os.name == "nt" else "pg_dump"
        candidates = list((ROOT / "node_modules" / "@embedded-postgres").glob(f"*/native/bin/{suffix}"))
        binary = str(candidates[0]) if candidates else None
    if not binary:
        return logical_backup()
    destination = DATA / "backups" / f"etip-{now():%Y%m%dT%H%M%SZ}.dump"
    result = subprocess.run(
        [
            binary,
            "--host",
            url.host or "127.0.0.1",
            "--port",
            str(url.port or 5432),
            "--username",
            url.username or "etip",
            "--format",
            "custom",
            "--no-owner",
            "--no-acl",
            "--file",
            str(destination),
            url.database or "etip",
        ],
        env={**os.environ, "PGPASSWORD": url.password or ""},
        capture_output=True,
        timeout=120,
    )
    if result.returncode:
        raise ValueError("Database backup failed; check local connection and available disk space")
    return {
        "file": str(destination.relative_to(DATA)),
        "bytes": destination.stat().st_size,
        "note": "Database dump only. Also back up data/raw, data/models and local-secrets.json securely. Restore procedure is in docs/RUNBOOK.md.",
    }


def logical_backup() -> dict:
    """Portable, repeatable-read database snapshot plus source archives and model files."""
    destination = DATA / "backups" / f"etip-{now():%Y%m%dT%H%M%SZ}.zip"
    counts = {}
    with zipfile.ZipFile(destination, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        with engine.connect().execution_options(isolation_level="REPEATABLE READ") as connection:
            with connection.begin():
                for table in Base.metadata.sorted_tables:
                    counts[table.name] = 0
                    result = connection.execute(
                        select(table).execution_options(stream_results=True)
                    ).mappings()
                    with archive.open(f"database/{table.name}.jsonl", "w") as target:
                        for row in result:
                            target.write((json.dumps(dict(row), default=iso) + "\n").encode("utf-8"))
                            counts[table.name] += 1
        for directory in (DATA / "raw", DATA / "models"):
            for file in directory.rglob("*"):
                if file.is_file():
                    archive.write(file, str(file.relative_to(DATA)).replace("\\", "/"))
        archive.writestr(
            "manifest.json",
            json.dumps(
                {
                    "format": "etip-logical-v1",
                    "created_at": iso(now()),
                    "schema_version": 1,
                    "tables": counts,
                    "secrets_included": False,
                },
                indent=2,
            ),
        )
    with zipfile.ZipFile(destination) as archive:
        if archive.testzip() is not None:
            raise ValueError("Backup integrity verification failed")
    return {
        "file": str(destination.relative_to(DATA)),
        "bytes": destination.stat().st_size,
        "tables": counts,
        "format": "etip-logical-v1",
        "integrity": "ZIP CRC verified",
        "note": "Consistent database snapshot plus raw archives and model files. Local secrets are deliberately excluded. See the restore runbook.",
    }


def restore_backup(filename: str) -> dict:
    """Restore a trusted ETIP logical archive only into an empty database, with worker stopped."""
    path = Path(filename).resolve()
    with engine.connect() as connection:
        if not connection.execute(text("SELECT pg_try_advisory_lock(7731002)")).scalar():
            raise ValueError("Stop the worker before restoring")
        connection.commit()
        try:
            if any(
                connection.scalar(select(func.count()).select_from(t))
                for t in Base.metadata.sorted_tables
                if t.name != "app_settings"
            ):
                raise ValueError(
                    "Restore requires an empty database; existing application data will not be overwritten"
                )
            connection.commit()
            with zipfile.ZipFile(path) as archive:
                manifest = json.loads(archive.read("manifest.json"))
                if manifest.get("format") != "etip-logical-v1" or manifest.get("schema_version") != 1:
                    raise ValueError("Unsupported backup format or schema version")
                if archive.testzip() is not None:
                    raise ValueError("Backup integrity check failed")
                for name in archive.namelist():
                    if name.startswith(("raw/", "models/")):
                        target = (DATA / name).resolve()
                        if not target.is_relative_to(DATA) or ".." in Path(name).parts:
                            raise ValueError("Unsafe path in backup")
                        if target.exists() and target.read_bytes() != archive.read(name):
                            raise ValueError(
                                "Restore would overwrite a different local artifact; use a clean data directory"
                            )
                with connection.begin():
                    connection.execute(Base.metadata.tables["app_settings"].delete())
                    for table in Base.metadata.sorted_tables:
                        name = f"database/{table.name}.jsonl"
                        rows = [
                            json.loads(line)
                            for line in archive.read(name).decode("utf-8").splitlines()
                            if line
                        ]
                        if len(rows) != manifest["tables"][table.name]:
                            raise ValueError("Backup row count does not match manifest")
                        for row in rows:
                            for column in table.columns:
                                if isinstance(column.type, DateTime) and row.get(column.name):
                                    row[column.name] = utc(row[column.name])
                            if table.name == "jobs" and row["status"] in ("queued", "running"):
                                row["status"], row["message"] = (
                                    "interrupted",
                                    "Restored from backup; requeue explicitly",
                                )
                            if table.name == "worker_state":
                                row["running"] = False
                        for i in range(0, len(rows), 500):
                            connection.execute(
                                insert(table).values(rows[i : i + 500]).on_conflict_do_nothing()
                            )
                for name in archive.namelist():
                    if name.startswith(("raw/", "models/")):
                        target = (DATA / name).resolve()
                        target.parent.mkdir(parents=True, exist_ok=True)
                        if not target.exists():
                            target.write_bytes(archive.read(name))
                return {"restored": manifest["tables"], "source": path.name}
        finally:
            connection.execute(text("SELECT pg_advisory_unlock(7731002)"))
