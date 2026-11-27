"""One database-backed local worker with leases, persisted schedules and catch-up."""

from __future__ import annotations

import logging
import os
import signal
import threading
from datetime import timedelta

from sqlalchemy import func, select, text

from app.config import DATA
from app.db import (
    AppSetting,
    Job,
    Observation,
    WorkerState,
    engine,
    initialize,
    now,
    session_scope,
    utc,
)
from app.jobs import claim, enqueue, execute

log = logging.getLogger("etip.worker")
stopping = threading.Event()


def heartbeat(job_id=None):
    with session_scope() as session:
        state = session.get(WorkerState, "local")
        if state:
            state.heartbeat, state.running = now(), True
        else:
            session.add(WorkerState(id="local", heartbeat=now(), running=True))
        if job_id:
            job = session.get(Job, job_id)
            if job and job.status == "running":
                job.heartbeat = now()


def schedule():
    with session_scope() as session:
        config = session.get(AppSetting, "automation").value
        if not config.get("enabled", True):
            return
        latest = session.scalar(
            select(Job).where(Job.kind.in_(["sync", "backfill"])).order_by(Job.created_at.desc()).limit(1)
        )
        interval = int(config.get("interval_minutes", 30))
        if not latest:
            enqueue("backfill", {"days": 120})
        elif latest.status not in ("queued", "running") and utc(latest.created_at) < now() - timedelta(
            minutes=interval
        ):
            latest_observation = session.scalar(
                select(func.max(Observation.time)).where(Observation.metric == "demand")
            )
            catchup_days = (
                min(730, max(2, (now() - utc(latest_observation)).days + 2)) if latest_observation else 120
            )
            enqueue("sync", {"days": catchup_days})
        has_data = session.scalar(select(Observation.id).where(Observation.metric == "demand").limit(1))
        if has_data:
            archive_job = session.scalar(
                select(Job).where(Job.kind == "weather_history").order_by(Job.created_at.desc()).limit(1)
            )
            if not archive_job:
                enqueue("weather_history", {"days": 120})
            last_model = session.scalar(
                select(Job).where(Job.kind == "forecast").order_by(Job.created_at.desc()).limit(1)
            )
            if not last_model or (
                last_model.status not in ("queued", "running")
                and utc(last_model.created_at) < now() - timedelta(hours=6)
            ):
                enqueue("forecast")
            last_report = session.scalar(
                select(Job).where(Job.kind == "report").order_by(Job.created_at.desc()).limit(1)
            )
            if not last_report or (
                last_report.status not in ("queued", "running")
                and utc(last_report.created_at) < now() - timedelta(hours=12)
            ):
                enqueue("report")
        last_backup = session.scalar(
            select(Job).where(Job.kind == "backup").order_by(Job.created_at.desc()).limit(1)
        )
        if not last_backup or utc(last_backup.created_at) < now() - timedelta(days=1):
            enqueue("backup")


def run():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    initialize()
    # Session advisory lock guarantees a single scheduler/worker for this database.
    lock_connection = engine.connect()
    if not lock_connection.execute(text("SELECT pg_try_advisory_lock(7731002)")).scalar():
        raise RuntimeError("A worker is already active for this database")
    lock_connection.commit()
    run_id = os.environ.get("ETIP_RUN_ID")
    stop_file = DATA / "runtime" / f"{run_id}.stop" if run_id else None
    with session_scope() as session:
        for interrupted in session.scalars(select(Job).where(Job.status == "running")).all():
            interrupted.status = "interrupted"
            interrupted.finished_at = now()
            interrupted.message = (
                "Previous worker stopped before completion; completed ingestion chunks are preserved."
            )
    signal.signal(signal.SIGINT, lambda *args: stopping.set())
    signal.signal(signal.SIGTERM, lambda *args: stopping.set())
    try:
        while not stopping.is_set() and not (stop_file and stop_file.exists()):
            heartbeat()
            schedule()
            item = claim()
            if not item:
                stopping.wait(3)
                continue
            job_id, kind, parameters = item
            pulse_stop = threading.Event()

            def pulse():
                while not pulse_stop.wait(10):
                    try:
                        heartbeat(job_id)
                    except Exception:
                        log.exception("Heartbeat update failed")

            thread = threading.Thread(target=pulse, daemon=True)
            thread.start()
            try:
                result = execute(job_id, kind, parameters)
                with session_scope() as session:
                    job = session.get(Job, job_id)
                    failures = result.get("failures", [])
                    job.status = "partial" if failures else "complete"
                    job.result, job.progress, job.finished_at = result, 100, now()
                    job.message = (
                        "Completed with provider gaps; inspect details"
                        if failures
                        else "Completed successfully"
                    )
                log.info("Completed %s (%s)", kind, job_id)
            except Exception as exc:
                log.exception("Job failed: %s", kind)
                with session_scope() as session:
                    job = session.get(Job, job_id)
                    job.status, job.finished_at, job.message = "failed", now(), str(exc)[:2000]
            finally:
                pulse_stop.set()
                thread.join(timeout=1)
    finally:
        with session_scope() as session:
            state = session.get(WorkerState, "local")
            if state:
                state.running = False
        lock_connection.close()
        engine.dispose()


if __name__ == "__main__":
    run()
