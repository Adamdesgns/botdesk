# Security boundaries

## Current 1.7 Owner control addition

The owner can explicitly select Owner control for coding apps, terminals and editing. Its native helper permits elevated targets only when it also runs elevated. System integrity, Windows Security, UAC/secure desktop and password controls remain blocked. Old viewing/selected-window policies keep their existing restrictions. No UAC policy or startup task is changed. Owner control is not a security sandbox: code execution can change or delete files.

Phone Take control cancels the previous bot session and excludes bot input at both relay and host. Return to bot creates another session; old phone snapshots cannot be reused. Manual sessions have no reconnect schedule. The viewer refreshes the foreground window, with fresh single-use image coordinates, visibility/state cancellation and a fixed STOP button. It is not full-desktop video.

Explicit BOTDESK_LOCAL_PAIRING=1 reads only the saved bot credential under the same Windows user/profile. Direct DPAPI and Chromium v10 encrypted storage are supported; unknown formats fail closed. No owner/host credential is decrypted or returned, and no code is sent to chat. Remote runners still require their own persistent private setup.

See [Owner control release and validation](OWNER-CONTROL-2026-10-01.md). The following sections describe the historical selected-window and restricted PC-viewing design; claims that all editors/elevated apps are blocked apply to those modes, not the explicitly granted Owner control mode. Historical deployment versions below are not current runtime claims.

BotDesk is remote control software for an owner-authorized Windows session. Its app and sensitive-window checks reduce accidental access; they are not a Windows security sandbox or a guarantee against an untrusted bot.

In the local 1.5 PC-wide viewing build, click, drag, type, clipboard and editing keys are rejected by both the host guard and native helper. The bot may inspect, focus, scroll and close ordinary windows. Closing can discard unsaved work, so this is not a guarantee that no data can be lost. The deployed 1.4 host has not been replaced by this local build.

## Owner authority

Host, owner, bot and provisioning credentials are separate. A bot credential cannot arm the host, change a schedule or obtain an owner credential. Keep the owner dashboard link and pairing file private. The owner's URL fragment is read by the dashboard and used in authenticated API calls; it is not a query-string token. HTTPS is required except for explicit local loopback development.

The relay stores credential hashes. Host credentials saved in config.json are encrypted using Electron safeStorage backed by Windows. This protects data at rest, not against malware running as the same Windows user. The one-time provisioning output file contains plaintext secrets and must stay out of source control, captures and bot conversations.

A start/end window is stored only after an authenticated owner request. Restarting the relay starts command execution off. A still-valid saved window may arm a connected host after the host acknowledges the new session. Host application restart loses its target selection and cannot grant access until the owner selects a target again. With phone access enabled locally, the owner may use STOP & CHOOSE on the phone; that cancels the schedule and leaves control OFF until a separate GO LIVE.

Phone target review is owner-authenticated and never a bot command. It lists eligible-window metadata only, expires after 60 seconds and requires the exact candidate to pass identity, title, geometry and safety checks again on approval. Temporary approval expires within five minutes and is revoked by STOP, pause, disconnect or expiry. There is no automatic parent-window fallback and no capture of an unapproved candidate. See [window recovery](WINDOW-RECOVERY-2026-09-22.md) for implementation and evidence boundaries.

## Command controls

- One authenticated host connection, one active bot lease and one command in flight. Inputs are not queued.
- Fresh request IDs, deadlines and session generations reject replay and late results.
- Input uses a short-lived, single-use snapshot tied to the bot, target window, process, position, dimensions and title.
- Every action requires the selected foreground window and a fixed allowed app: Edge, Chrome, Firefox or Notepad. Shells, editors and BotDesk itself are excluded. `focus` may restore only that stored HWND/PID; it re-runs integrity, sensitive-title, password and allowlist checks and never chooses another window.
- Windows integrity level, active desktop, password controls and sensitive titles are checked. Unknown evidence is rejected. Password-focused or elevated windows are rejected.
- Native capture uses only the selected window. It has no full-desktop fallback. Guarded recording repeats the capture checks for each frame.
- Keyboard and text operations are bounded. Clipboard shortcuts, shell/developer shortcuts and executable URI text are blocked.
- Native helpers use a fixed script and JSON over stdin, not generated shell commands. Cancellation kills the active helper; an input already delivered to Windows cannot be undone.

Web pages can contain confidential information even without a recognizable password field or title. Custom controls, one-time codes and innocuously titled authenticated pages are not guaranteed to be detected. An approved browser can navigate to other pages within the selected window. Use a dedicated test browser profile with only the access intended for the bot. Sensitive tasks remain excluded from this version.

## Stop and availability behavior

OFF, PAUSE, expiry and connection loss cancel ongoing operations and invalidate snapshots. Remote OFF or PAUSE cancels the saved window but allows a later owner GO LIVE. The local STOP button, Ctrl+Shift+F12, a locked Windows session, suspend and app shutdown latch a local stop and cancel the window. That latch needs local reset.

The host stops accepting commands when the relay is unavailable. Heartbeat detection bounds silent connection failure, and local expiry is enforced even without relay contact. Only a previously saved, unexpired owner window can resume after an ordinary connection loss.

## Data handling and limits

Audit files contain time, bot ID, command, outcome category and app name. They omit typed text, screenshots and page contents. Snapshot text and requested screenshots travel through the relay to the authorized caller. The relay is therefore trusted infrastructure, not an end-to-end encrypted tunnel.

WebM captures stay under the host's local user-data captures directory. Recording is bounded by chunk and total-byte limits and stops on guard/capture failure. The frame rate is approximately one frame per second; no microphone/audio or whole-desktop stream is enabled.

The renderer is sandboxed with context isolation, no Node access, constrained IPC, a local-content policy and denied popup/navigation/permission requests. The Windows native helper is unpacked from the application archive so it can run through PowerShell.

## Release evidence

See [VERIFICATION.md](VERIFICATION.md) for exactly what was exercised. Native helper compilation, simulated command flows and packaged UI checks do not prove actual UI Automation, GPU-window capture, input coordinates, real-phone connectivity or behavior on another PC. These remain controlled pilot checks before unattended use.
