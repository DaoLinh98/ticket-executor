#!/bin/sh
set -e

mkdir -p "$HOME"

if [ -z "$SETTINGS_ENC_KEY" ]; then
  keyfile=/data/settings-enc.key
  if [ ! -s "$keyfile" ]; then
    head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n' > "$keyfile"
    chmod 600 "$keyfile"
  fi
  SETTINGS_ENC_KEY="$(cat "$keyfile")"
  export SETTINGS_ENC_KEY
fi

npx prisma migrate deploy

exec npx next start -H 0.0.0.0 -p 3000
