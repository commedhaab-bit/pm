# Backend

FastAPI app, managed with uv. Serves the API under `/api` and the static frontend build at
`/`.

## Layout

- `pyproject.toml` / `uv.lock` - dependencies. `fastapi`, `uvicorn`, `itsdangerous` (required
  by `SessionMiddleware`) and `python-dotenv` at runtime; `pytest` and `httpx2` (FastAPI's
  `TestClient` needs an HTTPX-compatible transport) as a dev-only group, excluded from the
  image via `uv sync --no-dev`.
- `app/main.py` - creates the `FastAPI` app, loads `.env` from the project root (via
  `python-dotenv`, harmless no-op if the file is absent - Docker gets its env vars from
  `compose.yaml`'s `env_file` instead), adds `SessionMiddleware` keyed by `SESSION_SECRET`,
  and mounts the `/api` health route, the auth router, and the static handler in that order.
- `app/auth.py` - `POST /api/login`, `POST /api/logout`, `GET /api/me`. Credentials are
  checked against the hardcoded `user`/`password` pair in `check_credentials()` - a single
  function so Part 6 can swap it for a database lookup without touching the routes.
  `require_user` is the dependency other protected routes will use; it reads
  `request.session["username"]` (set by `SessionMiddleware` from the signed cookie) and
  raises 401 if absent.
- `app/static.py` - `mount_static(app)` registers a catch-all `GET /{full_path:path}` route
  that serves files from `backend/static`. It is a small custom handler rather than
  Starlette's `StaticFiles(html=True)`, because that class only auto-resolves `index.html`
  for directory-style paths - it does not resolve a bare route like `/login` to Next's
  exported `login.html`. The handler tries, in order: `index.html` for `""`, then the exact
  path, then `{path}.html`; anything unmatched (including unknown `/api/*` paths, since this
  route is registered last) is a 404. Path traversal is blocked by resolving the candidate
  and checking it stays under `static/`. Does nothing if the directory is absent, so the API
  runs standalone without a frontend build.
- `static/` - currently a placeholder page for that standalone case. The Docker image
  always overwrites this directory with the Next.js static export at build time (see the
  root `Dockerfile`).
- `tests/` - pytest, run with `uv run pytest`. Live tests (external network calls) are
  marked `live` and excluded by default via `addopts` in `pyproject.toml`; run them
  explicitly with `uv run pytest -m live`.

## Auth

Session-cookie based (`SessionMiddleware`, HttpOnly, signed with `SESSION_SECRET`). No
session table - the cookie itself holds the signed username. `SESSION_SECRET` is read from
the environment; `scripts/start.sh` / `start.ps1` generate one into the root `.env` on first
run if it's missing (falls back to an insecure fixed dev value if truly absent, e.g. under
plain `pytest`, so tests never depend on `.env`).

## Routes so far

- `GET /api/health` - `{"status": "ok"}`, no auth.
- `POST /api/login` - `{username, password}`, sets the session cookie, 401 on bad
  credentials or missing fields (422 for a missing field via Pydantic validation).
- `POST /api/logout` - clears the session.
- `GET /api/me` - `{"username": ...}` for the signed-in user, 401 without a session.

## Commands

```
uv sync              # install deps (add --no-dev for the runtime-only set)
uv run pytest        # tests
uv run pytest -m live  # tests that hit real external services
uv run uvicorn app.main:app --reload --port 8000
```
