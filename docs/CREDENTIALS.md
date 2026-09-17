# Credential lifecycle and recovery

## Diagnosis (2026-09-10 / Claude takeover)

Grok's repeated empty bot-token store is **not** the Windows host losing DPAPI credentials.

Observed failure points:

1. **Morgan / Grok box (`box-secrets.json`)** — homemade JSON under `/home/box/sand-data/` has been recreated empty mid-session while the box stayed up. This is fragile and **not** a durable platform secret API.
2. **Host AppData virtualization** — when Codex (MSIX) launches BotDesk, pairing and `config.json` land under  
   `%LOCALAPPDATA%\Packages\OpenAI.Codex_*\LocalCache\...`  
   Ordinary Explorer launches look at the real profile AppData and appear unpaired.
3. **Host config vs pairing** — encrypted host config stores `hostToken`/`ownerToken`. `botToken` lives in the private pairing file for bot MCP use only.

Local doctor (no secret values):

```powershell
node scripts/credential-doctor.mjs
```

## Durable recovery (do not rotate unless authorized)

### Bot (Morgan)

1. Prefer Grok **secret-request** named `BOTDESK_BOT_TOKEN` (or MCP `env`) so new processes inherit the token.
2. Launch via `mcp/run-with-secret.sh`: env first, optional file fallback, exit `2` on `credential-missing`.
3. Never paste `hostToken` or `ownerToken` into the bot store.

### Host (AlienAdam)

1. Launch the host **outside Codex** when possible so userData is `%LOCALAPPDATA%\BotDesk`. If `dist\BotDesk-0.1.0-portable.exe` is unavailable, use `dist\win-unpacked\BotDesk.exe` built from **`ac8a3b1`**. That host build does not refresh the MCP adapter or relay.
2. If only the Codex-virtualized pairing exists, re-import that pairing JSON into the active host (owner UI paste). Do not print tokens into chat.
3. Keep STOP/OFF until credentials and target are confirmed.

## Distinguishable errors

| Code | Meaning |
|------|---------|
| `credential-missing` | Env/store lacks required bot config |
| `authentication-rejected` | Relay rejected the bot token |
| `host-offline` | Windows host not connected |
| `session-expired` | Armed window expired |
| `not-armed` | Access OFF/paused |
| `command-timeout` | Result not delivered in time — do not replay clicks |
| `payload-too-large` / `capture-too-large` | Screenshot exceeded transport budget |

## Hard limits

- No UAC / secure-desktop bypass.
- No credential values in git, vault notes, bus handoffs, URLs, or ordinary chat.
