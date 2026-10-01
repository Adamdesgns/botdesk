# BotDoor 1.8 launched — 2026-10-01

Adam approved "Approved to complete launch" after reviewing candidate c30417d. No GitHub push was requested or made.

## Installed and deployed

- Existing Cloudflare Worker botdesk-relay deployed as 8935d81a-4cd5-427d-a12f-d0f1ed52f8ab at https://botdesk-relay.adamdesgns-lastword.workers.dev. Previous version: ea3b8e23-c404-4b2d-8e1a-caf99341f1a9. Wrangler dry run and deployment succeeded.
- Stable companion: `C:\Users\steam\AppData\Local\Programs\BotDesk\BotDesk-0.1.0-portable.exe`, SHA256 `DCC7F699DB001A8EB98CF04D5D11D39BEAD420B5DF2B8BD39D95E893D2584CEB`.
- Previous binary retained as `C:\Users\steam\AppData\Local\Programs\BotDesk\BotDesk-pre-1.8-20261001-132244.backup.exe`. No host was running before installation. New host launched normally with `--background`, no administrator request. One Electron host tree observed.
- Existing desktop and Startup shortcuts both resolve to the stable binary. Startup arguments remain `--background`. No reboot test performed.
- Connector installed at `C:\Users\steam\AppData\Local\Programs\BotDesk\connector-1.8.0\runtime\server.mjs`. Registered as the global Codex MCP server `botdoor`, with Node and `BOTDESK_LOCAL_PAIRING=1`. No credential pasted into config, output or chat. This is direct MCP registration, not public directory publication. Existing conversations may need to reload their tools or start a new session.
- Owner control policy saved through the authenticated owner API; existing blocked-app settings preserved. Remote arming was already enabled. Pairing and startup preserved.

## Verification

The installed bundled connector was launched by an actual MCP SDK client, listed 22 tools, reported contract 1.8 and authenticated to the live relay using encrypted local pairing. A five-minute test grant transferred to the human using request_owner; the actual installed host acknowledged the operator change. Exact-ID Done returned control to the bot without extending the expiry, and the installed connector observed the completed handoff. Finally access was turned OFF, with no schedule or handoff remaining. No desktop input or screenshot was sent during this live test.

Final authenticated state: host online, OFF, Owner control, relay contract 1.8. Live health and phone page returned HTTP 200; Waiting for you and Done controls are served. Local prior validation: 159 tests, types, original/bundled SDK checks and synthetic phone-size browser acceptance passed.

Evidence: ignored `evidence/live-launch-check.json`, `evidence/launch-deploy.log`, `evidence/launch-dry-run.log`; no secrets in these records.

## Remaining device acceptance

Adam should refresh the existing private phone link, press GO LIVE, and use a new/reloaded Codex session with BotDoor. Physical-phone typing/clicks and the offsite network path have not been observed. External Grok/Morgan credential setup is not established by this Codex installation. The runner must poll handoff completion; an idle external conversation is not automatically awakened. Windows must stay awake, signed in and unlocked. No absolute no-delete guarantee applies to downstream coding tools.

## Rollback

Turn access OFF first, quit this companion, restore the retained pre-1.8 binary at the stable path, and roll the Worker back to ea3b8e23-c404-4b2d-8e1a-caf99341f1a9. Restore the earlier PC access policy when using the older host, which does not understand Owner control. Keep encrypted pairing intact. Disable the new connector while the older contract is running. Verify OFF and online after rollback.
