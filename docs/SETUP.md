# BotDesk setup

BotDesk is a local Windows build. The relay has not been deployed, and the package does not contain pairing credentials. A phone or bot on another network needs an approved HTTPS relay deployment before it can reach the PC.

## Build or open the Windows host

From the BotDesk source directory:

```powershell
npm ci
npm run check
npm run build:win
```

Open `dist\BotDesk-0.1.0-portable.exe`. The portable host includes its own application runtime. The relay and bot MCP adapter run separately from the source project with Node.js and installed dependencies.

The host starts OFF. Provisioning creates its host ID; opening the application does not create a pairing automatically.

## Run a local relay for development

Local relay tests do not deploy anything. A `127.0.0.1` address is reachable only on that computer; it is not a phone or remote-bot address.

For the first local setup, create a random provisioning secret without printing it:

```powershell
node -e "const fs=require('node:fs');const secret=require('node:crypto').randomBytes(32).toString('base64url');fs.writeFileSync('relay/.dev.vars','PROVISIONING_SECRET='+secret+'\n',{flag:'wx',mode:0o600})"
npm run relay:dev
```

The file creation refuses to overwrite an existing `relay\.dev.vars`. Reuse the existing secret if the relay is already configured. Keep `.dev.vars` out of source control. Leave the relay terminal running and open another terminal for provisioning.

For a future approved deployment, configure `PROVISIONING_SECRET` as a Cloudflare Worker secret. Deployment is a separate release step; these instructions do not imply it has happened.

## Provision one PC

The provisioning script reads `BOTDESK_PROVISIONING_SECRET` from the process environment. It must match the relay's `PROVISIONING_SECRET`: a random base64url value of 43–128 characters. Do not pass the secret as a command-line argument.

For the local relay, run this from the source directory in the second PowerShell terminal:

```powershell
$botdeskSecretLine = Get-Content -LiteralPath .\relay\.dev.vars | Where-Object { $_.StartsWith('PROVISIONING_SECRET=') } | Select-Object -First 1
$env:BOTDESK_PROVISIONING_SECRET = $botdeskSecretLine.Substring('PROVISIONING_SECRET='.Length)
$botdeskPrivateFolder = Join-Path $env:LOCALAPPDATA 'BotDesk-Setup'
New-Item -ItemType Directory -Path $botdeskPrivateFolder -Force | Out-Null
$botdeskPairingFile = Join-Path $botdeskPrivateFolder 'botdesk-pairing.json'
try {
  node scripts/provision.mjs --relay http://127.0.0.1:8787 --allow-local --out $botdeskPairingFile
} finally {
  Remove-Item Env:\BOTDESK_PROVISIONING_SECRET -ErrorAction SilentlyContinue
  $botdeskSecretLine = $null
}
```

For an approved remote relay, set the same environment variable through your private secret workflow and use its HTTPS origin:

```powershell
node scripts/provision.mjs --relay https://YOUR-RELAY.workers.dev --out C:\YOUR-PRIVATE-FOLDER\botdesk-pairing.json
```

`--out` is required, its parent directory must exist, and the destination file must not already exist. The script grants the current Windows user access to the new pairing file, saves recovery credentials before contacting the relay, and prints only completion information and the file path. It does not print tokens. Confirm `provisioningStatus` is `complete` in the private file.

If the response is interrupted, the file remains marked `pending`. Keep that recovery file and check whether its host ID was provisioned before creating another pairing. An existing host ID cannot be overwritten by calling provision again.

The file contains three different credentials:

| Credential | Used by | Authority |
| --- | --- | --- |
| `hostToken` | Windows host | Connect this PC to its relay session |
| `ownerToken` | Owner phone and local host controls | GO LIVE, set or cancel a schedule, pause, stop, preview |
| `botToken` | Approved bot's MCP adapter | Request guarded commands during an owner-authorized window; cannot arm or schedule |

The provisioning secret is separate from all three. Keep the complete pairing file private and outside the repo. Give the bot only its bot token, relay URL, and host ID.

## Prepare the PC once before leaving

