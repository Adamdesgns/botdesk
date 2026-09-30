# BotDoor Codex submission checkpoint — 2026-09-30

**Prepared locally; not submission-ready, uploaded, submitted, approved or published.**

## Official requirements checked

Sources read on 2026-09-30:

- https://developers.openai.com/plugins/build/plugins — portable root manifest, MCP config, skills, assets; local marketplace differs from public directory. Public MCP submission needs HTTPS; contact OpenAI for local-MCP support if hosting is unsuitable.
- https://developers.openai.com/plugins/deploy/submission — ZIP upload, verified publisher, domain verification, automated checks, review information, submit, then separately publish after approval.
- https://developers.openai.com/plugins/plugin-guidelines — truthful functionality, complete product, published privacy policy, user intent and sensitive-data safeguards.
- Official Codex parser source https://github.com/openai/codex/blob/main/codex-rs/codex-mcp/src/agent_plugin_config.rs — portable stdio type, command/args, PLUGIN_ROOT expansion and package working directory. The installed runner still needs its own acceptance check.

## Audit

Source baseline is local `0f74059` on `codex/botdoor-recovery`, containing 1.6 navigation commit `385c851`. Worktree was clean at pickup. Existing host/relay release and startup evidence is in the September 29 release notes; it was not reverified or changed during packaging. The npm/Electron package version remains 0.1.0 while the protocol contract is 1.6.0. The new plugin intentionally versions its own package 1.6.0; it does not rename or upgrade the installed companion.

README originally described twelve tools and only the old selected-window release. Current source advertises 21 tools and both owner-selected scopes. The plugin listing describes the actual 1.6 limitations. No whole-repository ZIP is safe: old machine-specific release documents are not listing material. The packager copies a small allowlist and bundles the MCP adapter; it excludes pairing files, logs, screenshots, owner links, provisioning scripts, host binaries, vault material and Git history.

## Deliverables

- `plugins/botdoor/plugin.json`: listing draft and portable identity.
- `plugins/botdoor/mcp.json`: local stdio connection, no embedded secrets.
- `plugins/botdoor/skills/botdoor/SKILL.md`: bounded workflow and stop/error handling.
- `plugins/botdoor/README.md`: prerequisites, private setup and publication boundary.
- `scripts/build-plugin.mjs`: standalone adapter bundle, dependency notices and local marketplace catalog.
- `scripts/check-plugin.mjs`: package allowlist, metadata/icon checks, actual bundled SDK fixture and missing-credential refusal.
- `dist/BotDoor-1.6.0-codex-local.zip`: generated local package, accompanied by SHA-256.
- `REVIEW-CASES.md`: five positive and three negative reviewer scenarios; planned, not passed on a reviewer account.
- `PUBLIC-PAGES-DRAFT.md`: unpublished policy/support/terms content for owner review.

## What blocks public submission

1. **Transport:** BotDoor's current relay is a custom authenticated command API, not Streamable HTTP MCP. Do not put its URL in a remote MCP manifest. Recommended next implementation: a separately tested hosted MCP service with per-user authentication and host authorization, preserving STOP, deadlines, policy and single-bot leases. Use a separate test environment; no production changes are authorized here. Alternatively seek an explicit OpenAI local-MCP exception; none has been obtained. Do not submit skills-only to bypass MCP review, because adding MCP to an existing skills-only plugin is currently unsupported.
2. **Public pages:** Product, support, privacy and terms HTTPS URLs must be published and accessible, identifying the verified publisher. Deliberately omitted from the manifest rather than inventing reachable URLs. The drafts need exact operator identity, support channel, hosting/retention decisions and approval before publication.
3. **Publisher:** Adam selects the owning OpenAI organization/project, confirms suitable management permissions, completes publisher verification and approves policy attestations. No signed-in portal access was used.
4. **Review environment:** Dedicated disposable Windows PC/VM, relay and reviewer account/auth flow. Never give a reviewer Adam's PC, owner link or real bot token. Review access must not depend on owner MFA or a private network. Host authentication and reviewer setup need completion after transport is selected.
5. **Acceptance:** Execute the five positive/three negative cases using that environment; record an accessible walkthrough. Current automated/fixture evidence does not prove reviewer account, installed Codex plugin environment forwarding, physical phone, real-bot actions, frozen-app recovery or reboot startup.
6. **Publication permission:** Adam has authorized preparation. No new public push, listing publication, upload/submission or production deployment is authorized. Confirm the concrete approved candidate before these actions. A GitHub public push is not required merely to upload a ZIP to OpenAI.

## Exact submission path after gates pass

1. Rebuild the release with the actual hosted MCP configuration, reviewed listing URLs and review metadata; scan the full final ZIP for secrets.
2. In https://platform.openai.com/plugins choose the intended organization/project, Upload new or existing plugin and verified developer identity; upload the ZIP containing MCP from the start.
3. Resolve metadata/skills findings. In MCPs connect the HTTPS endpoint, complete domain verification using the portal's exact challenge, authenticate and inspect the tool scan. Do not overwrite another plugin's challenge.
4. Enter dedicated reviewer credentials privately in Review details, never in source/ZIP/chat; supply completed cases, recording and release notes.
5. With Adam's explicit authorization and completed attestations, Submit for review. Report portal receipt/status as submission evidence.
6. Review approval does not publish automatically. Publish only after approval and Adam's explicit authorization; verify the directory listing and fresh installation afterward.

## Local commands

`npm run check` includes 151 existing tests, relay types, original MCP smoke and plugin checks. `npm run build:win` is required by repository rules; it only creates a local artifact. `npm run plugin:build` creates the isolated plugin folder. The ZIP is made from only its validated files, with paths relative to the plugin root. No app launch, GO LIVE, native input, secret access or relay deployment is part of this workflow.
