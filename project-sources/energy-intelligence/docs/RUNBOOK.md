# Local operations runbook

## Start, stop and configuration

Run `npm ci`, `npm run setup`, then `npm start` at repository root. `start.ps1` is a PowerShell wrapper for startup. Use Ctrl+C or `npm stop` for orderly shutdown. A fresh install needs Python 3.12+ and Node.js 22+; set `ETIP_PYTHON` if Python is not discoverable. Existing installations can run directly with the created `.venv`.

Frontend: `http://127.0.0.1:3000`. API: `http://127.0.0.1:8000`. PostgreSQL: `127.0.0.1:5433`. These are local addresses; a reviewer on another machine cannot access your localhost.

Optional settings belong in `.env.local` at repository root, independent of shell working directory. `ETIP_DATABASE_URL` selects an existing PostgreSQL database. The portable database launcher is skipped when that variable is set. Do not put API keys in `NEXT_PUBLIC_*` variables. The optional `ETIP_API_ORIGIN` selects the private API origin used by Next.js.

## Data operations

Use the UI's Run operation menu or queue a job from a second terminal:

```powershell
.venv/Scripts/python.exe -m app.cli backfill --days 120
.venv/Scripts/python.exe -m app.cli sync
.venv/Scripts/python.exe -m app.cli weather_history --days 120
.venv/Scripts/python.exe -m app.cli forecast
.venv/Scripts/python.exe -m app.cli report
.venv/Scripts/python.exe -m app.cli backup
```

Queued jobs require the worker launched by `npm start`. Same-kind active jobs deduplicate. Backfill and sync preserve completed chunks and revisions; retries do not generate synthetic rows. Historical weather archive retry skips complete stored runs. For foreground diagnostics use `app.cli diagnostics`.

## Failure investigation

1. Read Data & operations → Pipeline & jobs. Expand failed or partial jobs for their recorded result/error. Retry the operation after addressing the cause.
2. Inspect Source ingestion events for status, new-vintage counts and validation rejections. Boundary exclusions can be expected when provider requests cover whole settlement dates; they are explicitly recorded.
3. Read Data quality for per-series coverage, latest timestamp and freshness. Coverage is measured within a series' stored bounds; it does not imply that a longer requested history exists.
4. Confirm worker heartbeat and database connectivity. A stale heartbeat never means the source itself is current.
5. Inspect `data/logs/postgres.log` for native database errors. API and worker messages are emitted in the startup terminal. Never paste local secret files or credentialed database URLs into issue reports.

If a provider is unavailable, stored observations remain viewable with timestamps. There is no automatic fake-data fallback. Model training refuses insufficient history, ineligible weather or stale current demand. Failed model runs do not replace the latest successfully published forecast.

## Backup and restore

Run a backup job or use the scheduled daily backup. Backups stay local; copy important backups to independent secure storage yourself. Disk loss cannot be recovered from another file on the same disk.

When `pg_dump` is available, the backup is a native custom-format `.dump`. Otherwise the portable backup is an `etip-logical-v1` ZIP containing a repeatable-read database snapshot, raw provider archives, model artifacts and a row-count manifest. ZIP CRC integrity is verified. Local credentials and LLM keys are excluded.

To restore a logical ZIP:

1. Stop the application. Keep the backup file untouched.
2. Prepare an empty PostgreSQL database and set `ETIP_DATABASE_URL` in `.env.local` to that database, or use a separately backed-up clean local data directory. Keep the worker stopped.
3. Run the database server alone with `npm run db` if using the portable cluster. From a second terminal run:

```powershell
.venv/Scripts/python.exe -m app.cli init
.venv/Scripts/python.exe -m app.cli restore --file "C:/path/to/etip-backup.zip"
```

4. Restore refuses a nonempty application database, unsafe archive paths, mismatched schema/row counts, corrupt ZIP data or conflicting artifact files. Queued/running jobs in a restored backup become interrupted; requeue explicitly after inspection.
5. Start the application and verify counts, latest observation timestamps and model cards before resuming automation.

For a native `.dump`, use matching PostgreSQL `pg_restore` tools against an empty target; separately preserve `data/raw` and `data/models`. Do not issue destructive restore commands against your only populated database.

## Research verification

Run `npm run check` while the database is running. It includes unit tests, disposable PostgreSQL integration tests and frontend checks/build. `npm run test:browser` checks the real populated application. Playwright can use installed Chrome on Windows or an explicitly configured `ETIP_BROWSER`; otherwise install its Chromium binary.

Export the current measured model card with `node scripts/export-research.mjs`. Inspect the exact sample/feature snapshots under `data/models`. A successful backtest is evidence for its recorded window only.

## Source release

This source release excludes local database state, credentials and legacy archives. Use the setup instructions to initialize a fresh local environment. The original workstation repository metadata was preserved separately.
