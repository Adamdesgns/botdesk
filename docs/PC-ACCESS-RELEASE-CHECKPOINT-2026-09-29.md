# BotDoor PC access release checkpoint — 2026-09-29

Adam asked for BotDoor to control ordinary windows across the PC during an owner-approved live session, with an owner-maintained blocked-app list instead of per-window selection. The 1.4 relay and host are now deployed and running, but PC-wide policy was not enabled or accepted on a real phone.

## What is ready

- Owner phone page offers PC access and a blocked-app list. Saving the rules stops access and cancels any schedule. GO LIVE is a separate action. The default remains one-window access.
- The bot can enumerate and focus ordinary, unblocked windows in PC mode. A fresh foreground capture is required before input; changing windows invalidates the capture. Protected Windows desktops, elevated windows, password controls, financial/sign-in windows, BotDesk itself, and system/security tools remain blocked. The native helper enforces the app blocklist and protected-tool rules again at the input and capture boundary.
- STOP, PAUSE, expiry, disconnect, local emergency stop, command replay protection, and the one-bot lease remain in force. Clipboard and recording are unavailable in PC mode until they can be scoped safely.
- Relay and MCP contracts report version 1.4.0. No bot, owner, or host credential changed during this work.

## Local verification

- `npm run check`: full test suite, relay TypeScript check and 18-tool MCP smoke passed.
- `node scripts/phone-dashboard-smoke.mjs`: synthetic owner API at 390 px and 320 px passed, including PC access GO LIVE without choosing a window, blocked-app rules, and STOP. Evidence: `evidence/phone-pc-access-320.png` (synthetic data only).
- Windows native helper compiled; packaged `main`, controller, guard, owner UI and native helper bytes match source.
- Portable built offline from installed Electron: `dist/BotDesk-0.1.0-portable.exe`, SHA-256 `24DA31D777416205EABA21110ED459B6F8B6498FF8D7E6A1221158BD91083C0F`.

## Live release — 2026-09-29

- Adam explicitly approved deploying the existing Worker, repairing the shortcut, and starting one host. `npm run relay:deploy` succeeded: Worker `botdesk-relay`, version `236df7e6-78fd-4ee1-b27f-483b6ff22ce6`, at `https://botdesk-relay.adamdesgns-lastword.workers.dev`. A live `/health` request returned HTTP 200 and `{"ok":true,"service":"botdesk-relay"}`.
- `C:\Users\steam\OneDrive\Desktop\BotDesk.lnk` now points to the portable above; the target exists. One portable host launch was made. An authenticated owner status check using the locally sealed owner credential returned `hostOnline:true`, `mode:"off"`, `accessMode:"selected-window"`, `targetState:"missing"`, and `schedulePending:false`. No GO LIVE was sent.

## Remaining gates

- Saving `pc-access` with an empty custom exclusion list was rejected by automatic approval review: that would persist broad future remote-control scope despite access currently being OFF. Do not retry through another path. The existing selected-window policy remains. Adam needs to specify the apps to block and approve the concrete policy before it can be saved.
- Real native multi-window use, separate-PID folder picker, physical-phone blocked-app interaction, and STOP during input still need acceptance proof. Keep access OFF until a bounded test is deliberately started.
- Morgan's saved bot token was rejected by the existing relay. The real local host config has a sealed bot token, but Morgan's private secret card has not been updated or authenticated. Transfer only the bot token through the private masked field, then verify a bot-only status call. Never paste the token into chat, logs, or this document.
- The private continuous in-app screen view is a separate unfinished feature in the independent `botdesk-pro` repository; the free page still has on-demand snapshots.

No GitHub push, schedule, GO LIVE, token rotation, or remote input occurred in this checkpoint.
