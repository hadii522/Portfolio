"""Evidence collection -> quality gate -> deterministic/optional LLM synthesis -> validation."""

from __future__ import annotations

import json
import re
import uuid
from datetime import timedelta

import httpx
import numpy as np
from sqlalchemy import select

from app.config import settings
from app.db import ModelRun, Report, iso, now, session_scope, utc
from app.repository import METRICS, latest_rows

REPORT_PROMPT = (
    "Write a short energy market brief grounded ONLY in the evidence supplied. "
    "Return JSON {paragraphs:[{text:string,evidence:[fact_id]}]}. One to five paragraphs. "
    "NO digits or numeric claims in text: the UI renders values directly from referenced facts. "
    "No recommendations, causal explanations, invented events, or unprovided facts. "
    "Every paragraph must reference the facts it discusses. Acknowledge stale or missing inputs."
)


def preview_llm_request() -> dict:
    """Prepare a review artifact; makes no external provider request."""
    if settings.groq_key:
        destination, model = "https://api.groq.com/openai/v1/chat/completions", settings.llm_model
    elif settings.openrouter_key:
        destination, model = "https://openrouter.ai/api/v1/chat/completions", "openai/gpt-4.1-mini"
    else:
        raise ValueError("No LLM provider is configured")
    evidence = collect_evidence()
    return {
        "destination": destination,
        "model": model,
        "external_request_performed": False,
        "contents": "Public Elexon market facts, local forecast error metrics, timestamps, relative archive references and workflow metadata. No credentials in prompt.",
        "request_body": {
            "model": model,
            "temperature": 0,
            "max_tokens": 1000,
            "response_format": {"type": "json_object"},
            "messages": [
                {"role": "system", "content": REPORT_PROMPT},
                {"role": "user", "content": json.dumps(evidence)},
            ],
        },
    }


def collect_evidence() -> dict:
    reference = now()
    facts, warnings, trace = [], [], []
    for metric in ("demand", "imbalance_price", "net_imbalance"):
        rows = latest_rows(metric, reference - timedelta(days=2), reference)
        trace.append({"tool": "read_published_series", "metric": metric, "rows": len(rows)})
        if not rows:
            warnings.append(f"No {METRICS[metric]['label'].lower()} observations in the last 48h.")
            continue
        values = np.array([r["value"] for r in rows])
        for suffix, value in (
            ("latest", rows[-1]["value"]),
            ("mean", float(values.mean())),
            ("min", float(values.min())),
            ("max", float(values.max())),
        ):
            facts.append(
                {
                    "id": f"{metric}.{suffix}",
                    "label": f"{METRICS[metric]['label']} · {suffix}",
                    "value": round(float(value), 2),
                    "unit": rows[-1]["unit"],
                    "time": rows[-1]["time"],
                    "source": "Elexon",
                    "source_url": "https://bmrs.elexon.co.uk/",
                    "archive": rows[-1]["archive"],
                    "archives": sorted({r["archive"] for r in rows}),
                    "source_rows": len(rows),
                    "window": "last 48 hours",
                }
            )
        if reference - utc(rows[-1]["time"]) > timedelta(hours=3):
            warnings.append(f"{METRICS[metric]['label']} is older than three hours.")
    with session_scope() as session:
        run = session.scalar(
            select(ModelRun)
            .where(ModelRun.status == "complete")
            .order_by(ModelRun.created_at.desc())
            .limit(1)
        )
        if run:
            score = run.metadata_json["test_scores"][run.model]
            facts.append(
                {
                    "id": "forecast.test_rmse",
                    "label": "Demand forecast · held-out RMSE",
                    "value": round(score["rmse"], 2),
                    "unit": "MW",
                    "time": iso(run.created_at),
                    "source": run.model,
                    "source_url": None,
                    "archive": run.artifact,
                    "window": "seven-day held-out test",
                }
            )
            trace.append({"tool": "read_model_card", "run_id": run.id, "model": run.model})
    return {"facts": facts, "warnings": warnings, "trace": trace, "as_of": iso(reference)}


