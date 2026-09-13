# Capability checklist — BotDesk Windows control

Contract: `1.1.0` · Branch: `claude/windows-control-expand` · Review: automated on Linux (no live AlienAdam hardware)

Legend: **I** implemented in this tree · **V** verified by **CI / automated tests only** on this review · **R** remaining / not built · **U** unverified on **live** AlienAdam hardware

**CI is not a live PASS.** A `V` or “prior” mark means Linux `npm run check`, unit/integration/MCP smoke, or an earlier named check in Notes — not a completed [NOTEPAD-LIVE.md](NOTEPAD-LIVE.md) run. Leave **U** rows **U** until Adam/Morgan record `evidence/notepad-live-*` with `RESULT.txt` = `PASS`. This docs update does not flip any live row.

Live Notepad control-surface steps (screenshot, click, type, `botdesk_focus` after steal, STOP mid-drag, `mode=off` + rejected follow-up) are specified in [NOTEPAD-LIVE.md](NOTEPAD-LIVE.md). Studio/GPU remains [STUDIO-TEST.md](STUDIO-TEST.md). Owner-phone Show/Copy Safari second-tap is [PR #5](https://github.com/Adamdesgns/botdesk/pull/5), not this checklist.

| Capability | I | V | Notes |
|---|---|---|---|
| Credential doctor (no secret leak) | I | V | Automated: `scripts/credential-doctor.mjs` reports presence only; fixture tokens never appear in output |
| Env-first MCP wrapper | I | V | Automated: `mcp/run-with-secret.sh` prefers env, file fallback, exit `2` on `credential-missing`. Live Morgan install still required |
| Distinguishable auth/offline/expiry errors | I | V | unit tests (`test/errors.test.mjs`) |
| Selected-window screenshot | I | prior | JPEG for large windows added; PNG/JPEG `toolContent` schema checked in CI |
| Screenshot transport (large Studio) | I | U | Automated: JPEG magic + `capture-too-large` size guard. Live Studio/GPU re-proof still required |
| UIA snapshot | I | prior | |
| List eligible windows (native) | I | U | unstubbed executor; native compile skipped on Linux |
| List monitors | I | U | Automated: armed-only, no foreground required, owner preview allowed, relay allowlist. Native `Screen.AllScreens` still U. Helper returns bounds/workingArea/primary/deviceName — not per-monitor scale |
| Focus approved window | I | U | Automated: explicit `botdesk_focus` restores stored HWND/PID only, `focus-refused` message, sensitive post-check. Live steal + recovery still U — [NOTEPAD-LIVE.md](NOTEPAD-LIVE.md) step 4 |
| Click / double / right | I | U | Live click still U — [NOTEPAD-LIVE.md](NOTEPAD-LIVE.md) step 2 |
| Move cursor | I | U | |
| Drag paths | I | prior | |
| Type text | I | prior | Prior = fixture/CI, not this-session live. Live type still U — [NOTEPAD-LIVE.md](NOTEPAD-LIVE.md) step 3 |
| Keys incl. E/WASD/CTRL+C/V/S | I | U | Automated allowlist + MCP schema. Native `SendInput` still U |
| Scroll X/Y | I | U | |
| Clipboard read (redacted) / write | I | U | Automated redact + write bounds. Native clipboard still U |
| Recording start/stop | I | prior | |
| STOP → OFF → reject | I | prior | |
| STOP during held drag | I | U | Automated latch exists; live held-gesture still unproved — [NOTEPAD-LIVE.md](NOTEPAD-LIVE.md) steps 5–6 |
| Full-desktop owner mode | R | | grant model not built |
| Launch approved apps | R | | |
| Window move/resize | R | | |
| File operations | R | | |
| Terminal execution | R | | explicit grant only |
| Multi-monitor capture | R | | list only |
| UAC bypass | — | — | will not implement |

## Acceptance matrix status

Live rows stay **unverified** until a dated Notepad folder exists. Do not treat this table as hardware PASS.

| Case | Status |
|---|---|
| Notepad type/save disposable | unverified this session — run [NOTEPAD-LIVE.md](NOTEPAD-LIVE.md) (untitled, do not save) |
| Browser nav/forms/scroll | unverified |
| Switch two approved apps | unverified |
| Clipboard transfer | unverified |
| Drag/resize/shortcuts | partial (drag prior; shortcuts schema-only) |
| Multi-monitor/DPI | monitors implemented; capture/scale unverified |
| Studio movement/menus/routes | parked; Morgan S-01 PASS earlier |
| STOP during held input | unverified — [NOTEPAD-LIVE.md](NOTEPAD-LIVE.md) step 5–6 |
| Disconnect/reconnect/expiry | prior partial |
| Credential persistence across restarts | doctor documents limitation; Grok file not durable |

## Automated check note (this review)

Linux `npm run check` covers unit/integration/MCP smoke. That is **CI only**. Native C# compile and live AlienAdam/Notepad/Studio sessions remain **Unverified**. A host portable NSIS pack was **not** produced here.

When the portable pack is stuck, the intended next-boot host is `dist\win-unpacked\BotDesk.exe` at **`ac8a3b1`**. Building the host does not update Morgan’s MCP adapter or the relay. See [NOTEPAD-LIVE.md](NOTEPAD-LIVE.md).
