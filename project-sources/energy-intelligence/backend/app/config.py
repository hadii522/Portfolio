"""Absolute-path local configuration; the original .env is never rewritten."""

from __future__ import annotations

import json
import os
import secrets
from dataclasses import dataclass
from pathlib import Path

from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parents[2]
DATA = Path(os.environ.get("ETIP_DATA_DIR", ROOT / "data")).resolve()
DATA.mkdir(parents=True, exist_ok=True)
for folder in ("raw", "models", "backups", "logs"):
    (DATA / folder).mkdir(exist_ok=True)
LOCAL_ENV = {**dotenv_values(ROOT / ".env.local"), **os.environ}
LEGACY_ENV = dotenv_values(ROOT / ".env")
SECRETS_PATH = DATA / "local-secrets.json"
if not SECRETS_PATH.exists():
    initial = {"pgPassword": secrets.token_urlsafe(32), "apiToken": secrets.token_urlsafe(48), "pgPort": 5433}
    try:
        with SECRETS_PATH.open("x", encoding="utf-8") as f:
            json.dump(initial, f)
    except FileExistsError:
        pass
LOCAL_SECRETS = json.loads(SECRETS_PATH.read_text(encoding="utf-8"))


@dataclass(frozen=True)
class Settings:
    database_url: str = LOCAL_ENV.get("ETIP_DATABASE_URL") or (
        f"postgresql+psycopg://etip:{LOCAL_SECRETS['pgPassword']}@127.0.0.1:{LOCAL_SECRETS['pgPort']}/etip"
    )
    api_token: str = LOCAL_SECRETS["apiToken"]
    groq_key: str = LOCAL_ENV.get("GROQ_API_KEY") or LEGACY_ENV.get("GROQ_API_KEY") or ""
    openrouter_key: str = LOCAL_ENV.get("OPENROUTER_API_KEY") or LEGACY_ENV.get("OPENROUTER_API_KEY") or ""
    llm_model: str = LOCAL_ENV.get("ETIP_LLM_MODEL") or "llama-3.3-70b-versatile"
    elexon_url: str = "https://data.elexon.co.uk/bmrs/api/v1"
    origins: tuple[str, ...] = (
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
    )


settings = Settings()
