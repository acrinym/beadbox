// External-URL opener used by the WebView navigation handler in lib.rs.
//
// History: this module was the home of the legacy Node.js sidecar plumbing
// (find_free_port / spawn_node / wait_for_server / resolve_node_path / etc.).
// P4.3 (bb-un5c.3) stripped all of that after the kkrpc bridge took over.
// What remains is the one helper the GUI navigation handler still needs to
// route http(s) clicks to the user's default browser.

use std::process::Command;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

pub fn open_url_in_browser(url: &str) {
    #[cfg(target_os = "macos")]
    { Command::new("open").arg(url).spawn().ok(); }
    #[cfg(target_os = "linux")]
    { Command::new("xdg-open").arg(url).spawn().ok(); }
    #[cfg(windows)]
    {
        // CREATE_NO_WINDOW (0x08000000): prevent cmd.exe console from flashing
        Command::new("cmd")
            .args(["/C", "start", "", url])
            .creation_flags(0x08000000)
            .spawn()
            .ok();
    }
}
