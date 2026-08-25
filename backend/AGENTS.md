# Backend

FastAPI app, managed with uv. Serves the API under `/api` and, when present, the static
frontend build at `/`.

## Layout

- `pyproject.toml` / `uv.lock` - dependencies. `fastapi` and `uvicorn` at runtime;
  `pytest` and `httpx2` (FastAPI's `TestClient` needs an HTTPX-compatible transport) as a
  dev-only group, excluded from the image via `uv sync --no-dev`.
- `app/main.py` - creates the `FastAPI` app, defines the `/api` router, mounts static files.
- `app/static.py` - `mount_static(app)` mounts `backend/static` at `/` with
  `StaticFiles(html=True)` so `/` serves `index.html` and other paths resolve to files under
  that directory. Does nothing if the directory is absent, so the API runs standalone
  without a frontend build.
- `static/` - currently a placeholder page. Part 3 replaces this with the Next.js static
  export.
- `tests/` - pytest, run with `uv run pytest`. Live tests (external network calls) are
  marked `live` and excluded by default via `addopts` in `pyproject.toml`; run them
  explicitly with `uv run pytest -m live`.

## Routes so far

- `GET /api/health` - `{"status": "ok"}`, no auth.

## Commands

```
uv sync              # install deps (add --no-dev for the runtime-only set)
uv run pytest        # tests
uv run pytest -m live  # tests that hit real external services
uv run uvicorn app.main:app --reload --port 8000
```
