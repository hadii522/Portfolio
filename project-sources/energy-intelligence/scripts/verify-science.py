"""Reproduce stored predictions from trusted local model and feature artifacts."""

import json

import joblib
import numpy as np
import pandas as pd
from app.config import DATA, ROOT
from app.db import ForecastPoint, ModelRun, now, session_scope
from sqlalchemy import select

with session_scope() as session:
    run = session.scalar(
        select(ModelRun).where(ModelRun.status == "complete").order_by(ModelRun.created_at.desc()).limit(1)
    )
    assert run is not None
    path = (DATA / run.artifact).resolve()
    assert path.is_relative_to((DATA / "models").resolve())
    artifact = joblib.load(path)
    features = pd.read_csv(DATA / run.metadata_json["forecast_feature_snapshot"])
    predictions = np.maximum(
        artifact["model"].predict(features[artifact["columns"]])
        if artifact["model"] is not None
        else features.lag_7d.to_numpy(),
        0,
    )
    points = session.scalars(
        select(ForecastPoint).where(ForecastPoint.run_id == run.id).order_by(ForecastPoint.time)
    ).all()
    difference = float(np.max(np.abs(predictions - np.array([p.value for p in points]))))
    assert difference < 1e-5, f"Stored model does not reproduce predictions: {difference}"
    assert artifact["input_fingerprint"] == run.metadata_json["input_fingerprint"]
    result = {
        "verified_at": now().isoformat(),
        "run_id": run.id,
        "model": run.model,
        "reproduced_points": len(points),
        "max_absolute_difference_mw": difference,
        "input_fingerprint": artifact["input_fingerprint"],
    }
(ROOT / "work" / "science-verification.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
print(json.dumps(result, indent=2))
