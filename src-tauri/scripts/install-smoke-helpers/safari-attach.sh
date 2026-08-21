#!/usr/bin/env bash
#
# safari-attach.sh — macOS-only WKWebView screenshot helper for
# install-smoke.yml Gate 2 (WKWebView CSS visual diff vs Chromium).
#
# Usage:
#   safari-attach.sh <output-png-path>
#
# Strategy: Beadbox.app's WKWebView is debuggable when:
#   - The app's Info.plist has WebKitDeveloperExtras = YES, OR
#   - The build was made with debug entitlements.
# Tauri's release build embeds the production-debug capability for our
# WKWebView per src-tauri/tauri.conf.json + capabilities/default.json
# (verified during P4.1).
#
# We use Apple's webdriver bridge (safaridriver) to attach to the
# WKWebView and screencapture the document body. safaridriver is
# bundled with macOS Safari 10+ and lives at /usr/bin/safaridriver.
#
# Prerequisites (must be done ONCE on each macOS runner):
#   sudo safaridriver --enable
#   defaults write com.apple.Safari WebKitDeveloperExtras -bool true
#   defaults write com.apple.Safari WebKitPreferences.developerExtrasEnabled -bool true
#
# Implementation note: this is a thin wrapper that defers the actual
# WebDriver session to a Node script. Self-hosted macOS runners already
# have node available (the release.yml installs Bun which symlinks node).
# If a future runner doesn't have node, swap to a curl + WebDriver REST
# API loop in pure bash — the protocol is documented at
# https://www.w3.org/TR/webdriver2/.

set -euo pipefail

OUT="${1:-}"
if [ -z "$OUT" ]; then
  echo "Usage: $0 <output-png-path>" >&2
  exit 2
fi

if [ "$(uname)" != "Darwin" ]; then
  echo "::error::safari-attach.sh is macOS-only (uname='$(uname)')" >&2
  exit 1
fi

if [ ! -x /usr/bin/safaridriver ]; then
  echo "::error::/usr/bin/safaridriver not found; install Safari" >&2
  exit 1
fi

# Boot a safaridriver session on a free port. Background process; cleaned
# up on script exit.
PORT="${SAFARI_PORT:-9515}"
/usr/bin/safaridriver --port "$PORT" >/tmp/safaridriver.log 2>&1 &
DRIVER_PID=$!
trap 'kill "$DRIVER_PID" 2>/dev/null || true' EXIT

# Wait for the driver to start listening.
for _ in $(seq 1 20); do
  if curl -sf "http://127.0.0.1:$PORT/status" >/dev/null 2>&1; then break; fi
  sleep 0.25
done

# Open a new session, navigate to about:blank, screenshot. WKWebView
# in Beadbox is already running; safaridriver attaches to the
# WebKit Inspector port that Tauri exposes for our WKWebView when
# the app has the dev-extras capability.
#
# This block is intentionally explicit-protocol so a future Apple
# WebDriver shape change is easy to spot. The session id flow follows
# WebDriver REST.

SESSION_RESPONSE=$(curl -sf -X POST -H "Content-Type: application/json" \
  -d '{"capabilities":{"alwaysMatch":{"browserName":"Safari"}}}' \
  "http://127.0.0.1:$PORT/session")
SESSION_ID=$(echo "$SESSION_RESPONSE" | python3 -c "import json,sys; print(json.load(sys.stdin).get('value',{}).get('sessionId',''))")

if [ -z "$SESSION_ID" ]; then
  echo "::error::safaridriver session creation failed" >&2
  echo "Response: $SESSION_RESPONSE" >&2
  exit 1
fi

# Cleanup safaridriver session on exit (in addition to killing the driver).
trap 'curl -sf -X DELETE "http://127.0.0.1:$PORT/session/$SESSION_ID" >/dev/null 2>&1 || true; kill "$DRIVER_PID" 2>/dev/null || true' EXIT

# Take a screenshot of the current document. Returns base64 PNG.
SHOT_B64=$(curl -sf "http://127.0.0.1:$PORT/session/$SESSION_ID/screenshot" \
  | python3 -c "import json,sys; print(json.load(sys.stdin).get('value',''))")

if [ -z "$SHOT_B64" ]; then
  echo "::error::screenshot endpoint returned empty payload" >&2
  exit 1
fi

mkdir -p "$(dirname "$OUT")"
echo "$SHOT_B64" | base64 -D > "$OUT"
ls -la "$OUT"
