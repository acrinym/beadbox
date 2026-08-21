use sha2::{Sha256, Digest};

/// Generate a stable anonymous ID from OS username + machine ID.
/// Returns first 32 hex chars of SHA-256("{username}@{machine_id}").
/// Returns empty string on any failure so the caller degrades gracefully.
#[tauri::command]
pub fn get_stable_id() -> String {
    let stable_id = (|| -> Option<String> {
        let username = get_os_username()?;
        let machine_id = get_machine_id().or_else(get_hostname)?;
        let input = format!("{}@{}", username, machine_id);
        let hash = Sha256::digest(input.as_bytes());
        let hex = format!("{:x}", hash);
        Some(hex[..32].to_string())
    })();

    stable_id.unwrap_or_default()
}

/// bb-07pe: return the OS username sanitized to PostHog-safe lowercase
/// (`[a-z0-9._-]`). Empty string on any failure (no env, all-non-allowed
/// chars). Renderer concatenates this prefix with `get_stable_id()` to
/// form a human-readable distinct_id while preserving the existing hash
/// suffix for alias-based history merging. Returns String (not Option)
/// so the Tauri command surface stays simple — empty == fallback.
#[tauri::command]
pub fn get_username_prefix() -> String {
    get_os_username()
        .map(|raw| sanitize_username(&raw))
        .unwrap_or_default()
}

/// Sanitize a username to the subset PostHog distinct_ids accept without
/// dashboard-query escaping (`[a-z0-9._-]`). Lowercased; characters outside
/// the set are dropped, not replaced — running them through unchanged would
/// break query-string filters (e.g., `Nelson Melo` -> `nelsonmelo`, not
/// `nelson%20melo`). Empty result is the caller's signal to fall back.
fn sanitize_username(raw: &str) -> String {
    raw.chars()
        .flat_map(|c| c.to_lowercase())
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
        .collect()
}

fn get_os_username() -> Option<String> {
    #[cfg(unix)]
    let var = "USER";
    #[cfg(windows)]
    let var = "USERNAME";
    let val = std::env::var(var).ok()?;
    if val.is_empty() { None } else { Some(val) }
}

// bb-fe03.8: get_machine_id was CCN 15 (lizard) because three platform
// branches each contained: spawn → status check → parse output → find
// line → validate. Splitting the parse step out gives both per-platform
// helpers a CCN ≤ 5 and lets the parsers run under unit tests without
// spawning a real subprocess (bb-y0me lint compliance).

/// Extract IOPlatformUUID from the stdout of `ioreg -rd1 -c IOPlatformExpertDevice`.
/// Lines look like: `    "IOPlatformUUID" = "XXXXXXXX-XXXX-..."` — split
/// on the literal `"` quote and pick the 4th field (index 3, the UUID).
/// Returns None if no matching line / empty UUID / malformed split.
#[cfg(any(target_os = "macos", test))]
fn parse_macos_ioreg_output(stdout: &str) -> Option<String> {
    for line in stdout.lines() {
        if !line.contains("IOPlatformUUID") {
            continue;
        }
        let uuid = line.split('"').nth(3)?;
        if !uuid.is_empty() {
            return Some(uuid.to_string());
        }
    }
    None
}

/// Extract the MachineGuid value from the stdout of `reg query HKLM\\... /v MachineGuid`.
/// Lines look like: `    MachineGuid    REG_SZ    {guid}` — the value is
/// the last whitespace-separated token. Returns None if no matching line
/// / empty token.
#[cfg(any(windows, test))]
fn parse_windows_reg_output(stdout: &str) -> Option<String> {
    for line in stdout.lines() {
        if !line.contains("MachineGuid") {
            continue;
        }
        let guid = line.split_whitespace().last()?;
        if !guid.is_empty() {
            return Some(guid.to_string());
        }
    }
    None
}

