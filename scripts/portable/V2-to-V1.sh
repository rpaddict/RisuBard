#!/bin/sh
set -eu

if [ "$#" -ne 1 ]; then
  echo "Usage: ./V2-to-V1.sh <v2-data-folder>" >&2
  exit 1
fi

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
exec "$SCRIPT_DIR/bin/node" "$SCRIPT_DIR/scripts/convert-v2-to-v0925.cjs" "$1"
