import { randomUUID } from 'node:crypto';
import { isAllowedWindow } from './guard.mjs';

export const TEMPORARY_TARGET_MS = 5 * 60_000;
const REVIEW_MS = 60_000;
export const sameTarget = (a, b) => Boolean(a && b &&
  String(a.handle) === String(b.handle) && a.processId === b.processId &&
  a.processName === b.processName && a.processStartedAt && a.processStartedAt === b.processStartedAt);
const sameReview = (a, b) => sameTarget(a, b) && a.title === b.title &&
  JSON.stringify(a.geometry) === JSON.stringify(b.geometry);

// This service is reachable only from local owner IPC or the authenticated owner
// transport. Bot commands cannot select a window or manufacture an approval.
export class TargetRecovery {
  constructor(controller) { this.host = controller; this.choices = new Map(); }
  clear() { this.choices.clear(); }
  async list() {
    const h = this.host;
    if (!h.configStore.load().allowRemoteArm) throw new Error('remote-arm-disabled');
    if (h.mode !== 'off' || h.operation) throw new Error('stop-before-selecting');
    const epoch = h.epoch;
    this.clear();
    const result = await h.executor.listWindows();
    if (epoch !== h.epoch) throw new Error('target-review-cancelled');
    if (!result.ok) throw new Error(result.error || 'target-check-unavailable');
    const expiresAt = h.clock() + REVIEW_MS;
    const windows = (result.windows || []).filter(w => w.processStartedAt && isAllowedWindow(w, h.configStore.load().allowedApps)).slice(0, 100);
    return { windows: windows.map(window => {
      const candidateId = randomUUID();
      this.choices.set(candidateId, { window: structuredClone(window), expiresAt, epoch });
      // No screen pixels or accessibility tree are disclosed before approval.
      return { candidateId, title: window.title, processName: window.processName, processId: window.processId, handle: window.handle };
    }), expiresAt };
  }
  async approve({ candidateId, temporary }) {
    const h = this.host;
    if (!h.configStore.load().allowRemoteArm) throw new Error('remote-arm-disabled');
    if (h.stopLatched) throw new Error('local-stop-latched');
    if (h.mode !== 'off' || h.operation) throw new Error('stop-before-selecting');
    const choice = this.choices.get(candidateId);
    this.clear(); // Approval is single-use, including a failed attempt.
    if (typeof temporary !== 'boolean' || !choice || choice.epoch !== h.epoch || choice.expiresAt <= h.clock()) throw new Error('target-review-expired');
    const current = await h.executor.inspect(choice.window);
    if (choice.epoch !== h.epoch || h.stopLatched) throw new Error('target-review-cancelled');
    if (choice.expiresAt <= h.clock()) throw new Error('target-review-expired');
    if (!current.ok || !sameReview(choice.window, current.window) || !isAllowedWindow(current.window, h.configStore.load().allowedApps)) throw new Error('target-review-changed');
    h.selectTarget(current.window, { temporary, notify: false });
    return h.getStatus();
  }
}
