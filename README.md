# BotDoor / BotDesk

BotDoor gives an owner-controlled bot access to a Windows PC through the separately running BotDesk companion and a private relay. This branch implements the 1.6 protocol contract; the legacy Electron/npm package name and version remain BotDesk 0.1.0. It is independent software, with no OpenAI or xAI endorsement.

The owner chooses an access scope, grants a time-limited session, and can pause or stop access. One-window mode permits guarded input only in the selected app. PC access permits ordinary-window viewing, focus, scrolling, pointer movement, moving/closing windows and exact-path executable launch; it blocks clicks, typing, content drag, editing keys and clipboard writes. Closing can discard unsaved work; programs can have effects when launched. No absolute no-data-loss guarantee is made.

The PC must remain awake, signed in and unlocked with its companion running. It cannot unlock Windows or operate UAC/secure-desktop or elevated/sensitive windows. Local STOP and Ctrl+Shift+F12 revoke access. Every input needs a fresh snapshot; stale or changed targets require owner recovery, never automatic substitution.

## Setup and tools

Provision your own private relay and host using [setup](docs/SETUP.md). Configure the bot runner privately with only its bot credential. Keep owner links, pairing files and all credentials out of source and chat. The relay command API is not a remote MCP endpoint.

The local MCP adapter exposes 21 tools over stdio using the official MCP SDK. It checks status/capabilities, captures the permitted window, lists eligible windows/monitors, performs scope-allowed actions, records guarded local frames and stops access. The tool prefix remains `botdesk_`. [Security boundaries](docs/SECURITY.md) and dated release notes describe implementation and acceptance limits.

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
