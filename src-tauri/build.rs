fn main() {
    // Make POSTHOG_KEY available to env!() macro at compile time.
    // Local dev builds get an empty string (PostHog rejects silently).
    // CI builds pass the real key via environment variable.
    println!("cargo:rerun-if-env-changed=POSTHOG_KEY");
    if std::env::var("POSTHOG_KEY").is_err() {
        println!("cargo:rustc-env=POSTHOG_KEY=");
    }

    tauri_build::build()
}
