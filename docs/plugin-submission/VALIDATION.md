# Local validation — 2026-09-30

Prepared against `0f74059`, protocol 1.6.0. The final code is committed locally; no push or submission occurred.

- `npm run check`: passed all 151 existing tests, relay types/TypeScript, 21-tool original MCP smoke and packaged-adapter checks. Relay tests use local Miniflare and simulated native calls, not the installed host.
- `npm run plugin:pack`: passed listing limits, square 256 px icon, exact file allowlist, private-path/key/fixture-token marker scan, all 21 bundled tools, seven relay requests exactly once, malformed-input refusal before relay and missing-credential refusal. ZIP entries were reopened and compared byte-for-byte with the validated package files.
- `npm run build:win`: completed a separate local portable. No packaged launch, replacement or host configuration change. Electron builder used Electron 43.6.0; this artifact does not establish runtime acceptance.
- `git diff --check`: passed.
- Vault checker: no stale checkable Git claims found (248 notes, 1,569 claims); historical/unverifiable claims are not current acceptance evidence.

ZIP: `dist/BotDoor-1.6.0-codex-local.zip`, 129,857 bytes. SHA-256 for this build: `CEC2127A276DF9333A1D73AA5FF105C00A565C7AE58755361AD4D122A8677434`. ZIP timestamps make subsequent archives' checksums vary; each run writes its own `.sha256` sidecar.

Archive entries: `plugin.json`, `mcp.json`, `README.md`, `THIRD-PARTY-NOTICES.txt`, `assets/icon.png`, `runtime/server.mjs`, `skills/botdoor/SKILL.md`. Dependency license notices accompany the standalone bundle. No distribution license for Adam's own code was invented.

One bundling defect was caught and fixed: a wrapper plus the original main guard started two MCP servers. Bundling the original entry directly now starts once; a new smoke assertion requires exactly seven relay requests, preventing double execution from passing unnoticed.

Initial sandbox attempts blocked build-tool dependency reads and the relay integration worker. The same checks passed with scoped execution approval. The package subtitle exceeded the 30-character limit initially and was corrected. The ZIP script uses .NET SHA-256 because Windows PowerShell's no-profile session could not resolve Get-FileHash. These are corrected build/test issues, not successful production operations.

Unverified: actual Codex plugin install/cache loading/private environment forwarding, public portal validation, reviewer-account cases, walkthrough, physical-phone interaction, Grok Bot's secret card, relay-to-native real actions, frozen-app recovery and reboot startup. Live host/relay state was not queried during this preparation. Earlier live OFF status remains dated September 29 evidence.

Public submission is blocked as described in SUBMISSION.md. No credentials, authenticated provider access, GO LIVE, desktop action, startup change, production deploy or public publication took place.
