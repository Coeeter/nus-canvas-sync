#!/bin/sh
set -eu

if [ "$#" -gt 0 ]; then
  exec "$@"
fi

if [ -n "${DOPPLER_TOKEN:-}" ]; then
  exec doppler run -- bun run sync
fi

exec bun run sync