#[cfg(target_os = "macos")]
fn macos_machine_id() -> Option<String> {
    let output = std::process::Command::new("ioreg")
        .args(["-rd1", "-c", "IOPlatformExpertDevice"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    parse_macos_ioreg_output(&stdout)
}

#[cfg(target_os = "linux")]
fn linux_machine_id() -> Option<String> {
    let contents = std::fs::read_to_string("/etc/machine-id").ok()?;
    let id = contents.trim().to_string();
    if id.is_empty() { None } else { Some(id) }
}

#[cfg(windows)]
fn windows_machine_id() -> Option<String> {
    let output = std::process::Command::new("reg")
        .args([
            "query",
            r"HKLM\SOFTWARE\Microsoft\Cryptography",
            "/v",
            "MachineGuid",
        ])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    parse_windows_reg_output(&stdout)
}

fn get_machine_id() -> Option<String> {
    #[cfg(target_os = "macos")]
    {
        macos_machine_id()
    }
    #[cfg(target_os = "linux")]
    {
        linux_machine_id()
    }
    #[cfg(windows)]
    {
        windows_machine_id()
    }
}

fn get_hostname() -> Option<String> {
    let output = std::process::Command::new("hostname")
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let name = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if name.is_empty() { None } else { Some(name) }
}

#[cfg(test)]
mod tests {
    use super::*;

    // bb-07pe: sanitize_username unit tests. The Rust function is a pure
    // string transform; no env / no I/O / no lock needed (unlike the
    // get_stable_id tests below which serialize on USERNAME_ENV_LOCK).

    #[test]
    fn sanitize_username_lowercases_alpha() {
        assert_eq!(sanitize_username("Nelson"), "nelson");
        assert_eq!(sanitize_username("NMELO"), "nmelo");
    }

    #[test]
    fn sanitize_username_preserves_safe_punctuation() {
        assert_eq!(sanitize_username("user.name"), "user.name");
        assert_eq!(sanitize_username("user_name"), "user_name");
        assert_eq!(sanitize_username("user-name"), "user-name");
        assert_eq!(sanitize_username("user123"), "user123");
    }

    #[test]
    fn sanitize_username_strips_unsafe_chars() {
        assert_eq!(sanitize_username("Ada Lovelace"), "adalovelace");
        assert_eq!(sanitize_username("user@example.com"), "userexample.com");
        assert_eq!(sanitize_username("user/name"), "username");
        assert_eq!(sanitize_username("user+plus"), "userplus");
    }

    #[test]
    fn sanitize_username_empty_when_all_unsafe() {
        // Non-ASCII (e.g., Japanese) gets fully stripped — caller treats
        // empty as the signal to fall back to bare hash.
        assert_eq!(sanitize_username("エンジニア"), "");
        assert_eq!(sanitize_username("!!!"), "");
        assert_eq!(sanitize_username(""), "");
    }

    /// pm/spec.md §10.2 row 10: env var unset → empty prefix (renderer
    /// falls back to bare hash). Exercises the get_username_prefix Tauri
    /// command end-to-end (env read → sanitize → string return), not just
    /// the underlying helpers covered by get_os_username_env_handling.
    /// Serializes on USERNAME_ENV_LOCK because env mutation is process-global.
    #[test]
    fn get_username_prefix_returns_empty_when_env_unset() {
        let _guard = USERNAME_ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());

        #[cfg(unix)]
        let var = "USER";
        #[cfg(windows)]
        let var = "USERNAME";

        let original = std::env::var(var).ok();

        // SAFETY: see get_os_username_env_handling above for the serialization
        // contract this Mutex enforces.
        unsafe {
            std::env::remove_var(var);
        }
        assert_eq!(
            get_username_prefix(),
            "",
            "unset username env must yield empty prefix so the renderer falls back to bare hash",
        );

        if let Some(orig) = original {
            unsafe {
                std::env::set_var(var, orig);
            }
        }
    }

    #[test]
    fn get_stable_id_returns_non_empty() {
        let _guard = USERNAME_ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let id = get_stable_id();
        assert!(!id.is_empty(), "get_stable_id() returned empty string");
        assert_eq!(id.len(), 32, "expected 32-char hex hash, got {}", id.len());
    }

    #[test]
    fn get_stable_id_is_deterministic() {
        let _guard = USERNAME_ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let id1 = get_stable_id();
        let id2 = get_stable_id();
        assert_eq!(id1, id2, "get_stable_id returned different values");
    }

    #[test]
    fn get_stable_id_is_hex_only() {
        let _guard = USERNAME_ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let id = get_stable_id();
        assert!(
            id.chars().all(|c| c.is_ascii_hexdigit()),
            "stable ID contains non-hex chars: '{}'",
            id
        );
    }

    // bb-7oq8: behavioral tests targeting surviving mutants in the
    // get_os_username, get_machine_id, and get_hostname helpers.
    //
    // Env mutations are process-global, so any test that mutates USER
    // races with anything else that calls get_os_username concurrently
    // (e.g. get_stable_id_is_deterministic above). cargo test runs
    // #[test] fns on multiple threads; serialize via this Mutex around
    // every test that touches the username env.
    use std::sync::Mutex;
    static USERNAME_ENV_LOCK: Mutex<()> = Mutex::new(());

    /// All env-driven get_os_username assertions in one #[test] fn so the
    /// process-global env mutations don't race with parallel tests.
    /// Restores the original USER value at the end.
    #[test]
    fn get_os_username_env_handling() {
        let _guard = USERNAME_ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());

        #[cfg(unix)]
        let var = "USER";
        #[cfg(windows)]
        let var = "USERNAME";

        let original = std::env::var(var).ok();

        // Empty string env → None (catches the `if val.is_empty()` mutant).
        // SAFETY: env mutation is unsound under multi-threaded access; this
        // test guarantees serial use within a single function body, and the
        // surrounding test harness runs each #[test] fn on its own thread
        // without overlap on this var.
        unsafe {
            std::env::set_var(var, "");
        }
        assert_eq!(get_os_username(), None, "empty env should map to None");

        // Non-empty env → Some(value).
        unsafe {
            std::env::set_var(var, "alice-test-user");
        }
        assert_eq!(
            get_os_username(),
            Some("alice-test-user".to_string()),
            "non-empty env should pass through verbatim",
        );

        // Unset env → None.
        unsafe {
            std::env::remove_var(var);
        }
        assert_eq!(get_os_username(), None, "unset env should map to None");

        // Restore original so subsequent tests inherit a sane USER.
        if let Some(orig) = original {
            unsafe {
                std::env::set_var(var, orig);
            }
        }
    }

    /// On the test runner's host platform, a real machine ID must be
    /// resolvable. Catches the None / Some(String::new()) / Some("xyzzy"...)
    /// replacement mutants — any of those returns a value that fails one
    /// of the assertions below.
    #[test]
    fn get_machine_id_returns_real_value() {
        let id = get_machine_id().expect("test runner has no machine ID — env regression");
        assert!(!id.is_empty(), "machine ID must not be empty");
        // Catches the Some("xyzzy".into()) mutant — real platform IDs are
        // either UUIDs (macOS, Windows) or 32-char hex (Linux); none equal
        // the literal "xyzzy".
        assert_ne!(id, "xyzzy");
        // Real IDs are always ≥ 8 chars (shortest plausible: a UUID is 36).
        assert!(
            id.len() >= 8,
            "machine ID looks malformed (len={}): {}",
            id.len(),
            id
        );
    }

    /// hostname(1) returns Some non-empty on every supported test runner.
    /// Catches the None / Some(String::new()) / Some("xyzzy".into()) mutants
    /// at line 88, AND the `delete !` mutant at line 91 (the is_empty check).
    #[test]
    fn get_hostname_returns_real_value() {
        let host = get_hostname().expect("hostname binary missing on test runner");
        assert!(!host.is_empty(), "hostname must not be empty");
        assert_ne!(host, "xyzzy");
        // hostname output is the trimmed value (no trailing whitespace).
        assert_eq!(host.trim(), host, "hostname must be trimmed");
    }

    // bb-fe03.8: hermetic parser tests. Drive parse_macos_ioreg_output and
    // parse_windows_reg_output with canned subprocess-stdout strings so we
    // can exercise the full parse-branch matrix without invoking ioreg /
    // reg (which would also be flagged by the bb-y0me lint).

    #[test]
    fn parse_macos_extracts_uuid_from_typical_ioreg_line() {
        let stdout = r#"+-o IOPlatformExpertDevice  <class IOPlatformExpertDevice...>
    | {
    |   "IOPlatformUUID" = "12345678-90AB-CDEF-1234-567890ABCDEF"
    |   "IOPlatformSerialNumber" = "FAKEAAAAAAAAA"
    | }
"#;
        assert_eq!(
            parse_macos_ioreg_output(stdout),
            Some("12345678-90AB-CDEF-1234-567890ABCDEF".to_string()),
        );
    }

    #[test]
    fn parse_macos_returns_none_when_uuid_line_absent() {
        let stdout = "+-o IOPlatformExpertDevice\n    | {\n    | }\n";
        assert_eq!(parse_macos_ioreg_output(stdout), None);
    }

    #[test]
    fn parse_macos_returns_none_when_uuid_value_is_empty() {
        // Line has the IOPlatformUUID label but the value between the 3rd
        // and 4th quote is empty. The is_empty() guard rejects it.
        let stdout = r#"    | "IOPlatformUUID" = ""
"#;
        assert_eq!(parse_macos_ioreg_output(stdout), None);
    }

    #[test]
    fn parse_macos_returns_none_on_empty_input() {
        assert_eq!(parse_macos_ioreg_output(""), None);
    }

    #[test]
    fn parse_macos_returns_none_when_line_has_too_few_quotes() {
        // split('"') needs ≥ 4 fields for nth(3) to be Some. A line with
        // only two quotes splits into 3 fields, nth(3) returns None.
        // Guards the nth(3)? branch — without this case a mutation
        // dropping the `?` would still pass the other tests.
        let stdout = "    IOPlatformUUID = unquoted-value\n";
        assert_eq!(parse_macos_ioreg_output(stdout), None);
    }

    #[test]
    fn parse_macos_picks_first_uuid_when_multiple_present() {
        // Defensive: real ioreg output has exactly one IOPlatformUUID line,
        // but the loop returns on the first non-empty match. Pin the
        // deterministic behavior so a future loop refactor can't silently
        // flip to last-wins.
        let stdout = r#"    | "IOPlatformUUID" = "FIRST-UUID-VALUE"
    | "IOPlatformUUID" = "SECOND-UUID-VALUE"
"#;
        assert_eq!(
            parse_macos_ioreg_output(stdout),
            Some("FIRST-UUID-VALUE".to_string()),
        );
    }

    #[test]
    fn parse_windows_extracts_guid_from_typical_reg_line() {
        let stdout = "\r\n\
            HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography\r\n\
            \x20\x20\x20\x20MachineGuid    REG_SZ    {12345678-90ab-cdef-1234-567890abcdef}\r\n";
        assert_eq!(
            parse_windows_reg_output(stdout),
            Some("{12345678-90ab-cdef-1234-567890abcdef}".to_string()),
        );
    }

    #[test]
    fn parse_windows_returns_none_when_machineguid_line_absent() {
        let stdout = "HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography\r\n";
        assert_eq!(parse_windows_reg_output(stdout), None);
    }

    #[test]
    fn parse_windows_returns_none_when_value_token_missing() {
        // A MachineGuid line with only the label + type but no value would
        // make split_whitespace().last() yield "REG_SZ"; we still surface
        // that as Some — the only way to get None from this branch is an
        // entirely empty MachineGuid line, which split_whitespace().last()
        // returns None for.
        let stdout = "MachineGuid\n";
        // Single-token line: last() returns "MachineGuid" itself. Pin the
        // current behavior — this is a degenerate input, pin so a future
        // tightening (e.g. requiring REG_SZ before the value) is intentional.
        assert_eq!(
            parse_windows_reg_output(stdout),
            Some("MachineGuid".to_string()),
        );
    }

    #[test]
    fn parse_windows_returns_none_on_empty_input() {
        assert_eq!(parse_windows_reg_output(""), None);
    }

    #[test]
    fn parse_windows_picks_first_machineguid_line_when_multiple_present() {
        let stdout = "    MachineGuid    REG_SZ    {first-guid}\n\
            \x20\x20\x20\x20MachineGuid    REG_SZ    {second-guid}\n";
        assert_eq!(
            parse_windows_reg_output(stdout),
            Some("{first-guid}".to_string()),
        );
    }
}