def validate_narrative(paragraphs: list[dict], facts: list[dict]) -> list[str]:
    """LLM text cannot introduce numeric claims; numerical values render from verified fact IDs."""
    valid_ids = {f["id"] for f in facts}
    errors = []
    if not isinstance(paragraphs, list) or any(not isinstance(p, dict) for p in paragraphs):
        return ["Expected a list of structured narrative paragraphs"]
    if not 1 <= len(paragraphs) <= 5:
        errors.append("Expected one to five narrative paragraphs")
    for paragraph in paragraphs:
        text = paragraph.get("text", "")
        references = paragraph.get("evidence", [])
        if not isinstance(text, str) or not text.strip() or len(text) > 1500:
            errors.append("Invalid paragraph text")
        if isinstance(text, str) and re.search(r"\d", text):
            errors.append("Model introduced digits instead of referencing verified facts")
        if not isinstance(references, list) or not references or any(r not in valid_ids for r in references):
            errors.append("Missing or unknown evidence reference")
    return errors


def generate_report(use_llm: bool = False) -> dict:
    evidence = collect_evidence()
    if not evidence["facts"]:
        raise ValueError("No recent source observations; a market brief cannot be generated")
    facts_by_id = {f["id"]: f for f in evidence["facts"]}
    paragraphs = []
    for metric in ("demand", "imbalance_price"):
        latest = facts_by_id.get(f"{metric}.latest")
        mean = facts_by_id.get(f"{metric}.mean")
        if latest and mean:
            direction = (
                "above"
                if latest["value"] > mean["value"]
                else "below"
                if latest["value"] < mean["value"]
                else "equal to"
            )
            paragraphs.append(
                {
                    "text": f"The latest published {METRICS[metric]['label'].lower()} is {direction} its recent average.",
                    "evidence": [latest["id"], mean["id"]],
                }
            )
    engine, validation = "Deterministic analytics", {"status": "verified", "errors": []}
    if use_llm:
        if settings.groq_key:
            url, key, model = (
                "https://api.groq.com/openai/v1/chat/completions",
                settings.groq_key,
                settings.llm_model,
            )
        elif settings.openrouter_key:
            url, key, model = (
                "https://openrouter.ai/api/v1/chat/completions",
                settings.openrouter_key,
                "openai/gpt-4.1-mini",
            )
        else:
            raise ValueError("Configure GROQ_API_KEY or OPENROUTER_API_KEY to enable LLM synthesis")
        with httpx.Client(timeout=45) as client:
            response = client.post(
                url,
                headers={"Authorization": f"Bearer {key}"},
                json={
                    "model": model,
                    "temperature": 0,
                    "max_tokens": 1000,
                    "response_format": {"type": "json_object"},
                    "messages": [
                        {"role": "system", "content": REPORT_PROMPT},
                        {"role": "user", "content": json.dumps(evidence)},
                    ],
                },
            )
            if response.status_code != 200:
                raise ValueError(f"LLM synthesis failed (HTTP {response.status_code}); no report published")
            try:
                paragraphs = json.loads(response.json()["choices"][0]["message"]["content"])["paragraphs"]
            except (ValueError, KeyError, TypeError, IndexError) as exc:
                raise ValueError("LLM returned an invalid report schema") from exc
        errors = validate_narrative(paragraphs, evidence["facts"])
        if errors:
            raise ValueError("LLM grounding failed; no report published: " + "; ".join(errors))
        engine = f"LLM · {model}"
        validation["qualitative_limit"] = (
            "Fact references and numeric claims are validated; qualitative interpretation is not proof of causation."
        )
    evidence["trace"].extend([{"tool": "synthesize", "engine": engine}, {"tool": "validate", **validation}])
    payload = {
        **evidence,
        "paragraphs": paragraphs,
        "validation": validation,
        "prompt_version": "market-brief-v1",
        "scope": "Published GB fundamentals and settlement imbalance prices",
    }
    report_id = str(uuid.uuid4())
    with session_scope() as session:
        session.add(
            Report(
                id=report_id,
                title="GB market intelligence brief",
                engine=engine,
                status="complete",
                payload=payload,
            )
        )
    return {"report_id": report_id, "engine": engine, "validation": validation}
