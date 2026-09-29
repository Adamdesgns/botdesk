import * as native from './windows.mjs';

export function redactClipboard(text) {
  if (typeof text !== 'string') return { text: '', redacted: true, reason: 'invalid' };
  const secretLike = /(sk-[A-Za-z0-9]{10,}|ghp_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|Bearer\s+[A-Za-z0-9._~+/=-]{16,}|password\s*[:=]\s*\S+)/i;
  if (secretLike.test(text) || /^[A-Za-z0-9_-]{43,128}$/.test(text.trim())) {
    return { text: '[redacted-secret-like]', redacted: true, length: text.length };
  }
  return { text: text.slice(0, 4000), redacted: false, length: text.length };
}

export class DesktopExecutor {
  constructor({ recorder }) { this.recorder = recorder; }
  foreground(options) { return native.foregroundWindow(options); }
  inspect(targetWindow, options) { return native.inspect({ expectedWindow: targetWindow }, options); }
  listWindows(options = {}) { return native.runWindowsAction('list_windows', { accessMode: options.accessMode, blockedApps: options.blockedApps }, options); }
  focus(targetWindow, options = {}) { return native.focus({ expectedWindow: targetWindow, accessMode: options.accessMode, blockedApps: options.blockedApps }, options); }
  async run(name, args, options) {
    switch (name) {
      case 'screenshot': return native.capture({ expectedWindow: args.expectedWindow, accessMode: args.accessMode, blockedApps: args.blockedApps }, options);
      case 'snapshot': return native.snapshot({ expectedWindow: args.expectedWindow, accessMode: args.accessMode, blockedApps: args.blockedApps }, options);
      case 'list_windows': {
        const listed = await this.listWindows({ ...options, accessMode: args.accessMode, blockedApps: args.blockedApps });
        if (!listed.ok) return listed;
        return { ok: true, windows: listed.windows || [] };
      }
      case 'list_monitors': return native.listMonitors(options);
      case 'focus': return this.focus(args.expectedWindow, options);
      case 'click': return native.click({
        ...args,
        x: args.geometry.x + args.x,
        y: args.geometry.y + args.y,
        button: args.button || 'left',
        count: args.count || 1
      }, options);
      case 'move': return native.moveCursor({
        ...args,
        x: args.geometry.x + args.x,
        y: args.geometry.y + args.y
      }, options);
      case 'drag': return native.drag(args, options);
      case 'type': return native.typeText(args, options);
      case 'key': return native.pressKey(args, options);
      case 'scroll': return native.scroll(args, options);
      case 'clipboard_read': {
        const result = await native.clipboardRead(options);
        if (!result.ok) return result;
        return { ok: true, clipboard: redactClipboard(result.text) };
      }
      case 'clipboard_write': return native.clipboardWrite(args, options);
      default: return { ok: false, error: 'unknown-command' };
    }
  }
  recordStart({ targetWindow, signal, onFailure }) {
    return this.recorder.start({ signal, onFailure, getFrame: () => native.capture({ expectedWindow: targetWindow }, { signal }) });
  }
  recordStop() { return this.recorder.stop(); }
}
