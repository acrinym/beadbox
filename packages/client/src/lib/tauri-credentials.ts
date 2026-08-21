/**
 * Thin wrapper around Tauri keychain commands (set_credential, delete_credential).
 * In web mode (non-Tauri), all operations silently no-op.
 * Errors are logged but never thrown, so keychain failures never block workspace operations.
 */

const SERVICE = "beadbox"

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window
}

export async function storeCredential(credentialKey: string, password: string): Promise<void> {
  if (!isTauri() || !credentialKey || !password) return
  try {
    const { invoke } = await import("@tauri-apps/api/core")
    await invoke("set_credential", { service: SERVICE, account: credentialKey, password })
  } catch (err) {
    console.warn("[tauri-credentials] failed to store credential:", err)
  }
}

export async function deleteCredential(credentialKey: string): Promise<void> {
  if (!isTauri() || !credentialKey) return
  try {
    const { invoke } = await import("@tauri-apps/api/core")
    await invoke("delete_credential", { service: SERVICE, account: credentialKey })
  } catch (err) {
    console.warn("[tauri-credentials] failed to delete credential:", err)
  }
}
