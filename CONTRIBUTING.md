# Contributing to Beadbox

Thanks for your interest in improving Beadbox. Contributions of all kinds are welcome — bug reports, fixes, features, docs, and tests.

## Licensing of contributions

Beadbox is licensed under the [MIT License](LICENSE). By submitting a contribution, you agree that it is your original work (or that you have the right to submit it) and that it is licensed under the same MIT License as the project. There is no CLA to sign.

## Before you start

- **Bug reports:** open an issue with steps to reproduce, expected vs. actual behavior, your OS, and your `bd --version`.
- **Features:** open an issue first to discuss scope before investing in an implementation. Beadbox has a strong point of view — it's a GUI over the `bd` CLI, and the CLI is the source of truth. Features that bypass `bd` or duplicate its state won't be accepted.
- **Small fixes:** typos, obvious bugs — just open a PR.

## Development setup

Prerequisites: [Bun](https://bun.sh), [Rust](https://rustup.rs) (stable), Node.js, the [Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/) for your platform, and the [beads CLI](https://github.com/gastownhall/beads) ≥ 1.0.1.

```sh
bun install          # install dependencies (also sets up git hooks via husky)
bun run tauri:dev    # desktop app in dev mode
bun run dev          # or: web client only
bun run server:dev   # or: server only
```

## Quality bar

Every PR must pass locally before you push (the pre-push hook enforces this):

```sh
bun run lint         # biome
bun run test         # server + client unit tests
```

For changes touching the Rust shell: `cargo test` in `src-tauri/`. On a fresh checkout, run `bash src-tauri/scripts/copy-sidecar.sh` first — the Tauri build embeds the compiled Bun sidecar as an external binary, and cargo fails with ``resource path `binaries/beadbox-sidecar-…` doesn't exist`` until it is built. (`bun run tauri:dev` and `bun run tauri:build` do this for you.) For UI behavior changes, run the relevant Playwright specs: `bun run test:e2e`.

CI also enforces coverage and complexity floors; the authoritative numbers live in `.github/workflows/quality-gates.yml`, and its failure messages tell you which floor you hit.

Guidelines:

- **Match the CLI.** If the UI shows something different from what `bd show` returns, that's a bug. When in doubt, run the CLI command and match its output.
- **Test what you change.** New behavior needs a test that fails without your change. Compiling is not testing.
- **Keep PRs focused.** One logical change per PR. Refactors separate from behavior changes.
- **TypeScript everywhere.** No `any`. bd CLI response shapes get types.
- **Follow existing patterns.** shadcn/ui primitives for components; server actions for mutations; all `bd` interaction goes through the server's bd wrapper — never shell out to `bd` from elsewhere.

## Commit messages

Use conventional-commit style prefixes (`fix:`, `feat:`, `chore:`, `ci:`) with a scope where it helps: `fix(epic-tree): …`. Explain *why* in the body when the change isn't self-evident.

## Code of conduct

This project follows a [code of conduct](CODE_OF_CONDUCT.md). Be excellent to each other.
