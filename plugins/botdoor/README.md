# BotDoor for Codex

Owner-controlled Windows access using the BotDoor 1.6 companion. The tool names retain `botdesk_` for compatibility. This is independent software.

## Prerequisites and setup

The runner needs Node.js 22 or newer. The controlled computer needs the separately installed Windows companion, a provisioned private relay, and an owner-selected access policy. It must stay awake, unlocked and connected. This plugin does not install or start the companion.

Build with `npm run plugin:pack` from the source repository. The resulting `dist/botdoor-plugin` contains a bundled adapter with its JavaScript dependencies; users do not run npm install inside the plugin. The ZIP is `dist/BotDoor-1.6.0-codex-local.zip`.

Configure `BOTDESK_RELAY_URL`, `BOTDESK_HOST_ID`, and `BOTDESK_BOT_TOKEN` in the runner's private environment before starting Codex. Use only a bot credential, never the owner link, host token or pairing file. The adapter reads these variables at runtime; none belong in the ZIP or chat. User-level MCP configuration may need `env_vars` to forward these variables, depending on the runner. Never paste a real value into an example or commit it.

For direct local testing, add the generated folder as a local marketplace source using the accompanying marketplace JSON, then install BotDoor through Codex. A separate direct MCP configuration can launch `node` with the absolute path to `runtime/server.mjs`. Configure only one adapter to avoid duplicate bot leases. Actual plugin installation and private environment forwarding still require a runner acceptance check; the bundled adapter is tested with the real SDK against a loopback fixture.

Start by asking: “Check whether my BotDoor PC is connected and whether access is enabled.” OFF is a valid result. Only the owner grants a timed session using the host or private phone controls. Capture a fresh window image before an action. End by asking BotDoor to stop, then confirm OFF.

## Boundaries

One-window mode permits guarded input only in the selected target. PC access supports viewing, focus, scroll, pointer movement, window movement/close and exact-path executable launch; it blocks click/type/drag/editing keys and clipboard writes. Closing may discard unsaved work; launching programs can have side effects. Sensitive and elevated windows are off-limits. Local STOP and Ctrl+Shift+F12 revoke access. BotDoor does not unlock Windows or offer continuous live video.

Screenshots and accessible labels pass through the user's relay and runner. Recordings and audit logs are stored by the Windows companion. Use disposable data for acceptance testing. Policy drafts and review cases are maintained in the source repository's `docs/plugin-submission/` folder.

## Publication status

Prepared for local testing, not submitted or approved. OpenAI's public directory requires a public HTTPS MCP endpoint or an approved exception for local MCP. The existing relay command API is not such an endpoint. Public website, support, privacy and terms URLs, verified publisher identity, dedicated reviewer access, recorded walkthrough and real-device test results remain required. Do not upload this local package as a completed public release or omit MCP to bypass review.

Official packaging: https://developers.openai.com/plugins/build/plugins

Official submission: https://developers.openai.com/plugins/deploy/submission
