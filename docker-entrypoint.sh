#!/bin/sh
# Creates a persistent SECRET_KEY on first start so you don't have to manage one.
set -eu
DATA_DIR="${DATA_DIR:-/data}"
if [ -z "${SECRET_KEY:-}" ] || [ "$SECRET_KEY" = "change-me" ]; then
  [ -s "$DATA_DIR/secret_key" ] || python -c "import secrets; print(secrets.token_hex(32))" > "$DATA_DIR/secret_key"
  SECRET_KEY="$(cat "$DATA_DIR/secret_key")"
  export SECRET_KEY
fi
if [ "$#" -eq 0 ] || [ "${1#-}" != "$1" ]; then set -- uvicorn app.main:app "$@"; fi
exec "$@"
