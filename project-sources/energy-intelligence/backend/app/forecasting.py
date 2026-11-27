"""Publication-aware direct 24h demand forecasts and chronological research protocol.

All fitting, scaling and interval calibration precede each evaluation origin. Final
test periods never participate in champion selection. No observations are fabricated.
"""

from __future__ import annotations

import hashlib
import math
import platform
import uuid

import joblib
import numpy as np
import pandas as pd
import sklearn
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.linear_model import Ridge
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from sqlalchemy import select

from app.config import DATA
from app.db import ForecastPoint, ModelRun, Observation, WeatherVintage, now, session_scope, utc

CORE_FEATURES = [
    "lag_24h",
    "lag_48h",
    "lag_7d",
    "previous_day_mean",
    "previous_day_std",
    "hour_sin",
    "hour_cos",
    "weekday_sin",
    "weekday_cos",
    "year_sin",
    "year_cos",
    "weekend",
]
WEATHER_FEATURES = ["temperature", "wind_speed", "radiation"]
CANDIDATES = ["Seasonal naive", "Ridge regression", "Gradient boosting"]


class InsufficientData(ValueError):
    pass


def metrics(actual, predicted, lower=None, upper=None) -> dict:
    a, p = np.asarray(actual, dtype=float), np.asarray(predicted, dtype=float)
    valid = np.isfinite(a) & np.isfinite(p)
    a, p = a[valid], p[valid]
    if not len(a):
        return {"n": 0, "mae": None, "rmse": None, "wape": None, "bias": None, "coverage": None}
    denominator = float(np.abs(a).sum())
    coverage = None
    if lower is not None and upper is not None:
        lo, hi = np.asarray(lower)[valid], np.asarray(upper)[valid]
        coverage = float(np.mean((a >= lo) & (a <= hi)) * 100)
    return {
        "n": len(a),
        "mae": float(np.mean(np.abs(a - p))),
        "rmse": float(np.sqrt(np.mean((a - p) ** 2))),
        "wape": float(np.abs(a - p).sum() / denominator * 100) if denominator else None,
        "bias": float(np.mean(p - a)),
        "coverage": coverage,
    }


def load_demand() -> pd.DataFrame:
    with session_scope() as session:
        rows = session.execute(
            select(
                Observation.time,
                Observation.value,
                Observation.published_at,
                Observation.fetched_at,
                Observation.id,
            )
            .where(Observation.metric == "demand")
            .order_by(Observation.time)
        ).all()
    if not rows:
        raise InsufficientData("No national demand observations. Run a real-data backfill first.")
    frame = pd.DataFrame(rows, columns=["time", "value", "published_at", "fetched_at", "id"])
    for c in ("time", "published_at", "fetched_at"):
        frame[c] = pd.to_datetime(frame[c], utc=True)
    return frame.sort_values(["time", "published_at", "fetched_at", "id"])


def known_series(frame: pd.DataFrame, cutoff: pd.Timestamp) -> pd.Series:
    known = frame[frame.published_at <= cutoff].drop_duplicates("time", keep="last")
    return known.set_index("time")["value"].sort_index()


def load_weather() -> pd.DataFrame:
    with session_scope() as session:
        rows = session.execute(
            select(
                WeatherVintage.location,
                WeatherVintage.available_at,
                WeatherVintage.valid_time,
                WeatherVintage.temperature,
                WeatherVintage.wind_speed,
                WeatherVintage.radiation,
                WeatherVintage.id,
            )
        ).all()
    frame = pd.DataFrame(rows, columns=["location", "available_at", "valid_time", *WEATHER_FEATURES, "id"])
    if len(frame):
        frame["available_at"] = pd.to_datetime(frame.available_at, utc=True)
        frame["valid_time"] = pd.to_datetime(frame.valid_time, utc=True)
    return frame


