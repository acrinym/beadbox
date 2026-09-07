#!/usr/bin/env bash
# scripts/check-ccn-allowlist.sh — CCN gate (bb-ystl.5 / QD.5).
#
# Runs lizard against the codebase, intersects the CCN ≥ 15 violation set
# against lizard-allowlist.txt, and exits non-zero on unallowed violations.
#
# Two modes:
#   --mode=changed  (pre-push) — lint files modified since the upstream
#                                  branch's tip. Fast path; what .husky/pre-push
#                                  invokes so contributors get fast feedback.
#   --mode=full     (CI)        — lint the whole repo. The authoritative
#                                  gate; what .github/workflows/quality-gates.yml
#                                  complexity-full-repo job invokes.
#
# Allowlist format: see lizard-allowlist.txt header. Lines starting with
# '#' are comments. Non-comment, non-empty lines are entries; the first
# whitespace-separated token of each entry is `<path>:<function-name>` —
# everything after `#` on the same line is a reason / approval-bead-id
# trail and is ignored by the parser.
#
# Lizard binary resolution (in order):
#   1. /tmp/lizvenv/bin/lizard  (project-standard PyPI install per bb-6ey1)
#   2. lizard-analyzer          (Homebrew package conflicting with LZ4 lizard)
#   3. lizard                   (PATH; only if it's the analyzer, not LZ4)
# If none found, prints install instructions and exits with a special status
# so pre-push contributors see a fixable error not a silent skip.
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
ALLOWLIST="$REPO_ROOT/lizard-allowlist.txt"
MODE="full"
THRESHOLD=15

# ── Args ──
for arg in "$@"; do
  case "$arg" in
    --mode=changed) MODE="changed" ;;
    --mode=full)    MODE="full" ;;
    --mode=*)       echo "unknown --mode value: ${arg#--mode=}" >&2; exit 2 ;;
    --help|-h)
      sed -n '2,/^set -euo pipefail/p' "$0" | sed 's/^# \?//'
      exit 0
      ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

# ── Locate lizard ──
LIZARD_BIN=""
# Unix venv uses bin/; Git-for-Windows venv uses Scripts/.
for cand in \
  "/tmp/lizvenv/bin/lizard" \
  "/tmp/lizvenv/Scripts/lizard" \
  "/tmp/lizvenv/Scripts/lizard.exe"; do
  if [ -x "$cand" ]; then
    LIZARD_BIN="$cand"
    break
  fi
done
if [ -z "$LIZARD_BIN" ] && command -v lizard-analyzer >/dev/null 2>&1; then
  LIZARD_BIN="$(command -v lizard-analyzer)"
fi
if [ -z "$LIZARD_BIN" ]; then
  for cmd in lizard lizard.exe; do
    if command -v "$cmd" >/dev/null 2>&1; then
      # Distinguish the analyzer from LZ4's `lizard`: --version on the analyzer
      # prints "Lizard command line interface ...", LZ4's prints LZ4-style help.
      if "$cmd" --version 2>&1 | grep -qi "Lizard command line interface"; then
        LIZARD_BIN="$(command -v "$cmd")"
        break
      fi
    fi
  done
fi
if [ -z "$LIZARD_BIN" ]; then
  cat >&2 <<EOF
[check-ccn-allowlist] lizard analyzer not found.

Install one of:
  python3 -m venv /tmp/lizvenv && /tmp/lizvenv/bin/pip install lizard -q
  brew install lizard-analyzer    # conflicts with brew install lizard (LZ4)
  pipx install lizard

Note: 'brew install lizard' installs an LZ4 compression tool, NOT this
analyzer. See docs/quality/<date>/complexity/ for the project standard.
EOF
  exit 3
fi

# ── Determine target paths ──
#
# bb-ej3u: lizard 1.22.1 with `-l typescript` SILENTLY SKIPS .tsx files
# in directory-recursive mode. `lizard packages/client/src -l typescript`
# scans 1022 .ts files and emits ZERO .tsx output. Explicit per-file
# invocation works correctly. Pre-fix, --mode=full was BLIND to all
# .tsx complexity since QD.5 landed.
#
# Fix: enumerate FILES in BOTH modes, never pass a directory to lizard.
# --mode=changed already enumerates files via git diff; --mode=full now
# does the same via find. Both modes use the same exclusion patterns,
# so verdicts are symmetric for the same allowlist.
collect_paths_full() {
  # Emit RELATIVE paths from REPO_ROOT — lizard echoes whatever path
  # form it received in its output, and the allowlist (lizard-allowlist.txt)
  # is keyed on relative paths. cd to REPO_ROOT so find emits relative.
  ( cd "$REPO_ROOT" || return
    find packages/server/src -type f -name '*.ts' \
      -not -path '*/__tests__/*' -not -path '*/__mocks__/*' \
      -not -name '*.test.ts' 2>/dev/null
    find packages/client/src -type f \( -name '*.ts' -o -name '*.tsx' \) \
      -not -path '*/__tests__/*' -not -path '*/__mocks__/*' \
      -not -name '*.test.ts' -not -name '*.test.tsx' 2>/dev/null
    find src-tauri/src -type f -name '*.rs' 2>/dev/null
  )
}

