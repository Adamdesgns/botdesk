# Bot Door setup audit

Audit of the first-time setup and troubleshooting experience on the `codex/botdesk-v1` baseline. The product is called **Bot Door** in owner-facing text; the repository, package and Windows title still say BotDesk, which is expected.

Everything marked **verified** below was reproduced on this branch against the real code: the Cloudflare relay running locally under `npm run relay:dev` (Miniflare), the real `scripts/provision.mjs`, the real `RelayClient`/`HostController`, the real Electron host driven by Playwright under a virtual display, the real MCP adapter over stdio, and the real phone dashboard HTML against the local relay. Items marked **untested** need a signed-in Windows desktop, a deployed HTTPS relay, a second machine or a real phone, none of which exist in this environment. Nothing was deployed and no production system was touched.

## How Bot Door actually connects

| Component | Runs where | Connects how | Credential |
| --- | --- | --- | --- |
| Windows host (`host/`) | The owner's PC, Electron portable exe | Outbound WebSocket to `wss://RELAY/api/host/HOSTID/socket`, `Authorization: Bearer` header, 10 s handshake timeout | `hostToken` (stored DPAPI-encrypted in `config.json`) |
| Owner phone page (`relay/src/dashboard.ts`) | Any browser | HTTPS to `/api/owner/HOSTID/{status,state,schedule,command}`, token from the URL fragment sent as a bearer header, polls every 5 s | `ownerToken` |
| Bot MCP adapter (`mcp/server.mjs`) | The bot runner's machine, stdio | HTTPS POST to `/api/bot/HOSTID/command` per tool call | `botToken` (env `BOTDESK_BOT_TOKEN`) |
| Relay (`relay/src/index.ts`) | Cloudflare Worker + one Durable Object per PC | Holds one host socket, the saved owner window and SHA-256 hashes of the three tokens | `PROVISIONING_SECRET` for `/api/provision` only |

There are no other integrations. The relay is not deployed on this branch; the local relay at `http://127.0.0.1:8787` is reachable only from the same machine.

### Lifecycle observed in code and tests

- **Install**: `npm ci`, `npm run check`, `npm run build:win` produces `dist\BotDesk-0.1.0-portable.exe`. The host needs Windows PowerShell 5.1 at `System32\WindowsPowerShell\v1.0\powershell.exe` and .NET Framework UI Automation assemblies (`Add-Type` in `scripts/windows-helper.ps1`). The MCP adapter and the provisioning script need Node.js and `npm ci` in a clone.
- **Initial configuration**: provision once (`scripts/provision.mjs`) to get a pairing file; paste it into the host (FILL PAIRING SETTINGS, SAVE SETTINGS); pick an approved window (REFRESH WINDOWS); enable remote arming; copy the phone link. Give the bot only `relayUrl`, `hostId` and `botToken`.
- **Connection**: the host connects as soon as `relayUrl`, `hostId` and `hostToken` are saved. `auth_ok` from the relay means authenticated. Every relay-side state change arrives as `owner_state`; the host must acknowledge an arm with `owner_state_result` within 5 s or the relay stays OFF.
- **Connected / disconnected / reconnecting / failure**: heartbeats every 10 s; the host drops the socket after 35 s without an ack, the relay after 30 s. Reconnect backoff starts at 1 s and doubles to 30 s. Any socket close puts the host in OFF (`relay-disconnected`). A saved, unexpired owner window re-arms automatically after reconnect, but only after the host's own checks pass again (remote arm enabled, stop not latched, window selected, focus succeeded).
- **Restart**: restarting the host loses the selected window (memory only) and therefore cannot re-arm until the owner selects it again. Lock screen, suspend, renderer crash and quit all latch the local stop. Restarting the relay (Worker) starts OFF and honours only the persisted owner window.
- **Asking for help**: before this branch, the owner had to describe symptoms by hand; there was no report, and the audit log and `config.json` were the only artefacts.

## The five most consequential verified problems

### 1. Every connection failure looked the same ("Offline")

