# Security boundaries

BotDesk is remote control software for an owner-authorized Windows session. Its app and sensitive-window checks reduce accidental access; they are not a Windows security sandbox or a guarantee against an untrusted bot.

## Owner authority

Host, owner, bot and provisioning credentials are separate. A bot credential cannot arm the host, change a schedule or obtain an owner credential. Keep the owner dashboard link and pairing file private. The owner's URL fragment is read by the dashboard and used in authenticated API calls; it is not a query-string token. HTTPS is required except for explicit local loopback development.

The relay stores credential hashes. Host credentials saved in config.json are encrypted using Electron safeStorage backed by Windows. This protects data at rest, not against malware running as the same Windows user. The one-time provisioning output file contains plaintext secrets and must stay out of source control, captures and bot conversations.

A start/end window is stored only after an authenticated owner request. Restarting the relay starts command execution off. A still-valid saved window may arm a connected host after the host acknowledges the new session. Host application restart loses its target selection and cannot grant access until a target is selected locally again.

## Command controls

- One authenticated host connection, one active bot lease and one command in flight. Inputs are not queued.
- Fresh request IDs, deadlines and session generations reject replay and late results.
- Input uses a short-lived, single-use snapshot tied to the bot, target window, process, position, dimensions and title.
- Every action requires the selected foreground window and a fixed allowed app: Edge, Chrome, Firefox or Notepad. Shells, editors and BotDesk itself are excluded.
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
