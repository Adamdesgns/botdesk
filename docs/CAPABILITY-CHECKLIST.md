# Capability checklist — BotDesk Windows control

Contract: `1.1.0` · Branch: `claude/windows-control-expand`

Legend: **I** implemented · **V** verified (automated or real) · **R** remaining · **U** unverified on this hardware

| Capability | I | V | Notes |
|---|---|---|---|
| Credential doctor (no secret leak) | I | V | `scripts/credential-doctor.mjs` |
| Env-first MCP wrapper | I | U | `mcp/run-with-secret.sh` — Morgan must install |
| Distinguishable auth/offline/expiry errors | I | V | unit tests |
| Selected-window screenshot | I | prior | JPEG for large windows added |
| Screenshot transport (large Studio) | I | U | JPEG + size guards; needs live re-proof |
| UIA snapshot | I | prior | |
| List eligible windows (native) | I | U | unstubbed executor |
| List monitors | I | U | |
| Focus approved window | I | U | |
| Click / double / right | I | U | |
| Move cursor | I | U | |
| Drag paths | I | prior | |
| Type text | I | prior | |
| Keys incl. E/WASD/CTRL+C/V/S | I | U | |
| Scroll X/Y | I | U | |
| Clipboard read (redacted) / write | I | U | |
| Recording start/stop | I | prior | |
| STOP → OFF → reject | I | prior | |
| STOP during held drag | I | U | still unproved live |
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
| Drag/resize/shortcuts | partial (drag prior) |
| Multi-monitor/DPI | monitors implemented; capture unverified |
| Studio movement/menus/routes | parked; Morgan S-01 PASS earlier |
| STOP during held input | unverified |
| Disconnect/reconnect/expiry | prior partial |
| Credential persistence across restarts | doctor documents limitation; Grok file not durable |
