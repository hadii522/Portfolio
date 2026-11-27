from __future__ import annotations

import hashlib
import uuid
from datetime import timedelta

from sqlalchemy import select, text

from app.db import Job, engine, now, record_to_dict, session_scope

KINDS = {"sync", "backfill", "forecast", "weather_history", "report", "backup"}


def enqueue(kind: str, parameters: dict | None = None) -> dict:
    if kind not in KINDS:
        raise ValueError("Unknown job type")
    with session_scope() as session:
        if engine.dialect.name == "postgresql":
            lock = int(hashlib.sha256(kind.encode()).hexdigest()[:14], 16)
            session.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": lock})
        existing = session.scalar(
            select(Job)
            .where(Job.kind == kind, Job.status.in_(["queued", "running"]))
            .order_by(Job.created_at)
            .limit(1)
        )
        if existing:
            return {"id": existing.id, "status": existing.status, "deduplicated": True}
        job = Job(id=str(uuid.uuid4()), kind=kind, parameters=parameters or {})
        session.add(job)
        session.flush()
        return {"id": job.id, "status": "queued", "deduplicated": False}


def progress(job_id: str, amount: int, message: str) -> None:
    with session_scope() as session:
        job = session.get(Job, job_id)
        job.progress = min(max(int(amount), 0), 100)
        job.message = message
        job.heartbeat = now()


def job_list(limit=30) -> list[dict]:
    with session_scope() as session:
        jobs = session.scalars(select(Job).order_by(Job.created_at.desc()).limit(limit)).all()
        return [
            record_to_dict(
                job,
                (
                    "id",
                    "kind",
                    "status",
                    "created_at",
                    "started_at",
                    "finished_at",
                    "heartbeat",
                    "progress",
                    "message",
                    "parameters",
                    "result",
                ),
            )
            for job in jobs
        ]


def claim() -> tuple[str, str, dict] | None:
    with session_scope() as session:
        stale = session.scalars(
            select(Job).where(Job.status == "running", Job.heartbeat < now() - timedelta(minutes=5))
        ).all()
        for job in stale:
            job.status, job.message = (
                "interrupted",
                "Worker heartbeat expired; requeue this operation. Completed ingestion chunks remain stored.",
            )
            job.finished_at = now()
        job = session.scalar(
            select(Job)
            .where(Job.status == "queued")
            .order_by(Job.created_at)
            .with_for_update(skip_locked=True)
            .limit(1)
        )
        if not job:
            return None
        job.status, job.started_at, job.heartbeat = "running", now(), now()
        job.message = "Starting"
        return job.id, job.kind, job.parameters


def execute(job_id: str, kind: str, parameters: dict) -> dict:
    from app.collectors import ingest_elexon, ingest_weather, weather_history
    from app.forecasting import run_forecast, score_forecasts
    from app.reports import generate_report

    def update(amount, message):
        progress(job_id, amount, message)

    if kind in ("sync", "backfill"):
        end = now()
        days = int(parameters.get("days", 120 if kind == "backfill" else 2))
        if not 1 <= days <= 730:
            raise ValueError("Backfill must cover one to 730 days")
        result = ingest_elexon(job_id, end - timedelta(days=days), end, update)
        result["weather"] = ingest_weather(job_id)
        if "error" in result["weather"]:
            result["failures"].append("Weather: " + result["weather"]["error"])
        try:
            result["forecast_actuals_scored"] = score_forecasts()
        except ValueError:
            result["forecast_actuals_scored"] = 0
        return result
    if kind == "weather_history":
        return weather_history(job_id, int(parameters.get("days", 120)), update)
    if kind == "forecast":
        return run_forecast(update)
    if kind == "report":
        return generate_report(bool(parameters.get("use_llm", False)))
    if kind == "backup":
        from app.operations import backup

        return backup()
    raise ValueError("Unknown job type")
