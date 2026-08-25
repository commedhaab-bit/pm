from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"


def _resolve(relative_path: str) -> Path | None:
    candidate = (STATIC_DIR / relative_path).resolve()
    if STATIC_DIR.resolve() not in candidate.parents and candidate != STATIC_DIR.resolve():
        return None
    return candidate


def mount_static(app: FastAPI) -> None:
    if not STATIC_DIR.is_dir():
        return

    @app.get("/{full_path:path}")
    def serve_static(full_path: str) -> FileResponse:
        candidates = (
            [STATIC_DIR / "index.html"]
            if full_path == ""
            else filter(
                None,
                [_resolve(full_path), _resolve(f"{full_path}.html")],
            )
        )
        for candidate in candidates:
            if candidate.is_file():
                return FileResponse(candidate)
        raise HTTPException(status_code=404)
