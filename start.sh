#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

PORT=48217

pids="$(lsof -nP -tiTCP:"${PORT}" -sTCP:LISTEN 2>/dev/null || true)"
if [[ -n "${pids}" ]]; then
  echo "Port ${PORT} is in use by PID ${pids}. Stopping it."
  # shellcheck disable=SC2086
  kill ${pids} 2>/dev/null || true
  sleep 1
  pids="$(lsof -nP -tiTCP:"${PORT}" -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -n "${pids}" ]]; then
    echo "Port ${PORT} still busy. Forcing stop."
    # shellcheck disable=SC2086
    kill -9 ${pids} 2>/dev/null || true
  fi
fi

if [[ ! -d node_modules ]]; then
  npm install
fi

echo "Starting H3 Story Prompt Workshop on port ${PORT}."
npm run dev
