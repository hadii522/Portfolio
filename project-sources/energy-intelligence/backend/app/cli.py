from __future__ import annotations

import argparse
import json

from app.db import initialize


def main():
    parser = argparse.ArgumentParser(description="ETIP local operations")
    parser.add_argument(
        "command",
        choices=[
            "init",
            "backfill",
            "sync",
            "forecast",
            "weather_history",
            "report",
            "backup",
            "diagnostics",
            "restore",
            "preview_llm",
        ],
    )
    parser.add_argument("--days", type=int, default=120)
    parser.add_argument("--file", help="Trusted ETIP logical ZIP backup to restore into an empty database")
    parser.add_argument(
        "--run-now", action="store_true", help="Run synchronously instead of queueing for the worker"
    )
    args = parser.parse_args()
    initialize()
    if args.command == "init":
        print("Database schema version 1 ready")
    elif args.command == "preview_llm":
        from app.config import ROOT
        from app.reports import preview_llm_request

        preview = preview_llm_request()
        destination = ROOT / "work" / "llm-verification-review.json"
        destination.parent.mkdir(exist_ok=True)
        destination.write_text(json.dumps(preview, indent=2), encoding="utf-8")
        print(
            json.dumps(
                {
                    "destination": preview["destination"],
                    "model": preview["model"],
                    "review_file": str(destination),
                    "external_request_performed": False,
                }
            )
        )
    elif args.command == "restore":
        from app.operations import restore_backup

        if not args.file:
            parser.error("restore requires --file")
        print(json.dumps(restore_backup(args.file), indent=2))
    elif args.command == "diagnostics":
        from app.main import health
        from app.operations import quality_report

        print(json.dumps({"health": health(), "quality": quality_report()}, indent=2))
    else:
        from app.jobs import enqueue, execute

        job = enqueue(args.command, {"days": args.days})
        if args.run_now:
            if job.get("deduplicated"):
                raise ValueError("This operation is already queued or running; let the worker finish it.")
            from app.db import Job, now, session_scope

            with session_scope() as session:
                row = session.get(Job, job["id"])
                row.status, row.started_at, row.heartbeat = "running", now(), now()
            try:
                result = execute(job["id"], args.command, {"days": args.days})
                with session_scope() as session:
                    row = session.get(Job, job["id"])
                    row.result, row.status, row.finished_at, row.progress = (
                        result,
                        "partial" if result.get("failures") else "complete",
                        now(),
                        100,
                    )
                print(json.dumps(result, indent=2))
            except Exception as exc:
                with session_scope() as session:
                    row = session.get(Job, job["id"])
                    row.status, row.finished_at, row.message = "failed", now(), str(exc)
                raise
        else:
            print(json.dumps(job, indent=2))


if __name__ == "__main__":
    main()
