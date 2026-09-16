# Capability checklist — BotDesk Windows control

Contract: `1.1.0` · Branch: `claude/windows-control-expand` · Review: automated on Linux (no live AlienAdam hardware)

Legend: **I** implemented · **V** verified (automated or real) · **R** remaining · **U** unverified on this hardware

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
| Focus approved window | I | U | Automated: explicit `botdesk_focus` restores stored HWND/PID only, `focus-refused` message, sensitive post-check. Live `SetForegroundWindow` still U |
| Click / double / right | I | U | |
| Move cursor | I | U | |
| Drag paths | I | prior | |
| Type text | I | prior | |
| Keys incl. E/WASD/CTRL+C/V/S | I | U | Automated allowlist + MCP schema. Native `SendInput` still U |
| Scroll X/Y | I | U | |
| Clipboard read (redacted) / write | I | U | Automated redact + write bounds. Native clipboard still U |
| Recording start/stop | I | prior | |
| STOP → OFF → reject | I | prior | |
| STOP during held drag | I | U | Automated latch exists; live held-gesture still unproved |
| Full-desktop owner mode | R | | grant model not built |
| Launch approved apps | R | | |
| Window move/resize | R | | |
| File operations | R | | |
| Terminal execution | R | | explicit grant only |
| Multi-monitor capture | R | | list only |
| UAC bypass | — | — | will not implement |

## Acceptance matrix status

| Case | Status |
|---|---|
| Notepad type/save disposable | unverified this session |
| Browser nav/forms/scroll | unverified |
| Switch two approved apps | unverified |
| Clipboard transfer | unverified |
| Drag/resize/shortcuts | partial (drag prior; shortcuts schema-only) |
| Multi-monitor/DPI | monitors implemented; capture/scale unverified |
| Studio movement/menus/routes | parked; Morgan S-01 PASS earlier |
| STOP during held input | unverified |
| Disconnect/reconnect/expiry | prior partial |
| Credential persistence across restarts | doctor documents limitation; Grok file not durable |

## Automated check note (this review)

Linux `npm run check` covers unit/integration/MCP smoke. Native C# compile and live AlienAdam/Notepad/Studio sessions remain Unverified. A host portable build was **not** produced here.
