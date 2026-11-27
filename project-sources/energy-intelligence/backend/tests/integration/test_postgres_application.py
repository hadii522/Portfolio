"""Run against a disposable PostgreSQL database, never the application database."""

import uuid
from datetime import UTC, datetime, timedelta

import psycopg
import pytest
from app import db
from app.collectors import store_observations
from app.config import settings
from app.repository import latest_rows, observation_id
from fastapi.testclient import TestClient
from psycopg import sql
from sqlalchemy import create_engine
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker

pytestmark = pytest.mark.integration


@pytest.fixture(scope="module")
def database_url():
    url = make_url(settings.database_url)
    name = "etip_test_" + uuid.uuid4().hex[:12]
    connect = {
        "host": url.host,
        "port": url.port,
        "user": url.username,
        "password": url.password,
        "dbname": "postgres",
    }
    with psycopg.connect(**connect, autocommit=True) as connection:
        connection.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(name)))
    yield url.set(database=name)
    with psycopg.connect(**connect, autocommit=True) as connection:
        connection.execute(sql.SQL("DROP DATABASE {} WITH (FORCE)").format(sql.Identifier(name)))


@pytest.fixture
def isolated_database(database_url, monkeypatch):
    engine = create_engine(database_url)
    monkeypatch.setattr(db, "engine", engine)
    monkeypatch.setattr(db, "Session", sessionmaker(engine, expire_on_commit=False))
    db.initialize()
    with engine.begin() as connection:
        for table in reversed(db.Base.metadata.sorted_tables):
            if table.name != "app_settings":
                connection.execute(table.delete())
    yield engine
    engine.dispose()


def point(value, published, fetched):
    timestamp = datetime(2026, 11, 1, tzinfo=UTC)
    return {
        "id": observation_id("demand", "Elexon", timestamp, published, value),
        "metric": "demand",
        "source": "Elexon",
        "market": "GB",
        "time": timestamp,
        "published_at": published,
        "fetched_at": fetched,
        "value": value,
        "unit": "MW",
        "archive": "raw/test.json",
        "quality": "published",
    }


def test_duplicate_imports_and_asof_revisions(isolated_database):
    first_publication = datetime(2026, 11, 1, 0, 30, tzinfo=UTC)
    revision = first_publication + timedelta(days=1)
    first = point(30000, first_publication, revision)
    assert store_observations([first]) == 1
    assert store_observations([first]) == 0
    assert store_observations([point(31000, revision, revision)]) == 1
    assert latest_rows("demand")[0]["value"] == 31000
    assert latest_rows("demand", as_of=first_publication)[0]["value"] == 30000
    assert latest_rows("demand", as_of=first_publication, recorded_as_of=True) == []


def test_write_auth_origin_and_job_deduplication(isolated_database, monkeypatch):
    from app import main

    monkeypatch.setattr(main, "engine", isolated_database)
    with TestClient(main.app) as client:
        assert client.post("/api/v1/jobs", json={"kind": "sync"}).status_code == 401
        token = client.get("/api/v1/session").json()["token"]
        headers = {"X-ETIP-Token": token, "Origin": "https://untrusted.example"}
        assert client.post("/api/v1/jobs", headers=headers, json={"kind": "sync"}).status_code == 403
        headers["Origin"] = "http://127.0.0.1:3000"
        first = client.post("/api/v1/jobs", headers=headers, json={"kind": "sync"})
        second = client.post("/api/v1/jobs", headers=headers, json={"kind": "sync"})
        assert first.status_code == 202
        assert second.json()["deduplicated"] is True
        assert first.json()["id"] == second.json()["id"]
        assert (
            client.post(
                "/api/v1/jobs", headers=headers, json={"kind": "weather_history", "days": 500}
            ).status_code
            == 422
        )


def test_empty_reads_and_csv_export_have_honest_shapes(isolated_database, monkeypatch):
    from app import main

    monkeypatch.setattr(main, "engine", isolated_database)
    with TestClient(main.app) as client:
        assert client.get("/api/v1/forecasts/latest").json()["available"] is False
        assert client.get("/api/v1/series?metric=demand").json()["points"] == []
        assert client.get("/api/v1/series?metric=unknown").status_code == 422
        response = client.get("/api/v1/export?metric=demand")
        assert response.status_code == 200
        assert response.text.startswith("time_utc,value,unit,source,published_at,fetched_at,quality")
        assert client.get("/api/v1/archive?path=local-secrets.json").status_code == 404
        assert client.get("/api/v1/archive?path=../.env").status_code == 404


def test_logical_backup_restore_preserves_values_and_settings(isolated_database, monkeypatch, tmp_path):
    from app import operations

    monkeypatch.setattr(operations, "engine", isolated_database)
    monkeypatch.setattr(operations, "DATA", tmp_path)
    for folder in ("raw", "models", "backups"):
        (tmp_path / folder).mkdir()
    (tmp_path / "raw" / "source.json").write_text('{"source":"verified fixture"}', encoding="utf-8")
    (tmp_path / "models" / "card.json").write_text('{"version":1}', encoding="utf-8")
    published = datetime(2026, 11, 1, 0, 30, tzinfo=UTC)
    store_observations([point(30000, published, published)])
    with db.session_scope() as session:
        session.get(db.AppSetting, "automation").value = {"enabled": False, "interval_minutes": 60}
    result = operations.logical_backup()
    assert result["integrity"] == "ZIP CRC verified"
    with isolated_database.begin() as connection:
        connection.execute(db.Observation.__table__.delete())
    restored = operations.restore_backup(str(tmp_path / result["file"]))
    assert restored["restored"]["observations"] == 1
    assert latest_rows("demand")[0]["value"] == 30000
    with db.session_scope() as session:
        assert session.get(db.AppSetting, "automation").value["enabled"] is False
    with pytest.raises(ValueError, match="empty database"):
        operations.restore_backup(str(tmp_path / result["file"]))
