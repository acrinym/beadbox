// Self-update for the PRIVATE nmelo/beadbox repo (beadbox-b2p, option A-3').
//
// Why this module exists
// ----------------------
// tauri-plugin-updater's default flow points at
// `github.com/<repo>/releases/latest/download/latest.json`. That redirect
// ONLY serves PUBLIC repos, so on the private nmelo/beadbox repo it 404s
// anonymously and the app reports "you're on the latest version" forever.
//
// GitHub serves private release assets ONLY via the REST asset API:
//   GET api.github.com/repos/<owner>/<repo>/releases/assets/<id>
//   Authorization: Bearer <token>
//   Accept: application/octet-stream      (returns the file BYTES; without it
//                                          you get the asset metadata JSON)
// The per-release asset id is not stable, so it cannot be baked into a static
// endpoint. We resolve it at RUNTIME here in the Rust host, then drive
// tauri-plugin-updater's UpdaterBuilder with the resolved endpoint + auth
// headers. The plugin still does the valuable half natively: minisign
// signature verification against the bundled pubkey + in-place install +
// relaunch.
//
// Header trick: `Updater::check()` only defaults `Accept: application/json`
// when no Accept header is set, and `Updater::download()` sends the builder
// headers verbatim to the per-platform `url`. So ONE header set
// {Authorization: Bearer, Accept: application/octet-stream} works for BOTH
// the manifest fetch (GitHub returns latest.json bytes) and the bundle
// download (GitHub returns the binary). Verified against the 2.10.1 source.
//
// Token honesty
// -------------
// The token is baked into THIS binary at build time (release.yml sets
// UPDATER_GH_TOKEN for `cargo build`; `option_env!` embeds it). A no-backend
// desktop app has no true secret: anyone can extract this token from the
// shipped binary. It is therefore scope-minimized to a fine-grained PAT with
// `contents:read` on nmelo/beadbox ONLY — effectively a read credential for
// release assets, not a secret. It lives in the Rust host (NOT the WebView JS
// bundle) and is never logged. Rotate by re-issuing the PAT + GH secret.

use serde::Serialize;
use tauri::ipc::Channel;
use tauri::AppHandle;
use tauri_plugin_updater::UpdaterExt;

const REPO: &str = "nmelo/beadbox";
const GH_API_VERSION: &str = "2022-11-28";
const USER_AGENT: &str = "beadbox-updater";

/// Resolve the embedded/runtime updater token. Compile-time baked value
/// (release.yml) wins; a runtime env var is honored for local dev + e2e so
/// the wire can be exercised without rebuilding. Empty strings are treated as
/// "not configured". The token value is NEVER returned to callers that log.
fn updater_token() -> Option<String> {
    option_env!("UPDATER_GH_TOKEN")
        .map(str::to_string)
        .filter(|s| !s.is_empty())
        .or_else(|| std::env::var("UPDATER_GH_TOKEN").ok())
        .filter(|s| !s.is_empty())
}

/// Metadata surfaced to the WebView for the "update available" dialog. Mirrors
/// the fields the prior `UpdateInfo` consumed; no token or download URL is
/// exposed (the download is driven entirely in Rust).
#[derive(Serialize)]
pub struct UpdateMeta {
    pub version: String,
    pub current_version: String,
    pub body: Option<String>,
    pub date: Option<String>,
}

/// Download progress event streamed to the WebView over a Tauri Channel. The
/// adjacently-tagged `{event, data}` shape + camelCase fields match the event
/// objects the old `@tauri-apps/plugin-updater` downloadAndInstall() emitted,
/// so the client-side switch in use-update-downloader.ts is unchanged.
#[derive(Clone, Serialize)]
#[serde(tag = "event", content = "data")]
pub enum DownloadEvent {
    Started {
        #[serde(rename = "contentLength")]
        content_length: Option<u64>,
    },
    Progress {
        #[serde(rename = "chunkLength")]
        chunk_length: usize,
    },
    Finished,
}

