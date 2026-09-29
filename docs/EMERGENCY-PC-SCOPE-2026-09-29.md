# BotDoor emergency PC scope — 2026-09-29

Adam's requested behavior: after the current KEORIS Claude test, BotDoor should let Morgan operate ordinary windows across this PC without asking Adam to select each one. Adam chooses apps to block instead. The current selected-window grant cannot do this: the owner page, host controller, MCP contract, and native Windows helper all enforce one HWND and a small app allowlist.

## Intended owner flow

1. The private owner page shows **PC access** and a blocked-app list. Switching from one-window mode to PC access stops any live session or schedule. It never arms by itself.
2. Adam saves the blocked apps, then presses GO LIVE for a bounded session. PAUSE, STOP, local STOP, Ctrl+Shift+F12, disconnect and expiry still end access.
3. Morgan can list and focus any ordinary, unblocked window, including a separate folder picker or File Explorer. A fresh capture of the current foreground window is required before input; changing foreground invalidates it. This is multi-window control, not unredacted whole-desktop capture.
4. The host rejects blocked processes at the native input/capture boundary, as well as the JavaScript guard. Protected Windows desktops, UAC/elevated targets, password controls, sign-in and financial windows stay outside this mode. BotDesk itself stays blocked so the bot cannot change its own access switch.
5. The bot-only token must be restored in Morgan's private secret card and a real bot-only status call must pass before declaring the connector fixed. Never put it in chat, logs or this file.

## Acceptance

- With PC access OFF, bot commands fail. Saving the blocklist or switching scope stops a live session and clears any schedule.
- With PC access LIVE, Morgan can capture and use two ordinary apps and a separate-PID file picker without an owner window-selection step.
- A blocked app never appears in a bot capture or accepts focus/input; foreground changes require a new capture. Protected windows fail closed.
- STOP during an input, expiry, relay disconnect, replay and stale session IDs still reject further commands.
- Phone UI at narrow width clearly shows PC access, blocked apps, connection and STOP. A real phone and Morgan connector check are needed before release.

This document records the target behavior; it is not implementation or release evidence.
