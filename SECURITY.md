# Security Policy

## Reporting a vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Use GitHub's private vulnerability reporting: go to the [Security tab](https://github.com/beadbox/beadbox/security) of this repository and click **"Report a vulnerability"**. This opens a private advisory visible only to you and the maintainers.

In your report, include:

- A description of the vulnerability and its impact
- Steps to reproduce (a proof of concept helps a lot)
- The Beadbox version (`Beadbox → About`, or the DMG/package version) and your OS
- Any suggested mitigation, if you have one

## What to expect

- **Acknowledgment within 5 business days.**
- We'll work with you to understand and validate the report, and keep you informed as a fix progresses.
- Fixes ship as a patch release; the advisory is published after the fix is available, with credit to the reporter (unless you prefer otherwise).

## Supported versions

Only the **latest release** receives security fixes. Beadbox has an in-app updater; please stay current.

## Scope notes

Beadbox is a local desktop application. Reports we especially care about:

- Anything that lets another process, local user, or web origin reach the app's RPC surface — Beadbox opens no network listener by design, so a bypass of the Tauri IPC capability scope (or any reintroduced listener) is exactly what we want to hear about
- Command or argument injection into the `bd` CLI invocations via UI-controlled input
- Path traversal via workspace paths
- Update-mechanism integrity issues

Out of scope: issues requiring an attacker who already has full control of the same user account, and vulnerabilities in dependencies with no demonstrated impact on Beadbox (report those upstream, though a heads-up is welcome).
