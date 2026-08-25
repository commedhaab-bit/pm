# Project plan

Ten parts, executed in order. Each part ends with its tests passing and its success
criteria met before the next begins. Checkboxes are ticked off by the agent as work lands.

## Decisions

Settled before Part 2, in addition to the technical decisions in the root AGENTS.md:

- **AI provider**: the OpenAI API directly, using the `openai` Python SDK with
  `OPENAI_API_KEY` from `.env`. Model `gpt-5.6-luna`.
- **Frontend build**: Next.js static export (`output: "export"`). FastAPI serves the
  exported files at `/`. No Node process at runtime, no SSR, no Next middleware; every
  dynamic behaviour is a browser fetch to the FastAPI API.
- **Auth**: `POST /api/login` sets a signed HttpOnly session cookie via Starlette's
  `SessionMiddleware`. No session table.
- **Storage**: one SQLite row per board holding the whole board as a JSON blob. Detailed
  in `docs/DATABASE.md` in Part 5.
- **Columns**: exactly five, created when the user is seeded. They can be renamed and
  nothing else - no adding or deleting columns, by the user or the AI.
- **Card editing**: not in the current frontend. Added in Part 7, against the API.
- **Container**: single image, multi-stage (Node builds the frontend, uv installs Python).
  Published on port 8000. SQLite file on a mounted volume so data survives a restart.
- **Backend tests**: pytest with FastAPI's `TestClient`. AI calls are mocked everywhere
  except the explicit connectivity test in Part 8.

## API surface

Built up across Parts 2, 4, 6 and 9. Final shape:

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | liveness, no auth |
| POST | `/api/login` | `{username, password}`, sets the session cookie |
| POST | `/api/logout` | clears the session |
| GET | `/api/me` | current user, or 401 |
| GET | `/api/board` | the signed in user's board |
| PUT | `/api/board` | replace the board with the posted JSON |
| POST | `/api/chat` | `{message}`, returns `{reply, board?}` |

All `/api/*` routes except health and login require the session cookie and return 401
without it. Everything not under `/api` falls through to the static export.

---

## Part 1: Plan

**Goal** - a plan detailed enough to execute without re-litigating decisions, plus a
description of the existing frontend.

- [x] Resolve the AGENTS.md conflicts (AI provider, model, env var name) with the user
- [x] Record the open decisions above (build mode, auth, storage shape, port, test stack)
- [x] Write `frontend/AGENTS.md` describing the existing code
- [x] Enrich this document with per-part checklists, tests and success criteria
- [ ] User reviews and approves this plan

**Success criteria** - the user has approved this document; no part below has an unanswered
question blocking it.

---

## Part 2: Scaffolding

**Goal** - a Docker container that runs, serves a placeholder page at `/`, and answers an
API call. No Kanban yet.

