#!/usr/bin/env bash
# Beadbox installer.
#
#   curl -fsSL https://beadbox.app/install.sh -o beadbox-install.sh && bash beadbox-install.sh
#
# Downloaded under a distinct name so it cannot clobber another install.sh in
# the current directory, and left on disk so it can be read before it is run.
#
# A NOTE ON `curl ... | sh`, because this script exists to fix a silent failure:
# if the URL 404s, curl writes nothing, the shell reads empty stdin and exits 0,
# and the user sees a success that installed nothing. NOTHING THIS SCRIPT DOES
# CAN CHANGE THAT -- it never runs in that case. Downloading first and running
# second is what makes a fetch failure visible. The whole script is therefore
# wrapped in main() and invoked on the last line, so a TRUNCATED download can
# never execute a partial installer either.
#
# Everything after the script starts is loud: no silent branches, no unverified
# artifact ever reaches the system, and every failure path exits non-zero with a
# message on stderr.
set -euo pipefail

# Debian and Ubuntu -- our shipping Linux target -- point /bin/sh at dash, so a
# `sh beadbox-install.sh` would fail on bash constructs in a way that reads as a
# broken installer rather than a wrong interpreter. Re-exec under bash instead
# of guessing, and say so plainly if bash is genuinely absent.
if [ -z "${BASH_VERSION:-}" ]; then
  if command -v bash >/dev/null 2>&1; then exec bash "$0" "$@"; fi
  printf 'error: this installer requires bash, which was not found in PATH.\n' >&2
  printf '       Install bash and re-run: bash %s\n' "$0" >&2
  exit 1
fi

REPO="beadbox/beadbox"
API="https://api.github.com/repos/${REPO}/releases/latest"
# The app's updater public key (src-tauri/tauri.conf.json plugins.updater.pubkey,
# decoded). Signatures are made by the release pipeline; this key is what proves
# an artifact came from us and not from whoever served the bytes.
MINISIGN_PUBKEY="RWS1kKmj0QLBEaLMscP2wloGY/F5tC1aDtkbLLCkwJ3jnrzsutZ4XQGD"

CHECK_ONLY=0
SKIP_VERIFY=0
TMPDIR_INSTALL=""

say()  { printf '%s\n' "$*"; }
info() { printf '==> %s\n' "$*"; }
warn() { printf 'warning: %s\n' "$*" >&2; }
die()  { printf 'error: %s\n' "$*" >&2; exit 1; }

cleanup() { [ -n "$TMPDIR_INSTALL" ] && rm -rf "$TMPDIR_INSTALL"; }

need() {
  command -v "$1" >/dev/null 2>&1 || die "'$1' is required but was not found in PATH.${2:+ $2}"
}

# ---------------------------------------------------------------- release API
# Fetch with the status code checked EXPLICITLY. `curl -f` alone would hand an
# empty body onward with no indication of why.
http_get() {
  _url="$1"; _out="$2"
  _code=$(curl -sSL -w '%{http_code}' -o "$_out" "$_url" 2>"$TMPDIR_INSTALL/curl.err") || {
    die "network request failed for $_url: $(cat "$TMPDIR_INSTALL/curl.err")"
  }
  [ "$_code" = "200" ] || die "$_url returned HTTP $_code (expected 200)."
  [ -s "$_out" ] || die "$_url returned an empty body."
}

