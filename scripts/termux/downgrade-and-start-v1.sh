#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT"

if [ "$#" -gt 1 ]; then
    echo "Usage: bash scripts/termux/downgrade-and-start-v1.sh [v2-data-folder]" >&2
    exit 1
fi

SOURCE="${1:-${RISUBARD_DATA_ROOT:-${XDG_DATA_HOME:-$HOME/.local/share}/risubard}}"
SOURCE="${SOURCE%/}"
DESTINATION="${SOURCE}-v1"
MARKER="$DESTINATION/conversion/v2-to-v0925.json"

if [ ! -f "$MARKER" ]; then
    if [ -e "$DESTINATION" ]; then
        echo "Refusing to overwrite existing destination: $DESTINATION" >&2
        exit 1
    fi
    echo "Converting V2 data. The source remains unchanged: $SOURCE"
    node scripts/convert-v2-to-v0925.cjs "$SOURCE"
fi

echo "Starting RisuBard with V1 data: $DESTINATION"
export RISUBARD_DATA_ROOT="$DESTINATION"
exec node server/node/server.cjs
