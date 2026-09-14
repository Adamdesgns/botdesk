# Local verification

This is a development baseline. The relay has not been deployed or paired, and remote phone access is not live. No real-phone or external-bot pilot is claimed.

## Verified on Windows

- 73 automated tests passed, including 14 real Miniflare HTTP/WebSocket relay tests; generated Worker types, TypeScript and the MCP stdio smoke passed.
- A scheduled owner window automatically started and stopped the real host controller and relay client with a simulated native executor.
- An owned Notepad fixture passed real target capture, typing verified through Windows UI Automation, PAUSE denial, emergency STOP denial and rearm lockout. The fixture was closed afterward.
- Source and packaged desktop UI passed OFF startup, stop/unlock, target-required denial, disabled startup/remote defaults, actual Windows-encrypted credential storage and sandboxed renderers.
- The phone dashboard passed at 390px: no horizontal overflow, next6AM–6PM defaults, timezone, eight-hour access, screenshot preview, pause, invalid-duration rejection, scheduled countdown and cancellation.
- Synthetic frames produced a playable WebM. This proves the recorder pipeline, not smooth or real-browser video.
- The portable launcher passed an ordinary launch without debugger or GPU flags, and the bundled app passed its UI checks and graceful quit.
- Runtime dependency audit reported zero vulnerabilities. The development-only Miniflare/Sharp chain reported three high-severity advisory entries; those packages are not the shipped host runtime.

Screenshots shown in the README contain only synthetic, unconfigured application state. Raw desktop captures, local reports, process identifiers and machine paths are excluded from publication.

## This change (focus + empty-save)

Automated host, guard, config, MCP stdio and local Miniflare relay tests cover `botdesk_focus` (restore only the stored HWND/PID; fail closed on `focus-refused`) and blank Save Settings leaving prior pairing secrets. Linux CI imports `relay/src/policy.ts` with Node's `--experimental-strip-types` flag; native helper compile remains Windows-only and is skipped here. These tests do not call real `SetForegroundWindow` or prove an HTTPS phone/bot pilot. Confirm on a signed-in Windows desktop: arm → steal focus → `botdesk_focus` → screenshot/click works again; Save with a blank bot token leaves the prior token.

## This change (setup and troubleshooting audit)

Verified on Linux in this branch's environment, against the real code paths:

- `npm run check`: all Node tests pass (the native C# compile test is skipped off Windows), Worker types and TypeScript pass, MCP stdio smoke passes. New tests: `test/relay-status.test.mjs`, `test/diagnostics.test.mjs`, additions to `test/windows.test.mjs`, `test/config.test.mjs`, `test/mcp.test.mjs` and a real-Miniflare integration test that connects `RelayClient` with a wrong token, a duplicate host, an unreachable port and no configuration and asserts the reported reasons.
- The real Electron host (`host/main.mjs`) was launched under Xvfb via Playwright with a harness that enables Electron's plaintext `safeStorage` backend (Linux has no DPAPI; the harness lives outside the repository). Observed: unconfigured card text; save-time rejection of a short token; **Rejected by relay (HTTP 401)**, **Relay unreachable (ECONNREFUSED)**, **Securely connected**, **Another copy is connected (HTTP 409)** and automatic recovery after the other copy quit; COPY DIAGNOSTIC REPORT produced a JSON report on the clipboard and in `logs/`, containing none of the three pairing tokens or the home path. Launching without a usable keyring exited with code 0 and wrote `logs/startup-errors.log`.
- `scripts/provision.mjs` was run against the local Wrangler relay through the success path and eleven failure paths (existing file, missing folder, missing/short secret, wrong secret, bad or non-HTTPS URL, refused connection, DNS failure).
- The existing phone-dashboard smoke passed on Linux (patched only for the Electron binary path), and a second run against the real local relay with a real `HostController` showed the explained alerts for `remote-arm-disabled`, `select-a-window-first` and an `unauthorized` link.

Not verified here and needing a signed-in Windows desktop: the startup error dialog rendering, `helperSelfTest()` against real PowerShell/.NET and policy, REFRESH WINDOWS, the tray, the global shortcut, `npm run build:win`, the packaged `app.asar.unpacked` helper path, `scripts/desktop-smoke.mjs` and `scripts/portable-launch-smoke.ps1`. A real phone on another network, a real bot runner and a second PC were simulated locally only. See `docs/setup-audit.md` for the problem list and acceptance criteria.

## Reproduce

Run from a Windows clone after installing dependencies:

```powershell
npm ci
npm run check
node scripts/desktop-smoke.mjs
node scripts/phone-dashboard-smoke.mjs
node scripts/recording-smoke.mjs
npm run build:win
node scripts/desktop-smoke.mjs --packaged
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/portable-launch-smoke.ps1
```

The separate native-control smoke opens a new Notepad test document and sends real input only to that fixture. Run it deliberately on a test desktop. Modern Notepad can restore inactive tabs even into a new process; the test keeps images in memory and does not save raw desktop screenshots.

Use a normal user execution environment for GUI verification. A restricted sandbox test encountered an unusable GPU subprocess; ordinary packaged startup succeeded. The packaged app also includes guarded renderer cleanup and a synchronous no-recording quit path.

## Remaining pilot checks

1. Deploy and privately provision an HTTPS relay, then pair one prepared host and owner phone.
2. Test one bot tool runner and a dedicated browser profile: click/scroll coordinates, `botdesk_focus` after another window steals foreground, locked-screen behavior, actual recording and cancellation.
3. Verify a real phone from another network: schedule, STOP, disconnect/reconnect and expiry with the phone page closed.
4. Verify installation and behavior on a clean Windows account/device. The local portable build is unsigned.

Do not treat local tests as proof of unattended production readiness.
