# Roblox Studio test support

This build adds an optional Roblox Studio target, a local session-length selector
(30 minutes by default), and `botdesk_drag` through the direct MCP SDK adapter.
Existing browser/Notepad defaults are unchanged. Studio requires local opt-in.

## Start a test

1. Keep access OFF while updating the host, relay, and SDK adapter.
2. Deploy the relay command allowlist update only with the owner's approval.
   The old relay rejects `drag`; the old SDK does not advertise it.
3. Restart the host using its existing encrypted pairing configuration. In Choose
   window, enable Roblox Studio, refresh, and select the exact place window.
   Changing the preference stops access and clears the target. Unlock local STOP.
4. Choose 30 minutes. Start access only when the tester is ready. Confirm status
   is armed, the expected handle/PID/title is selected, and the deadline matches.
5. Connect through the official SDK and existing private credential wrapper.
   Start recording, then inspect a fresh screenshot of the actual game viewport.
   A successful capture response alone does not prove GPU content rendered.
6. Take a new screenshot before every input. Abort on a rejection; inspect before
   any explicitly requested retry. End with `botdesk_stop_all`, verify OFF, and
   verify a screenshot request is rejected as not armed.

## Drag contract

`botdesk_drag` takes exactly `snapshotId`, `points`, and `durationMs`.
`points` contains 2–64 objects with integer `x`/`y` coordinates relative to the
captured window. Every point must be inside it; consecutive duplicates are
rejected. `durationMs` is an integer from 100 to 2000. Use only coordinates from
the observed game canvas. Raw mouse-down/up commands are unavailable.

One input consumes its snapshot. The host retains the 15-second snapshot limit,
exact window identity, title and geometry checks, foreground ownership checks,
and sensitive-control exclusions. Drag repeats checks while moving. Cancellation
releases the button, with an independent native deadline of requested duration
plus 250 ms (subject to Windows scheduling). Dense paths can exceed that bound
and abort; that is a failure to investigate, not evidence of a completed route.

If helper exit or release cannot be confirmed, access locks OFF. Local unlock and
remote rearming are refused. Check the mouse locally and restart the host before
another session. Quitting waits for active operation cleanup.

## Verification boundary

Automated tests cover schemas, relay transport, snapshot consumption, STOP
cancellation, cleanup failures, app opt-in, and the 30-minute deadline. Synthetic
UI checks cover preference persistence, target reselection, protected pairing
fields, timer selection, and STOP. Native helper compilation is checked.

Actual Studio screenshot rendering, route drawing, cancellation during a real
gesture, and the complete game test pack still require runtime evidence. Mouse
input does not prove multitouch or a physical-phone test. Nothing here changes
game release gates or authorizes Roblox publication.
