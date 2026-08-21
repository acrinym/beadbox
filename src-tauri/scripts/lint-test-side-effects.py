#!/usr/bin/env python3
"""
bb-y0me: lint Rust unit tests for real-OS-store side effects.

Background — bb-7oq8 hardening incident:
    The first cargo-mutants run on src-tauri/ spammed Nelson's macOS login
    keychain ~50 times because credentials::keychain_round_trip and
    credentials::get_nonexistent_credential_returns_error called the real
    keyring crate. cargo-mutants invokes each test once per mutant; macOS
    pops a keychain prompt for each access.

Rule:
    A `#[test] fn` MUST NOT touch a real OS credential store, fork
    platform-specific subprocesses, mutate process-global env without a
    serialization mutex, or write to absolute paths under $HOME / /etc /
    /var. If you genuinely need to exercise that surface (e.g. a manual
    integration test), gate the test with `#[ignore = "reason"]` and run
    via `cargo test --lib -- --ignored`.

Forbidden patterns inside non-#[ignore]'d #[test] fn bodies:
    - keyring::                           — touches OS credential store
    - Command::new("open"|"xdg-open"|     — OS-specific subprocess fork
                   "cmd"|"reg"|
                   "hostname"|"ioreg"|
                   "sw_vers")
    - std::env::set_var (no Mutex token   — process-global env mutation;
      anywhere in same fn body)             must be serialized via Mutex
    - std::fs::write("/Users|/etc|        — absolute-path write outside
                     /var|/private", ...)   project tree

To extend: add a regex to FORBIDDEN_PATTERNS below. Patterns match against
the function body text (not the function signature).

Usage:
    python3 src-tauri/scripts/lint-test-side-effects.py [path...]

    Default path: src-tauri/src/

Exit codes:
    0 — clean
    1 — at least one violation
    2 — script error (e.g. file unreadable)
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

# Forbidden source-text patterns. Each entry is (regex, human-readable label).
# Patterns are matched against the body text of every non-#[ignore]'d
# #[test] fn. The label appears in the violation message.
FORBIDDEN_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"keyring::"), "keyring:: (touches OS credential store)"),
    (
        re.compile(
            r'Command::new\(\s*"(open|xdg-open|cmd|reg|hostname|ioreg|sw_vers)"\s*\)'
        ),
        "Command::new for OS-specific subprocess",
    ),
    (
        re.compile(r'std::fs::write\(\s*"(/Users|/etc|/var|/private)'),
        "std::fs::write to absolute path outside project tree",
    ),
]

# Special: env::set_var is allowed only when the same fn body also uses a
# Mutex guard (the bb-7oq8 pattern: serialize env mutations via a
# module-level static Mutex<()> so concurrent #[test] fns don't race on
# global state). Accept either the explicit `Mutex` token OR any `.lock(`
# call (covers the common pattern `let _guard = SOME_LOCK.lock()...`).
ENV_SET_VAR = re.compile(r"std::env::(set_var|remove_var)\b")
MUTEX_GUARD = re.compile(r"\bMutex\b|\.lock\s*\(")


def find_test_fns(text: str) -> list[tuple[int, int, int, str, str]]:
    """
    Walk the source text and yield each #[test] fn we find.

    Returns a list of (start_line, body_start_line, body_end_line,
    fn_name, body_text) tuples for tests that are NOT #[ignore]'d.
    Line numbers are 1-indexed.
    """
    lines = text.splitlines()
    n = len(lines)
    out: list[tuple[int, int, int, str, str]] = []

    i = 0
    while i < n:
        line = lines[i]
        if "#[test]" not in line:
            i += 1
            continue

        test_attr_line = i + 1  # 1-indexed
        j = i + 1
        is_ignored = False
        # Walk forward through additional attributes / blank lines until we
        # reach the `fn ` line.
        while j < n:
            stripped = lines[j].strip()
            if not stripped or stripped.startswith("//"):
                j += 1
                continue
            if "#[ignore" in stripped:
                is_ignored = True
                j += 1
                continue
            if stripped.startswith("#["):
                # Some other attribute — skip
                j += 1
                continue
            break

        if j >= n or "fn " not in lines[j]:
            # Couldn't find a fn after #[test] — skip; will surface as a
            # compile error if real, not our concern.
            i = j + 1
            continue

        if is_ignored:
            i = j + 1
            continue

        fn_match = re.search(r"\bfn\s+(\w+)", lines[j])
        fn_name = fn_match.group(1) if fn_match else "<unknown>"
        body_start_line = j + 1  # 1-indexed

        # Find the matching close brace by counting from the first '{' on
        # the fn line forward. Tracks string literals (avoid counting
        # braces inside "...") and line comments (// ...).
        depth = 0
        body_text_parts: list[str] = []
        started = False
        k = j
        while k < n:
            cur = lines[k]
            # Strip line comment for brace counting (rough — doesn't handle
            # block comments or // inside strings, but good enough for
            # well-formed Rust test bodies)
            cur_for_braces = re.sub(r"//.*$", "", cur)
            # Strip string literals for brace counting
            cur_for_braces = re.sub(r'"(?:[^"\\]|\\.)*"', '""', cur_for_braces)
            for ch in cur_for_braces:
                if ch == "{":
                    depth += 1
                    started = True
                elif ch == "}":
                    depth -= 1
            body_text_parts.append(cur)
            if started and depth == 0:
                break
            k += 1

        body_end_line = k + 1  # 1-indexed
        body_text = "\n".join(body_text_parts)
        out.append((test_attr_line, body_start_line, body_end_line, fn_name, body_text))
        i = k + 1

    return out


def lint_file(path: Path) -> list[str]:
    """Returns a list of human-readable violation messages (empty if clean)."""
    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as err:
        return [f"{path}: cannot read ({err})"]

    violations: list[str] = []
    for test_line, body_start, _body_end, fn_name, body in find_test_fns(text):
        for pattern, label in FORBIDDEN_PATTERNS:
            for m in pattern.finditer(body):
                # Approximate offending line by counting newlines from the
                # body start to the match offset.
                line_within_body = body[: m.start()].count("\n")
                line_no = body_start + line_within_body
                violations.append(
                    f"{path}:{line_no}: [#[test] fn {fn_name} (declared :{test_line})] "
                    f"forbidden — {label} :: {m.group(0)}"
                )
        if ENV_SET_VAR.search(body) and not MUTEX_GUARD.search(body):
            m = ENV_SET_VAR.search(body)
            assert m is not None
            line_within_body = body[: m.start()].count("\n")
            line_no = body_start + line_within_body
            violations.append(
                f"{path}:{line_no}: [#[test] fn {fn_name} (declared :{test_line})] "
                f"forbidden — std::env::set_var/remove_var without Mutex serialization :: {m.group(0)}"
            )

    return violations


def main(argv: list[str]) -> int:
    targets = [Path(a) for a in argv[1:]] if len(argv) > 1 else [
        Path(__file__).resolve().parent.parent / "src"
    ]

    rs_files: list[Path] = []
    for t in targets:
        if t.is_file() and t.suffix == ".rs":
            rs_files.append(t)
        elif t.is_dir():
            rs_files.extend(sorted(t.rglob("*.rs")))
        else:
            print(f"warning: target not found or not a .rs file: {t}", file=sys.stderr)

    all_violations: list[str] = []
    for f in rs_files:
        all_violations.extend(lint_file(f))

    if all_violations:
        print("Rust unit-test side-effect lint FAILED — the following tests touch", file=sys.stderr)
        print("real OS surfaces (keyring / OS subprocess / global env / abs-path fs)", file=sys.stderr)
        print("without being gated behind #[ignore]:", file=sys.stderr)
        print("", file=sys.stderr)
        for v in all_violations:
            print(f"  {v}", file=sys.stderr)
        print("", file=sys.stderr)
        print(
            "Fix: either gate the test with `#[ignore = \"reason\"]` (opt-in via",
            file=sys.stderr,
        )
        print(
            "`cargo test --lib -- --ignored`) OR refactor to call private validation",
            file=sys.stderr,
        )
        print(
            "fns directly / mock at the boundary. See bb-y0me + bb-7oq8 for context.",
            file=sys.stderr,
        )
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
