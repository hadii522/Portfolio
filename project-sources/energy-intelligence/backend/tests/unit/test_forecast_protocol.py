import numpy as np
import pandas as pd
import pytest
from app.forecasting import feature_frame, finite_sample_quantile, known_series, metrics


def frame():
    times = pd.date_range("2026-10-01", periods=10 * 48, freq="30min", tz="UTC")
    return pd.DataFrame(
        {
            "time": times,
            "value": np.arange(len(times), dtype=float) + 20000,
            "published_at": times + pd.Timedelta(minutes=30),
            "fetched_at": times + pd.Timedelta(minutes=31),
            "id": [str(i) for i in range(len(times))],
        }
    )


def test_late_revision_is_ineligible_before_publication():
    data = frame()
    origin = pd.Timestamp("2026-10-10", tz="UTC")
    revision = data.iloc[[-70]].copy()
    revision["value"] = 99999
    revision["published_at"] = origin + pd.Timedelta(hours=1)
    data = pd.concat([data, revision]).sort_values(["time", "published_at", "fetched_at", "id"])
    eligible = known_series(data, origin)
    assert eligible.loc[revision.time.iloc[0]] != 99999


def test_future_targets_never_read_future_demand_values():
    data = frame()
    origin = pd.Timestamp("2026-10-09", tz="UTC")
    targets = pd.date_range(origin, periods=48, freq="30min")
    before = feature_frame(data, origin, targets)
    data.loc[data.time >= origin, "value"] = -999999
    after = feature_frame(data, origin, targets)
    pd.testing.assert_frame_equal(before, after)
    assert not before["lag_24h"].isna().any()


def test_longer_horizon_does_not_read_lags_past_origin():
    data = frame()
    origin = pd.Timestamp("2026-10-09", tz="UTC")
    targets = pd.date_range(origin, periods=49, freq="30min")
    features = feature_frame(data, origin, targets)
    assert pd.isna(features.iloc[-1]["lag_24h"])


def test_weather_requires_availability_and_all_six_locations():
    data = frame()
    origin = pd.Timestamp("2026-10-09", tz="UTC")
    targets = pd.date_range(origin, periods=1, freq="30min")
    weather = pd.DataFrame(
        {
            "location": [str(i) for i in range(6)],
            "available_at": [origin + pd.Timedelta(hours=1)] * 6,
            "valid_time": [origin] * 6,
            "temperature": [10.0] * 6,
            "wind_speed": [5.0] * 6,
            "radiation": [100.0] * 6,
        }
    )
    assert feature_frame(data, origin, targets, weather).temperature.isna().all()
    weather["available_at"] = origin - pd.Timedelta(hours=1)
    assert feature_frame(data, origin, targets, weather).temperature.iloc[0] == 10
    assert feature_frame(data, origin, targets, weather.iloc[:5]).temperature.isna().all()


def test_metrics_handle_zeros_and_nonfinite_values_explicitly():
    score = metrics([0, 0, np.nan], [1, 2, 3])
    assert score["n"] == 2
    assert score["wape"] is None
    assert score["mae"] == 1.5
    assert metrics([], [])["rmse"] is None


def test_calibration_quantile_uses_finite_sample_upper_order_statistic():
    assert finite_sample_quantile(np.arange(1, 10, dtype=float), 0.9) == 9
    with pytest.raises(ValueError):
        finite_sample_quantile(np.array([]))
