# BotDesk working rules

- BotDesk controls only the Windows PC on which its host is installed.
- Remote commands fail closed unless the owner has armed a time-limited session.
- The local STOP button and `Ctrl+Shift+F12` always win.
- Never store host, owner, bot, or provisioning tokens in source control.
- Adam authorized shared bot/phone control on 2026-10-01: bot manages programs and requests human typing/clicks using request_owner. Ordinary use requires no administrator launch. Keep sign-in, password, Windows Security, UAC and secure desktop off-limits. Existing selected-window and PC viewing restrictions remain unchanged. Never promise absolute prevention of deletion by downstream coding apps.
- Run `npm run check` before committing. Build the portable Windows artifact after checks pass.
- Deployment and permanent startup remain separate owner decisions.