def feature_frame(
    demand: pd.DataFrame, origin: pd.Timestamp, targets: pd.DatetimeIndex, weather: pd.DataFrame | None = None
) -> pd.DataFrame:
    """Every feature value must be observable at origin; no forward/backward filling."""
    known = known_series(demand, origin)
    features = pd.DataFrame(index=targets)
    for label, hours in (("lag_24h", 24), ("lag_48h", 48), ("lag_7d", 168)):
        lag_times = targets - pd.Timedelta(hours=hours)
        # Prevent an accidental future feature if a caller asks for >24h horizons.
        values = known.reindex(lag_times).to_numpy()
        values[lag_times >= origin] = np.nan
        features[label] = values
    previous = known[(known.index >= origin - pd.Timedelta(days=1)) & (known.index < origin)]
    features["previous_day_mean"] = previous.mean() if len(previous) >= 44 else np.nan
    features["previous_day_std"] = previous.std() if len(previous) >= 44 else np.nan
    local = targets.tz_convert("Europe/London")
    hour = local.hour + local.minute / 60
    features["hour_sin"], features["hour_cos"] = np.sin(hour * 2 * np.pi / 24), np.cos(hour * 2 * np.pi / 24)
    features["weekday_sin"] = np.sin(local.dayofweek * 2 * np.pi / 7)
    features["weekday_cos"] = np.cos(local.dayofweek * 2 * np.pi / 7)
    features["year_sin"] = np.sin(local.dayofyear * 2 * np.pi / 365.25)
    features["year_cos"] = np.cos(local.dayofyear * 2 * np.pi / 365.25)
    features["weekend"] = (local.dayofweek >= 5).astype(int)
    for c in WEATHER_FEATURES:
        features[c] = np.nan
    if weather is not None and len(weather):
        eligible = weather[weather.available_at <= origin].sort_values("available_at")
        latest = eligible.drop_duplicates(["location", "valid_time"], keep="last")
        complete = latest.groupby("valid_time")[WEATHER_FEATURES].count().min(axis=1) == 6
        mean = latest.groupby("valid_time")[WEATHER_FEATURES].mean().loc[complete]
        for c in WEATHER_FEATURES:
            features[c] = mean[c].reindex(targets.floor("h")).to_numpy()
    return features


def training_samples(demand: pd.DataFrame, weather: pd.DataFrame) -> pd.DataFrame:
    truth = demand.drop_duplicates("time", keep="last").set_index("time")
    start = demand.time.min().normalize() + pd.Timedelta(days=8)
    end = demand.time.max().normalize()
    samples = []
    for origin in pd.date_range(start, end, freq="D"):
        targets = pd.date_range(origin, periods=48, freq="30min")
        features = feature_frame(demand, origin, targets, weather)
        features["actual"] = truth.value.reindex(targets)
        features["label_published_at"] = truth.published_at.reindex(targets)
        features["origin"] = origin
        features["target"] = targets
        samples.append(features)
    if not samples:
        raise InsufficientData("At least eight days of valid demand history are needed to form lag features.")
    return pd.concat(samples).dropna(subset=[*CORE_FEATURES, "actual", "label_published_at"])


def estimator(name: str):
    if name in ("Ridge regression", "Weather ridge regression"):
        return make_pipeline(StandardScaler(), Ridge(alpha=20))
    if name in ("Gradient boosting", "Weather gradient boosting"):
        return HistGradientBoostingRegressor(
            max_iter=90,
            max_leaf_nodes=15,
            learning_rate=0.06,
            l2_regularization=10,
            random_state=42,
            early_stopping=False,
        )
    return None


def predict(model, frame: pd.DataFrame, columns: list[str]) -> np.ndarray:
    values = frame["lag_7d"].to_numpy() if model is None else model.predict(frame[columns])
    return np.maximum(values, 0)


def finite_sample_quantile(errors: np.ndarray, coverage=0.90) -> float:
    errors = np.asarray(errors, dtype=float)
    errors = errors[np.isfinite(errors)]
    if not len(errors):
        raise InsufficientData("No independent calibration residuals available")
    level = min(1, math.ceil((len(errors) + 1) * coverage) / len(errors))
    return float(np.quantile(errors, level, method="higher"))


def fit_at(samples: pd.DataFrame, origin: pd.Timestamp, name: str, columns: list[str]):
    eligible = samples[(samples.target < origin) & (samples.label_published_at <= origin)].dropna(
        subset=columns
    )
    split = origin - pd.Timedelta(days=7)
    train = eligible[eligible.target < split]
    calibration = eligible[eligible.target >= split]
    if len(train) < 28 * 44 or len(calibration) < 5 * 44:
        raise InsufficientData(
            "Need 28 training days and at least five complete calibration days before each origin"
        )
    model = estimator(name)
    if model is not None:
        model.fit(train[columns], train.actual)
    errors = np.abs(calibration.actual.to_numpy() - predict(model, calibration, columns))
    q = finite_sample_quantile(errors)
    return (
        model,
        q,
        {
            "training_rows": len(train),
            "calibration_rows": len(calibration),
            "train_end": train.target.max().isoformat(),
            "calibration_start": calibration.target.min().isoformat(),
        },
    )


