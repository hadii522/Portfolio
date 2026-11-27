"""Loopback API with cooperative shutdown for the local process supervisor."""

import os
import threading

import uvicorn

from app.config import DATA


def main():
    server = uvicorn.Server(uvicorn.Config("app.main:app", host="127.0.0.1", port=8000, log_level="info"))
    run_id = os.environ.get("ETIP_RUN_ID")
    done = threading.Event()

    def monitor():
        while not done.wait(0.5):
            if run_id and (DATA / "runtime" / f"{run_id}.stop").exists():
                server.should_exit = True
                return

    thread = threading.Thread(target=monitor, daemon=True)
    thread.start()
    try:
        server.run()
    finally:
        done.set()


if __name__ == "__main__":
    main()
