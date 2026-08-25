FROM node:22-slim AS frontend-builder

WORKDIR /app

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend ./
RUN npm run build

FROM ghcr.io/astral-sh/uv:python3.13-bookworm-slim

WORKDIR /app

COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --locked --no-install-project --no-dev

COPY backend/app ./app
COPY --from=frontend-builder /app/out ./static

EXPOSE 8000

CMD ["uv", "run", "--no-dev", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