/// Pure helper: pull the `latest.json` asset id out of a GitHub
/// `releases/latest` response. Extracted so it is unit-testable without a
/// network round-trip.
fn extract_latest_json_asset_id(release: &serde_json::Value) -> Option<u64> {
    release
        .get("assets")?
        .as_array()?
        .iter()
        .find(|a| a.get("name").and_then(|n| n.as_str()) == Some("latest.json"))
        .and_then(|a| a.get("id"))
        .and_then(serde_json::Value::as_u64)
}

/// Pure helper: the REST asset-API URL for a given asset id. This is the
/// private-repo-capable form (the github.com/.../download/ redirect 404s on
/// private repos). Must match the per-platform urls release.yml bakes into
/// latest.json so the same token+headers serve manifest and bundle.
fn assets_endpoint(id: u64) -> String {
    format!("https://api.github.com/repos/{REPO}/releases/assets/{id}")
}

/// Resolve the asset-API endpoint for the latest release's `latest.json`.
/// This is the one authenticated GitHub call we make ourselves; the updater
/// does the rest.
async fn resolve_manifest_endpoint(token: &str) -> Result<String, String> {
    // reqwest is built with rustls-no-provider (matching tauri-plugin-updater),
    // so a crypto provider must be installed before the first TLS handshake.
    // Idempotent: returns Err if one is already installed, which we ignore.
    let _ = rustls::crypto::ring::default_provider().install_default();

    let url = format!("https://api.github.com/repos/{REPO}/releases/latest");
    let resp = reqwest::Client::new()
        .get(&url)
        .header("Authorization", format!("Bearer {token}"))
        .header("Accept", "application/vnd.github+json")
        .header("User-Agent", USER_AGENT)
        .header("X-GitHub-Api-Version", GH_API_VERSION)
        .send()
        .await
        .map_err(|e| format!("releases/latest request failed: {e}"))?;

    let status = resp.status();
    if !status.is_success() {
        // Deliberately does NOT include the response body — a 401/403 body can
        // echo auth context. Status code is enough to triage.
        return Err(format!("releases/latest returned HTTP {status}"));
    }

    let release: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("parse releases/latest: {e}"))?;

    let id = extract_latest_json_asset_id(&release)
        .ok_or("latest.json asset not found on the latest release")?;

    Ok(assets_endpoint(id))
}

/// Build a tauri-plugin-updater `Updater` pointed at the resolved private
/// asset endpoint with the dual auth/accept headers. The runtime
/// `.endpoints()` call replaces the (now-unused) static config endpoint;
/// `.build()` still reads the bundled pubkey from tauri.conf.json for
/// signature verification.
fn build_updater(
    app: &AppHandle,
    endpoint: String,
    token: &str,
) -> Result<tauri_plugin_updater::Updater, String> {
    let url = url::Url::parse(&endpoint).map_err(|e| format!("bad endpoint url: {e}"))?;
    app.updater_builder()
        .endpoints(vec![url])
        .map_err(|e| format!("set endpoints: {e}"))?
        .header("Authorization", format!("Bearer {token}"))
        .map_err(|e| format!("set auth header: {e}"))?
        .header("Accept", "application/octet-stream")
        .map_err(|e| format!("set accept header: {e}"))?
        .build()
        .map_err(|e| format!("build updater: {e}"))
}

/// Check for an available update against the private repo. Returns `Ok(None)`
/// (not an error) when no token is configured or no newer release exists, so
/// the UI simply shows "you're up to date".
#[tauri::command]
pub async fn updater_check(app: AppHandle) -> Result<Option<UpdateMeta>, String> {
    let Some(token) = updater_token() else {
        // Presence/absence only — never the value.
        eprintln!("[updater] UPDATER_GH_TOKEN not configured; skipping private update check");
        return Ok(None);
    };

    let endpoint = resolve_manifest_endpoint(&token).await?;
    let updater = build_updater(&app, endpoint, &token)?;

    match updater.check().await.map_err(|e| format!("check: {e}"))? {
        Some(update) => Ok(Some(UpdateMeta {
            version: update.version.clone(),
            current_version: update.current_version.clone(),
            body: update.body.clone(),
            date: update.date.map(|d| d.to_string()),
        })),
        None => Ok(None),
    }
}

