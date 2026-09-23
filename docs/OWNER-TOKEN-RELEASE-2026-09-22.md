# BotDesk owner token release — 2026-09-22

Adam requested that the locally built owner-phone bot token controls be put into use. Morgan's Last Word extension installation remains cancelled. No browser extension or X action was performed.

## Released components

- Source: local branch `codex/botdoor-recovery`, commit `1a7a086`. No GitHub push.
- Relay: existing `botdesk-relay` Worker at `https://botdesk-relay.adamdesgns-lastword.workers.dev`, deployed version `f702011f-38dc-4bd6-b5ec-23e76ccf7a3d`. Existing Durable Object and provisioning secret were retained. Owner status reports contract `1.3.0`.
- PC host: `dist/BotDesk-0.1.0-portable.exe`, SHA256 `c69f140e1960bfa135dd60fb9193215900a258949e36138f8f80cfb879e1fd0d`, launched from this worktree in background. The previous portable under `Kingmarch/botdoor-studio/dist` was stopped after owner status confirmed OFF, with no schedule or active bot. It remains on disk for rollback. The running host's extracted `main.mjs`, `relay-client.mjs`, and `owner-secret.mjs` matched the source byte for byte.
- Existing encrypted host and owner credentials were retained. The missing bot credential was replaced through the owner-only rotation route. This revoked the old bot token. The new bot token is stored encrypted in the host config; the relay stores only its hash. No token value is in this document, logs, chat, or source.

## Verification

- Before replacement, the live owner API reported OFF, online, no schedule, no active bot. After restart, it reported OFF, online, no schedule, relay contract `1.3.0`, target state `missing`.
- The live owner-only Show route returned a valid 43-character bot token without displaying it in the verification output.
- A bot-only read-only `status` request using that token succeeded and returned OFF. The old credential was not retrieved or reused for a live rejection test; the relay integration test proves old-token rejection after rotation.
- The deployed owner dashboard responded HTTP 200 and contained **SHOW TOKEN** and **CREATE NEW TOKEN**. Automated phone interaction used a synthetic owner API; a physical-phone tap, browser clipboard write, and real owner view have not been observed.
- Local release checks before deployment: 143 tests passed, relay types and 18-tool MCP smoke passed. The portable build's packaged host files matched source. An isolated portable-launch smoke could not identify its hidden test window and was not counted as a pass; the actual replacement host subsequently connected and passed the live checks above.

## Current operating state

BotDesk is OFF. No window is selected after restart, so GO LIVE requires a fresh approved target. The owner can open the existing private phone link, tap **SHOW TOKEN**, then **COPY TOKEN** and paste it only into the bot's private credential field. The owner link itself contains the owner credential and must not be pasted into chat. Morgan's previous bot token will no longer work.

The private continuous screen view remains separate, unfinished work. The free owner page still offers on-demand selected-window snapshots during a live session.
