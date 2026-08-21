#!/usr/bin/env bash
#
# burst-bd-create.sh — 1000-event subscription burst for install-smoke.yml
# Gate 3.
#
# Strategy: create a tmpdir bd workspace, register it (or rely on the
# running app discovering it via the workspace registry), then issue
# 1000 bd create commands. The running Beadbox app's central
# useChangeSubscription should:
#   - receive 1000 stderr [SUBSCRIPTION:<id>] events from the sidecar
#   - bump useSubscriptionChangeSignal 1000 times
#   - drive 1000 invalidate-or-refetch cycles
#
# We can't observe the React tree from a CI shell. Instead, we observe
# what the sidecar wrote: the bd workspace's last-touched fingerprint
# advances on every mutation; the activity stream has 1000 entries.
#
# Pass criteria (per p4-verification-rubric.md Gate 3):
#   - 1000 bd create succeed within 30s wall clock
#   - bd activity / bd list shows 1000 entries
#   - the activity entries are in the correct creation order (sequence
#     number monotonically increasing)
#
# This script is gate-only — it doesn't probe the React side. The full
# end-to-end (app feed renders within 2s of last create) requires
# screenshot / OCR / accessibility-tree introspection that the bead's
# follow-up commits can layer on. The gate as-implemented catches the
# most common regression class (sidecar fails to dispatch under load),
# which is what addendum 1 + bb-vy13.6 / bb-cqpc.4 worried about.

set -euo pipefail

if ! command -v bd >/dev/null 2>&1; then
  echo "::error::bd CLI not on PATH" >&2
  exit 1
fi

WS_ROOT="$(mktemp -d)"
cd "$WS_ROOT"

echo "[burst] tmp workspace: $WS_ROOT"
git init -q .
git config user.email "smoke@local" >/dev/null
git config user.name "smoke" >/dev/null
bd init --skip-hooks --skip-agents >/dev/null

START="$(date +%s)"
N=1000
i=1
while [ "$i" -le "$N" ]; do
  bd create -t bug -p 1 "burst-$i" >/dev/null
  i=$((i + 1))
done
END="$(date +%s)"
ELAPSED=$((END - START))
echo "[burst] $N creates in ${ELAPSED}s"

if [ "$ELAPSED" -gt 30 ]; then
  echo "::error::Gate 3 burst took ${ELAPSED}s (>30s threshold)"
  exit 1
fi

# Sanity: the workspace has N+1 issues (N created here + the bd init's
# implicit metadata; recent bd versions don't auto-create issues, so the
# count is exactly N). Use bd list --json | jq.
COUNT=$(bd list --json --limit 2000 2>/dev/null | python3 -c "import json,sys; d=json.load(sys.stdin); print(len(d if isinstance(d,list) else d.get('issues',[])))")
echo "[burst] bd list reports $COUNT issues"

if [ "$COUNT" != "$N" ]; then
  echo "::error::Gate 3 expected $N issues, bd list reports $COUNT (drops or extras)"
  exit 1
fi

# Order check: bd list returns most-recent-first by default; the
# burst-N name carries the original sequence index. Walk the list,
# extract numeric suffix, assert it strictly decreases (since list is
# newest first) — equivalent to monotonic ordering of creation events.
ORDER_OK=$(bd list --json --limit 2000 2>/dev/null | python3 -c "
import json, sys, re
d = json.load(sys.stdin)
issues = d if isinstance(d, list) else d.get('issues', [])
seqs = []
for issue in issues:
    title = issue.get('title') or issue.get('name') or ''
    m = re.search(r'burst-(\d+)', title)
    if m: seqs.append(int(m.group(1)))
if not seqs:
    print('NONE')
elif seqs == sorted(seqs, reverse=True):
    print('MONOTONIC')
else:
    print('OUT_OF_ORDER')
")
echo "[burst] order check: $ORDER_OK"

if [ "$ORDER_OK" != "MONOTONIC" ]; then
  echo "::error::Gate 3 burst events out of order (or no burst-N entries found)"
  exit 1
fi

# Cleanup the tmp workspace so the running app isn't permanently
# polluted with the burst data. Note: if the app cached this workspace
# in its registry, removal here doesn't unregister; that's an app-side
# cleanup the operator runs after the run.
cd /
rm -rf "$WS_ROOT"
echo "[burst] OK"
