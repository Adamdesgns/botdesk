# Reboot sign-in startup — 2026-09-29

Adam asked for BotDoor and Grok Bot to reopen after a PC reboot. Both now have Windows Startup-folder shortcuts for the `steam` account:

- `C:\Users\steam\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup\BotDesk.lnk` points to the current released 1.4 portable at `C:\Users\steam\AppData\Local\Programs\BotDesk\BotDesk-0.1.0-portable.exe` with `--background`. The binary was copied from the already released `dist\BotDesk-0.1.0-portable.exe`; source and copy both have SHA-256 `24DA31D777416205EABA21110ED459B6F8B6498FF8D7E6A1221158BD91083C0F`.
- `C:\Users\steam\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup\Grok Bot.lnk` points to `C:\Users\steam\AppData\Local\Programs\Grok Bot\Grok Bot.exe` with no arguments.

The existing Start Menu `Grok Bot.lnk` pointed to the nonexistent `C:\Users\CodexSandboxOffline\...` path. It was backed up as `Grok Bot.pre-repair-2026-09-29.lnk` beside the original and repaired to the real installed executable. All three shortcuts now resolve to existing files. No reboot or launch was performed, so actual after-sign-in behavior has not yet been observed. The 1.6 BotDoor candidate remains local; the startup copy is the released 1.4 version until host and relay are upgraded together.

Startup occurs when this Windows user signs in, not at the firmware boot screen or before login. BotDoor still starts with access OFF; a saved schedule may activate only under the existing authenticated owner schedule rules. Grok Bot may open at login, but this does not guarantee that a prior chat or task resumes automatically. The BotDesk in-app `Start when I sign in` toggle was not changed; Windows Startup currently manages this copy. If the owner wants startup off, remove the two shortcuts from the Startup folder. After a future BotDoor release, replace the stable portable in `LocalAppData\Programs\BotDesk` only after verifying the host/relay pair.
