# BotDoor / BotDesk

BotDoor gives an owner-controlled bot access to a Windows PC through the separately running BotDesk companion and a private relay. This branch implements the 1.8 protocol contract; the legacy Electron/npm package name and version remain BotDesk 0.1.0. It is independent software, with no OpenAI or xAI endorsement.

The owner chooses an access scope, grants a time-limited session, and can pause or stop access. One-window mode permits guarded input only in the selected app. PC access permits ordinary-window viewing, focus, scrolling, pointer movement, moving/closing windows and exact-path executable launch; it blocks clicks, typing, content drag, editing keys and clipboard writes. Closing can discard unsaved work; programs can have effects when launched. No absolute no-data-loss guarantee is made.

Explicit **Owner control** lets the bot manage programs while the human handles clicks, typing and editing keys. The bot calls `botdesk_request_owner`; the phone displays **Waiting for you** with the request and exclusive manual control. **Done — continue** returns control. The bot must poll `botdesk_status` for that same completed handoff before continuing; this does not wake an idle external AI conversation. STOP, expiry and disconnect cancel the handoff. The viewer refreshes the foreground window, not full-desktop video. Old settings are never silently upgraded.

The PC must remain awake, signed in and unlocked with its companion running. Administrator apps require the companion itself to run as administrator using normal local Windows consent. It cannot unlock Windows or operate UAC/secure desktop or password controls. Local STOP and Ctrl+Shift+F12 revoke access. Every input needs a fresh snapshot; stale or changed targets require owner recovery.

For a connector on this Windows PC, explicitly set `BOTDESK_LOCAL_PAIRING=1` to reuse the saved encrypted bot credential without copying codes; rotations are read on the next call. Remote runners still need one-time private credential setup. See [Shared control release and acceptance](docs/SHARED-CONTROL-2026-10-01.md). This candidate has not been installed or deployed.

## Setup and tools

Provision your own private relay and host using [setup](docs/SETUP.md). Configure the bot runner privately with only its bot credential. Keep owner links, pairing files and all credentials out of source and chat. The relay command API is not a remote MCP endpoint.

The local MCP adapter exposes 22 tools over stdio using the official MCP SDK. It checks status/capabilities, captures the permitted window, lists eligible windows/monitors, performs scope-allowed actions, records guarded local frames and stops access. The tool prefix remains `botdesk_`. [Security boundaries](docs/SECURITY.md) and dated release notes describe implementation and acceptance limits.

## Codex plugin

[Plugin README](plugins/botdoor/README.md) describes the separately packaged adapter, private setup and local installation. [Submission checkpoint](docs/plugin-submission/SUBMISSION.md) records current official requirements, exact portal steps and outstanding gates. This local package has not been uploaded, submitted, approved or published. Public directory submission needs hosted HTTPS MCP or OpenAI acceptance of local MCP, public policy/support URLs, verified identity and a dedicated tested review environment.

```powershell
npm ci
npm run check
npm run plugin:pack
npm run build:win
```

The plugin output is `dist/botdoor-plugin`; the standalone Windows portable is `dist/BotDesk-0.1.0-portable.exe`. Neither build launches or replaces a host. Installing a plugin does not deploy/provision a relay, install a Windows companion, enable startup or grant access.

## Evidence

[Verification](docs/VERIFICATION.md) contains historical evidence. [1.6 release record](docs/PC-NAVIGATION-RELEASE-2026-09-29.md) and [startup record](docs/REBOOT-STARTUP-2026-09-29.md) distinguish deployed/local evidence from acceptance. Real phone taps, Grok Bot private credential setup, bounded live actions, frozen-app recovery and sign-in after reboot remain unverified unless a later dated record proves them. Fixture checks do not prove those outcomes. Continuous live-screen video is separate private work.
