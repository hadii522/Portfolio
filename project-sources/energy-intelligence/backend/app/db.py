"""Synchronous repository layer; API handlers use FastAPI's thread pool."""

from __future__ import annotations

from contextlib import contextmanager
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import JSON, Boolean, DateTime, Float, Index, Integer, String, Text, create_engine, text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker

from app.config import settings


def now() -> datetime:
    return datetime.now(UTC)


def utc(value: datetime | str) -> datetime:
    dt = datetime.fromisoformat(value.replace("Z", "+00:00")) if isinstance(value, str) else value
    return dt.replace(tzinfo=UTC) if dt.tzinfo is None else dt.astimezone(UTC)


def iso(value: datetime | None) -> str | None:
    return utc(value).isoformat().replace("+00:00", "Z") if value else None


class Base(DeclarativeBase):
    pass


class Observation(Base):
    __tablename__ = "observations"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    metric: Mapped[str] = mapped_column(String(80), index=True)
    source: Mapped[str] = mapped_column(String(40))
    market: Mapped[str] = mapped_column(String(12), default="GB")
    time: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    published_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    value: Mapped[float] = mapped_column(Float)
    unit: Mapped[str] = mapped_column(String(24))
    archive: Mapped[str] = mapped_column(String(260))
    quality: Mapped[str] = mapped_column(String(32), default="published")
    __table_args__ = (Index("ix_obs_metric_time_pub", "metric", "time", "published_at"),)


class WeatherVintage(Base):
    __tablename__ = "weather_vintages"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    location: Mapped[str] = mapped_column(String(40))
    run_time: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    available_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    valid_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    temperature: Mapped[float | None] = mapped_column(Float, nullable=True)
    wind_speed: Mapped[float | None] = mapped_column(Float, nullable=True)
    radiation: Mapped[float | None] = mapped_column(Float, nullable=True)
    archive: Mapped[str] = mapped_column(String(260))
    basis: Mapped[str] = mapped_column(String(50), default="retrieved-at")


class Job(Base):
    __tablename__ = "jobs"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    kind: Mapped[str] = mapped_column(String(32), index=True)
    status: Mapped[str] = mapped_column(String(24), default="queued", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    heartbeat: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    progress: Mapped[int] = mapped_column(Integer, default=0)
    message: Mapped[str] = mapped_column(Text, default="Waiting for worker")
    parameters: Mapped[dict] = mapped_column(JSON, default=dict)
    result: Mapped[dict | None] = mapped_column(JSON, nullable=True)


class PipelineEvent(Base):
    __tablename__ = "pipeline_events"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    job_id: Mapped[str] = mapped_column(String(36), index=True)
    source: Mapped[str] = mapped_column(String(50))
    dataset: Mapped[str] = mapped_column(String(80))
    time: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    status: Mapped[str] = mapped_column(String(24))
    accepted: Mapped[int] = mapped_column(Integer, default=0)
    rejected: Mapped[int] = mapped_column(Integer, default=0)
    detail: Mapped[str] = mapped_column(Text, default="")
    archive: Mapped[str | None] = mapped_column(String(260), nullable=True)


class ModelRun(Base):
    __tablename__ = "model_runs"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    cutoff: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    model: Mapped[str] = mapped_column(String(60))
    status: Mapped[str] = mapped_column(String(24))
    artifact: Mapped[str | None] = mapped_column(String(260), nullable=True)
    metadata_json: Mapped[dict] = mapped_column(JSON)


class ForecastPoint(Base):
    __tablename__ = "forecast_points"
    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    run_id: Mapped[str] = mapped_column(String(36), index=True)
    time: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    value: Mapped[float] = mapped_column(Float)
    lower: Mapped[float] = mapped_column(Float)
    upper: Mapped[float] = mapped_column(Float)
    baseline: Mapped[float | None] = mapped_column(Float, nullable=True)
    actual: Mapped[float | None] = mapped_column(Float, nullable=True)


class Report(Base):
    __tablename__ = "reports"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    title: Mapped[str] = mapped_column(String(200))
    engine: Mapped[str] = mapped_column(String(40))
    status: Mapped[str] = mapped_column(String(32))
    payload: Mapped[dict] = mapped_column(JSON)


class AppSetting(Base):
    __tablename__ = "app_settings"
    key: Mapped[str] = mapped_column(String(60), primary_key=True)
    value: Mapped[dict] = mapped_column(JSON)


class WorkerState(Base):
    __tablename__ = "worker_state"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    heartbeat: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    running: Mapped[bool] = mapped_column(Boolean, default=True)


engine = create_engine(settings.database_url, pool_pre_ping=True, pool_size=8, max_overflow=8)
Session = sessionmaker(engine, expire_on_commit=False)


@contextmanager
def session_scope():
    with Session() as session:
        try:
            yield session
            session.commit()
        except Exception:
            session.rollback()
            raise


def initialize() -> None:
    with engine.begin() as connection:
        if engine.dialect.name == "postgresql":
            connection.execute(text("SELECT pg_advisory_xact_lock(7731001)"))
        Base.metadata.create_all(connection)
        connection.execute(text("CREATE TABLE IF NOT EXISTS schema_versions (version INTEGER PRIMARY KEY)"))
        connection.execute(text("INSERT INTO schema_versions(version) VALUES (1) ON CONFLICT DO NOTHING"))
    with session_scope() as session:
        if session.get(AppSetting, "automation") is None:
            session.add(AppSetting(key="automation", value={"enabled": True, "interval_minutes": 30}))


def record_to_dict(record: Any, fields: tuple[str, ...]) -> dict:
    return {
        field: iso(value) if isinstance(value := getattr(record, field), datetime) else value
        for field in fields
    }