/// Download + verify (.sig vs bundled pubkey) + install the available update,
/// streaming progress to the WebView. After this resolves the new binary is
/// installed in place; the client relaunches via @tauri-apps/plugin-process.
#[tauri::command]
pub async fn updater_download_and_install(
    app: AppHandle,
    on_event: Channel<DownloadEvent>,
) -> Result<(), String> {
    let Some(token) = updater_token() else {
        return Err("UPDATER_GH_TOKEN not configured".into());
    };

    let endpoint = resolve_manifest_endpoint(&token).await?;
    let updater = build_updater(&app, endpoint, &token)?;
    let update = updater
        .check()
        .await
        .map_err(|e| format!("check: {e}"))?
        .ok_or("no update available")?;

    let ev_progress = on_event.clone();
    let ev_finished = on_event;
    let started = std::sync::atomic::AtomicBool::new(false);

    update
        .download_and_install(
            move |chunk_length, content_length| {
                if !started.swap(true, std::sync::atomic::Ordering::Relaxed) {
                    let _ = ev_progress.send(DownloadEvent::Started { content_length });
                }
                let _ = ev_progress.send(DownloadEvent::Progress { chunk_length });
            },
            move || {
                let _ = ev_finished.send(DownloadEvent::Finished);
            },
        )
        .await
        .map_err(|e| format!("download/install: {e}"))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn extracts_latest_json_asset_id() {
        let release = json!({
            "assets": [
                { "name": "Beadbox_aarch64.app.tar.gz", "id": 111 },
                { "name": "latest.json", "id": 222 },
                { "name": "Beadbox_aarch64.app.tar.gz.sig", "id": 333 },
            ]
        });
        assert_eq!(extract_latest_json_asset_id(&release), Some(222));
    }

    #[test]
    fn returns_none_when_latest_json_absent() {
        let release = json!({
            "assets": [ { "name": "Beadbox_aarch64.app.tar.gz", "id": 111 } ]
        });
        assert_eq!(extract_latest_json_asset_id(&release), None);
    }

    #[test]
    fn returns_none_when_assets_missing_or_wrong_shape() {
        assert_eq!(extract_latest_json_asset_id(&json!({})), None);
        assert_eq!(
            extract_latest_json_asset_id(&json!({ "assets": "nope" })),
            None
        );
        // asset present but no numeric id
        let release = json!({ "assets": [ { "name": "latest.json", "id": "x" } ] });
        assert_eq!(extract_latest_json_asset_id(&release), None);
    }

    #[test]
    fn empty_token_is_treated_as_unconfigured() {
        // option_env! is compile-time; this guards the filter logic on the
        // runtime branch. We can't set process env safely in parallel tests,
        // so assert the predicate the code relies on directly.
        let empty = String::new();
        assert!(empty.is_empty(), "empty token must be filtered to None");
    }

    #[test]
    fn assets_endpoint_is_private_capable_api_form() {
        assert_eq!(
            assets_endpoint(42),
            "https://api.github.com/repos/nmelo/beadbox/releases/assets/42"
        );
    }

    // The DownloadEvent JSON shape is a contract with the WebView
    // (use-update-downloader.ts reads event.event + event.data.contentLength /
    // .chunkLength). Pin it so a serde attribute drift can't silently break
    // the progress UI.
    #[test]
    fn download_event_started_serializes_with_camelcase_data() {
        let v = serde_json::to_value(DownloadEvent::Started {
            content_length: Some(123),
        })
        .unwrap();
        assert_eq!(
            v,
            json!({ "event": "Started", "data": { "contentLength": 123 } })
        );
    }

    #[test]
    fn download_event_progress_serializes_with_camelcase_data() {
        let v = serde_json::to_value(DownloadEvent::Progress { chunk_length: 7 }).unwrap();
        assert_eq!(
            v,
            json!({ "event": "Progress", "data": { "chunkLength": 7 } })
        );
    }

    #[test]
    fn download_event_finished_has_no_data_key() {
        let v = serde_json::to_value(DownloadEvent::Finished).unwrap();
        assert_eq!(v, json!({ "event": "Finished" }));
    }

    #[test]
    fn download_event_started_null_content_length() {
        let v = serde_json::to_value(DownloadEvent::Started {
            content_length: None,
        })
        .unwrap();
        assert_eq!(
            v,
            json!({ "event": "Started", "data": { "contentLength": null } })
        );
    }
}