**Verified.** `RelayClient` swallowed the `ws` `error` event and emitted `{connected:false, authenticated:false}` for a wrong host token (HTTP 401), an unknown host ID (401), a second copy of the host already connected (409), DNS failure (`ENOTFOUND`), a refused connection (`ECONNREFUSED`), a TLS failure and a handshake timeout. The renderer showed "Offline" for all of them and for the unconfigured state.

Reproduction (before): run `npm run relay:dev`, provision, save the pairing in the host with one character of the host token changed, watch the Connection card. It says "Offline" and never changes; the same text appears if you stop the relay or start the host twice.

Acceptance criteria:
- Each failure class has its own label and one sentence saying what to check, plus the attempt count and time to the next retry.
- No token or raw error message text is ever shown or emitted; only classified reason codes, the HTTP status and the socket error code.
- A duplicate host reconnects automatically after the other copy quits.
- Owner GO LIVE/PAUSE relay errors (`unauthorized`, `state-timeout`, `local-stop-latched`, ...) are explained, with the code kept in parentheses.

Fix: `host/relay-status.mjs`, `host/relay-client.mjs`, `host/ui/renderer.js`, `host/ui/index.html`. Verified by `test/relay-status.test.mjs`, the new integration test in `test/relay.integration.test.mjs` (real Miniflare relay) and the Electron harness: "Rejected by relay (HTTP 401)", "Relay unreachable (ECONNREFUSED)", "Another copy is connected (HTTP 409)" followed by automatic recovery to "Securely connected".

### 2. Startup failures were silent

**Verified (Linux run of the real Electron host).** `app.whenReady()` threw when credential encryption was unavailable or when `Ctrl+Shift+F12` could not be registered, and the catch handler only wrote to `console.error` before quitting. The portable exe has no console, so the owner saw the process appear and vanish. `requestSingleInstanceLock()` failing also called `app.quit()` but let the ready handler keep running.

Reproduction (before): launch the host where DPAPI is unavailable (on Linux, or as a restricted account), or while another program owns `Ctrl+Shift+F12`. Nothing appears.

Acceptance criteria:
- A dialog names the cause and the fix; the same text is appended to `logs/startup-errors.log` under the data folder; the process exits with code 0.
- The message for the shortcut says another program owns it and that Bot Door will not run without an emergency stop (this is deliberate, not a bug to disable).
- A second instance focuses the first and does not initialise.

Fix: `host/main.mjs` (`startupFailure`, `primaryInstance`). Verified on Linux: exit 0 and the log line "Windows credential encryption (DPAPI) is unavailable ...". The dialog itself is **untested** here (suppressed under `BOTDESK_TEST_DATA`, and there is no Windows desktop).

### 3. No prerequisite check for the Windows native helper

**Verified by code reading; helper compile untested on Windows here.** The first PowerShell run happened on REFRESH WINDOWS, and any failure returned the bare code `windows-helper-failed`, `windows-helper-start-failed` or `native-action-blocked`. The helper's `-CompileOnly` mode existed but was only used by a Windows-only unit test. PowerShell Constrained Language Mode, AppLocker/WDAC policy, antivirus scanning and a missing unpacked `scripts/windows-helper.ps1` in a rebuilt package all produce that same code.

Acceptance criteria:
- The host runs a compile-only self-test shortly after start and again on demand; it never reads a request or touches a window.
- The Connection card shows a "Windows helper check failed" line with a specific cause list; REFRESH WINDOWS and GO LIVE errors use the same text.
- The result (code, exit code, bounded printable stderr excerpt, duration) appears in the diagnostic report.

Fix: `helperSelfTest()` and `describeHelperError()` in `host/windows.mjs`; wiring in `host/main.mjs`. Verified with injected-spawn fixtures in `test/windows.test.mjs` and on Linux ("unsupported-platform" shown in the card and the report). A real PowerShell compile pass/fail is **untested** here.

### 4. No diagnostic report, and the artefacts that existed contained private material

