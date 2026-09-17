# Live Notepad acceptance — PR #4 control surface

Public product name is Bot Door; code and this tree still say BotDesk.

This is the **next-boot** checklist for Adam/Morgan on AlienAdam. It is **not** a live hardware PASS. AlienAdam is expected to be shut down when this document is written. CI, Linux `npm run check`, and earlier synthetic/native smokes do **not** satisfy this list.

Related: [STUDIO-TEST.md](STUDIO-TEST.md) (opt-in Studio / GPU / drag contract — a different target). Studio rows stay parked unless a separate Studio run is scheduled.

**Do not merge, deploy, or rotate credentials from this checklist.**

## Current live test host

When the portable NSIS / `npm run build:win` pack is stuck, the current live test host is the **unpacked** Electron dir build from expand-line tip **`ac8a3b1`** (draft [PR #4](https://github.com/Adamdesgns/botdesk/pull/4)):

```
dist\win-unpacked\BotDesk.exe
```

Rebuild that tree on Windows with `npm run check` then `npm run build:dir`. Launch **outside Codex** so userData is `%LOCALAPPDATA%\BotDesk` ([CREDENTIALS.md](CREDENTIALS.md)).

A **host build alone does not update** Morgan’s MCP adapter or the Cloudflare relay. All three must carry contract `1.1.0` and the same command set (`focus`, `list_monitors`, `clipboard_*`, JPEG-sized frames, drag). Old relays reject new command names. Adapter files live in `mcp/` + `shared/`; they are not inside `BotDesk.exe`.

Confirm before arming:

| Piece | What to record (no secrets) | This run |
| --- | --- | --- |
| Host | Path + file time or SHA-256 of `BotDesk.exe`; source commit `ac8a3b1` | Unpacked exe above |
| MCP adapter | Checkout path + commit of `mcp/server.mjs` | Must match host contract; not updated by `build:dir` |
| Relay | Deployed Worker revision / last owner-approved deploy | Do **not** deploy from this checklist |

## Out of scope (do not run here)

- **Owner phone Show/Copy**, including the iPhone Safari second-tap Copy limitation on [PR #5](https://github.com/Adamdesgns/botdesk/pull/5). That is a **separate owner deploy decision** (relay + phone page). It is not a Notepad control-surface gate. See PR #5 `docs/SECURITY.md` (Owner bot-token retrieve) and the Safari note in that branch’s `docs/SETUP.md`.
- Studio / GPU viewport proof ([STUDIO-TEST.md](STUDIO-TEST.md)).
- Browser, clipboard transfer, multi-monitor capture, E/WASD in a game, disconnect/reconnect on a new relay, credential rotation.
- Saving the disposable Notepad document (modern Notepad can restore tabs; keep the fixture untitled and unsaved).

## Evidence folder

Keep captures **out of git** (`/evidence/` is gitignored). Do not commit screenshots, pairing JSON, tokens, owner links, or raw desktop dumps.

```
evidence/notepad-live-YYYYMMDD-HHMM/
  RESULT.txt
  01-screenshot.png          # or .jpg from the tool image
  02-after-click.png
  03-after-type.png
  04-focus-stolen.png        # approved Notepad no longer foreground
  05-after-focus.png         # after botdesk_focus
  06-drag-armed.png          # fresh frame used for the drag
  07-after-stop.png          # host UI or status after STOP (mode OFF)
  notes.txt                  # errors, HWND/PID/title only — no tokens
```

Use the local clock on AlienAdam. One folder per attempt. If a step fails, **stop**; do not continue and call the run PASS.

`RESULT.txt` first line must be exactly `PASS` or `FAIL`. Then one line per step below (`PASS`, `FAIL`, or `SKIP` only if the machine never reached that step).

## Preflight (required)

1. Windows signed in, awake, unlocked. No UAC, sign-in, or Security dialog in front.
2. Open a **new untitled** Notepad. Do not use a window that shows someone else’s tabs or saved files.
3. Start `dist\win-unpacked\BotDesk.exe` from `ac8a3b1` (or a rebuild of that commit). Keep access **OFF** until the target is selected.
4. Choose window → Refresh → select that Notepad. Unlock local STOP if latched.
5. Arm a short window (30 minutes is enough). Confirm host status is armed, expected title/PID, deadline set.
6. Morgan: existing adapter + bot credential (env/secret-request). Call `botdesk_status` first. Do not paste host or owner tokens into chat or the evidence folder.

Abort if the selected window is not the disposable Notepad.

## Steps

Take a **new** screenshot (or snapshot) before every input. One command consumes its `snapshotId`. Abort on rejection; inspect before any retry. Coordinates are pixels relative to that image (0,0 top-left of the selected window).

### 1. Screenshot

Call `botdesk_screenshot` (or `botdesk_snapshot` then screenshot). Save the image as `01-screenshot.png`.

| PASS | FAIL |
| --- | --- |
| Image is the selected untitled Notepad only (not full desktop, not BotDesk, not another app). Response includes `snapshotId`, width, height. | Blank/GPU-missing frame is acceptable **only** if Notepad chrome is still identifiable; a different window, a password/UAC surface, or a capture of the wrong PID/title is FAIL. |

### 2. Click

Click inside the Notepad **edit area** (not the title bar or tab strip) with `botdesk_click` and the fresh `snapshotId`. Then screenshot → `02-after-click.png`.

| PASS | FAIL |
| --- | --- |
| Caret is in the document body (or a visible click highlight). Same window identity. | Click rejected, hit the wrong chrome, or the target changed. |

### 3. Type

`botdesk_type` a unique disposable string such as `NOTEPAD-LIVE ac8a3b1 <HHMM>`. Do **not** save. Screenshot → `03-after-type.png`.

| PASS | FAIL |
| --- | --- |
| The typed string is visible in that untitled document. | Missing text, type rejected, or text landed in another window/tab. |

### 4. Focus steal + `botdesk_focus` recovery

Locally click another ordinary window (Explorer, a second Notepad, or a browser) so the **approved** Notepad is not foreground. Screenshot if still allowed (`04-focus-stolen.png`) or note `target-not-foreground` / auto-restore behavior. Then call **`botdesk_focus`** (not a different window picker). Screenshot → `05-after-focus.png`.

Read-path auto-restore on screenshot/snapshot is **not** a substitute for this step. The gate is the explicit `botdesk_focus` tool.

| PASS | FAIL |
| --- | --- |
| `botdesk_focus` succeeds and the **same** stored HWND/PID Notepad is foreground. Follow-up screenshot matches that window and still shows the typed string. | Tool picks a different window, bypasses UAC, or claims success while another app stays in front. **`focus-refused`** (Windows denied `SetForegroundWindow`) is a **documented fail-closed FAIL** for live recovery — record the error; do not retry by selecting a new target. |

### 5. STOP mid-drag

Fresh screenshot → `06-drag-armed.png`. Start `botdesk_drag` with 2–8 distinct points **inside** the edit area and `durationMs` **1500–2000** (long enough to interrupt). While the button is still down, press the host **STOP** button or **Ctrl+Shift+F12**. Do not use phone STOP for this row.

| PASS | FAIL |
| --- | --- |
| Gesture stops; mouse button is not left held. Host shows OFF / local stop latched. | Drag runs to completion after STOP, button stays down, or access remains armed. If helper release cannot be confirmed and the host locks OFF with unlock refused, treat as **safety lockout** (investigate locally; do not rearm remotely) — that is not a clean PASS. |

### 6. Prove `mode=off` + rejected follow-up

Call `botdesk_status`. Attempt one more `botdesk_screenshot` or `botdesk_type` with the last `snapshotId` (or a new one). Save host/status notes as `07-after-stop.png` / `notes.txt`.

| PASS | FAIL |
| --- | --- |
| Status `mode` is `off` (not `armed` / `running`). Follow-up input or capture is **rejected** (`not-armed` or equivalent). Local unlock is required before another arm. | Status still live, or the follow-up command succeeds. |

End with `botdesk_stop_all` only if STOP did not already run. Close the untitled Notepad **without saving**.

## Overall verdict

- **PASS** — every step 1–6 is PASS, evidence folder is complete, no secrets in the folder or in chat.
- **FAIL** — any step FAIL, missing evidence, wrong host/adapter/relay contract, or a non-Notepad target. Leave [CAPABILITY-CHECKLIST.md](CAPABILITY-CHECKLIST.md) live rows **Unverified**.

This document and CI staying green are **not** a live PASS. Only a completed `evidence/notepad-live-*` folder with `RESULT.txt` = `PASS` is live evidence for PR #4’s control surface.
