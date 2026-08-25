#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f .env ] || ! grep -q '^SESSION_SECRET=' .env; then
  printf '\nSESSION_SECRET=%s\n' "$(openssl rand -hex 32)" >> .env
fi

docker compose up -d --build
echo "PM app running at http://localhost:8000"