def evaluate_period(samples, origins, candidates, progress=lambda *args: None, stage="validation"):
    output = {name: [] for name in candidates}
    fold_info = []
    for i, origin in enumerate(origins):
        progress(int(15 + i * 60 / max(len(origins), 1)), f"{stage.title()} fold {i + 1}/{len(origins)}")
        test = samples[samples.origin == origin]
        if len(test) < 44:
            raise InsufficientData(
                f"Evaluation day {origin:%Y-%m-%d} has fewer than 44 eligible settlement periods"
            )
        for name in candidates:
            columns = CORE_FEATURES + (WEATHER_FEATURES if name.startswith("Weather") else [])
            test_rows = test.dropna(subset=columns)
            if len(test_rows) != len(test):
                raise InsufficientData(
                    "Weather coverage is incomplete on evaluation rows; backfill archived runs"
                )
            model, q, info = fit_at(samples, origin, name, columns)
            predictions = predict(model, test_rows, columns)
            for target, actual, estimate in zip(test_rows.target, test_rows.actual, predictions, strict=True):
                output[name].append(
                    {
                        "time": target.isoformat(),
                        "origin": origin.isoformat(),
                        "actual": float(actual),
                        "predicted": float(estimate),
                        "lower": float(max(0, estimate - q)),
                        "upper": float(estimate + q),
                    }
                )
        fold_info.append({"origin": origin.isoformat(), "test_rows": len(test), **info})
    scores = {}
    for name, points in output.items():
        scores[name] = metrics(
            [r["actual"] for r in points],
            [r["predicted"] for r in points],
            [r["lower"] for r in points],
            [r["upper"] for r in points],
        )
    return scores, output, fold_info


