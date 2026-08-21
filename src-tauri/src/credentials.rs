use keyring::Entry;

/// Maximum length for service and account names (bytes).
const MAX_NAME_LEN: usize = 512;

/// Validate that service and account names are non-empty and within length limits.
fn validate_names(service: &str, account: &str) -> Result<(), String> {
    if service.is_empty() {
        return Err("service name must not be empty".to_string());
    }
    if account.is_empty() {
        return Err("account name must not be empty".to_string());
    }
    if service.len() > MAX_NAME_LEN {
        return Err(format!(
            "service name exceeds {} byte limit (got {})",
            MAX_NAME_LEN,
            service.len()
        ));
    }
    if account.len() > MAX_NAME_LEN {
        return Err(format!(
            "account name exceeds {} byte limit (got {})",
            MAX_NAME_LEN,
            account.len()
        ));
    }
    Ok(())
}

/// Retrieve a credential from the OS keychain.
/// Returns the password string or an error message.
#[tauri::command]
pub fn get_credential(service: String, account: String) -> Result<String, String> {
    validate_names(&service, &account)?;
    let entry = Entry::new(&service, &account).map_err(|e| format!("keyring error: {}", e))?;
    entry.get_password().map_err(|e| format!("keyring error: {}", e))
}

/// Store a credential in the OS keychain.
#[tauri::command]
pub fn set_credential(service: String, account: String, password: String) -> Result<(), String> {
    validate_names(&service, &account)?;
    let entry = Entry::new(&service, &account).map_err(|e| format!("keyring error: {}", e))?;
    entry.set_password(&password).map_err(|e| format!("keyring error: {}", e))
}

/// Delete a credential from the OS keychain.
#[tauri::command]
pub fn delete_credential(service: String, account: String) -> Result<(), String> {
    validate_names(&service, &account)?;
    let entry = Entry::new(&service, &account).map_err(|e| format!("keyring error: {}", e))?;
    entry.delete_credential().map_err(|e| format!("keyring error: {}", e))
}

#[cfg(test)]
mod tests {
    use super::*;

    // bb-7oq8 hardening: tests that touch the real OS keychain are gated
    // behind `#[ignore]`. cargo-mutants invokes them N times per mutant
    // and macOS pops a keychain-access prompt for each, which is ~unusable
    // for the developer running the harness. Opt-in via:
    //   cargo test --lib -- --ignored
    // The boundary-validation tests below DO NOT touch the keychain (they
    // error out inside validate_names before Entry::new is called) and
    // remain in the default test set so cargo-mutants exercises them.

    /// Full round-trip: store, retrieve, delete, verify gone.
    /// Uses a unique test service name to avoid colliding with real credentials.
    #[test]
    #[ignore = "touches real OS keychain (login prompt) — opt-in via `cargo test -- --ignored`"]
    fn keychain_round_trip() {
        let service = "beadbox-test".to_string();
        let account = "test-user@127.0.0.1:3309".to_string();
        let password = "test-password-12345".to_string();

        // Clean up any leftover from a prior failed run
        let _ = delete_credential(service.clone(), account.clone());

        // Store
        set_credential(service.clone(), account.clone(), password.clone())
            .expect("set_credential should succeed");

        // Retrieve
        let retrieved = get_credential(service.clone(), account.clone())
            .expect("get_credential should succeed");
        assert_eq!(retrieved, password, "retrieved password should match stored");

        // Delete
        delete_credential(service.clone(), account.clone())
            .expect("delete_credential should succeed");

        // Verify gone
        let result = get_credential(service, account);
        assert!(result.is_err(), "get_credential should fail after delete");
    }

    #[test]
    #[ignore = "touches real OS keychain (login prompt) — opt-in via `cargo test -- --ignored`"]
    fn get_nonexistent_credential_returns_error() {
        let result = get_credential(
            "beadbox-test-nonexistent".to_string(),
            "no-such-account".to_string(),
        );
        assert!(result.is_err(), "should error for nonexistent credential");
    }

    #[test]
    fn rejects_empty_service() {
        let result = get_credential("".to_string(), "account".to_string());
        assert_eq!(result.unwrap_err(), "service name must not be empty");
    }

    #[test]
    fn rejects_empty_account() {
        let result = get_credential("service".to_string(), "".to_string());
        assert_eq!(result.unwrap_err(), "account name must not be empty");
    }

    #[test]
    fn rejects_overlong_service() {
        let long = "x".repeat(MAX_NAME_LEN + 1);
        let result = set_credential(long, "account".to_string(), "pw".to_string());
        assert!(result.unwrap_err().contains("service name exceeds"));
    }

    #[test]
    fn rejects_overlong_account() {
        let long = "x".repeat(MAX_NAME_LEN + 1);
        let result = delete_credential("service".to_string(), long);
        assert!(result.unwrap_err().contains("account name exceeds"));
    }

    /// bb-7oq8: boundary test for the validate_names length check. The
    /// existing rejects_overlong_* tests use MAX_NAME_LEN+1 which passes
    /// both `>` and `>=` mutations indistinguishably. A name with length
    /// exactly equal to MAX_NAME_LEN should pass validation under `>`
    /// (the real code) and fail it under `>=` (the mutant), so this test
    /// catches both line-14 and line-21 boundary mutants.
    ///
    /// Calls validate_names DIRECTLY (private but in-module) to avoid the
    /// Entry::new keychain call that set_credential would trigger after
    /// successful validation. cargo-mutants runs the test ~50 times across
    /// the mutant matrix; touching the OS keychain that often spams the
    /// developer with login prompts (bb-7oq8 hardening lesson, real
    /// regression observed during the first cargo-mutants pass).
    #[test]
    fn accepts_names_at_exactly_max_length() {
        let exact = "x".repeat(MAX_NAME_LEN);
        assert!(
            validate_names(&exact, "account").is_ok(),
            "service name of length exactly MAX_NAME_LEN should pass validate_names"
        );
        assert!(
            validate_names("service", &exact).is_ok(),
            "account name of length exactly MAX_NAME_LEN should pass validate_names"
        );
        // The boundary test above kills the `>` -> `>=` mutant. The
        // adjacent `rejects_overlong_*` tests still cover the `>` -> `<`
        // and `>` -> `==` mutations via MAX_NAME_LEN+1 inputs.
    }
}
