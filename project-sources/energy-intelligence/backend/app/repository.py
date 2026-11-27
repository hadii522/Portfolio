from __future__ import annotations

import hashlib
from datetime import datetime

from sqlalchemy import func, select

from app.db import Observation, iso, session_scope, utc

METRICS = {
    "demand": {
        "label": "National demand",
        "unit": "MW",
        "source": "Elexon",
        "cadence_minutes": 30,
        "definition": "Initial National Demand Outturn (INDO); distinct from transmission system demand.",
    },
    "transmission_demand": {
        "label": "Transmission demand",
        "unit": "MW",
        "source": "Elexon",
        "cadence_minutes": 30,
        "definition": "Initial Transmission System Demand Outturn (ITSDO); distinct from INDO.",
    },
    "imbalance_price": {
        "label": "System imbalance price",
        "unit": "GBP/MWh",
        "source": "Elexon",
        "cadence_minutes": 30,
        "definition": "System sell price; a settlement imbalance price, not a day-ahead executable quote.",
    },
    "net_imbalance": {
        "label": "Net imbalance volume",
        "unit": "MWh",
        "source": "Elexon",
        "cadence_minutes": 30,
        "definition": "Net system imbalance volume for each settlement period.",
    },
}


def observation_id(metric: str, source: str, time: datetime, published: datetime, value: float) -> str:
    # A correction with an unchanged publication timestamp still becomes a new vintage.
    key = f"{source}|GB|{metric}|{iso(time)}|{iso(published)}|{value:.12g}"
    return hashlib.sha256(key.encode()).hexdigest()


def latest_rows(
    metric: str,
    start: datetime | None = None,
    end: datetime | None = None,
    as_of: datetime | None = None,
    recorded_as_of: bool = False,
) -> list[dict]:
    filters = [Observation.metric == metric]
    if start:
        filters.append(Observation.time >= start)
    if end:
        filters.append(Observation.time < end)
    if as_of:
        filters.append(Observation.published_at <= as_of)
        if recorded_as_of:
            filters.append(Observation.fetched_at <= as_of)
    ranked = (
        select(
            Observation,
            func.row_number()
            .over(
                partition_by=Observation.time,
                order_by=(Observation.published_at.desc(), Observation.fetched_at.desc(), Observation.id),
            )
            .label("rn"),
        )
        .where(*filters)
        .subquery()
    )
    with session_scope() as session:
        result = session.execute(select(ranked).where(ranked.c.rn == 1).order_by(ranked.c.time)).mappings()
        return [
            {
                "time": iso(r["time"]),
                "value": r["value"],
                "published_at": iso(r["published_at"]),
                "fetched_at": iso(r["fetched_at"]),
                "source": r["source"],
                "unit": r["unit"],
                "archive": r["archive"],
                "quality": r["quality"],
            }
            for r in result
        ]


def metric_inventory() -> list[dict]:
    with session_scope() as session:
        rows = session.execute(
            select(
                Observation.metric,
                Observation.source,
                Observation.unit,
                func.min(Observation.time),
                func.max(Observation.time),
                func.max(Observation.fetched_at),
                func.count(),
                func.count(func.distinct(Observation.time)),
            ).group_by(Observation.metric, Observation.source, Observation.unit)
        ).all()
    return [
        {
            "metric": r[0],
            "source": r[1],
            "unit": r[2],
            "first": iso(r[3]),
            "latest": iso(r[4]),
            "last_fetch": iso(r[5]),
            "vintages": r[6],
            "points": r[7],
            "label": METRICS.get(r[0], {}).get(
                "label", r[0].replace("generation_", "").replace("_", " ").title()
            ),
        }
        for r in rows
    ]


def availability_age(row: dict, reference: datetime) -> float:
    return max(0, (reference - utc(row["time"])).total_seconds() / 60)
