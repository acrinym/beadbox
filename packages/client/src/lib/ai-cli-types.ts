// Type-only extract: the runtime ai-cli helper imports node:child_process
// and runs server-side; HelpFab on the client only needs the AiCliName
// union for state management.
export type AiCliName = "claude" | "codex" | "gemini"
