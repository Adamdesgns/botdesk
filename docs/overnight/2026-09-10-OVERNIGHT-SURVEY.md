# Overnight survey — 2026-09-10

Survey of public `Adamdesgns/botdesk` (`codex/botdesk-v1` @ `2caa591`) for a shippable Bot Door night. Written 2026-09-11. **Plan only.** No open GitHub issues or PRs. Single commit: *Build BotDesk host with phone schedules and guarded bot controls* (2026-09-09).

## 1. Current state

BotDesk is a local development baseline: Windows host, Cloudflare Worker relay, owner phone page, and an 11-tool MCP adapter. Host, schedule, STOP, pairing, DPAPI config, selected-window guards, and Miniflare/controller tests are implemented. The relay is **not deployed**, pairing is **not in the package**, and remote phone/bot access is **not live**. README, SETUP, ARCHITECTURE, and VERIFICATION all say local simulations are not a phone controlling a real desktop. Default allowlist is Edge, Chrome, Firefox, and Notepad only.

## 2. What's already ~done vs missing for a shippable Bot Door night

**~Done (in-repo, locally tested)**

- Host: tray, overlay, pairing paste/save, target pick, local GO LIVE / PAUSE / STOP, `Ctrl+Shift+F12`, lock/suspend latch, optional sign-in startup (portable only; off by default).
- Owner windows: GO LIVE (default 8h, cap 12h), one dated phone schedule, Durable Object alarms, reconnect-inside-window, phone STOP/PAUSE cancel the saved window.
- Bot surface: `status`, `screenshot`, `snapshot`, `list_windows`, `click`, `type`, `key`, `scroll`, `record_start`/`stop`, `stop_all`. One bot lease, one in-flight command, 15s single-use snapshot, 20s command deadline.
- Native helper: selected-window PrintWindow capture, UIA snapshot, click, Unicode type, allowlisted keys, center-wheel scroll, `focus` **as a helper action**.
- Guards: allowlist + deny titles, integrity/desktop/password fail-closed, no clipboard/shell shortcuts. Relay stores token hashes; host encrypts pairing with Windows `safeStorage`.
- Verification claimed on Windows: 73 automated tests (14 Miniflare), Notepad fixture, packaged UI, 390px phone page, synthetic WebM. `npm run check` = tests + Worker types + MCP stdio smoke.

**Missing / blocking a real night**

| Gap | Verified in code? |
| --- | --- |
| HTTPS relay deploy + private provision + phone pair | Yes — docs and `wrangler.jsonc`; owner spend/publish |
| Real-phone / external-bot / clean-PC pilot | Yes — VERIFICATION remaining items 1–4 |
| Bot cannot recover when focus is stolen | Yes — see task 1 |
| No drag; scroll is wheel-at-center; no E/WASD/Space VKs | Yes — see task 3. Studio ScrollingFrame/touch is likely game-side |
| Allowlist excludes Studio/games | Yes — `DEFAULT_APP_ALLOWLIST`; do not invent new apps tonight |
| `botdesk_list_windows` returns only the current foreground | Yes — `DesktopExecutor.run('list_windows')` |
| Unsigned portable exe; target lost on host restart | By design / owner release |
| Grok-box bot-token wipe | **Not this repo** — MCP reads env only; host DPAPI is Windows `config.json` |

## 3. Ranked overnight tasks (max 5)

### 1. Guarded focus/activate for the already-approved window — **M**, risk medium

**Why.** Live-ops hypothesis holds. Native `Focus` exists (`scripts/windows-helper.ps1` `Focus`, `host/windows.mjs`) and runs at **arm only** (`host/main.mjs` local GO LIVE, `host/controller.mjs` `applyOwnerState`). There is no `focus`/`activate` command in `shared/protocol.mjs`, MCP `TOOL_DEFS`, or relay `COMMANDS`. After arm, every command requires the approved HWND to already be foreground (`validateCommand` → `target-changed`; helper `target-not-foreground`). A toast, overlay, or other window leaves the bot stuck. Native errors collapse to `native-action-blocked`.

**Files.** `mcp/server.mjs`, `shared/protocol.mjs`, `host/guard.mjs`, `host/controller.mjs`, `host/executor.mjs`, `relay/src/index.ts`, `scripts/windows-helper.ps1`, `test/mcp.test.mjs`, `test/controller.test.mjs`, `scripts/mcp-smoke.mjs`.

