# BotDoor 1.7 — owner coding control candidate

Adam requested one-click access for coding from work, administrator abilities, and a phone viewer with direct control. Implemented in isolated branch `codex/botdoor-owner-control` from `ab68375`. Installed host, running apps, remote relay and existing startup settings were not changed.

## Delivered behavior

Choose Owner control once and save. GO LIVE then reuses the saved access policy and bot credential. No token is rotated or sent to a chat. A local Windows connector can use `BOTDESK_LOCAL_PAIRING=1` to read the current encrypted bot credential automatically, including after rotation. It uses the same Windows user/profile as BotDesk. Remote Grok/Morgan or other runners still require their private persistent setup; their actual credential store and automatic conversation resumption have not been verified.

Owner control enables coding apps, terminal input, clicks, type, drag and editing keys. Existing PC viewing mode remains restricted. Administrator apps are supported by the native guard only when the companion itself was launched as administrator. Launch with `scripts/Start-BotDoor-Admin.ps1 -PortablePath <absolute portable path>` after quitting the old host from its tray menu. The launcher requests normal local Windows consent and refuses to kill an existing host. No UAC policy is changed.

Phone Take control revokes the bot session, including an in-flight command, and creates a manual session. Refreshed foreground-window captures support tap/double/right click, typing, keys, scrolling, selecting/focusing windows, closing the current window and launching an exact installed .exe path. Return to bot starts a new bot session. The fixed STOP button stays available. Setup/token controls are collapsed below the viewer.

## Limits

This is a refreshed current-window viewer, not whole-desktop video or a Windows login/unlock tool. Windows secure-desktop/UAC/password controls remain unavailable. The computer must stay awake, signed in, unlocked and connected. Elevated-app behavior and real remote coding remain live acceptance gates. Executing commands or closing programs can change/delete data; no no-loss guarantee is made. Programs launch by exact existing .exe path without arguments. A running app can be selected from the window list; a not-running app needs its path. Clipboard sharing is disabled in both PC modes.

## Local validation

- `npm run check`: 158 tests, relay TypeScript, original and bundled 21-tool MCP checks. Includes real local Worker/WebSocket/HostController integration with simulated native calls: owner takeover, bot rejection, typing, snapshot invalidation and STOP.
- `node scripts/local-pairing-smoke.mjs`: actual Electron safeStorage encryption and connector decryption with a synthetic token. No real credential read.
- `node scripts/owner-viewer-smoke.mjs`: real headless Edge at 390 × 844 against the production dashboard HTML and a loopback API fixture. Takeover, coordinate scaling, typing, focus, launch, close, escaped titles, no overflow and late-capture rejection after STOP pass. Image: `evidence/owner-phone-fixture.png` (synthetic screen).
- Native C# compilation and existing native denial tests pass. This is not real administrator-control proof.
- Windows portable and plugin builds are prepared under `dist/`; legacy portable filename remains `BotDesk-0.1.0-portable.exe` despite protocol 1.7.

## Matched release and acceptance

Project AGENTS.md requires a separate deployment decision. After approval:

1. Deploy this relay with `npm run relay:deploy`; replace the stable portable with this candidate, retaining the previous binary for rollback. Quit/restart the old host only as authorized. No GitHub push is part of this release.
2. Launch the companion as administrator with Adam present to accept normal Windows consent. Confirm exactly one host, contract 1.7 and OFF. Save Owner control and phone access explicitly; no arm during setup.
3. Configure the intended bot connector once. Use local pairing for a same-PC runner, or persistent private bot credentials for the external runner. Verify bot-only status without disclosing credentials.
4. On Adam's physical phone: Take control, select a disposable coding project/window, type an inert prompt and confirm the visible result. Test launch/focus/close on disposable programs. Verify an explicitly chosen elevated test window separately.
5. Return to bot, verify the phone's old frame is unusable, and run a bounded remote coding action. STOP; confirm OFF, no saved schedule and rejection of follow-up input.
6. Test normal reboot/sign-in separately. Keep Windows awake/unlocked for the intended work period; do not claim unattended readiness until the actual work-phone path passes.

Rollback: stop access, restore the prior portable and matching prior relay, then verify OFF. Never silently substitute the previous viewing policy with full control.
