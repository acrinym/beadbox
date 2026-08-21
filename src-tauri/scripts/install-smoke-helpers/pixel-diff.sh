#!/usr/bin/env bash
#
# pixel-diff.sh — Wraps ImageMagick's `compare` for cross-platform pixel
# diffing in install-smoke.yml Gate 2.
#
# Usage:
#   pixel-diff.sh <reference.png> <candidate.png> <diff.png>
#
# Output (stdout): the percent-pixels-different as a decimal number
# (e.g., "0.42" for 0.42%). The workflow's caller asserts this against a
# threshold (1.0% per bb-x6lg.6 AC).
#
# Why ImageMagick: ubiquitous across all three platform runners.
#   macOS:   brew install imagemagick
#   Linux:   apt-get install imagemagick
#   Windows: scoop install imagemagick   (or choco install imagemagick)
# All three install the `compare` binary on PATH. Result format is stable
# across versions: AE metric returns a single integer count of differing
# pixels; we convert to a percentage against the candidate's pixel count.
#
# Exit codes:
#   0 — diff computed and emitted on stdout (regardless of threshold)
#   1 — invocation error (missing arg, missing tool, file not found)
# The threshold check is the workflow's job, not this script's.

set -euo pipefail

REF="${1:-}"
CAND="${2:-}"
DIFF_OUT="${3:-}"

if [ -z "$REF" ] || [ -z "$CAND" ] || [ -z "$DIFF_OUT" ]; then
  echo "Usage: $0 <reference.png> <candidate.png> <diff.png>" >&2
  exit 1
fi
[ -f "$REF" ]  || { echo "::error::reference not found: $REF" >&2; exit 1; }
[ -f "$CAND" ] || { echo "::error::candidate not found: $CAND" >&2; exit 1; }

if ! command -v compare >/dev/null 2>&1; then
  echo "::error::ImageMagick 'compare' not found on PATH" >&2
  exit 1
fi
if ! command -v identify >/dev/null 2>&1; then
  echo "::error::ImageMagick 'identify' not found on PATH" >&2
  exit 1
fi

# AE metric prints the differing-pixel count to stderr and writes the
# diff image to DIFF_OUT. Non-zero exit code is expected when there's
# any diff at all; trap so we don't kill the script.
DIFF_COUNT=$(compare -metric AE "$REF" "$CAND" "$DIFF_OUT" 2>&1 || true)
# Strip non-digits in case ImageMagick added formatting.
DIFF_COUNT=$(echo "$DIFF_COUNT" | tr -dc '0-9')
[ -z "$DIFF_COUNT" ] && DIFF_COUNT=0

# Total pixels = width * height. Use identify on the candidate (the
# WKWebView shot we're scoring; the reference may be a different size,
# in which case ImageMagick crops/pads to candidate dims by default).
W=$(identify -format "%w" "$CAND")
H=$(identify -format "%h" "$CAND")
TOTAL=$((W * H))

if [ "$TOTAL" -le 0 ]; then
  echo "::error::candidate image has zero pixels (W=$W H=$H)" >&2
  exit 1
fi

# Percent = diff_count * 100 / total. Use awk for floating-point.
awk -v d="$DIFF_COUNT" -v t="$TOTAL" 'BEGIN { printf "%.4f\n", (d * 100.0) / t }'