**Keep bounded.** Re-foreground **only** the in-memory approved target. Do not let the bot pick a window. Re-run existing sensitive/integrity checks. Expect Windows to refuse `SetForegroundWindow` when BotDesk is not allowed to steal focus.

### 2. Owner gate: deploy HTTPS relay and provision one PC — **S** (ops), risk spend/publish (Adam)

**Why.** Without this, there is no Bot Door night: phone and MCP cannot reach the PC. Code is present; production Worker and secrets are not.

**Area.** `relay/wrangler.jsonc`, `docs/SETUP.md`, `scripts/provision.mjs`. Do **not** deploy from this survey.

### 3. Host-side input gaps only if tonight's allowlisted window needs them — **S** doc / **M** code, risk medium

**Why.** Verified host limits (do not treat as Studio bugs):

- No drag / mouse-down-hold. `Click` is immediate down+up. A future drag would hit helper timeout **8s** (`host/windows.mjs`) and command deadline **20s** (controller + relay). Snapshot is consumed on the first input.
- `SAFE_KEYS`: ENTER, TAB, ESCAPE, BACKSPACE, DELETE, arrows, HOME/END, PAGEUP/PAGEDOWN, CTRL+A, CTRL+Z, ALT+LEFT/RIGHT, F5. **No E, W, A, S, D, Space.**
- `type` emits **Unicode** (`KEYEVENTF_UNICODE`). Browsers/Notepad accept it; many games ignore it for movement.
- `scroll` is one wheel event at the **window center**, `|deltaY| ≤ 1200`, no point, no `deltaX`.

Phone ScrollingFrame / touch-drag vs mouse in a Studio emulator is still most likely **game-side**. Host cannot emit touch. Do not add Studio (or any new exe) to the allowlist tonight.

**Files.** `mcp/server.mjs` `keys`, `host/guard.mjs` `SAFE_KEYS`, `scripts/windows-helper.ps1` `Click`/`Press`/`Scroll`/`TypeText`.

### 4. One real Windows pilot of the 11 tools after (2) — **M**, risk environment

**Why.** VERIFICATION remaining checks 2–3 are the ship gate: dedicated browser profile, click/scroll/focus, locked-screen STOP, recording, phone closed-page schedule/STOP/reconnect/expiry.

**Area.** `scripts/native-control-smoke.mjs`, `mcp/server.mjs`, `docs/VERIFICATION.md`. This Linux agent cannot prove UIA, GPU capture, or another-network phone.

### 5. Confirm Grok-box token wipe is runner env, not host store — **S**, risk low

**Why.** Live-ops wipe is a **hypothesis about the bot runner**, not BotDesk persistence. MCP (`mcp/server.mjs`) uses `BOTDESK_RELAY_URL`, `BOTDESK_HOST_ID`, `BOTDESK_BOT_TOKEN` from the process environment and does not write them. Host pairing lives in Windows userData `config.json` under DPAPI (`host/config-store.mjs`). Do not add a token vault to this repo.

**Area.** `docs/SETUP.md` “Connect the approved bot”; owner’s private Grok MCP env. Re-paste bot token if the runner wiped it.

## 4. Explicit non-goals tonight

- Deploy, paid Cloudflare, Worker secrets, public DNS, or shipping `dist/` — Adam owns spend/publish.
- Permanent / default sign-in startup.
- New product surface: Studio/game allowlist, multi-window, filesystem/shell, JS in the page, daily recurring schedules, full-desktop capture, signed exe.
- Grok-box secret persistence or a BotDesk-side bot-token store.
- Touch / ScrollingFrame / emulator gesture fidelity.
- Large drag/gesture engine or holding a snapshot across a long mouse-down.
- Changing fail-closed STOP, latch, sensitive-window, or UAC/lock-screen rules.
- Claiming unattended production readiness from local tests.

## 5. Definition of done for the night

**This survey is done when** this document is on a PR against `codex/botdesk-v1`.

**A useful code night (optional, after this PR) is done when** at most task 1 (guarded focus) is implemented with tests, `npm run check` is green on Windows, and no allowlist or new-app scope landed. Rebuild the portable artifact only if host/MCP/helper changed.

**A shippable Bot Door night additionally requires Adam to:** deploy the HTTPS relay, provision one host, put bot env on the runner, leave Windows signed-in/awake with BotDesk running and an **already-allowed** window selected, and run the phone + one-bot pilot in VERIFICATION items 1–3. Until those owner steps happen, the product remains a local baseline.
