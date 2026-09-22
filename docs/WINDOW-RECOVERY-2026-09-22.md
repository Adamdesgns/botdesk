# BotDoor window recovery — 2026-09-22

Adam cancelled Morgan's Last Word extension installation and requested BotDoor repairs. That installation remains cancelled. This change is local; it does not update the running host or deployed relay.

## What failed

Morgan's handback records Edge's **Select the extension directory.** folder picker as a separate top-level window with a different process ID from the approved Edge window. `point-obscured` prevented a click through the approved window into that picker. That refusal was correct. BotDoor lacked an owner recovery flow usable from the phone.

The earlier claim that `focus-refused` proved a stale window handle was too strong. A stale target is one possibility; Windows refusing foreground focus is another. The available handback does not establish that earlier cause.

The handback also records `invalid-command` for focus and clipboard write, and `command-timeout` for typing. Both commands are present in this branch's host, MCP and relay contracts and pass local relay tests. A mismatch among the installed host, relay and connector is plausible, but not confirmed. A timed-out input has an **unknown outcome**; do not automatically repeat it.

## Implemented

- The host checks the selected window without focusing it before arm and before target commands, on relay reconnect, and on a five-second idle status timer. It compares window handle, process ID, process start time and executable name, then checks the current desktop, privilege level, app allowlist and sensitive controls. Closed, replaced or unsafe targets revoke access and show **RESELECT REQUIRED**. Normal title/position changes still require a new snapshot for input.
- The phone has **STOP & CHOOSE**. It cancels the schedule and stops bot access, including an in-flight command, before listing eligible app windows. If native cleanup is still finishing, refresh after it settles. Candidate titles are text, never HTML.
- The owner reviews app, title, process ID and window ID, then explicitly approves one candidate. Review expires after 60 seconds and is single-use. Approval checks the window again; any identity, title, geometry or safety change requires a fresh review. It leaves access OFF. GO LIVE is a separate action.
- Temporary-dialog approval defaults on. It lasts at most five minutes **from approval**, cannot use a saved schedule and is revoked by STOP, PAUSE, disconnect, expiry or target loss. BotDoor never returns to a parent window automatically; the owner must approve it again.
- Phone recovery requires the host's existing locally saved phone-access preference. It cannot clear local STOP, expand the app allowlist, control an elevated/sensitive window or expose an owner endpoint to bot credentials.
- Window review discloses eligible-window metadata only. A preview requires explicit selection and a live session. This deliberately preserves the existing OFF capture boundary; an unapproved-window thumbnail is not implemented.
- Known target/activation failures stop automatic scheduled retries and retain an actionable error. Host/MCP contract and relay status report version 1.2.0 to help compare installed components.
- A delayed screenshot or window-list response cannot reappear in the phone UI after STOP or hiding the page.

## Verification

`npm run check`: **136 tests passed**, Worker types/TypeScript passed, MCP smoke passed with 18 tools. Includes real loopback HTTP/WebSocket relay plus the actual host controller with a simulated Windows executor, role isolation, stale and unsafe targets, process reuse, changed/expired/replayed review, STOP/disconnect during approval, temporary expiry, separate-PID dialog approval, and STOP preemption.

`node scripts/phone-dashboard-smoke.mjs`: passed in a hidden, isolated Electron test window against synthetic loopback data. Checked 390px and 320px layout, exact dialog approval, literal hostile-looking title text, five-minute label/cap, scheduling disabled for temporary targets, and late responses after STOP. Local screenshots and JSON report are in ignored `evidence/`.

Native C# helper compilation passed. The Windows desktop, real Edge folder picker and physical phone were **not** operated. Compilation and simulated native tests do not prove real Edge focus, folder-picker accessibility or native STOP during input. No production deployment, app replacement, startup change, token transfer or extension installation occurred.

The portable build is a local release candidate only; see the build receipt in `evidence/`. Before any deployment, match all component versions and run a separately authorized disposable-window pilot ending STOP → OFF → rejected follow-up. Do not resume the cancelled extension mission as that pilot.

## Recorded next work

1. **Owner phone Show/Copy bot token — built locally after this checkpoint.** The owner console now requests the bot token from the connected host over a separate authenticated route, then shows it only after a tap, hides it after 30 seconds/STOP/page hide, and offers explicit copy. A matching legacy pairing file migrates into Windows-encrypted host config. On this PC the legacy file and saved bot token are absent, so the page also offers **CREATE NEW TOKEN** with a confirmation that the old bot token will stop working. The host seals the new token locally; the relay replaces only the bot-token hash and rejects the old bot credential. No real token was generated or rotated during testing. The installed host and deployed relay remain older versions; the phone cannot use this feature until both are updated. See the newer commit/verification checkpoint for exact release status.
2. **In-app screen view.** Adam wants to see what the bot is doing. Keep the free on-demand snapshot baseline separate from private `botdesk-pro` live-view work. Design selected-window-only frames, clear LIVE/paused/stale indicators, explicit opt-in, bounded frame rate/retention, and immediate clearing on STOP, expiry, disconnect or target change. Live streaming is not implemented here.
3. **Installation/version diagnosis.** Compare the running host, deployed relay and Morgan's connector contract/build identifiers before diagnosing `invalid-command`. Gather sanitized timing around host execution versus relay delivery for `command-timeout`; never retry unknown-outcome input blindly.
