# Development journal

The application uses real public electricity and weather data, native PostgreSQL, a durable worker and an interactive research UI. See [the issue register](ENGINEERING_LOG.json) for each problem, resolution and verification, and [the research protocol](RESEARCH_PROTOCOL.md) for the evaluation design.

## 25 November 2026 — Local release validation

Validated 29 backend tests, five browser scenarios, formatting, lint, type checking and a production frontend build. The recorded seven-day evaluation covers 336 held-out periods. The selected weather Ridge model achieved 1,521.67 MW RMSE versus 2,174.49 MW for the weekly seasonal baseline. This result describes one historical window; data providers and model availability assumptions are documented in the research protocol.

The database and local credentials are deliberately excluded from this source release. First startup downloads real observations; data totals and forecasts change with subsequent ingestions. External LLM synthesis is optional and has not been validated with a paid live request. Deterministic evidence briefs work locally.
