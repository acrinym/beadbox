# Reference Screenshots

Baseline screenshots used by `install-smoke.yml` Gate 2 (WKWebView CSS
visual diff vs Chromium). Each `<name>-<page>.png` here is the
"correct" rendering — the Tauri WKWebView screenshot taken on a runner
is diffed against this file.

## Files

| File | What | Generated from |
|------|------|----------------|
| `chromium-home.png` | `/` route, Chromium baseline | `bun --cwd packages/client run dev` → http://localhost:5173/ |

The first commit of `install-smoke.yml` (bb-x6lg.6) intentionally does
NOT ship `chromium-home.png` because reference screenshots require a
maintainer's workstation (Chromium GUI). The workflow handles the
absence gracefully: Gate 2 skips with a warning until the file is
committed. Gates 1, 3, 4 still run on every workflow execution.

## Generation

Run on a maintainer's workstation:

```bash
# 1. Build & start the Vite SPA dev server
bun --cwd packages/client run dev
# Note the URL Vite prints (default http://localhost:5173/, may auto-pick
# a higher port if 5173 is busy)

# 2. Open Chromium with a fixed viewport size — repeatability is the whole
#    point of a baseline. The diff is sensitive to viewport, so pick a
#    common size and document it (we use 1280×800 to match the macOS
#    runner's default WKWebView size).
google-chrome \
  --no-first-run \
  --window-size=1280,800 \
  --user-data-dir="$(mktemp -d)" \
  http://localhost:5173/

# 3. Wait for the route to fully render (no skeletons, no flickers).
#    StartupGate may run; in browser dev mode it'll fall through to /
#    via its workspace-not-required code path.

# 4. Capture via Chrome DevTools:
#      Cmd-Option-I → Cmd-Shift-P → "Capture full size screenshot"
#    Save the result as: src-tauri/scripts/reference-screenshots/chromium-home.png

# 5. Verify size & format:
file src-tauri/scripts/reference-screenshots/chromium-home.png
# Expected: PNG image data, 1280 x ~800, 8-bit/color RGBA, non-interlaced

# 6. Commit:
git add src-tauri/scripts/reference-screenshots/chromium-home.png
git commit -m "feat(smoke): add Chromium reference screenshot for Gate 2 (bb-x6lg.6 follow-up)"
```

## Pin / version requirements

Browser rendering varies by version, font availability, OS color
profile. To minimize drift between the maintainer's workstation and
the macOS runner's WKWebView:

- **Chromium**: stable channel at the time of generation. Document the
  exact version in the commit message that adds the screenshot.
- **Viewport**: 1280 × 800. Matches the macOS runner's WKWebView
  default. If that ever changes, regenerate.
- **OS**: macOS, since the WKWebView side IS macOS. Cross-platform
  rendering math (font hinting, OKLCH color resolution) is closer
  Chromium-on-macOS ↔ WKWebView-on-macOS than Chromium-on-Linux ↔
  WKWebView-on-macOS.

## When to regenerate

Anytime the `/` route's chrome composition changes:

- P3.1 chrome edits (header, startup gate visible state)
- P2.3 chrome edits (Toaster position, ConsoleLogo placement, DevBadge)
- `packages/client/src/index.css` `@theme` token changes (colors,
  spacing, font stack)
- Tailwind v4 upgrade
- Any deliberate visual redesign

The diff failing on an UNINTENDED change is a feature — the gate exists
to surface visual regressions before users see them. When a diff fails:
1. Open the workflow's `smoke-macos-arm64-logs` artifact and inspect
   `_smoke/wkwebview-screenshots/diff.png`.
2. Decide: regression (fix the code) vs intentional change (regenerate
   the baseline + commit per the steps above).

## Threshold

`install-smoke.yml` accepts up to **1.0%** pixel difference (per the
bb-x6lg.6 acceptance criteria). Tighter is better but flake-prone;
looser misses real regressions. Re-tune in a separate bead if the
empirical false-positive rate justifies it.

## Future expansion

When P3.4 (formulas) or other rich routes ship, add per-route
screenshots:

- `chromium-formulas.png`
- `chromium-activity.png`
- `chromium-workspaces.png`

Each with its own diff step in `install-smoke.yml`. Same generation
recipe — just navigate Chromium to the route before capture.