declare -a PATHS=()
case "$MODE" in
  full)
    while IFS= read -r f; do
      [ -z "$f" ] && continue
      PATHS+=("$f")
    done < <(collect_paths_full)
    ;;
  changed)
    # Diff against the upstream branch tip if available, else origin/v0.25,
    # else origin/main, else fall back to full.
    BASE=""
    if git rev-parse --abbrev-ref --symbolic-full-name '@{u}' >/dev/null 2>&1; then
      BASE="$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}')"
    elif git rev-parse --verify origin/v0.25 >/dev/null 2>&1; then
      BASE="origin/v0.25"
    elif git rev-parse --verify origin/main >/dev/null 2>&1; then
      BASE="origin/main"
    fi
    if [ -z "$BASE" ]; then
      echo "[check-ccn-allowlist] no upstream / origin reference; falling back to full mode" >&2
      while IFS= read -r f; do
        [ -z "$f" ] && continue
        PATHS+=("$f")
      done < <(collect_paths_full)
    else
      # `mapfile` is bash 4+; macOS default /bin/bash is 3.2. Use a while-read
      # loop fed via process substitution for portability.
      while IFS= read -r f; do
        [ -z "$f" ] && continue
        case "$f" in
          */__tests__/*|*/__mocks__/*|*.test.ts|*.test.tsx) continue ;;
        esac
        if [ -f "$f" ]; then PATHS+=("$f"); fi
      done < <(
        git diff --name-only --diff-filter=AMR "$BASE"...HEAD -- \
          'packages/server/src/**/*.ts' \
          'packages/client/src/**/*.ts' 'packages/client/src/**/*.tsx' \
          'src-tauri/src/**/*.rs' 2>/dev/null
      )
      if [ "${#PATHS[@]}" -eq 0 ]; then
        echo "[check-ccn-allowlist] no relevant changed files; nothing to check"
        exit 0
      fi
    fi
    ;;
esac

# bb-kf5o: build a flat array of 'path:start:end' hunk tokens from the
# diff. Used in --mode=changed to filter out lizard violations whose
# function range doesn't overlap any hunk (engineers shouldn't be
# forced to refactor pre-existing complex code just because they
# touched a different part of the same file).
declare -a HUNKS=()
if [ "$MODE" = "changed" ] && [ -n "${BASE:-}" ]; then
  for f in "${PATHS[@]}"; do
    # Each --no-color/-U0 hunk header looks like '@@ -OLD,N +NEW,M @@'.
    # OLD,N is the pre-image; NEW,M is the post-image we care about. M
    # may be omitted (single-line change → count=1). Parse via awk.
    while IFS= read -r hunk; do
      [ -n "$hunk" ] && HUNKS+=("$f:$hunk")
    done < <(
      git diff -U0 --no-color "$BASE"...HEAD -- "$f" 2>/dev/null \
        | awk '/^@@ / {
            # @@ -A,B +C,D @@ ...   -> parse the +C,D segment
            for (i = 1; i <= NF; i++) {
              if (substr($i, 1, 1) == "+") {
                sub("^\\+", "", $i)
                n = split($i, a, ",")
                start = a[1] + 0
                count = (n >= 2) ? a[2] + 0 : 1
                # zero-count hunks (pure deletions) have no post-image
                # lines to overlap; emit nothing
                if (count > 0) {
                  end = start + count - 1
                  print start ":" end
                }
                break
              }
            }
          }'
    )
  done
fi

# Test whether a given path:func_start:func_end overlaps ANY hunk in
# HUNKS for the same path. Echoes "1" if overlap, "0" otherwise.
hunks_overlap() {
  local target_path="$1"
  local fstart="$2"
  local fend="$3"
  local h hpath hstart hend
  for h in "${HUNKS[@]}"; do
    hpath="${h%%:*}"
    [ "$hpath" != "$target_path" ] && continue
    # Strip the leading 'path:' to get 'start:end'
    local rest="${h#*:}"
    hstart="${rest%%:*}"
    hend="${rest##*:}"
    # Range overlap: not(fend < hstart || fstart > hend)
    if [ "$fend" -ge "$hstart" ] && [ "$fstart" -le "$hend" ]; then
      echo "1"
      return
    fi
  done
  echo "0"
}

# ── Run lizard ──
LIZARD_OUT="$(mktemp)"
trap 'rm -f "$LIZARD_OUT"' EXIT