# Asset fields, extracted without jq -- a fresh machine may not have it, and an
# installer that dies on a missing jq is the same silent-cliff class this fixes.
# browser_download_url is the last field of each asset object, so the text
# between the previous one and ours holds our size and digest.
# Emits "name<TAB>url<TAB>size<TAB>digest" per asset. Within an asset object
# "name" precedes "size"/"digest"/"browser_download_url", and the nested
# uploader object carries "login" rather than "name", so the most recent "name"
# is always the current asset's.
assets_table() {
  awk '
    /"name":/      { if (match($0, /"name": *"[^"]*"/)) { v=substr($0,RSTART,RLENGTH); sub(/"name": *"/,"",v); sub(/"$/,"",v); name=v } }
    /"size":/      { if (match($0, /"size": *[0-9]+/))  { v=substr($0,RSTART,RLENGTH); sub(/"size": *"?/,"",v); size=v } }
    /"digest":/    { if (match($0, /"digest": *"sha256:[0-9a-f]*"/)) { v=substr($0,RSTART,RLENGTH); sub(/.*sha256:/,"",v); sub(/"$/,"",v); digest=v } }
    /"browser_download_url":/ {
      if (match($0, /"browser_download_url": *"[^"]*"/)) {
        v=substr($0,RSTART,RLENGTH); sub(/"browser_download_url": *"/,"",v); sub(/"$/,"",v)
        printf "%s\t%s\t%s\t%s\n", name, v, size, digest
        size=""; digest=""
      }
    }
  ' "$1"
}
asset_row()    { assets_table "$1" | awk -F'\t' -v re="$2" '$1 ~ re { print; exit }'; }
row_url()      { printf '%s' "$1" | cut -f2; }
row_size()     { printf '%s' "$1" | cut -f3; }
row_digest()   { printf '%s' "$1" | cut -f4; }

# ------------------------------------------------------------- verification
# Two independent checks per platform. The digest is GitHub's own, over the same
# TLS channel the bytes came from: it catches truncation and corruption. The
# second check does not trust that channel at all -- Apple's notarization on
# macOS, our minisign signature on Linux -- so bytes swapped at the source still
# fail. Neither is skipped silently.
# Every successful check appends here. install_* refuses to touch the system
# while this is empty, so "no verification ran" can never be a silent pass --
# the failure mode this installer exists to eliminate.
VERIFIED_BY=""
record_check() { VERIFIED_BY="${VERIFIED_BY}${VERIFIED_BY:+, }$1"; }
require_verification() {
  if [ -z "$VERIFIED_BY" ]; then
    [ "$SKIP_VERIFY" = "1" ] || die "no integrity check could be completed for $1, so it will not be installed.
Re-run with --skip-verify only if you accept unverified bytes."
    warn "INSTALLING $1 WITH NO INTEGRITY CHECK AT ALL (--skip-verify)."
    return 0
  fi
  info "verified by: $VERIFIED_BY"
}


verify_digest() {
  _file="$1"; _want="$2"
  [ -n "$_want" ] || die "the release API published no sha256 digest for $(basename "$_file").
Refusing to install an artifact whose checksum cannot be confirmed."
  if command -v shasum >/dev/null 2>&1; then _got=$(shasum -a 256 "$_file" | awk '{print $1}')
  elif command -v sha256sum >/dev/null 2>&1; then _got=$(sha256sum "$_file" | awk '{print $1}')
  else warn "no shasum/sha256sum available; skipping the checksum check."; return 0
  fi
  [ "$_got" = "$_want" ] || die "checksum mismatch for $(basename "$_file").
  expected $_want
  got      $_got
The download does not match what the release publishes. Nothing was installed."
  record_check "sha256 digest"
  info "checksum verified (sha256 ${_got%"${_got#????????}"}...)"
}

verify_minisign() {
  _file="$1"; _sig="$2"
  if [ "$SKIP_VERIFY" = "1" ]; then
    warn "signature verification skipped at your request (--skip-verify). You are installing unverified bytes."
    return 0
  fi
  if ! command -v minisign >/dev/null 2>&1; then
    say ""
    say "This installer verifies the package signature before installing it, and"
    say "'minisign' is not installed. Install it and re-run:"
    say ""
    say "    sudo apt-get install -y minisign     # Debian/Ubuntu"
    say "    sudo dnf install -y minisign         # Fedora"
    say ""
    say "To proceed without verification (not recommended), re-run with --skip-verify."
    die "cannot verify the download without minisign; nothing was installed."
  fi
  # The release publishes the .sig asset base64-encoded (the updater reads it
  # that way). minisign wants the decoded file, so normalise before verifying --
  # handing it the encoded blob fails with a signature error that looks like
  # tampering, which is exactly the wrong thing to tell a user.
  if head -c 18 "$_sig" | grep -q '^untrusted comment'; then
    _sigfile="$_sig"
  else
    _sigfile="${_sig}.decoded"
    base64 -d < "$_sig" > "$_sigfile" 2>/dev/null || base64 -D < "$_sig" > "$_sigfile" 2>/dev/null \
      || die "could not decode the signature file for $(basename "$_file"). Nothing was installed."
    head -c 18 "$_sigfile" | grep -q '^untrusted comment' \
      || die "the signature file for $(basename "$_file") is not in a recognised format. Nothing was installed."
  fi
  minisign -V -P "$MINISIGN_PUBKEY" -x "$_sigfile" -m "$_file" >/dev/null 2>&1 \
    || die "SIGNATURE VERIFICATION FAILED for $(basename "$_file").
The file does not carry a valid Beadbox signature. Nothing was installed.
This means the download was corrupted or tampered with -- please report it."
  record_check "minisign signature"
  info "signature verified against the Beadbox release key"
}

verify_apple() {
  _app="$1"
  command -v codesign >/dev/null 2>&1 || { warn "codesign unavailable; skipping the notarization check."; return 0; }
  codesign --verify --deep --strict "$_app" >/dev/null 2>&1 \
    || die "code signature verification FAILED for $_app. Nothing was installed."
  if command -v spctl >/dev/null 2>&1; then
    spctl --assess --type execute "$_app" >/dev/null 2>&1 \
      || die "Gatekeeper rejected $_app (not notarized, or altered). Nothing was installed."
    record_check "Apple notarization"
    info "Apple signature and notarization verified"
  else
    record_check "Apple code signature"
    info "code signature verified"
  fi
}

# ------------------------------------------------------------------ installs
install_macos_cask() {
  info "Homebrew found -- installing the cask so 'brew upgrade' keeps Beadbox current."
  brew install --cask beadbox/cask/beadbox || die "'brew install --cask beadbox/cask/beadbox' failed. See the output above."
  # Report what brew resolved -- never a version this script did not install.
  # Homebrew verifies the cask's own sha256 before installing, which is the
  # integrity check on this path.
  record_check "Homebrew cask sha256"
  _v=$(brew list --cask --versions beadbox 2>/dev/null | awk '{print $2}')
  info "Installed${_v:+ version $_v} via Homebrew. Launch it with: open -a Beadbox"
}

install_macos_dmg() {
  _json="$1"
  _row=$(asset_row "$_json" 'macOS-arm64\.dmg$')
  [ -n "$_row" ] || die "the latest release has no macOS arm64 .dmg asset. Please report this at https://github.com/${REPO}/issues"
  _url=$(row_url "$_row"); _dig=$(row_digest "$_row")
  _dmg="$TMPDIR_INSTALL/$(basename "$_url")"

  info "downloading $(basename "$_url")"
  http_get "$_url" "$_dmg"
  verify_digest "$_dmg" "$_dig"

  _mnt="$TMPDIR_INSTALL/mnt"; mkdir -p "$_mnt"
  hdiutil attach "$_dmg" -nobrowse -readonly -mountpoint "$_mnt" >/dev/null 2>&1 \
    || die "the downloaded file is not a valid disk image. Nothing was installed."
  # shellcheck disable=SC2064  # expand $_mnt now, on purpose
  trap "hdiutil detach '$_mnt' >/dev/null 2>&1 || true; cleanup" EXIT INT TERM
  [ -d "$_mnt/Beadbox.app" ] || die "the disk image does not contain Beadbox.app. Nothing was installed."
  verify_apple "$_mnt/Beadbox.app"

  require_verification "$(basename "$_dmg")"
  info "installing to /Applications/Beadbox.app"
  rm -rf "/Applications/Beadbox.app"
  cp -R "$_mnt/Beadbox.app" "/Applications/Beadbox.app" || die "could not copy to /Applications. Nothing was installed."
  hdiutil detach "$_mnt" >/dev/null 2>&1 || true
  info "Installed. Launch it with: open -a Beadbox"
}

install_linux_deb() {
  _json="$1"
  _row=$(asset_row "$_json" 'Linux_amd64\.deb$')
  [ -n "$_row" ] || die "the latest release has no Linux amd64 .deb asset. Please report this at https://github.com/${REPO}/issues"
  _url=$(row_url "$_row"); _dig=$(row_digest "$_row")
  _sigrow=$(asset_row "$_json" 'Beadbox_x86_64\.deb\.sig$'); _sigurl=""
  [ -n "$_sigrow" ] && _sigurl=$(row_url "$_sigrow")
  _deb="$TMPDIR_INSTALL/$(basename "$_url")"

  info "downloading $(basename "$_url")"
  http_get "$_url" "$_deb"
  # Test hook (QA harness only): flip one byte to prove the verification layer
  # rejects altered bytes. Never set in normal use.
  [ "${BEADBOX_TEST_CORRUPT:-0}" = "1" ] && { printf 'X' | dd of="$_deb" bs=1 seek=5000000 conv=notrunc status=none; warn "TEST HOOK: corrupted the download on purpose"; }
  verify_digest "$_deb" "$_dig"

  if [ -n "$_sigurl" ]; then
    # The signed updater artifact and the user-facing .deb are the same bytes
    # (identical sha256 in the release), so this signature covers this file.
    http_get "$_sigurl" "$TMPDIR_INSTALL/pkg.sig"
    verify_minisign "$_deb" "$TMPDIR_INSTALL/pkg.sig"
  elif [ "$SKIP_VERIFY" = "1" ]; then
    warn "no signature published for this release; continuing because --skip-verify was given."
  else
    die "no signature asset found for this release, so the download cannot be verified. Nothing was installed."
  fi

  require_verification "$(basename "$_deb")"
  command -v dpkg >/dev/null 2>&1 || die "this installer needs a Debian-based system (dpkg not found).
Download the .deb manually from https://github.com/${REPO}/releases/latest"
  dpkg-deb --info "$_deb" >/dev/null 2>&1 || die "the downloaded file is not a valid .deb package. Nothing was installed."

  _sudo=""
  [ "$(id -u)" -eq 0 ] || { command -v sudo >/dev/null 2>&1 && _sudo="sudo" || die "installing needs root. Re-run as root, or install sudo."; }
  info "installing the package (you may be prompted for your password)"
  if command -v apt-get >/dev/null 2>&1; then
    $_sudo apt-get install -y "$_deb" || die "apt-get failed to install the package. See the output above."
  else
    $_sudo dpkg -i "$_deb" || die "dpkg failed to install the package. If it reports missing dependencies, run: $_sudo apt-get -f install"
  fi
  info "Installed. Launch it with: beadbox"
}

check_bd() {
  if command -v bd >/dev/null 2>&1; then
    info "beads CLI found: $(bd version 2>/dev/null | head -1)"
  else
    say ""
    warn "the 'bd' (beads) CLI is not installed. Beadbox is a GUI over bd and needs it
         to open a workspace. Install it with:  brew install beads
         See https://github.com/gastownhall/beads"
  fi
}

usage() {
  say "Beadbox installer"
  say ""
  say "  --check         verify the environment and the latest release, install nothing"
  say "  --skip-verify   install without signature verification (NOT recommended)"
  say "  -h, --help      this message"
}

main() {
  for arg in "$@"; do
    case "$arg" in
      --check) CHECK_ONLY=1 ;;
      --skip-verify) SKIP_VERIFY=1 ;;
      -h|--help) usage; exit 0 ;;
      *) die "unknown option: $arg (try --help)" ;;
    esac
  done

  need curl
  TMPDIR_INSTALL=$(mktemp -d 2>/dev/null || mktemp -d -t beadbox-install)
  trap cleanup EXIT INT TERM

  _os=$(uname -s); _arch=$(uname -m)
  case "$_arch" in amd64) _arch=x86_64 ;; arm64|aarch64) _arch=arm64 ;; esac
  info "detected ${_os} ${_arch}"

  # Exhaustive by design: every platform reaches a definite outcome, and the
  # ones we do not build for say so in plain words rather than failing obscurely.
  case "${_os}:${_arch}" in
    Darwin:arm64) _plan="macos" ;;
    Darwin:x86_64)
      die "Beadbox does not publish an Intel (x86_64) macOS build.
On Apple Silicon this installer works as-is. On an Intel Mac, build from source:
  https://github.com/${REPO}#development" ;;
    Linux:x86_64) _plan="linux" ;;
    Linux:arm64)
      die "Beadbox does not publish a Linux arm64 build yet.
