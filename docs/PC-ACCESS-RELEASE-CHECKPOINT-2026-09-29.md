# BotDoor PC access local checkpoint — 2026-09-29

Adam asked for BotDoor to control ordinary windows across the PC during an owner-approved live session, with an owner-maintained blocked-app list instead of per-window selection. This checkout implements that flow locally. It has **not** been deployed or accepted on a real phone.

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

## Live release gates

- Automatic approval review rejected deployment of the existing Cloudflare Worker because Adam's current request did not explicitly authorize that shared-service change. **No relay deployment occurred.** The old relay does not accept the new `policy` owner action, so do not treat the new package as a live PC access release yet.
- No BotDesk process was found at this checkpoint. The OneDrive Desktop `BotDesk.lnk` points to an old `C:\Users\CodexSandboxOffline\...` target. Its shortcut and host launch remain unchanged. After deployment approval, confirm relay status is OFF, deploy the 1.4 relay, correct the shortcut to this portable, start one host copy, and confirm owner status is online/OFF.
- Real native multi-window use, separate-PID folder picker, physical-phone blocked-app interaction, and STOP during input still need acceptance proof. Keep access OFF until a bounded test is deliberately started.
- Morgan's saved bot token was rejected by the existing relay. The real local host config has a sealed bot token, but Morgan's private secret card has not been updated or authenticated. Transfer only the bot token through the private masked field, then verify a bot-only status call. Never paste the token into chat, logs, or this document.
- The private continuous in-app screen view is a separate unfinished feature in the independent `botdesk-pro` repository; the free page still has on-demand snapshots.

No GitHub push, schedule, GO LIVE, token rotation, or remote input occurred in this checkpoint.