**Verified.** Support needed the owner to describe versions, connection state and settings by hand. `config.json` holds encrypted tokens and the pairing file holds plaintext ones, so neither is safe to paste.

Acceptance criteria:
- One button copies a JSON report to the clipboard and saves it under `logs/`. It contains versions, prerequisite results, configuration presence (`saved`/`missing`, never values), relay state with reason/attempts/timestamps, session state, the approved app's process name (never its title) and the last 20 audit outcomes.
- Redaction is layered: known secret values, `dpapi:` blobs, `Bearer` values, URL fragments, any 40+ character token-shaped string and the home directory are removed even if they leak into a field.
- The report ends with concrete blockers ("No approved window is selected ... select-a-window-first").

Fix: `host/diagnostics.mjs`, IPC `diagnostic-report`, COPY DIAGNOSTIC REPORT button. Verified by `test/diagnostics.test.mjs` and the Electron harness, which asserted the real report contained none of the three pairing tokens or the home path. A sample is in `docs/TROUBLESHOOTING.md`.

### 5. Provisioning and pairing edge cases failed unhelpfully

**Verified.** `scripts/provision.mjs` printed a raw `EEXIST` stack trace when `--out` existed, printed only `fetch failed` for an unreachable relay, and told the owner to "inspect the relay status" after a 401 even though the relay had stored nothing. In the host, FILL PAIRING SETTINGS accepted a `pending` pairing file and a bot-only configuration without comment, which then produced problem 1. The host accepted 32-character tokens while the relay requires 43, so a truncated paste saved successfully and never connected.

Acceptance criteria:
- Every provisioning precondition fails with one sentence naming the fix and no stack trace; network failures include the cause code (`ECONNREFUSED`, `ENOTFOUND`, ...); when the relay rejected or never received the request the output says the pending file is unusable and can be deleted.
- FILL PAIRING SETTINGS warns when `provisioningStatus` is not `complete` or when host fields are missing.
- SAVE SETTINGS rejects tokens shorter than 43 characters naming the field.

Fix: `scripts/provision.mjs`, `host/ui/renderer.js`, `host/config-store.mjs`. Verified by running the script through eleven failure paths against the local relay, by `test/config.test.mjs`, and in the Electron harness ("Invalid hostToken: pairing tokens are 43–128 ...").

## Also improved

- MCP adapter: logs its validated relay origin and host ID (never the token) or the configuration error at startup; known relay codes such as `unauthorized`, `host-offline`, `not-armed`, `bot-lease-held`, `fresh-snapshot-required` and `target-changed` gain a next step; network failures name the cause code (`mcp/server.mjs`, `test/mcp.test.mjs`).
- Phone dashboard: `remote-arm-disabled`, `select-a-window-first`, `local-stop-latched`, `state-timeout`, `unauthorized` and phone network errors are explained with the code kept (`relay/src/dashboard.ts`). Verified against the real local relay with a real host controller.

## Boundaries preserved

No authentication or consent path changed. Tokens are still required in headers, the relay still stores only hashes, remote arming still requires the local opt-in, a selected window and an unlatched local stop, and the emergency stop still wins. The startup check for the emergency shortcut still refuses to run without it. Nothing was exposed publicly and no service was deployed.

## Remaining setup blockers (not fixable from this environment)

1. The relay is not deployed. Owners on another network cannot connect until an HTTPS Worker exists with `PROVISIONING_SECRET`; that is an owner decision and a spend decision.
2. The portable exe is unsigned. SmartScreen will warn on first launch; the docs say so.
3. Target selection does not survive a host restart or Windows restart. Automatic start-at-login helps only if the owner selects the window again.
4. The following need a real Windows desktop and remain untested here: the startup error dialog rendering, the helper self-test against real PowerShell/.NET and policy, REFRESH WINDOWS listing, the tray, `Ctrl+Shift+F12` on a real keyboard, `npm run build:win` and the packaged `app.asar.unpacked` helper path.
5. Real phone on another network, real bot runner, and a second PC using the same host ID were simulated locally only.