def run_forecast(progress=lambda *args: None) -> dict:
    progress(2, "Loading published demand vintages and archived weather")
    demand, weather = load_demand(), load_weather()
    samples = training_samples(demand, weather)
    complete_end = min(
        pd.Timestamp(now()).normalize(), (demand.time.max() + pd.Timedelta(minutes=30)).normalize()
    )
    test_start = complete_end - pd.Timedelta(days=7)
    validation_start = test_start - pd.Timedelta(days=7)
    if samples.target.min() > validation_start - pd.Timedelta(days=36):
        raise InsufficientData(
            "Backfill at least 60 days: lag warmup, training, calibration, validation and final test are separate."
        )
    candidates = list(CANDIDATES)
    weather_coverage = float(samples[WEATHER_FEATURES].notna().all(axis=1).mean())
    # No weather imputation. Enable this candidate only with complete archived coverage.
    if weather_coverage == 1.0:
        candidates.extend(["Weather ridge regression", "Weather gradient boosting"])
    validation_origins = pd.date_range(validation_start, test_start - pd.Timedelta(days=1), freq="D")
    selection, _, _ = evaluate_period(samples, validation_origins, candidates, progress, "model selection")
    winner = min(candidates, key=lambda name: selection[name]["rmse"])
    test_origins = pd.date_range(test_start, complete_end - pd.Timedelta(days=1), freq="D")
    test_scores, test_points, folds = evaluate_period(
        samples, test_origins, candidates, progress, "untouched test"
    )
    cutoff = pd.Timestamp(now())
    columns = CORE_FEATURES + (WEATHER_FEATURES if winner.startswith("Weather") else [])
    model, q, fit_info = fit_at(samples, cutoff, winner, columns)
    known = known_series(demand, cutoff)
    if cutoff - known.index.max() > pd.Timedelta(hours=3):
        raise InsufficientData(
            "Demand is more than three hours old; refresh before publishing a new forecast."
        )
    targets = pd.date_range(known.index.max() + pd.Timedelta(minutes=30), periods=48, freq="30min")
    features = feature_frame(demand, cutoff, targets, weather)
    if features[columns].isna().any().any():
        missing = features[columns].isna().sum().loc[lambda x: x > 0].to_dict()
        raise InsufficientData(
            f"Current forecast has missing eligible inputs: {missing}. Refresh data before forecasting."
        )
    values = predict(model, features, columns)
    ceiling = max(known.max() * 1.5, 10_000)
    if not np.isfinite(values).all() or (values > ceiling).any():
        raise ValueError("Forecast failed the finite/physical envelope check; no curve was published")
    run_id = str(uuid.uuid4())
    input_ids = sorted(demand.id.tolist()) + (sorted(weather.id.tolist()) if len(weather) else [])
    fingerprint = hashlib.sha256("|".join(input_ids).encode()).hexdigest()
    artifact = DATA / "models" / f"{run_id}.joblib"
    samples.to_csv(DATA / "models" / f"{run_id}.samples.csv.gz", index=False, compression="gzip")
    features.to_csv(DATA / "models" / f"{run_id}.forecast-features.csv", index_label="target_utc")
    joblib.dump(
        {
            "model": model,
            "columns": columns,
            "interval_radius": q,
            "cutoff": cutoff.isoformat(),
            "input_fingerprint": fingerprint,
            "sklearn_version": sklearn.__version__,
        },
        artifact,
    )
    metadata = {
        "target": "GB Initial National Demand Outturn (INDO)",
        "unit": "MW",
        "horizon_hours": 24,
        "selection_metric": "Validation RMSE",
        "validation_start": validation_start.isoformat(),
        "test_start": test_start.isoformat(),
        "test_end": complete_end.isoformat(),
        "selection_scores": selection,
        "test_scores": test_scores,
        "test_points": test_points,
        "folds": folds,
        "features": columns,
        "weather_coverage": weather_coverage,
        "weather_enabled": winner.startswith("Weather"),
        "interval_nominal_coverage": 90,
        "interval_method": "Independent trailing seven-day absolute residual quantile; empirical calibration, no coverage guarantee under distribution shift",
        "data_start": demand.time.min().isoformat(),
        "data_end": demand.time.max().isoformat(),
        "input_fingerprint": fingerprint,
        "sample_snapshot": f"models/{run_id}.samples.csv.gz",
        "forecast_feature_snapshot": f"models/{run_id}.forecast-features.csv",
        "random_seed": 42,
        "fit": fit_info,
        "versions": {
            "python": platform.python_version(),
            "sklearn": sklearn.__version__,
            "numpy": np.__version__,
            "pandas": pd.__version__,
        },
        "limitations": [
            "Latest available actuals are evaluation targets; historical revision availability can be incomplete.",
            "Historical feature eligibility uses provider publication timestamps; as-recorded replay only exists after local ingestion began.",
            "Archived weather availability is conservatively assumed at initialization + 8h, not a measured publication timestamp.",
            "Weather is an equally weighted six-city sample; it is not population or wind-farm weighted.",
            "UTC forecast windows and Europe/London calendar features are explicit; no price profitability is inferred.",
            "Inference artifacts are local trusted files; never load an untrusted joblib file.",
        ],
    }
    with session_scope() as session:
        session.add(
            ModelRun(
                id=run_id,
                cutoff=cutoff.to_pydatetime(),
                model=winner,
                status="complete",
                artifact=str(artifact.relative_to(DATA)),
                metadata_json=metadata,
            )
        )
        for i, (target, value) in enumerate(zip(targets, values, strict=True)):
            session.add(
                ForecastPoint(
                    id=f"{run_id}:{i}",
                    run_id=run_id,
                    time=target.to_pydatetime(),
                    value=float(value),
                    lower=float(max(0, value - q)),
                    upper=float(value + q),
                    baseline=float(features.loc[target, "lag_7d"]),
                )
            )
    progress(100, f"Published 24h forecast: {winner}")
    return {
        "run_id": run_id,
        "winner": winner,
        "test_scores": test_scores,
        "weather_enabled": metadata["weather_enabled"],
    }


def score_forecasts() -> int:
    demand = load_demand()
    actuals = known_series(demand, pd.Timestamp(now()))
    count = 0
    with session_scope() as session:
        points = session.scalars(select(ForecastPoint).where(ForecastPoint.actual.is_(None))).all()
        for point in points:
            key = pd.Timestamp(utc(point.time))
            if key in actuals.index:
                point.actual = float(actuals.loc[key])
                count += 1
    return count
