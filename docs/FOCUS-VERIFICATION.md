# Focus result verification

The focus helper now observes the exact approved foreground window even if its
existing accessibility fallback throws. Previously that exception immediately
returned `focus-refused`, including when the approved window had become foreground.
The existing one-second observation budget and final identity, desktop, privilege,
and sensitive-control checks still determine success. Provider exception text is
never returned.

After native success, the controller also verifies process name and process-start
identity, in addition to the window handle and PID. Missing or changed identity
returns `target-changed` instead of `focused: true`.

## Windows behavior

Windows can refuse foreground activation, even when a caller appears eligible.
This patch does not grant foreground permission or guarantee that Edge can be
activated. The accessibility provider's behavior does not establish foreground
success. A transient null foreground is tolerated only within the existing bounded
observation; success still requires the exact approved window and final checks.

- [SetForegroundWindow](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setforegroundwindow)
- [AutomationElement.SetFocus](https://learn.microsoft.com/en-us/dotnet/api/system.windows.automation.automationelement.setfocus?view=windowsdesktop-9.0)
- [GetForegroundWindow](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getforegroundwindow)

There is no new input simulation, permission grant, restore/minimize operation,
input-queue attachment, owned-popup substitution, or extra activation attempt.
An owned dialog or another window from the same process does not inherit approval.

## Regression checks

On Windows, run:

```powershell
node --test test/windows-focus-sequence.test.mjs test/controller.test.mjs
```

The focus test extracts the production C# method into an inert fixture. Its Win32,
accessibility, clock, and sleep dependencies are substitutes; it cannot observe or
control the desktop. It covers 15 cases, including delayed activation, provider
exceptions with and without eventual activation, refusal, transient null,
different windows, stale identity, and final safety rejection. It checks sequencing,
not the internals of the substituted guards or actual Windows behavior.

Controller tests cover replaced/missing process identity, STOP, expiry, scope
revocation, lease ownership, and stale control generations. Late success cannot
override cancellation or produce a snapshot. The new native fixture is skipped
on non-Windows hosts; Windows must run it before release.

## Acceptance boundary

The regressions establish two source defects. They do not establish the cause of
any particular live `focus-refused` response, successful Edge activation, popup
dismissal, screenshot capture, or model-stream recovery.

Publishing this patch does not authorize installation, companion restart, relay
deployment, or a desktop test. A separately approved live test must verify the
current connection, granted scope, exact target, and free controller lease, then
stop on refusal. This public source baseline is not a replacement package for a
newer installed companion with additional local functionality.
