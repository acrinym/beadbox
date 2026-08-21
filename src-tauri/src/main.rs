// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // P4.3 (bb-un5c.3) strip: --headless mode and run_headless() are gone.
    // The legacy mode existed to host the Next.js Node sidecar without a
    // GUI. Post-cutover, the SPA is the only entry point — no Node sidecar
    // to host, nothing to run headless.
    beadbox_lib::run()
}