# -l limits parsers (TS for .ts/.tsx, Rust for .rs). --CCN gives the warning
# threshold (must be > the lower flag of 10 we use to drive ratcheting later).
# bb-ej3u: cd to REPO_ROOT so PATHS' relative entries resolve and lizard
# emits relative paths matching the allowlist's keying.
( cd "$REPO_ROOT" && \
  "$LIZARD_BIN" "${PATHS[@]}" -l typescript -l rust --CCN "$THRESHOLD" \
    -x "*/__tests__/*" -x "*/__mocks__/*" -x "*.test.ts" -x "*.test.tsx" \
) > "$LIZARD_OUT" 2>&1 || true  # lizard exits non-zero when warnings exist

# ── Parse violations ──
# The warning section is delimited by lines like:
#   !!!! Warnings (cyclomatic_complexity > N or ...) !!!!
# Followed by a header row and warning rows of the form:
#   <NLOC> <CCN> <token> <PARAM> <length> <name>@<start>-<end>@<path>
# We extract `<path>:<name>` for each warning row.
declare -a VIOLATIONS=()
in_warnings=0
while IFS= read -r line; do
  # Enter the warnings section on the lizard banner line
  if [[ "$line" == *"!!!! Warnings ("*"!!!!"* ]]; then
    in_warnings=1
    continue
  fi
  # Leave the warnings section on the totals row
  if [[ "$line" == "Total nloc"* ]]; then
    in_warnings=0
    continue
  fi
  [ "$in_warnings" = "0" ] && continue
  # Skip the column-header row + horizontal-rule lines + blank lines
  case "$line" in
    *NLOC*CCN*token*PARAM*length*location*) continue ;;
    "------"*|"======"*|"==="*|"") continue ;;
  esac
  # Warning row: trailing token is `name@start-end@path`
  loc="${line##* }"
  if [[ "$loc" == *"@"*"@"* ]]; then
    name="${loc%%@*}"
    path="${loc##*@}"
    # bb-kf5o: in --mode=changed, suppress violations whose function
    # line range doesn't overlap any diff hunk for that file. The
    # function's start-end is between the first and second '@'.
    if [ "$MODE" = "changed" ] && [ ${#HUNKS[@]} -gt 0 ]; then
      # Strip both '@' anchors to isolate 'start-end'.
      range="${loc#*@}"          # name removed → 'start-end@path'
      range="${range%@*}"         # path removed → 'start-end'
      fstart="${range%-*}"
      fend="${range#*-}"
      # Both lizard output and HUNKS use repo-relative paths (find
      # is run from REPO_ROOT, lizard is run from REPO_ROOT). Strip a
      # leading './' if present for symmetry.
      hpath="${path#./}"
      if [ "$(hunks_overlap "$hpath" "$fstart" "$fend")" = "0" ]; then
        continue
      fi
    fi
    VIOLATIONS+=("$path:$name")
  fi
done < "$LIZARD_OUT"

# ── Parse allowlist ──
declare -a ALLOWED=()
if [ -f "$ALLOWLIST" ]; then
  while IFS= read -r line; do
    # Strip leading whitespace + skip comments + skip blanks
    case "$line" in
      ""|"#"*) continue ;;
      *)
        # First whitespace-separated token is `<path>:<func>`; rest is metadata
        entry="${line%%[[:space:]#]*}"
        [ -z "$entry" ] && continue
        ALLOWED+=("$entry")
        ;;
    esac
  done < "$ALLOWLIST"
fi

# ── Intersect ──
# `${#arr[@]}` returns 0 for empty arrays even under `set -u`, so no
# guard / default-value modifier is needed. Earlier `${#arr[@]:-0}`
# attempts mixed length and default-value operators in a single
# expansion, which trips bad-substitution errors on some bash builds
# (bb-8w92).
declare -a UNALLOWED=()
if [ "${#VIOLATIONS[@]}" -gt 0 ]; then
  for v in "${VIOLATIONS[@]}"; do
    hit=0
    if [ "${#ALLOWED[@]}" -gt 0 ]; then
      for a in "${ALLOWED[@]}"; do
        if [ "$a" = "$v" ]; then hit=1; break; fi
      done
    fi
    [ "$hit" = "0" ] && UNALLOWED+=("$v")
  done
fi

# ── Report ──
if [ "${#UNALLOWED[@]}" -eq 0 ]; then
  printf "[check-ccn-allowlist] PASS — %d violations, all in allowlist (%d entries).\n" \
    "${#VIOLATIONS[@]}" "${#ALLOWED[@]}"
  exit 0
fi

cat >&2 <<EOF
[check-ccn-allowlist] FAIL — ${#UNALLOWED[@]} new CCN ≥ ${THRESHOLD} violation(s) not in allowlist:
EOF
for v in "${UNALLOWED[@]}"; do
  printf '  %s\n' "$v" >&2
done
cat >&2 <<EOF

To resolve, EITHER:
  1. Refactor the function below CCN ${THRESHOLD} (preferred), OR
  2. Add to lizard-allowlist.txt — REQUIRES super approval recorded in
     the commit message: "ALLOWLIST ADDITION sanctioned by super in bb-XXXX"

Run with --mode=full to see the complete repo state. See
docs/specs/quality-discipline.md §2 Q5 for the policy.
EOF
exit 1
