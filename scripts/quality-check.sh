#!/usr/bin/env bash
# bb-ystl.2 (QD.2): local quality-check wrapper for engineers iterating
# before pushing. Same logic as the .github/workflows/quality-gates.yml
# Tier 2 jobs (lint + per-package typecheck + full-repo lizard with
# allowlist subtraction). Coverage + mutation are NOT in this script
# — they're slow and best run as CI artifacts on a PR.
#
# Usage: bun run quality:check  (or: bash scripts/quality-check.sh)

set -e

echo "=== bun run lint ==="
bun run lint

echo "=== typecheck packages/server ==="
bun --cwd=packages/server run typecheck

echo "=== typecheck packages/client ==="
bun --cwd=packages/client run typecheck

echo "=== lizard --CCN 15 (full repo, allowlist-aware) ==="
LIZ=/tmp/lizvenv/bin/lizard
if [ ! -x "$LIZ" ]; then
    python3 -m venv /tmp/lizvenv
    /tmp/lizvenv/bin/pip install lizard -q
fi
LIZ_OUT=$($LIZ \
    packages/server/src packages/client/src src-tauri/src \
    -l typescript -l rust --CCN 15 \
    -x '*/__tests__/*' -x '*/__mocks__/*' \
    -x '*.test.ts' -x '*.test.tsx' \
    2>&1) || true

echo "$LIZ_OUT" | tail -10

WARN=$(echo "$LIZ_OUT" | grep -A2 '^Total nloc' | tail -1 | awk '{print $6}')
if [ -z "$WARN" ] || ! [[ "$WARN" =~ ^[0-9]+$ ]]; then
    echo "::error::Could not parse lizard Warning cnt (got '$WARN')"
    exit 1
fi

ALLOWED=0
if [ -f lizard-allowlist.txt ]; then
    ALLOWED=$(grep -cvE '^\s*(#|$)' lizard-allowlist.txt 2>/dev/null || echo 0)
fi

NET=$((WARN - ALLOWED))
echo "lizard warnings: $WARN; allowlisted: $ALLOWED; net: $NET"

if [ "$NET" -gt 0 ]; then
    echo "::error::$NET function(s) ≥ CCN 15 not in allowlist"
    echo "$LIZ_OUT" | grep -A20 '!!!! Warnings' || true
    exit 1
fi

echo "✓ quality:check passed"
