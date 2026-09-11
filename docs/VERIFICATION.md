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
2. Test one bot tool runner and a dedicated browser profile: click/scroll coordinates, focus changes, locked-screen behavior, actual recording and cancellation.
3. Verify a real phone from another network: schedule, STOP, disconnect/reconnect and expiry with the phone page closed.
4. Verify installation and behavior on a clean Windows account/device. The local portable build is unsigned.

See [OVERNIGHT-PUSH-PLAN.md](OVERNIGHT-PUSH-PLAN.md) for the 2026-09-11 code survey of live fleet gaps (no approved-window activate tool, phone touch vs mouse-wheel scroll, host bot-token wipe on empty save, Grok dynamic MCP). That survey did not deploy the relay or claim a Grok Studio run.

Do not treat local tests as proof of unattended production readiness.