1. Open BotDesk, paste the host pairing JSON, choose **FILL PAIRING SETTINGS**, then **SAVE SETTINGS**. The host needs `relayUrl`, `hostId`, `hostToken`, and `ownerToken`; it does not require `botToken` to connect.
2. Open the app the bot should use. In BotDesk, choose **REFRESH WINDOWS** and select that app under **APPROVED WINDOW**. The default allowed apps are Edge, Chrome, Firefox, and Notepad.
3. Enable **Allow remote arming while BotDesk is running** and save. Local **GO LIVE — 8 HOURS** also enables remote arming. The host checks the selected window when access starts and attempts to bring it forward.
4. Use **COPY PHONE LINK** and save the private link for yourself. It contains the owner credential after `#`.
5. Leave Windows signed in, awake, and unlocked, with BotDesk running and the selected app open. You can leave access OFF and start it later from the phone.

There are no per-action permission prompts during authorized remote operation. The host checks permissions and the selected window automatically. Blocked windows and unsafe actions return an error to the bot.

**Start BotDesk when I sign in** is optional and requires your explicit choice in the app. It does not unlock Windows or select a target window. The selected target is held in memory: restarting BotDesk or Windows requires selecting the target again. Ordinary network interruptions and relay restarts can resume the same prepared host inside its saved owner window.

BotDesk cannot wake a powered-off PC, bypass the lock screen, approve UAC, or reopen a closed target app.

## Connect the approved bot

MCP is the tool connection that lets an AI agent request screenshots and actions. Register `node` with `mcp/server.mjs` in the bot application's MCP configuration. For example, replace the example path with your local clone:

```json
{
  "mcpServers": {
    "botdesk": {
      "command": "node",
      "args": ["C:\\path\\to\\botdesk\\mcp\\server.mjs"],
      "env": {
        "BOTDESK_RELAY_URL": "https://YOUR-RELAY.workers.dev",
        "BOTDESK_HOST_ID": "YOUR-PROVISIONED-HOST-ID",
        "BOTDESK_BOT_TOKEN": "YOUR-BOT-TOKEN"
      }
    }
  }
}
```

The adapter gives each process a distinct bot ID by default. `BOTDESK_BOT_ID` can set an explicit ID if needed. One bot holds the control lease at a time. The bot must take a fresh snapshot before input; click coordinates are relative to the selected-window capture. Commands are rejected rather than queued when the host is busy.

## Use the phone while away

- **GO LIVE — 8 HOURS** starts an immediate owner-authorized timer. The API accepts durations up to 12 hours. If the PC is temporarily offline, the timer is saved and access can start when that prepared host reconnects before the timer ends.
- **Set a time window** saves one dated window. For example, select tomorrow at **6:00 AM** for START and tomorrow at **6:00 PM** for END, then choose **SAVE SCHEDULE**. Inputs use the phone's local timezone, displayed beside the fields. This is a one-time window, not a daily recurring schedule.
- The page shows the saved dates, current PC connection, and a countdown until start or stop. Scheduled access starts automatically when the PC is ready and stops at the saved end time. No one needs to confirm at the PC.
- **PAUSE** and **STOP NOW** cancel the saved window. Access stays disabled until you choose GO LIVE or save a new window. A phone STOP can be followed by another phone GO LIVE.
- The local **STOP NOW** button and **Ctrl + Shift + F12** are emergency stops. They cancel access and latch the local stop. Use **UNLOCK LOCAL STOP** on the PC before remote access can start again.

A reconnect never extends the authorized end time. A saved owner window permits another automatic host acknowledgement only while that window is still active. Without a saved window, reconnecting leaves access OFF.

## Captures and recordings

Use **SHOW SCREEN** for an on-demand phone preview of the guarded selected window. The bot can also request a snapshot or screenshot while live.

Bot recordings are local WebM files built from guarded selected-window captures, at up to one frame per second, without audio. They are not smooth full-desktop video. Use **OPEN RECORDINGS** in the host to open its application-data `captures` folder. Recordings are not uploaded to the relay automatically. Audit records are stored in the host's application-data `logs` folder.
