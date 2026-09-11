# BotDesk overnight push plan

Survey date: 2026-09-11. Tree surveyed: `2caa591` on default branch `codex/botdesk-v1`.

This is an honest plan for a Cursor overnight pass on the **public free companion** (`Adamdesgns/botdesk`). It is not a claim that BotDOOR Studio, Grok, or a phone on another network was re-verified tonight. Do not rotate tokens. Do not deploy the relay. Do not invent a verified Grok Studio run.

## 1. Current state

### What this repo is

BotDesk is the free Windows companion for BotDOOR: a local Electron host, a Cloudflare Worker relay, an owner phone page, and an MCP adapter. The product story is: the owner picks one allowed app window, arms a time-limited session, and an approved bot can screenshot/click/type inside that window only.

BotDOOR itself is Adam’s live private app (public posts on 2026-09-10 and 2026-09-11). **This repository is not that live binary.** It is the published development baseline.

### What works locally (as documented and as the code is written)

These are real, in-repo capabilities. They are **not** proof of an internet phone or an external Grok bot.

- **Host (Electron, Windows):** tray + local STOP, `Ctrl+Shift+F12`, remote-arm latch, in-memory target selection, Windows DPAPI `safeStorage` for pairing secrets, optional portable sign-in startup (off by default).
- **Guards:** allowlist is Edge, Chrome, Firefox, Notepad. Shells, editors, UAC, Windows Security, financial, and sign-in/password titles fail closed. Capture is selected-window only (`PrintWindow`), no desktop fallback.
- **Relay (implemented, Miniflare-tested):** hashed host/owner/bot credentials, one host socket, one bot lease, one in-flight command, Durable Object alarms for a single dated window (max 12 hours; GO LIVE default 8). Owner token in the phone URL fragment, sent as `Authorization`.
- **MCP adapter:** `@modelcontextprotocol/sdk` over **stdio only**. Eleven tools: `status`, `screenshot`, `snapshot`, `list_windows`, `click`, `type`, `key`, `scroll`, `record_start`, `record_stop`, `stop_all`.
- **Automated suite:** 73 `node --test` cases, including 14 real Miniflare HTTP/WebSocket tests and an SDK stdio smoke (`npm run check` = tests + Worker types + MCP smoke).
- **Windows evidence in `docs/VERIFICATION.md`:** Notepad fixture (capture, type, PAUSE/STOP lockout), packaged desktop UI, 390px phone-dashboard smoke, synthetic WebM, portable launch. That document is the last claimed Windows pass; this Linux survey did not repeat it.
- **This survey’s `npm test` on Linux Node 22.14:** 68 passed, 1 skipped (native C# compile), and `test/policy.test.mjs` failed to load (`ERR_UNKNOWN_FILE_EXTENSION` for `relay/src/policy.ts`). The four policy cases were not executed here. Overnight agents should re-run `npm run check` on the Windows baseline, not treat this Linux import failure as a new product bug unless it also fails on Windows.

### What is undeployed / not live

| Surface | Status in this tree |
| --- | --- |
| Cloudflare Worker `botdesk-relay` | Code + local Miniflare only. `wrangler.jsonc` exists. No workers.dev hostname, no release, no pairing. |
| Remote phone dashboard | HTML is real; it cannot reach a PC until an HTTPS relay is deployed and provisioned. |
| External bot / Grok | MCP env (`BOTDESK_RELAY_URL`, `BOTDESK_HOST_ID`, `BOTDESK_BOT_TOKEN`) has nothing live to call. |
| GitHub Releases / signed exe | None. Portable build is unsigned `BotDesk-0.1.0-portable.exe` when built on Windows. |
| Permanent startup | Owner checkbox only; build process does not enable it. |
| Recurring daily schedule | Not implemented (one dated window). |

README, SETUP, ARCHITECTURE, and VERIFICATION all already say the relay is not deployed and local simulation is not a phone-controlling-a-desktop proof. Believe them.

### GitHub and last push

| Fact | Value |
| --- | --- |
| Repo | `Adamdesgns/botdesk` (public) |
| Default branch | `codex/botdesk-v1` (only branch) |
| HEAD | `2caa591` — *Build BotDesk host with phone schedules and guarded bot controls* |
| Author date | 2026-09-08 19:31 -0500 |
| `pushed_at` | 2026-09-09T00:47:39Z (same window as repo create) |
| Open / closed PRs | **None** |
| Open / closed issues | **None** |
| Releases | **None** |

There is no backlog in this repo to reconcile. Overnight work should open focused PRs against `codex/botdesk-v1`.

### Last claimed verification vs this survey

`docs/VERIFICATION.md` remaining pilot checks are still open:

1. Deploy and privately provision an HTTPS relay, then pair one host and phone.
2. One real bot runner + dedicated browser profile (click/scroll, **focus changes**, lock screen, recording).
3. Real phone from another network with the page closed.
4. Clean Windows account / unsigned portable install.

This survey adds code-level confirmation of the four fleet gaps below. It does **not** close those pilot checks.

## 2. Known live gaps (Adam’s fleet) mapped onto this tree

These came in as live BotDOOR/Grok lessons. They are **not** filed as GitHub issues here. Each one already has a corresponding hole or trap in `botdesk`.

### A. No focus/activate for the approved window

**Fleet symptom:** a covering window defeats the bot. Adam’s 2026-09-10 post: the bot could not move the rectangle sitting in front of the browser.

**In this repo:**

- Native `focus` exists (`SetForegroundWindow` in `scripts/windows-helper.ps1`) and is used on **local GO LIVE** and **remote arm**.
- `focus` is **not** in `shared/protocol.mjs` `COMMANDS`, not in the Worker command set, not in MCP `TOOL_DEFS`.
- After arm, every capture/input requires the approved HWND+PID to **already** be foreground (`guard.mjs` → `target-changed`). `list_windows` is read-only and cannot retarget or raise a window.
- Helper `Focus` is `SetForegroundWindow` only (no restore). That API is unreliable when BotDesk is not the foreground process.
- Controller treats `executor.focus` as optional. Simulated tests can arm without ever calling it.

If another window steals focus during a live session, the bot has no legal tool to recover. Screenshot and click fail closed. That is the same class of failure as the live BotDOOR story.

### B. Phone ScrollingFrame: touch vs mouse

**Fleet symptom:** Roblox `ScrollingFrame` (and similar) often moves with one pointer type and ignores the other. Adam is using BotDOOR to test Roblox games from the phone.

**In this repo, two different surfaces:**

1. **Owner phone page** (`relay/src/dashboard.ts`) is **HTML**, not a Roblox `ScrollingFrame`. Controls use `onclick` only. Layout smoke is Playwright/Electron at 390px, mouse clicks, no horizontal overflow. There is no touch/`pointerup` coverage, no `touch-action`, and `datetime-local` on iOS/Android is unproven. A real-phone pass is also blocked by the undeployed relay.
2. **Bot scroll** (`windows-helper.ps1` `Scroll`) moves the cursor to the window center and sends **mouse wheel** (`MOUSEEVENTF_WHEEL`). It does not emit touch, flick, or drag. A Roblox `ScrollingFrame` that only listens to touch/drag will not move. PAGEUP/PAGEDOWN exist as keys; they are a different contract and may still miss canvas-style frames.

Do not build a Roblox phone UI in this repo tonight. Do not claim the HTML dashboard “is” a `ScrollingFrame`.

### C. Private bot token store can wipe

**Fleet symptom:** a private bot-token store (Grok runner UI or a local pairing form) can replace a good token with empty.

**In this repo:**

- The MCP adapter has **no** token file. It reads `BOTDESK_BOT_TOKEN` from the process environment. If Grok’s dynamic/private store wipes, the stdio child starts with an empty env and every tool fails.
- The host **does not use** `botToken` to connect (`relay-client.mjs` needs `relayUrl`, `hostId`, `hostToken`; owner calls use `ownerToken`).
- The host UI still has a Bot token field. `ConfigStore.save` writes `''` for any secret that is not the `'saved'` sentinel. `FILL PAIRING SETTINGS` copies empty strings. Saving after that **persists a wipe**.
- `save-config` then emergency-stops and reconnects. Wiping host/owner the same way takes the PC offline until pairing is pasted again.
- Tests cover the `'saved'` happy path. They do **not** cover “empty field must not destroy a stored secret.”

SETUP already says the host does not need `botToken`. The form still invites storing and clearing it.

### D. Grok dynamic MCP often “Not connected”; SDK stdio works

**Fleet symptom:** Grok’s dynamic/remote MCP connector shows Not connected. The working path is a local stdio process using the official SDK.

**In this repo:**

- `mcp/server.mjs` is SDK + `StdioServerTransport` only. No Streamable HTTP, SSE, or dynamic MCP server.
- `scripts/mcp-smoke.mjs` / `npm run mcp:smoke` already prove: SDK client → stdio child → loopback HTTP fixture (not a desktop, not Grok).
- SETUP’s JSON example is already the stdio `command` / `args` / `env` shape.

Overnight work should **document and keep** that path, not add a second transport to chase Grok’s dynamic connector.

## 3. Ranked overnight tasks (max 5)

Do these in order. Stop after five. Prefer a small green PR over a half-finished activate tool plus a deploy.

### 1. Guarded activate for the already-approved window — **M**

**Why first:** this is the live blocker and a hard fail-closed hole. Arm-time focus is not enough.

**Do:**

- Add one command (name it `focus` or `activate`; pick one and use it in protocol, Worker, guard, MCP).
- Raise **only** the in-memory approved HWND+PID. No retarget, no other process, no BotDesk window, no allowlist expansion.
- Native path: restore if minimized, then foreground; fail closed on `focus-refused` / identity mismatch. Do not add unbounded `AttachThreadInput` loops or fake key events that look like a new input injector.
- Decide snapshot rules explicitly: activate may need a fresh snapshot afterward; do not let a pre-activate snapshot authorize a click on a new z-order.
- Tests: protocol/MCP/Worker accept the command; guard rejects wrong HWND/PID and unarmed/off; controller recovers from a simulated focus steal; empty/`saved` pairing behavior unchanged.

**Success:**

- A bot can call the new tool, the approved window is foreground, then screenshot/click work again.
- There is still no tool to select a different window.
- `npm run check` green. Windows helper still compiles (`windows.test.mjs` compile-only on Windows).
- No claim of a Grok Studio run unless Adam actually runs one and writes it down.

### 2. Stop empty saves from wiping pairing secrets — **S**

**Why:** one Save Settings click can destroy bot (and host/owner) tokens. That is a pairing-break, not a UX nit.

**Do:**

- Empty / omitted secret on save = keep existing ciphertext. `'saved'` keeps current behavior.
- Host does not need `botToken`. Prefer: stop collecting it in the host form, or treat it as optional and never write blank over ciphertext.
- Add a test: store three tokens, save `{ botToken: '' }` (and a FILL-empty-then-save case), assert host/owner/bot ciphertext unchanged unless the user pastes a **new** valid token.
- Do not change token format, hashing, or provisioning.

**Success:**

- Saving settings, toggling remote-arm, or importing a pairing JSON that omits `botToken` cannot blank a stored secret.
- Host still connects with only `relayUrl` + `hostId` + `hostToken` (+ `ownerToken` for local GO LIVE).
- MCP token remains env-only. No new token file in the repo or userData “for convenience.”

### 3. Lock docs and runner notes to SDK stdio — **S**

**Why:** the working Grok path is already what this repo ships. A second transport tonight will not make dynamic MCP reliable.

**Do:**

- State in SETUP/README: Grok **dynamic MCP is unsupported** here; “Not connected” is a known runner failure; use `node mcp/server.mjs` via SDK stdio with the three env vars.
- Keep `npm run mcp:smoke` as the connectivity proof.
- Do not add HTTP MCP, OAuth, or a hosted MCP URL.

**Success:**

- A Grok/Codex owner can copy one stdio snippet and see why dynamic MCP is the wrong ticket.
- Tool count stays 11 until task 1 lands, then 12 with `focus`/`activate` only.
- No Studio screenshot attached unless it is a real one from Adam.

### 4. Phone HTML touch vs mouse (not a Roblox frame) — **S**

**Why:** fleet pain is touch-vs-mouse. This companion’s phone page is HTML and has only mouse smoke.

**Do:**

- Bind owner actions to `click`/`pointerup` without double-firing. Buttons must not lose the tap to page scroll (`touch-action` on the control row is enough).
- Keep the 390px no-horizontal-overflow smoke.
- If Playwright in this environment can emit a touch tap, add one GO LIVE / STOP path. If it cannot, say so in the PR; do not fake a device farm.
- Document that `botdesk_scroll` is **mouse wheel**, so Roblox `ScrollingFrame` may ignore it. Optional follow-up (not required tonight): one bounded drag-scroll experiment behind the same target/point checks. That is a new input modality — treat it as out of scope unless task 1 is done and the change is tiny.

**Success:**

- `scripts/phone-dashboard-smoke.mjs` still passes.
- PR text states what was not run (real iPhone/Android, deployed relay).
- No Roblox UI added to the Worker.

### 5. Focus-steal regression + honest VERIFICATION leftover list — **S**

**Why:** task 1 is easy to “finish” without proving the steal path, and VERIFICATION still reads like a closed baseline.

**Do:**

- Controller test: armed → foreign foreground → input `target-changed` → activate approved → screenshot/input allowed.
- Guard test: activate never bypasses allowlist, password, integrity, or latch.
- Update `docs/VERIFICATION.md` leftovers: activate/focus-steal, token non-wipe, stdio-only MCP, phone touch, **no** deployed relay, **no** Grok Studio claim.

**Success:**

- The steal path is red without task 1 and green with it.
- VERIFICATION does not grow a fake “verified on Grok” bullet.

## 4. Non-goals tonight

- Deploy `botdesk-relay`, set `PROVISIONING_SECRET`, or pair a real phone.
- Rotate, print, or commit host/owner/bot/provisioning tokens.
- Invent or attach a verified Grok Studio / dynamic-MCP session.
- Dynamic MCP, Streamable HTTP, SSE, or a hosted MCP URL.
- Daily recurring schedules, command queues, multi-window control, or unattended target restore after host/Windows restart.
- Expanding the allowlist (Roblox Player/Studio, Office, Discord, VS Code). Studio titles can look like “developer tools” and are a security change, not a drive-by.
- Wake-from-sleep, lock-screen bypass, UAC, elevated windows, full-desktop capture, clipboard, or richer key chords.
- Signed Windows builds, store packaging, or turning on permanent startup by default.
- Porting BotDOOR’s private UI into this repo.
- Touch/drag injection for Roblox unless task 1 is done and the patch stays inside existing point checks.
- “Fix Grok’s token store” inside xAI. Document the wipe; keep BotDesk env-based.

## 5. Risks

### Security

- **Activate/focus:** a bot-callable raise is still remote input. If it can take any HWND, it is a new primitive. Bind to the owner-selected handle+PID only. Prefer restore+`SetForegroundWindow` and fail closed over thread-attach tricks.
- **Scroll/touch follow-up:** drag or synthetic touch is closer to general input injection. Stay inside the selected window and existing `PointCheck`.
- **Allowlist creep:** adding Roblox Studio tonight is a policy change. Do not hide it inside a focus PR.
- **Phone page:** owner token stays in the fragment and `Authorization` header. Do not move it to query string, localStorage experiments, or a second cookie scheme.
- **Relay trust:** screenshots already transit the Worker. Deploying it is an owner decision with a real attack surface (provisioning secret, Durable Object, billing for a live socket). Out of scope.

### Breaking host pairing

- Token regex, `'saved'` sentinel, DPAPI prefix, and “unencrypted secrets rejected” are a load-bearing trio. A wipe “fix” that writes plaintext, accepts short tokens, or deletes `config.json` on decrypt error will unpair the PC.
- `save-config` already emergency-stops and reconnects. After a wipe bug, reconnect fails closed (good) but the owner is stuck until they re-paste pairing (bad). Preserve ciphertext.
- Host must keep working **without** `botToken`. Requiring it to save or connect will break the documented pairing split (bot token lives with the MCP runner).
- Provisioning is one-shot per host ID. Do not “repair” a wipe by calling provision again against a live relay.
- MCP tool rename/add is a runner-config change. Add `botdesk_focus` / `botdesk_activate`; do not rename the existing eleven tools.

### Process

- `npm run check` before commit. Build the portable exe only on Windows after checks, and only if an overnight PR actually needs a binary.
- This survey ran on Linux against the git tree. It did not run Electron desktop smokes, native Notepad control, or `wrangler deploy`.

## Order of operations for overnight agents

1. Branch from `codex/botdesk-v1`. Do not rotate secrets. Do not deploy.
2. Task 2 first if pairing-wipe is cheaper and unblocks local host use; otherwise task 1 first (recommended) because it is the live control failure.
3. Tasks 3–5 can share a docs/test PR if 1–2 are already up.
4. Each PR: `npm run check`, honest VERIFICATION leftovers, no Studio folklore.
5. Leave deployment and permanent startup for Adam.
