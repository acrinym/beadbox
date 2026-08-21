#!/usr/bin/env bash
# Loop the 4-target sidecar build matrix locally. Convenience wrapper for
# cross-compile probing during P5 development; CI invokes copy-sidecar.sh
# per-target per-runner (release.yml / P5.4) and does not call this
# script.
#
# Targets default to the 4 Tauri-supported Rust triples:
#   aarch64-apple-darwin       (macOS ARM64 — primary)
#   x86_64-apple-darwin        (macOS Intel — matrix entry preserved;
#                               disabled in release.yml per arch's audit,
#                               kept here for v0.26 re-enable)
#   x86_64-unknown-linux-gnu   (Linux x86_64)
#   x86_64-pc-windows-msvc     (Windows x86_64)
#
# Skips on per-target failure rather than aborting the whole loop —
# expected when probing cross-compile from one host (e.g. Linux compile
# from macOS without a target installed). Reports a per-target size
# table at the end so the size-baseline drift from TB0.6 (57/35/37 MB)
# is visible at a glance.
#
# Usage:
#   build-all.sh                                   # all 4 targets
#   build-all.sh aarch64-apple-darwin x86_64-...   # explicit subset
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVER_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$SERVER_DIR/../.." && pwd)"
COPY_SIDECAR="$REPO_ROOT/src-tauri/scripts/copy-sidecar.sh"
BINARIES_DIR="$REPO_ROOT/src-tauri/binaries"

if [[ ! -x "$COPY_SIDECAR" ]]; then
  echo "copy-sidecar.sh not found at $COPY_SIDECAR" >&2
  exit 1
fi

DEFAULT_TARGETS=(
  aarch64-apple-darwin
  x86_64-apple-darwin
  x86_64-unknown-linux-gnu
  x86_64-pc-windows-msvc
)

if [[ $# -gt 0 ]]; then
  TARGETS=("$@")
else
  TARGETS=("${DEFAULT_TARGETS[@]}")
fi

declare -a results

for triple in "${TARGETS[@]}"; do
  echo
  echo "════════════════════════════════════════════════════════════"
  echo "[build-all] target: $triple"
  echo "════════════════════════════════════════════════════════════"
  if "$COPY_SIDECAR" "$triple"; then
    ext=""
    [[ "$triple" == *windows* ]] && ext=".exe"
    outfile="$BINARIES_DIR/beadbox-sidecar-${triple}${ext}"
    if [[ -f "$outfile" ]]; then
      size_bytes=$(wc -c < "$outfile" | tr -d ' ')
      size_mb=$(awk -v b="$size_bytes" 'BEGIN{printf "%.1f", b/1024/1024}')
      results+=("OK   ${triple}  ${size_mb} MB")
    else
      results+=("MISS ${triple}  (script ok but binary not found at $outfile)")
    fi
  else
    rc=$?
    results+=("FAIL ${triple}  (exit $rc — likely missing cross-compile capability)")
  fi
done

echo
echo "════════════════════════════════════════════════════════════"
echo "[build-all] summary (TB0.6 baseline: 57 MB macOS-arm64, 35 MB linux-x64, 37 MB windows-x64):"
echo "════════════════════════════════════════════════════════════"
for line in "${results[@]}"; do
  echo "  $line"
done
