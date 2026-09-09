# BotDesk working rules

- BotDesk controls only the Windows PC on which its host is installed.
- Remote commands fail closed unless the owner has armed a time-limited session.
- The local STOP button and `Ctrl+Shift+F12` always win.
- Never store host, owner, bot, or provisioning tokens in source control.
- Keep sign-in, password, financial, Windows Security, UAC, and elevated windows off-limits.
- Run `npm run check` before committing. Build the portable Windows artifact after checks pass.
- Deployment and permanent startup remain separate owner decisions.
