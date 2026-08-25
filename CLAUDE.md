# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

A single-board Kanban app with an AI chat sidebar (MVP). One hardcoded user
(`user`/`password`), one Kanban board per user, runs locally in Docker. Full spec is in
`AGENTS.md`; build plan is in `docs/PLAN.md`; database schema and invariants are in
`docs/DATABASE.md`. Each of `backend/AGENTS.md`, `frontend/AGENTS.md` also has detailed
per-package notes — read the relevant one before working in that directory, since they
document non-obvious decisions (races, API quirks, etc.) this file doesn't repeat.

Stack: Next.js 16 frontend (static export) served by a FastAPI backend at `/`, SQLite
database, OpenAI API for the AI chat feature, everything packaged into one Docker image via
`uv` (Python) and `npm` (Node).

## Coding standards (from AGENTS.md)

1. Use latest versions of libraries and idiomatic approaches as of today.
2. Keep it simple — never over-engineer, always simplify, no unnecessary defensive
   programming. No extra features beyond what's asked.
3. Be concise. No emojis, ever.
4. When hitting issues, identify root cause before attempting a fix — don't guess; prove
   with evidence, then fix the root cause.

## Commands

Run the full app (Docker):

```
scripts/start.sh       # Mac/Linux — build image, start container, serve at localhost:8000
scripts/stop.sh        # Mac/Linux
scripts/start.ps1      # Windows
scripts/stop.ps1       # Windows
```

Backend (from `backend/`), managed with `uv`:

```
uv sync                    # install deps
uv run pytest               # unit tests (isolated temp DB per test)
uv run pytest -m live       # tests that call the real OpenAI API (excluded by default)
uv run uvicorn app.main:app --reload --port 8000
```

Frontend (from `frontend/`):

```
npm run dev            # dev server on :3000
npm run build          # production static export
npm run lint           # eslint
npm run test:unit      # vitest
npm run test:e2e       # playwright, excludes @live-tagged tests
npm run test:e2e:live  # only the @live-tagged tests (real OpenAI calls)
npm run test:all       # test:unit then test:e2e
```

Playwright e2e runs against the Docker container at `http://localhost:8000` by default (must
already be up); set `PW_BASE_URL=http://127.0.0.1:3000` to run against `next dev` instead.
`playwright.config.ts` forces `workers: 1` — there is exactly one shared board, so
board-mutating tests cannot run concurrently. A single test to run: use Playwright's
`--grep` / Vitest's file-path filtering as usual.

Requires an `OPENAI_API_KEY` in a `.env` file at the project root.

## Architecture

**Single source of truth for the board shape.** `frontend/src/lib/kanban.ts`'s `BoardData`
type (`columns: Column[]`, `cards: Record<string, Card>`) is exactly what
`backend/app/board.py`'s Pydantic `BoardData` validates, exactly what's stored as JSON in
SQLite, and exactly what the AI prompt/response use — no translation layer anywhere except
where OpenAI's structured-output schema forces one (see `AIBoardData` in `backend/app/chat.py`,
needed because strict JSON schemas can't express `cards` as an open-ended dict). Cards are
keyed once in `cards`; ordering lives entirely in each column's `cardIds`. The five column ids
are fixed constants (`col-backlog`, `col-discovery`, `col-progress`, `col-review`, `col-done`)
— renameable, never added/removed/re-identified.

**Static frontend, no Next.js server at runtime.** `next.config.ts` sets `output: "export"`.
The Docker build compiles the frontend to static HTML/JS/CSS (see `Dockerfile`) and the
FastAPI backend serves it directly from `backend/static` via a custom catch-all route
(`app/static.py`) — there's no SSR, no server components, no Next middleware, and the backend
cannot gate `/` server-side (auth redirect happens client-side after load, in `page.tsx`).

**Auth is a signed session cookie**, no session table: `SessionMiddleware` signs the
username with `SESSION_SECRET`; `require_user` (in `app/auth.py`) reads it and looks the user
up on every request.

**Database is JSON-blob-per-user, not normalized** — one row each in `boards` and
`chat_history` per user, storing the whole `BoardData` / message list as a JSON text column.
Deliberate MVP tradeoff (see `docs/DATABASE.md`'s "why a JSON blob" section) since there's
exactly one board per user and the invariants are cheap to check in Python on every write.
Same `BoardData` Pydantic model validates every write path (direct API `PUT`, and the AI's
proposed board from chat), so nothing can bypass the invariants (five fixed columns; every
`cardIds` entry exists in `cards`; every card in exactly one column).

**Chat re-reads the live board on every turn** rather than trusting stored history, since a
direct UI edit can happen between chat turns; the system prompt is rebuilt with the current
board state each time. `GET/POST /api/chat` in `backend/app/chat.py`; conversation history
(not the board) is what's persisted, capped at `MAX_HISTORY_MESSAGES`.

**Frontend save pattern**: `KanbanBoard.tsx`'s `applyAndSave` updates local state optimistically
then `PUT`s in the background, reverting to `lastSavedBoard` on failure. Column rename is
debounced 500ms. When the AI chat endpoint returns an updated board, it's adopted directly
(already validated/persisted server-side) with no follow-up `PUT`.

## Environment

- `.env` at the project root holds `OPENAI_API_KEY` (and `SESSION_SECRET`, auto-generated by
  the start scripts if missing). Loaded via `python-dotenv` locally; Docker gets it through
  `compose.yaml`'s `env_file` instead.
- `DATABASE_PATH` defaults to `/data/pm.db` (the Docker volume mount); tests override it to a
  temp file per test.
- Model name is configurable via `OPENAI_MODEL` (default `gpt-5.6-luna`).
