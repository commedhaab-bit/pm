# PM

A single-board Kanban app with an AI chat sidebar. See `AGENTS.md` for the full spec and
`docs/PLAN.md` for the build plan.

## Prerequisites

- Docker Desktop (with Compose)
- An OpenAI API key in `.env` at the project root: `OPENAI_API_KEY=...`

## Start

```
scripts/start.sh      # Mac/Linux
scripts/start.ps1      # Windows
```

Builds the image and starts the container, then serves the app at `http://localhost:8000`.

## Stop

```
scripts/stop.sh      # Mac/Linux
scripts/stop.ps1      # Windows
```

## Tests

Backend (from `backend/`):

```
uv run pytest             # unit tests
uv run pytest -m live     # tests that call the real OpenAI API
```

Frontend (from `frontend/`):

```
npm run test:unit
npm run test:e2e       # excludes tests that call the real OpenAI API
npm run test:e2e:live  # only the tests that call the real OpenAI API
```
