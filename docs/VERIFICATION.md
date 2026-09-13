# Local verification

This is a development baseline. The relay has not been deployed or paired, and remote phone access is not live. No real-phone or external-bot pilot is claimed.

## Verified on Windows

- 80 automated tests passed, including 14 real Miniflare HTTP/WebSocket relay tests; generated Worker types, TypeScript and the MCP stdio smoke passed.
- A scheduled owner window automatically started and stopped the real host controller and relay client with a simulated native executor.
- An owned Notepad fixture passed real target capture, typing verified through Windows UI Automation, PAUSE denial, emergency STOP denial and rearm lockout. The fixture was closed afterward.
- Source and packaged desktop UI passed OFF startup, stop/unlock, target-required denial, disabled startup/remote defaults, actual Windows-encrypted credential storage and sandboxed renderers.
- The synthetic onboarding GUI passed 22 checks using the actual host HTML, renderer and preload: masked password-field pairing, invalid pairing rejection, cleared secret paste, readiness derived from saved settings, keyboard tabs, stable tab selection during status updates, countdown, pause and STOP, and STOP during a pending save. Layout checks passed at 980px, 760px and 490 × 380px. The smallest viewport tests CSS reflow, not native operating-system zoom. This fixture uses in-memory IPC and makes no real network requests or desktop-control calls.
- The phone dashboard passed at 390px: no horizontal overflow, next6AM–6PM defaults, timezone, eight-hour access, screenshot preview, pause, invalid-duration rejection, scheduled countdown and cancellation.
- Synthetic frames produced a playable WebM. This proves the recorder pipeline, not smooth or real-browser video.
- The portable launcher passed an ordinary launch without debugger or GPU flags, and the bundled app passed its UI checks and graceful quit.
- Runtime dependency audit reported zero vulnerabilities. The development-only Miniflare/Sharp chain reported three high-severity advisory entries; those packages are not the shipped host runtime.

Screenshots shown in the README come from synthetic first-run and phone dashboard fixtures. They do not show a live pairing. Raw desktop captures, local reports, process identifiers and machine paths are excluded from publication.

## Reproduce

Run from a Windows clone after installing dependencies:

```powershell
npm ci
npm run check
node scripts/desktop-smoke.mjs
node scripts/onboarding-smoke.mjs
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
5. On next AlienAdam boot, run the disposable Notepad control-surface list in [NOTEPAD-LIVE.md](NOTEPAD-LIVE.md). Until that folder exists with `RESULT.txt` = `PASS`, live rows stay Unverified. Owner-phone Show/Copy (Safari second-tap) is a separate [PR #5](https://github.com/Adamdesgns/botdesk/pull/5) deploy decision, not that Notepad run.

Do not treat local tests as proof of unattended production readiness.
