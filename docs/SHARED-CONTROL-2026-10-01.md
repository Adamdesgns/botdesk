# Shared bot and phone control — 1.8 local candidate

Adam approved: bot opens/focuses the program, asks for human input, waits while Adam types or clicks in the phone viewer, and continues after Done. Ordinary program use requires no administrator setup.

## Implemented flow

1. Owner grants a timed Owner control session using GO LIVE.
2. Bot uses program launch/focus/close and inspection tools.
3. `botdesk_request_owner({message})` transfers the remaining grant to the human. No new grant or expiry extension is possible from this tool.
4. Phone shows Waiting for you and the message. Adam uses the viewer's input controls.
5. Done — continue sends the exact handoff ID. Host acknowledges exclusive bot control with a new generation; prior screenshots are invalid.
6. Bot polls status and proceeds only for the matching completed handoff. The adapter cannot wake an idle external conversation; its runner must remain active or be resumed by the user.

STOP, expiry, local stop and disconnect cancel the handoff. Saved reconnect schedules are removed when yielding. Human-entered text is not copied into handoff status. Both relay and host reject bot typing/clicking/drag/editing/clipboard in this mode. The old selected-window mode is unchanged.

## Limits and release

This is a refreshed foreground-window viewer, not continuous full-desktop video. Windows must stay awake, signed in and unlocked. Password controls and UAC remain unavailable. Closing can discard unsaved work and downstream coding programs can delete data; no absolute no-delete guarantee is made.

Local checks, real relay/host integration with a fake Windows executor, headless phone-size viewer with synthetic image, and packaged SDK validation establish local behavior only. Matched relay deployment, host replacement, connector update and a physical-phone acceptance run remain separate release work. No live host has been restarted and nothing has been pushed.