- [x] `backend/pyproject.toml` with `fastapi`, `uvicorn[standard]`, `httpx2`, `pytest`,
      managed by uv; commit `uv.lock` (`httpx2` in place of `httpx`: FastAPI's
      `TestClient` on this stack's version emits a deprecation warning pointing at it)
- [x] `backend/app/main.py` - FastAPI app, `GET /api/health` returning `{"status": "ok"}`
- [x] `backend/app/static.py` - mount the static directory at `/`, tolerating its absence
      so the backend runs standalone during development
- [x] `backend/static/index.html` - placeholder page that fetches `/api/health` and renders
      the result, proving the container serves both static content and API from one origin
- [x] `Dockerfile` using the uv base image on a slim Python base, `uv sync --locked`,
      running uvicorn on 8000
- [x] `compose.yaml` - one service, port 8000, `.env` loaded, named volume mounted at
      `/data` for the SQLite file
- [x] `.dockerignore`
- [x] `scripts/start.sh`, `scripts/stop.sh` (Mac and Linux), `scripts/start.ps1`,
      `scripts/stop.ps1` (Windows), each wrapping `docker compose up -d --build` and
      `docker compose down`, printing the URL
- [x] `backend/tests/test_health.py`
- [x] Update `backend/AGENTS.md` with the backend description
- [x] Minimal `README.md` at the project root: prerequisites, start, stop, test

**Tests**
- pytest: `GET /api/health` returns 200 and `{"status": "ok"}` - passing
- Manual: `scripts/start.ps1`, open `http://localhost:8000`, see the placeholder page
  report a healthy API; confirmed `/api/health` returns 200, `/` returns the placeholder
  page, `/api/nonexistent` returns 404; `scripts/stop.ps1` stops and removes the container

**Success criteria** - a clean clone plus `.env` starts with one script and serves both the
page and the API on port 8000. `docker compose down` then `up` leaves no stale state.
Verified on Windows with `start.ps1` / `stop.ps1`.

---

## Part 3: Add in the frontend

**Goal** - the demo Kanban board, statically built, served by FastAPI at `/`.

- [x] Set `output: "export"` in `frontend/next.config.ts`
- [x] Confirm `next/font/google` resolves during the Docker build; self-host the two fonts
      if the build has no network - resolved fine, both locally and inside the Docker build
      (build environment has network access); no self-hosting needed
- [x] Dockerfile stage 1: `npm ci && npm run build`, copy `frontend/out` into the image at
      the path the static mount serves (multi-stage: `node:22-slim` builds, output copied
      into the uv stage's `./static`)
- [x] Replace the placeholder `index.html` with the exported app; the static mount serves
      `index.html` for `/` and unknown `/api` paths still return 404 rather than the page
      (placeholder file kept in `backend/static/` only for running the backend standalone
      without a frontend build; the Docker image always uses the built export)
- [x] `npm run build` and `npm run lint` clean, no type errors
- [x] Extend `frontend/src/lib/kanban.test.ts` to cover `moveCard` reorder within a column,
      move across columns, drop on an empty column, and no-op cases, plus `createId`
      uniqueness
- [x] Extend `frontend/src/components/KanbanBoard.test.tsx`: renders five columns and eight
      cards, rename updates the heading, add card appends to the right column, delete
      removes the card
- [x] Point `playwright.config.ts` at the container (`http://localhost:8000`) and keep the
      dev-server config for local runs (`PW_BASE_URL=http://127.0.0.1:3000` opts back into
      the `next dev` webServer)
- [x] Playwright: board loads at `/`, drag a card between columns, rename a column, add and
      delete a card

**Tests** - `npm run test:unit` (14 tests), `npm run test:e2e` against the built container
(4 tests), `pytest` (1 test). All green.

**Success criteria** - `http://localhost:8000` shows the styled board with working drag and
drop - confirmed via curl (title tag) and the Playwright suite running against the built
container. State still resets on refresh - persistence is Part 7.

---

## Part 4: Fake sign in

**Goal** - the board is behind a login; credentials are hardcoded to `user` / `password`.

- [x] `SessionMiddleware` with a secret from the environment, generated and written to
      `.env` by the start scripts if absent (falls back to a fixed insecure dev value so
      plain `pytest` never needs `.env`)
- [x] `POST /api/login`, `POST /api/logout`, `GET /api/me`
- [x] Credentials checked against the hardcoded pair for now; the check lives in one
      function (`check_credentials`) so Part 6 can swap it for the database lookup
- [x] Dependency `require_user` returning 401 for unauthenticated `/api` requests
- [x] `frontend/src/app/login/page.tsx` - login form in the project color scheme, showing an
      error on bad credentials
- [x] `frontend/src/lib/api.ts` - fetch wrapper with `credentials: "include"`;
      `getCurrentUser` (used by the page guard) swallows a 401 and returns `null` rather
      than redirecting itself, since the login page also uses `apiFetch` and a blanket
      redirect-on-401 there would fight the "show an error, stay put" behavior on bad
      credentials. The `/` page guard is what actually redirects to `/login`.
- [x] Client-side guard: `/` checks `GET /api/me` on mount and redirects to `/login` when
      unauthenticated
- [x] Sign out control in the board header
- [x] Custom static handler replacing the plain `StaticFiles(html=True)` mount from Part 2/3
      - it does not resolve a bare route like `/login` to Next's exported `login.html`,
      only to directory-style `index.html`. See `backend/app/static.py`.

**Tests**
- pytest (6 tests): login with correct credentials sets the cookie; wrong username, wrong
  password and missing fields (422) each rejected; `/api/me` returns 401 without the cookie
  and the user with it; logout clears the session so `/api/me` is 401 again
- vitest (2 tests, `login/page.test.tsx`): failed login shows the error and does not
  navigate; successful login navigates to `/`
- Playwright (`auth.spec.ts`, 3 tests, plus the existing `kanban.spec.ts` now logging in via
  `page.request.post` in a `beforeEach`): hitting `/` unauthenticated redirects to `/login`;
  bad credentials show an error and stay on `/login`; good credentials reach the board,
  sign out returns to `/login`, and the back button does not restore the board (the guard
  re-checks `/api/me` on every load of `/`, so back navigation re-redirects)

**Success criteria** - no route exposes board content without a valid session cookie -
verified directly: `curl /api/me` with no cookie is 401. (`/api/board` doesn't exist until
Part 6; `/` itself is a static shell that always 200s, since gating happens client-side -
documented in `frontend/AGENTS.md`.)

**Found and fixed during this part**: the start scripts' original `SESSION_SECRET`
generation used `echo ... >> .env`, which silently concatenated onto `OPENAI_API_KEY`'s
value with no newline in between (the existing `.env` didn't end in one), corrupting both
variables. Fixed by always emitting a leading newline before the appended line in both
`start.sh` and `start.ps1`; `.env` was repaired and verified by exact line length.

---

## Part 5: Database modeling

**Goal** - an agreed schema, documented and signed off before any code depends on it.

- [x] Write `docs/DATABASE.md`: tables, the JSON board document, why the blob approach fits
      the MVP, and what a future normalized schema would change
- [x] Schema:
      `users(id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, created_at TEXT NOT NULL)`
      and
      `boards(id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL UNIQUE REFERENCES users(id), data TEXT NOT NULL, updated_at TEXT NOT NULL)`
- [x] `boards.data` holds the exact `BoardData` shape the frontend already uses
      (`{columns: [{id, title, cardIds}], cards: {id: {id, title, details}}}`), so board JSON
      is identical in the database, over the API and in the AI prompt
- [x] Document seeding: on first run, create the `user` account and one board from the
      current `initialData`
- [x] Document the invariants the backend enforces: exactly five columns with stable ids,
      every id in a `cardIds` list exists in `cards`, no card in two columns, no orphans
- [ ] User signs off on `docs/DATABASE.md`

**Success criteria** - the user has approved the schema; no implementation started before
that approval.

---

## Part 6: Backend

**Goal** - the API reads and writes the board, backed by SQLite that creates itself.

- [x] `backend/app/db.py` - connection helper, `CREATE TABLE IF NOT EXISTS` at startup,
      database path from an env var defaulting to `/data/pm.db`, parent directory created
- [x] Seed the `user` account and its board on startup when the users table is empty
- [x] `backend/app/board.py` - load, validate and save the board document
- [x] Validation with Pydantic models mirroring `BoardData`, enforcing the Part 5 invariants
- [x] `GET /api/board` and `PUT /api/board`, both scoped to the session user
- [x] Point the Part 4 credential check at the users table
- [x] Tests use a temporary database file per test, never the real one

**Tests** - pytest (18 tests):
- the database file and tables are created when the file is absent
- startup is idempotent: running it twice does not duplicate the seed user or board
- `GET /api/board` returns the seeded board for the signed in user
- `PUT /api/board` persists and is visible to a subsequent `GET`
- invalid boards are rejected with 422: wrong column count, unknown card id in `cardIds`,
  duplicate card across columns, orphaned card, renamed column id
- both routes return 401 without a session
- two users see only their own board (a second user/board inserted directly since there's
  no signup route; also confirms `check_credentials` is genuinely DB-driven, not still
  hardcoded to the one username)

**Success criteria** - pytest green (18/18) with every route covered; deleting the database
file inside the container and restarting recreates it with the seed data - verified for
real against the built container (renamed a column via `PUT`, restarted, change survived;
deleted `/data/pm.db`, restarted, board was back to the fresh seed).

**Found and fixed during this part** (both via repeated real Playwright runs against the
built container, not caught by pytest - `TestClient` doesn't reproduce FastAPI's
threadpool concurrency):
- `db.connect()` opened SQLite connections without `check_same_thread=False`. FastAPI runs
  sync dependencies and route handlers through a thread pool, so a single request's
  `get_db()` setup and its handler body are not guaranteed to run on the same thread -
  under concurrent load this raised `sqlite3.ProgrammingError`, intermittently and only
  under 2+ parallel workers (reproduced 3/3 times before the fix, 0/5 after).
- That 500 was silently swallowed as "not authenticated" by the frontend's
  `getCurrentUser()`, which treated any non-401 failure the same as a 401 - so the visible
  symptom was a wrong redirect to `/login`, not a visible error. Fixed by only treating a
  confirmed `UnauthorizedError` as "signed out" and rethrowing anything else; `page.tsx`
  now shows a short message instead of redirecting when that happens.
- Also stopped re-running `init_db`/`seed_if_empty` on every single request (they were
  idempotent but pointlessly repeated); now cached per resolved path in `_ready_paths`.

---

## Part 7: Frontend plus backend

**Goal** - the board is genuinely persistent, and cards can be edited.

- [x] `KanbanBoard` loads its state from `GET /api/board` instead of `initialData`, with
      loading and error states
- [x] Every mutation (move, rename, add, delete, edit) updates local state optimistically
      then PUTs the board; on failure, revert and surface the error
- [x] Debounce the column rename PUT so typing does not fire a request per keystroke
- [x] Add card editing: an inline title and details editor with save and cancel. The whole
      card is currently the drag handle, so introduce an explicit edit affordance rather
      than a click handler that fights the drag sensor
- [x] `initialData` moves to the backend seed; the frontend no longer ships demo data

**Tests**
- vitest with a mocked fetch (`KanbanBoard.test.tsx`, 6 tests): initial load renders the
  fetched board; add/edit issue a PUT with the expected payload; rename debouncing
  collapses rapid keystrokes into one request; a failed PUT reverts the UI and shows an
  error
- pytest: unchanged from Part 6 (18 tests) - `test_put_board_persists_and_get_reflects_it`
  already round-trips the exact frontend-shaped payload (camelCase `cardIds`, etc.), since
  `BoardData` is the declared type on both `GET` and `PUT`; no new test needed
- Playwright against the container: `kanban.spec.ts` covers rename/add/edit/move each in
  isolation; `persistence.spec.ts` does all of rename, add, edit, move, and delete in one
  flow, reloads the page, and asserts every one of them survived. A real container restart
  (not a Playwright test - same manual approach as Part 6) confirmed a mutation survives
  that too.

**Success criteria** - no board state is lost across a page reload or a container restart -
confirmed both ways above.

**Found and fixed during this part** (all only visible by running the e2e suite repeatedly,
not on a single run - see `frontend/AGENTS.md` for the full detail on each):
- Starlette's `StaticFiles(html=True)` bug from Part 4 wasn't touched here, but a new,
  similarly easy-to-miss ambiguity showed up: a card's whole sortable article is
  `role="button"`, so `getByRole("button", { name: "Delete X" })` in a test also matches the
  *article* (its accessible name is computed from its content, which includes the real
  button's own label as a substring). Fixed by using a plain CSS attribute selector
  (`button[aria-label="..."]`) for card buttons instead.
- `hasText` locators stop matching a card once it switches into its inline edit form
  (the title moves from text content into an `<input value>`, which `hasText` doesn't see) -
  fixed by resolving the card's stable `data-testid` before entering edit mode.
- The board is one real, persisted row shared by the single hardcoded user, with no reset
  endpoint - so `playwright.config.ts` now forces `workers: 1`, and `kanban.spec.ts`'s tests
  use randomly-suffixed titles and clean up after themselves rather than assuming specific
  seed content still exists.
- The big one: every mutating test action needed to explicitly wait for its own
  `PUT /api/board` (`KanbanBoard`'s `applyAndSave` fires it fire-and-forget) before moving
  on, or Playwright tearing the page down could abort it mid-flight - silently orphaning
  data in the real board (assertions against local React state still "pass", since they
  don't depend on the network round trip). This took several iterations across repeated
  batches of runs to fully pin down and fix everywhere it applied.

---

## Part 8: AI connectivity

**Goal** - prove the OpenAI call works end to end before building anything on top of it.

- [x] `backend/app/ai.py` - client constructed from `OPENAI_API_KEY`, model `gpt-5.6-luna`,
      both read from the environment with the model overridable (`OPENAI_MODEL`)
- [x] A single `ask(messages)` helper; a missing key fails loudly at call time (inside
      `get_client()`) with a clear message rather than at import
- [x] `backend/tests/test_ai_live.py` - marked `live`, deselected by default, sends "What is
      2+2?" and asserts the reply contains "4"
- [x] Document the live-test command in the README (already there since Part 2)

**Tests**
- `pytest -m live` - the 2+2 test passes against the real API - confirmed: `gpt-5.6-luna` is
  a real, working model
- `pytest` - the default run skips live tests (18 passed, 1 deselected) and passes with no
  key present; `app.ai` never touches `OPENAI_API_KEY` at import time, only inside `ask()`

**Success criteria** - the live test passes, and the ordinary test suite never touches the
network - both confirmed above.

Also added the `openai` Python SDK as a runtime dependency. It resolved to v3.x, a
noticeably different major version from what most existing documentation/training
describes (v1.x) - its top-level client shape and available resources differ, so its
actual installed API was checked directly (`dir(openai.OpenAI)`, `inspect.signature(...)`)
rather than assumed from memory before writing `ai.py` against it.

---

## Part 9: AI board reasoning

**Goal** - the AI sees the board and the conversation, and answers with an optional board
update.

- [x] `POST /api/chat` taking `{message}` and returning `{reply, board?}`
- [x] Conversation history stored per user in a new `chat_history` table (one row per user,
      messages as a JSON array - mirrors the `boards` table's shape) - recorded in
      `docs/DATABASE.md`
- [x] Prompt: a system message with the rules (five fixed columns, ids stable, never invent
      a column id) plus the current board JSON, then the history and the new message
- [x] Structured Outputs with a Pydantic response model: `reply: str` and a board field -
      **not literally `BoardData | None`** as originally sketched, though: OpenAI's
      structured outputs can't represent `BoardData.cards`'s `dict[str, Card]` (confirmed by
      trying it - a 400 naming `cards` as the offending field), so the AI-facing schema
      (`AIBoardData` in `app/chat.py`) uses `cards: list[AICard]` instead, converted to the
      real dict-keyed `BoardData` before validation/saving
- [x] A returned board goes through the same Part 6 validation before it is saved (literally
      the same `BoardData` model, via that conversion step) - on failure the reply is still
      returned and the board is left untouched
- [x] Cap history length (`MAX_HISTORY_MESSAGES = 20`) so the prompt cannot grow without
      bound

**Tests** - pytest with the AI client mocked (`test_chat.py`, `ask_structured` monkeypatched
to return a canned `ChatReply`):
- a reply with no board leaves the stored board unchanged
- a reply with a board persists it and returns it
- a structurally invalid board from the model (wrong column set) is rejected, the board is
  unchanged, and the reply still reaches the user
- history accumulates across turns and is truncated at the cap (`MAX_HISTORY_MESSAGES`
  patched down to 4 for a fast test)
- the route returns 401 without a session
- one live test (`test_chat_live.py`), marked `live`: asking to move the first Backlog card
  to Done produces a board where that card id sits in `col-done` - passed against the real
  API

**Success criteria** - the board never enters an invalid state as a result of a model
response, proven by the invalid-board test.

---

## Part 10: AI chat sidebar

**Goal** - the chat UI, and a board that refreshes itself when the AI changes it.

- [ ] `frontend/src/components/ChatSidebar.tsx` - collapsible right sidebar in the project
      color scheme: message list with user and assistant styling, textarea, send button,
      in-flight indicator, error state
- [ ] The board layout adjusts when the sidebar is open rather than overlapping the columns
- [ ] `POST /api/chat` from the client; when the response carries a board, apply it to the
      board state so the columns update without a manual reload
- [ ] A note in the transcript when a message changed the board
- [ ] History rendered from the server on load, so a reload does not lose the conversation
- [ ] Keyboard: Enter sends, Shift+Enter newlines; the sidebar is reachable and operable by
      keyboard alone

**Tests**
- vitest with a mocked fetch: messages render, sending appends the user message then the
  reply, a response containing a board updates the rendered columns, an error shows without
  losing the typed message, the in-flight state disables double submission
- Playwright against the container with the AI mocked at the backend: open the sidebar, send
  a message, see the reply, and see a card move on the board without a reload
- One live Playwright run, marked `live`, against the real model

**Success criteria** - a user can ask the AI to create, edit and move cards in plain
language and watch the board update, with the change surviving a reload. Full suite green:
pytest, `npm run test:unit`, `npm run test:e2e`.
