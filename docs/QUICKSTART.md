# Bot Door quick start

Bot Door lets one approved bot operate one app window on your Windows PC while you are away, only during a time window you start from your phone or at the PC. This guide follows the application as built on this branch. The window title, package and tray still say **BotDesk**; that is the same program.

The relay on this branch is **not deployed**. Everything below works against the local development relay on the same PC; a phone or bot on another network needs an approved HTTPS relay first (a separate owner decision).

## What you need

- A Windows 10/11 PC that stays signed in, awake and unlocked while the bot works. Bot Door cannot wake, unlock or approve UAC.
- Windows PowerShell 5.1 (built into Windows) and .NET Framework, which Bot Door uses for its fixed window helper. Corporate policy that blocks `Add-Type` (Constrained Language Mode, AppLocker) stops it; see the troubleshooting guide.
- Node.js 22 or newer and a clone of this repository for building, provisioning and the bot adapter.
- An ordinary user account. Credentials are stored with Windows DPAPI; Bot Door refuses to start if that is unavailable.
- The emergency stop shortcut `Ctrl+Shift+F12` must be free. Bot Door refuses to start if another program owns it.

## 1. Build the host

```powershell
npm ci
npm run check
npm run build:win
```

Open `dist\BotDesk-0.1.0-portable.exe`. The build is unsigned, so Windows SmartScreen may warn on first launch. The host starts **OFF** with no pairing; the Connection card shows **Not configured**.

If nothing opens, look for `logs\startup-errors.log` in the data folder (`%APPDATA%\botdesk` by default; the exact path is printed in the diagnostic report once the app runs).

## 2. Run a relay

For a local test on this PC only:

```powershell
node -e "const fs=require('node:fs');const secret=require('node:crypto').randomBytes(32).toString('base64url');fs.writeFileSync('relay/.dev.vars','PROVISIONING_SECRET='+secret+'\n',{flag:'wx',mode:0o600})"
npm run relay:dev
```

Leave that terminal open. `http://127.0.0.1:8787/health` should answer `{"ok":true,"service":"botdesk-relay"}`. `127.0.0.1` is reachable only from this PC.

## 3. Provision one PC

In a second terminal, from the clone:

```powershell
$botdeskSecretLine = Get-Content -LiteralPath .\relay\.dev.vars | Where-Object { $_.StartsWith('PROVISIONING_SECRET=') } | Select-Object -First 1
$env:BOTDESK_PROVISIONING_SECRET = $botdeskSecretLine.Substring('PROVISIONING_SECRET='.Length)
$botdeskPrivateFolder = Join-Path $env:LOCALAPPDATA 'BotDesk-Setup'
New-Item -ItemType Directory -Path $botdeskPrivateFolder -Force | Out-Null
try {
  node scripts/provision.mjs --relay http://127.0.0.1:8787 --allow-local --out (Join-Path $botdeskPrivateFolder 'botdesk-pairing.json')
} finally {
  Remove-Item Env:\BOTDESK_PROVISIONING_SECRET -ErrorAction SilentlyContinue
}
```

Expected output: `Pairing complete. Private credentials and the phone link were saved in ...`. The script prints no tokens and never overwrites an existing file. If it prints `Provisioning failed: ...`, the relay stored nothing; fix the cause, delete the pending file and run it again.

The pairing file contains `relayUrl`, `hostId`, `hostToken`, `ownerToken`, `botToken`, `ownerLink` and `provisioningStatus: "complete"`. Keep it private and out of the repository.

## 4. Pair the host

1. In Bot Door, paste the whole pairing file into **Paste the host pairing JSON** and choose **FILL PAIRING SETTINGS**. Expect "Pairing fields filled. Save settings next." A warning here means the file is still `pending` or is not a host pairing.
2. Choose **SAVE SETTINGS**. Expect "Settings saved with Windows encryption." Tokens are stored encrypted; the fields then show `saved`.
3. Watch the Connection card. It should go **Connecting → Authenticating → Securely connected** within a few seconds. Any other label is explained in `docs/TROUBLESHOOTING.md`.

Saving settings always turns access off and reconnects; that is expected.

## 5. Choose the window the bot may use

1. Open the app the bot should use (Edge, Chrome, Firefox or Notepad by default) with ordinary content, not a sign-in page.
2. Choose **REFRESH WINDOWS** and pick it under **APPROVED WINDOW**. The card shows "Selected: <title> (<app>)".
3. If the list is empty, the notice explains why (no eligible window, or a Windows helper problem).

Only that window is captured or controlled. The selection lives in memory: after restarting Bot Door or Windows you must select it again.

## 6. Enable phone control and keep the link

1. Tick **Allow remote arming while BotDesk is running** and choose **SAVE SETTINGS**. (Pressing local **GO LIVE — 8 HOURS** also turns this on.)
2. Choose **COPY PHONE LINK** and paste it somewhere private on your phone. The link is `RELAY/control/HOSTID#OWNERTOKEN`; the part after `#` is the owner credential.
3. Open the link. The phone shows **OFF** and **PC ONLINE**. If it shows **LOCKED**, the `#...` part is missing.

## 7. Connect the bot

Register the adapter in the bot runner's MCP configuration, giving it only the bot token:

```json
{
  "mcpServers": {
    "botdesk": {
      "command": "node",
      "args": ["C:\\path\\to\\botdesk\\mcp\\server.mjs"],
      "env": {
        "BOTDESK_RELAY_URL": "http://127.0.0.1:8787",
        "BOTDESK_HOST_ID": "pc-...",
        "BOTDESK_BOT_TOKEN": "..."
      }
    }
  }
}
```

The adapter prints `[botdesk-mcp] ready (relay ..., host ...)` on stderr; if it prints `ready, but not configured`, fix the env. Ask the bot to call `botdesk_status`: expect `"mode": "off"` and `"hostOnline": true`. Use an HTTPS relay URL for any bot not on this PC.

## 8. Go live, then stop

- Phone: **GO LIVE — 8 HOURS** or save a **time window**. The PC shows a red **BOT CONTROL ARMED** bar across the top and the phone shows **LIVE** with a countdown. The bot's `botdesk_screenshot` now returns an image and a `snapshotId`.
- PC: **GO LIVE — 8 HOURS** does the same locally and requires the relay to be connected.
- Stop from the phone with **PAUSE** or **STOP NOW**, or at the PC with **STOP NOW**, the tray item, or **Ctrl+Shift+F12**. A local stop latches: choose **UNLOCK LOCAL STOP** before anyone can arm again.

Locking Windows, sleeping, closing the approved window or losing the relay all turn access off. A saved window resumes automatically after a network blip, but only while it is still valid and the PC is still prepared.

## If something is wrong

Choose **COPY DIAGNOSTIC REPORT** in the Connection card and read `docs/TROUBLESHOOTING.md`. The report never contains tokens, window titles or typed text.
