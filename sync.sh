#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$root"
exec bun run "$root/src/cli/collect.ts" "$@"
