# Bot Door troubleshooting

Every entry below corresponds to a message the software really produces on this branch. Start where the symptom appears: the Bot Door window on the PC, the phone page, the bot's tool error, the provisioning terminal, or "nothing opens". When you ask for help, attach the diagnostic report described at the end.

## Nothing opens when I start Bot Door

Bot Door refuses to start when a prerequisite is missing and, since this branch, says so in a dialog and in `logs\startup-errors.log` inside the data folder (`%APPDATA%\botdesk` by default; the packaged build's folder appears in the diagnostic report as `paths.userData`).

| Message | Cause | Fix |
| --- | --- | --- |
| Windows credential encryption (DPAPI) is unavailable... | Electron `safeStorage` cannot encrypt on this account or OS. Bot Door never stores tokens in plain text. | Sign in with an ordinary Windows user account on a Windows PC. Bot Door does not run on other operating systems. |
| The emergency stop shortcut Ctrl+Shift+F12 could not be registered... | Another program already owns that global shortcut. | Close or reconfigure that program, then start Bot Door again. This check is deliberate: Bot Door will not run without a working emergency stop. |
| (no dialog, window appears briefly then hides) | Bot Door was started with `--background`, or it is already running. | Look for the tray icon; a second copy just brings the first one forward. |

## The Connection card on the PC

The **Relay** row shows one of these labels; the sentence under the table is shown in the card too, with the HTTP status or socket code in parentheses and a countdown to the next attempt. Reconnection is automatic: 1 s after the first failure, doubling to at most 30 s.

| Label | Meaning | What to do |
| --- | --- | --- |
| Not configured | `relayUrl`, `hostId` or `hostToken` is not saved. | Paste the pairing JSON, FILL PAIRING SETTINGS, SAVE SETTINGS. |
| Invalid relay URL | The saved URL is not an HTTPS origin (or `http://127.0.0.1:...` for local tests). | Save the `relayUrl` exactly as it appears in the pairing file. |
| Connecting | A connection attempt is in progress. | Wait a few seconds. |
| Authenticating | TCP/TLS is up; the relay is checking the host token. | Wait; if it stays here 10 s the attempt times out (see Relay not responding). |
| Securely connected | Authenticated. | Nothing. Remote arming still needs a selected window and the remote-arm setting. |
| Rejected by relay (HTTP 401) | The relay does not recognise this `hostId` + `hostToken` pair. Typical causes: a pairing file still marked `pending`, a token pasted from a different pairing, or a hand-edited host ID. | Re-import the pairing file whose `provisioningStatus` is `complete` and save. A pairing that failed part-way can never connect; provision again. |
| Another copy is connected (HTTP 409) | A second Bot Door with the same host ID holds the relay slot (another PC, or a copy still running in the tray). | Quit the other copy. This one reconnects by itself, usually within 30 s. |
| Relay route missing (HTTP 404) | The URL points at something that is not the Bot Door relay origin. | Fix `relayUrl`. |
| Relay refused the connection | The relay returned another 4xx. | Check `relayUrl`; check the relay logs if you run it. |
| Relay error | The relay returned 5xx. | Wait; retried automatically. |
| Relay not responding | The address answered but no WebSocket handshake completed within 10 s. Common when `https` and `http` are swapped, or a proxy strips WebSockets. | Check the scheme in `relayUrl` and any proxy. |
| Relay address not found (ENOTFOUND) | DNS cannot resolve the relay hostname. | Check the spelling and this PC's internet connection. |
| Relay unreachable (ECONNREFUSED, ETIMEDOUT, ...) | Nothing accepted the connection. For the local relay this means `npm run relay:dev` is not running. | Start the relay; check firewall rules. |
| Secure connection failed (CERT_..., ERR_TLS_...) | TLS certificate verification failed. | Check the URL and the PC's date and time. |
| Connection lost | Heartbeats stopped being acknowledged for 35 s. | Wait; reconnects automatically. |
| Disconnected (relay said: host-heartbeat-timeout / invalid-host-frame / ...) | The relay closed the socket and gave a reason. | Wait for reconnection. If it repeats with `invalid-host-frame`, report it with a diagnostic report. |
| Offline | The connection is intentionally stopped (during a settings save or quit). | Nothing. |

Any disconnection also turns access **OFF** on the PC. A saved owner window resumes automatically after reconnection only while the window is still valid and the PC still passes its own checks.

**Windows helper check failed** under the card means the fixed PowerShell helper could not compile. The text lists the causes; the codes are:

| Code | Meaning |
| --- | --- |
| windows-helper-missing | `scripts\windows-helper.ps1` is not next to the app. Rebuild the portable package; it must unpack that file. |
| windows-helper-start-failed | `powershell.exe` could not be started from `System32\WindowsPowerShell\v1.0`. |
| windows-helper-failed | PowerShell exited with an error. Usually Constrained Language Mode, AppLocker/WDAC blocking `Add-Type`, or missing .NET UI Automation assemblies. The report carries a short stderr excerpt. |
| windows-helper-timeout | Compilation did not finish in time; slow PC or antivirus scanning PowerShell. Try again. |
| windows-helper-invalid-response | Something else wrote to the console (transcription/logging policy). |
| unsupported-platform | Not Windows. |

## Notices in the Bot Door window

| Notice | Cause / fix |
| --- | --- |
| Paste the host config JSON from the private provisioning file. | The pasted text is not JSON. Paste the whole pairing file. |
| This pairing file is marked "pending"... | Provisioning never confirmed. Delete it and provision again. |
| Pairing fields filled, but this PC also needs: ... | You pasted a bot-only configuration. The host needs `relayUrl`, `hostId`, `hostToken`, `ownerToken`. |
| Invalid hostToken: pairing tokens are 43–128 letters, digits, "-" or "_"... | A token was truncated or has stray characters. Paste the full value. Leaving a token blank keeps the previously saved one. |
| Invalid host ID: use the lowercase hostId... | Host IDs are lowercase letters, digits and dashes. |
| Relay URL must be an origin without credentials or path. / Relay must use HTTPS or local loopback HTTP. | Save only the origin, e.g. `https://your-relay.workers.dev`. |
| Unencrypted BotDesk credentials rejected. Import pairing again. | `config.json` was edited or copied from another machine. Bot Door only trusts DPAPI-encrypted tokens it wrote itself. |
| Start at sign-in is available in the portable build only. | Running from source; use the portable exe for start-at-login. |
| Choose a window first. | GO LIVE needs an approved window. REFRESH WINDOWS, then select. |
| Unlock the local stop first. | A local STOP latched. UNLOCK LOCAL STOP. |
| Connect the relay before going live. | Local GO LIVE requires **Securely connected**. |
| Import pairing details first. | COPY PHONE LINK needs `relayUrl`, `hostId` and `ownerToken` saved. |
| No verified app windows available... | No allowed app (Edge, Chrome, Firefox, Notepad) with an ordinary page is open, or Windows could not verify one. Sign-in, password, financial and system windows are excluded on purpose. |
| Refresh and choose an available window. | The list is stale. REFRESH WINDOWS again. |
| Windows refused to bring the approved window to the front... (focus-refused) | Windows blocks foreground changes in some cases. Click the window once yourself, then retry. |
| The relay rejected the owner token saved on this PC... (unauthorized) | The saved `ownerToken` does not belong to this pairing. Re-import the complete pairing file. |
| This PC did not acknowledge the request within 5 seconds... (state-timeout) | The host was connected but did not answer; usually the focus attempt hung. Confirm the approved window is open and retry. |
| The relay is still waiting on a previous request... (host-busy) | Try again in a few seconds. |

## On the phone page

| Text | Meaning / fix |
| --- | --- |
| LOCKED — Open the private owner link saved during setup. | The `#...` part of the link is missing. Use COPY PHONE LINK on the PC again. |
| UNKNOWN — Could not verify the PC state, plus "(unauthorized)" | The link's owner credential is not accepted. Use the link copied from the paired PC. |
| PC OFFLINE | The host is not connected to the relay. Check the Connection card on the PC. GO LIVE while offline saves a timer that starts when the PC reconnects. |
| The PC has remote arming turned off... (remote-arm-disabled) | Tick **Allow remote arming** on the PC and save. Scheduled windows rejected for this reason are cancelled, not retried. |
| No approved window is selected on the PC... (select-a-window-first) | REFRESH WINDOWS and select on the PC. Remember the selection is lost when Bot Door restarts. |
| The local STOP is locked on the PC... (local-stop-latched) | Someone pressed STOP, `Ctrl+Shift+F12`, locked Windows or the PC slept. UNLOCK LOCAL STOP on the PC. A saved window is cancelled. |
| The PC did not answer within 5 seconds... (state-timeout) | See the same code above. |
| Windows refused to bring the approved window forward... (focus-refused) | Click the approved window once on the PC. |
| Choose an end after the start, within 12 hours. / (invalid-schedule-window) | Windows are at most 12 h, must end in the future and start within 30 days. |
| The relay could not be reached from this phone... | Phone connectivity, or the relay is local-only (`127.0.0.1` never works from a phone). |
| SCHEDULED with "Waiting for the PC to connect" | The window is saved; access starts when the prepared PC connects, at the earliest at the saved start time. |

## Bot tool errors

The adapter returns the relay or host code followed by a next step. The most common:

| Code | Meaning | Next step |
| --- | --- | --- |
| BotDesk MCP is not configured. Set BOTDESK_RELAY_URL, BOTDESK_HOST_ID and BOTDESK_BOT_TOKEN. | Env missing. The adapter also logs `ready, but not configured` on stderr at startup. | Fix the MCP `env` block. |
| BotDesk relay unreachable (ECONNREFUSED / ENOTFOUND / ...) | The relay URL is wrong or the relay is down or local-only. | Fix `BOTDESK_RELAY_URL`; a bot on another machine cannot use `127.0.0.1`. |
| unauthorized | Wrong `BOTDESK_BOT_TOKEN` for this host ID (often the host or owner token pasted by mistake), or wrong host ID. | Use `botToken` from the completed pairing file. |
| host-offline | The PC is not connected. | Owner: Connection card must show Securely connected. |
| not-armed | Access is OFF or paused. | Wait for the owner's GO LIVE or schedule. `botdesk_status` works while off. |
| bot-lease-held | Another bot ID holds the 60 s lease. | Wait or stop the other client. |
| host-busy | One command at a time. | Retry after the previous command returns. |
| command-timeout | No answer within 20 s. | Do not assume it happened; capture again. |
| fresh-snapshot-required | Input needs a `snapshotId` from your own capture within 15 s. | Capture, then act. |
| window-moved-retake-snapshot | The window moved/resized/retitled since the capture. | Capture again. |
| target-changed | The approved window is not in the foreground. | `botdesk_focus`, then capture. |
| focus-refused | Windows refused the foreground change. | Only the owner can click it on the PC. |
| credential / financial / system / app-blocked | The foreground content is off-limits by design. | Ask the owner to show ordinary content. This is not a fault to work around. |
| expired / session-expired | The window ended. | Owner must GO LIVE again. |

## Provisioning terminal

`scripts/provision.mjs` prints one sentence per problem:

- `Provisioning did not start: ...` — a precondition failed before any request (`--out` exists, folder missing, secret unset or not 43–128 base64url characters, relay URL not a bare HTTPS origin, `http://127.0.0.1` without `--allow-local`). Nothing was created on the relay.
- `Provisioning failed: the relay could not be reached (ECONNREFUSED)...` — for the local relay, `npm run relay:dev` is not running. The pending file is unusable; delete it.
- `Provisioning failed: the relay rejected the provisioning secret.` — `BOTDESK_PROVISIONING_SECRET` differs from the relay's `PROVISIONING_SECRET`. Delete the pending file and retry with the matching secret.
- `Provisioning failed: the relay already holds credentials for this host ID.` — only possible if you reused a host ID by hand; run again for a fresh one.
- `Provisioning did not confirm completion: ...` — the request may or may not have been stored (for example a timeout after sending). Keep the file and check whether that host ID connects before provisioning again.

## Connection states and reconnection, in one place

| Event | Host | Relay | Phone |
| --- | --- | --- | --- |
| Host starts | OFF, connects within ~1 s of having a pairing | Accepts one socket; forces OFF | PC ONLINE |
| Heartbeat | Every 10 s; drops after 35 s silence | Drops after 30 s silence | — |
| Network blip | OFF (`relay-disconnected`); retries 1 s → 30 s | Cancels pending command; keeps only an unexpired saved window | PC OFFLINE until reconnect |
| Reconnect inside a saved window | Re-arms only if remote arm on, stop not latched, window selected, focus OK | Sends `owner_state armed`, waits 5 s for the acknowledgement | LIVE again |
| Host process killed or crashes | On restart it has no selected window; cannot re-arm until one is chosen | Saved window stays pending | SCHEDULED / "Waiting for the PC" |
| Quit Bot Door, lock screen, sleep, renderer crash (Windows shutdown likely follows the quit path; untested) | Local stop latched, OFF; after restart the window must be selected again | Saved window cancelled (`local-stop`) | Stopped; needs UNLOCK on the PC |
| Relay (Worker) restart | Reconnects on the next retry | Starts OFF; re-arms only from the persisted window after a new acknowledgement | Brief OFFLINE |
| Second host with the same ID | "Another copy is connected", keeps retrying | 409 for the second socket | Unaffected |

## What to include when asking for help

1. On the PC choose **COPY DIAGNOSTIC REPORT**. It copies the report to the clipboard and saves it under `logs\diagnostic-<time>.txt` in the data folder. Running it also re-runs the Windows helper check.
2. The label and sentence shown in the Connection card at the time.
3. The exact phone alert or bot error code.
4. What changed last (new pairing, Windows update, moved PC, new antivirus).

The report never includes tokens, the owner link, window titles, typed text or screenshots; it lists token fields as `saved` or `missing`, and shortens your home folder to `~`. Sample from this branch (unconfigured window, relay reachable):

```json
{
  "report": "Bot Door diagnostic report",
  "generatedAt": "2026-09-14T01:31:30.720Z",
  "app": { "version": "0.1.0", "packaged": false, "portable": false, "electron": "43.6.0", "platform": "win32", "arch": "x64" },
  "paths": { "userData": "~\\AppData\\Roaming\\botdesk", "configFileExists": true },
  "prerequisites": {
    "credentialEncryption": true,
    "emergencyShortcutRegistered": true,
    "windowsHelper": { "ok": true, "error": null, "durationMs": 2410 }
  },
  "configuration": {
    "relayUrl": "https://your-relay.workers.dev", "hostId": "pc-0123456789abcdef01234567",
    "hostToken": "saved", "ownerToken": "saved", "botToken": "missing",
    "allowRemoteArm": false, "startAtLogin": false, "allowedApps": ["msedge", "chrome", "firefox", "notepad"]
  },
  "connection": { "label": "Securely connected", "connected": true, "authenticated": true, "attempts": 0, "lastAuthenticatedAt": "2026-09-14T01:31:30.639Z" },
  "session": { "mode": "off", "stopLatched": false, "targetSelected": false, "target": null },
  "recentAudit": [ { "time": "2026-09-14T01:31:30.631Z", "botId": "local", "command": "state", "outcome": "off:settings-changed", "app": "" } ],
  "notes": [
    "No approved window is selected. Remote or scheduled arming is rejected with select-a-window-first until REFRESH WINDOWS and a selection are done on this PC.",
    "Remote arming is disabled. Phone GO LIVE and schedules are rejected with remote-arm-disabled until the setting is enabled and saved (local GO LIVE enables it)."
  ]
}
```

Audit files (`logs\audit-YYYY-MM-DD.jsonl`) record time, bot ID, command, outcome and app name only; they are safe to share as well.