Build from source: https://github.com/${REPO}#development" ;;
    CYGWIN*:*|MINGW*:*|MSYS*:*|Windows*:*)
      die "This installer does not support Windows.
Download the installer from https://github.com/${REPO}/releases/latest" ;;
    *)
      die "unsupported platform: ${_os} ${_arch}.
See https://github.com/${REPO}/releases/latest for available downloads." ;;
  esac

  # On macOS with Homebrew the cask decides the version, so do not resolve (or
  # announce) a release here: doing both once printed one version and installed
  # another. brew is the source of truth on that path.
  if [ "$_plan" = "macos" ] && [ "$CHECK_ONLY" = "0" ] && command -v brew >/dev/null 2>&1; then
    install_macos_cask
    check_bd
    exit 0
  fi

  info "resolving the latest release"
  http_get "$API" "$TMPDIR_INSTALL/release.json"
  _tag=$(grep -o '"tag_name"[[:space:]]*:[[:space:]]*"[^"]*"' "$TMPDIR_INSTALL/release.json" | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
  [ -n "$_tag" ] || die "could not read a release tag from the GitHub API response. Nothing was installed."
  info "latest release: $_tag"

  if [ "$CHECK_ONLY" = "1" ]; then
    if [ "$_plan" = "macos" ]; then _want='macOS-arm64\.dmg$'; else _want='Linux_amd64\.deb$'; fi
    _r=$(asset_row "$TMPDIR_INSTALL/release.json" "$_want")
    [ -n "$_r" ] || die "no asset matching $_want in release $_tag."
    info "asset for this platform: $(basename "$(row_url "$_r")") ($(row_size "$_r") bytes)"
    [ -n "$(row_digest "$_r")" ] || die "the release publishes no sha256 digest for that asset; an install would refuse to proceed."
    info "digest published: sha256 $(row_digest "$_r" | cut -c1-16)..."
    info "--check passed; nothing was installed."
    exit 0
  fi

  if [ "$_plan" = "macos" ]; then
    install_macos_dmg "$TMPDIR_INSTALL/release.json"
  else
    install_linux_deb "$TMPDIR_INSTALL/release.json"
  fi

  check_bd
}

# Test hook (QA harness only): make every verifier unavailable, to prove the
# guard above refuses rather than installing unchecked bytes.
if [ "${BEADBOX_TEST_NO_VERIFIERS:-0}" = "1" ]; then
  verify_digest()   { warn "TEST HOOK: checksum verifier unavailable"; }
  verify_minisign() { warn "TEST HOOK: signature verifier unavailable"; }
fi

# Invoked last so a truncated download cannot execute a partial installer.
main "$@"
