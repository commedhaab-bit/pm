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
  and mounts the `/api` health route, the auth router, the board router, and the static
  handler in that order.
- `app/db.py` - SQLite connection and schema. `get_db_path()` reads `DATABASE_PATH` from the
  environment (default `/data/pm.db`), re-read on every call rather than cached, so tests
  can point it at a temp file per test via `monkeypatch.setenv`. `connect()` opens a
  connection with `check_same_thread=False` - required because FastAPI runs sync
  dependencies and route handlers through a thread pool, so a single request's `get_db()`
  setup and its handler body are not guaranteed to run on the same thread (this bit us: it
  surfaced as `sqlite3.ProgrammingError` under concurrent load, which the frontend's error
  handling at the time silently mistook for "not authenticated" - see the api.ts note
  below). `get_db()` is the FastAPI dependency: opens a connection, runs `init_db` +
  `seed_if_empty` once per resolved path (cached in `_ready_paths` - both are idempotent
  `CREATE TABLE IF NOT EXISTS` / seed-if-empty checks, but there's no reason to repeat them
  on every request), yields the connection, closes it. `seed_if_empty` inserts the
  hardcoded `user`/`password` account and one board (from `board.INITIAL_BOARD`) only when
  the `users` table is empty - idempotent across restarts.
- `app/board.py` - the `Card` / `Column` / `BoardData` Pydantic models mirroring the
  frontend's `BoardData` shape, with a `model_validator` enforcing the invariants from
  `docs/DATABASE.md`: the column ids must be exactly the five fixed ones (as a set, not
  order-sensitive), every `cardIds` entry must exist in `cards`, no card in more than one
  column, no card left out of every column. A board failing any of these is rejected by
  FastAPI's normal request-validation 422 before the route body even runs, since `BoardData`
  is the declared request/response type. Also holds `INITIAL_BOARD` (the seed data, a
  straight port of `frontend/src/lib/kanban.ts`'s `initialData`) and `load_board`/
  `save_board`.
- `app/board_routes.py` - `GET`/`PUT /api/board`, both behind `require_user` and scoped to
  `current_user.id`.
- `app/auth.py` - `POST /api/login`, `POST /api/logout`, `GET /api/me`. Credentials are
  checked against the `users` table (`check_credentials()`, comparing an unsalted
  `hashlib.sha256` hash - see `docs/DATABASE.md` for why that's an acceptable MVP call
  here). `require_user` is the dependency protected routes use; it reads
  `request.session["username"]` (set by `SessionMiddleware` from the signed cookie), looks
  the user up by that username, and raises 401 if there's no session or no matching row. It
  returns a `CurrentUser(id, username)` so routes needing the numeric id (board routes)
  don't have to look it up again - FastAPI caches a dependency's result per request, so
  `require_user`'s own `Depends(get_db)` and a route's separate `Depends(get_db)` resolve to
  the same connection.
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
- `tests/` - pytest, run with `uv run pytest`. `conftest.py`'s `db_path` fixture points
  `DATABASE_PATH` at a fresh `tmp_path` file per test (via `monkeypatch`); its `client`
  fixture builds on that to give each test an isolated, freshly-seeded database - no test
  touches the real `/data/pm.db`. Live tests (external network calls) are marked `live` and
  excluded by default via `addopts` in `pyproject.toml`; run them explicitly with
  `uv run pytest -m live`.

## Auth

Session-cookie based (`SessionMiddleware`, HttpOnly, signed with `SESSION_SECRET`). No
session table - the cookie holds the signed username, looked up against `users` on every
request. `SESSION_SECRET` is read from the environment; `scripts/start.sh` / `start.ps1`
generate one into the root `.env` on first run if it's missing (falls back to an insecure
fixed dev value if truly absent, e.g. under plain `pytest`, so tests never depend on `.env`).

## Database

SQLite at `DATABASE_PATH` (default `/data/pm.db`, matching the volume mount in
`compose.yaml`). Schema, invariants, and the seed data are documented in full in
`docs/DATABASE.md` - read that first for anything DB-shaped. Created and seeded
automatically on first use; deleting the file and restarting recreates it.

## Routes so far

- `GET /api/health` - `{"status": "ok"}`, no auth.
- `POST /api/login` - `{username, password}`, sets the session cookie, 401 on bad
  credentials or missing fields (422 for a missing field via Pydantic validation).
- `POST /api/logout` - clears the session.
- `GET /api/me` - `{"username": ...}` for the signed-in user, 401 without a session.
- `GET /api/board` - the signed-in user's board, 401 without a session.
- `PUT /api/board` - replaces the signed-in user's board; 422 if it fails the
  `BoardData` invariants, 401 without a session.

## Commands

```
uv sync              # install deps (add --no-dev for the runtime-only set)
uv run pytest        # tests
uv run pytest -m live  # tests that hit real external services
uv run uvicorn app.main:app --reload --port 8000
```
