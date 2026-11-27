from app.reports import validate_narrative

FACTS = [{"id": "demand.latest", "value": 30000}]


def test_malformed_model_payload_is_rejected_without_publishing():
    assert validate_narrative({"text": "unexpected dictionary"}, FACTS)
    assert validate_narrative([None], FACTS)


def test_llm_review_preparation_never_includes_the_api_key(monkeypatch):
    import json
    from types import SimpleNamespace

    from app import reports

    monkeypatch.setattr(
        reports,
        "settings",
        SimpleNamespace(groq_key="secret-sentinel", openrouter_key="", llm_model="test-model"),
    )
    monkeypatch.setattr(reports, "collect_evidence", lambda: {"facts": FACTS, "warnings": [], "trace": []})
    preview = reports.preview_llm_request()
    assert preview["external_request_performed"] is False
    assert "secret-sentinel" not in json.dumps(preview)
    assert preview["destination"] == "https://api.groq.com/openai/v1/chat/completions"


def test_unknown_references_are_rejected():
    assert validate_narrative([{"text": "Demand increased.", "evidence": ["invented.fact"]}], FACTS)


def test_model_cannot_introduce_numeric_claims():
    assert validate_narrative([{"text": "Demand is 99999 MW.", "evidence": ["demand.latest"]}], FACTS)


def test_empty_evidence_is_rejected():
    assert validate_narrative([{"text": "Demand increased.", "evidence": []}], FACTS)


def test_referenced_narrative_is_valid():
    assert (
        validate_narrative(
            [{"text": "Demand is above its recent average.", "evidence": ["demand.latest"]}], FACTS
        )
        == []
    )
