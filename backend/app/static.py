from pathlib import Path

from fastapi import FastAPI
from starlette.staticfiles import StaticFiles

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"


def mount_static(app: FastAPI) -> None:
    if not STATIC_DIR.is_dir():
        return
    app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
