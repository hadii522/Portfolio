from datetime import UTC, datetime, timedelta

import pytest
from app.collectors import parse_elexon, settlement_windows, validate_point

START = datetime(2026, 11, 1, tzinfo=UTC)
END = START + timedelta(days=1)
FETCHED = END + timedelta(days=1)


@pytest.mark.parametrize("value", [None, True, float("nan"), float("inf"), "not-a-number"])
def test_invalid_values_never_enter_observations(value):
    with pytest.raises((ValueError, TypeError)):
        validate_point("demand", value, START, START + timedelta(minutes=30), START, END, FETCHED)


def test_negative_prices_are_valid_and_not_clipped():
    value, _, _ = validate_point("imbalance_price", -125.5, START, END, START, END, FETCHED)
    assert value == -125.5


def test_window_is_half_open_and_timestamps_are_not_floored():
    with pytest.raises(ValueError, match="outside requested"):
        validate_point("demand", 30000, END, END, START, END, FETCHED)
    with pytest.raises(ValueError, match="never silently floor"):
        validate_point("demand", 30000, START + timedelta(minutes=7), END, START, END, FETCHED)


def test_national_and_transmission_demand_remain_distinct():
    payload = {
        "data": [
            {
                "startTime": START.isoformat(),
                "publishTime": (START + timedelta(minutes=30)).isoformat(),
                "initialDemandOutturn": 25000,
                "initialTransmissionSystemDemandOutturn": 31000,
            }
        ]
    }
    rows, errors = parse_elexon(payload, "demand", START, END, FETCHED, "raw/test.json")
    assert not errors
    assert {r["metric"]: r["value"] for r in rows} == {"demand": 25000, "transmission_demand": 31000}


def test_generation_without_publication_deduplicates_but_records_a_correction():
    payload = {
        "data": [{"startTime": START.isoformat(), "data": [{"psrType": "Wind Offshore", "quantity": 4000}]}]
    }
    first, _ = parse_elexon(payload, "generation", START, END, FETCHED, "raw/a.json")
    second, _ = parse_elexon(payload, "generation", START, END, FETCHED + timedelta(hours=1), "raw/b.json")
    assert first[0]["id"] == second[0]["id"]
    assert first[0]["quality"] == "retrieved-at"
    payload["data"][0]["data"][0]["quantity"] = 4100
    corrected, _ = parse_elexon(payload, "generation", START, END, FETCHED + timedelta(hours=2), "raw/c.json")
    assert corrected[0]["id"] != first[0]["id"]


def test_foreign_window_records_are_rejected_independently_of_provider_filtering():
    payload = {
        "data": [
            {
                "startTime": (START - timedelta(days=1)).isoformat(),
                "publishTime": START.isoformat(),
                "initialDemandOutturn": 30000,
                "initialTransmissionSystemDemandOutturn": 32000,
            }
        ]
    }
    rows, errors = parse_elexon(payload, "demand", START, END, FETCHED, "raw/test.json")
    assert rows == []
    assert len(errors) == 2


@pytest.mark.parametrize("day,hours", [("2026-03-29", 23), ("2026-10-25", 25), ("2026-06-15", 24)])
def test_gb_settlement_windows_preserve_dst_day_lengths(day, hours):
    from zoneinfo import ZoneInfo

    local_start = datetime.fromisoformat(day).replace(tzinfo=ZoneInfo("Europe/London"))
    local_end = local_start + timedelta(days=1)
    windows = list(settlement_windows(local_start.astimezone(UTC), local_end.astimezone(UTC)))
    assert len(windows) == 1
    assert (windows[0][2] - windows[0][1]).total_seconds() == hours * 3600
