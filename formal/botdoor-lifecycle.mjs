/**
 * Finite statechart of BotDoor's session lifecycle.
 *
 * States
 * - disconnected: host link down, mode off, no handoff
 * - authenticated-off: host up, mode off, not latched
 * - arming: owner or schedule request waiting for a matching host ack
 * - live-bot: armed, operator and host agree on bot
 * - live-owner: armed, operator and host agree on owner (phone has control)
 * - handoff-waiting: owner-control handoff, same grant deadline, operator owner
 * - paused: owner pause, grant and schedule cleared
 * - stop-latched: local STOP, mode off until the PC clears the latch
 * - expired: clock reached the grant and the live state was cleared
 *
 * Transitions
 * - connect / disconnect
 * - go-live-short / go-live-long (explicit new grant; may raise the cap)
 * - take-control from off (new manual grant, owner-control access only)
 * - switch-owner / switch-bot while live (cannot raise the cap)
 * - resume a saved schedule after reconnect, bounded by the same cap
 * - ack-ok / ack-bad (a mismatched operator ack clears the grant)
 * - request-handoff / complete-handoff (deadline unchanged)
 * - pause, stop, local-stop, clear-latch
 * - tick (expiry clears a live grant; a schedule cannot survive its own end)
 * - bot-click (refused while the phone operator is owner or access is owner-control)
 * - bot-scroll (refused while the phone operator is owner; allowed for the bot in owner-control)
 *
 * `bugs` recreates the failures the checker must catch. The real relay must run with every flag false.
 */

export const MAX = 4;
const EDITING_REFUSAL = 'input-while-owner-control';

export function initialState() {
  return {
    link: 'down', mode: 'off', operator: 'bot', host: 'bot', access: 'window',
    stopped: false, handoff: 'none', phase: 'idle', clock: 0,
    grantEnd: 0, grantCap: 0, scheduleEnd: 0,
    proposedEnd: 0, proposedCap: 0, requested: 'bot', intent: 'none',
    wasLive: false, expired: false, fault: false
  };
}

const KEYS = Object.keys(initialState());

export function stateKey(state) {
  return KEYS.map(key => String(state[key])).join('|');
}

function cleared(state, extra = {}) {
  return {
    ...state,
    mode: 'off', operator: 'bot', host: 'bot', handoff: 'none', phase: 'idle',
    grantEnd: 0, proposedEnd: 0, proposedCap: 0, requested: 'bot', intent: 'none',
    ...extra
  };
}

function endAt(clock, span) {
  return Math.min(MAX, clock + span);
}

export function enabledEvents(state) {
  const events = ['stop', 'local-stop'];
  if (state.clock < MAX) events.push('tick');
  events.push(state.link === 'down' ? 'connect' : 'disconnect');
  if (state.link === 'up' && state.phase === 'arming') events.push('ack-ok', 'ack-bad');
  if (state.link === 'up' && state.phase === 'idle' && !state.stopped) {
    if (state.mode === 'off' || state.mode === 'paused') {
      events.push('go-live-short', 'go-live-long');
      if (state.access === 'owner') events.push('take-control');
      if (state.scheduleEnd > state.clock) events.push('resume');
    }
    if (state.mode === 'armed') {
      events.push('go-live-long', 'pause', 'bot-click', 'bot-scroll', 'switch-bot');
      if (state.access === 'owner') events.push('switch-owner');
      if (state.access === 'owner' && state.operator === 'bot' && state.handoff === 'none') events.push('request-handoff');
      if (state.handoff === 'waiting') events.push('complete-handoff');
    }
  }
  if (state.link === 'up' && state.phase === 'idle' && state.mode === 'off' && !state.stopped) {
    events.push('access-owner', 'access-window');
  }
  if (state.stopped && state.mode === 'off' && state.phase === 'idle') events.push('clear-latch');
  return events;
}

export function applyEvent(state, event, bugs = {}) {
  switch (event) {
    case 'connect':
      return state.link === 'down' ? { ...state, link: 'up' } : null;
    case 'disconnect':
      if (state.link !== 'up') return null;
      return cleared(state, {
        link: 'down', clock: state.clock, access: state.access, stopped: state.stopped,
        wasLive: state.wasLive || state.mode === 'armed', expired: state.expired,
        scheduleEnd: state.scheduleEnd, grantCap: state.scheduleEnd ? state.grantCap : 0
      });
    case 'tick': {
      if (state.clock >= MAX) return null;
      const clock = state.clock + 1;
      const grantOver = state.mode === 'armed' && state.grantEnd > 0 && clock >= state.grantEnd;
      const proposalOver = state.phase === 'arming' && state.proposedEnd > 0 && clock >= state.proposedEnd;
      const scheduleOver = state.scheduleEnd > 0 && clock >= state.scheduleEnd;
      if (grantOver || proposalOver) {
        return cleared(state, {
          clock, expired: true, wasLive: true, stopped: state.stopped, access: state.access,
          link: state.link, scheduleEnd: scheduleOver ? 0 : state.scheduleEnd,
          grantCap: scheduleOver ? 0 : state.grantCap
        });
      }
      return { ...state, clock, scheduleEnd: scheduleOver ? 0 : state.scheduleEnd, grantCap: scheduleOver ? 0 : state.grantCap };
    }
    case 'stop':
      return cleared(state, { stopped: state.stopped, scheduleEnd: 0, grantCap: 0, link: state.link, access: state.access, clock: state.clock, wasLive: state.wasLive || state.mode === 'armed' });
    case 'local-stop':
      if (bugs.ignoreLocalStop) return { ...state, stopped: true };
      return cleared(state, { stopped: true, scheduleEnd: 0, grantCap: 0, link: state.link, access: state.access, clock: state.clock, wasLive: state.wasLive || state.mode === 'armed' });
    case 'clear-latch':
      return state.stopped && state.mode === 'off' && state.phase === 'idle' ? { ...state, stopped: false } : null;
    case 'pause':
      if (state.mode !== 'armed' || state.phase !== 'idle' || state.link !== 'up') return null;
      return cleared(state, { mode: 'paused', scheduleEnd: 0, grantCap: 0, stopped: state.stopped, link: 'up', access: state.access, clock: state.clock, wasLive: true });
    case 'access-owner':
    case 'access-window':
      if (state.mode !== 'off' || state.phase !== 'idle' || state.stopped || state.link !== 'up') return null;
      return { ...state, access: event === 'access-owner' ? 'owner' : 'window' };
    case 'go-live-short':
    case 'go-live-long': {
      if (state.link !== 'up' || state.stopped || state.phase !== 'idle') return null;
      if (state.mode === 'armed' && event === 'go-live-short') return null;
      const end = endAt(state.clock, event === 'go-live-long' ? 4 : 2);
      if (end <= state.clock) return null;
      return { ...state, phase: 'arming', intent: 'live', requested: 'bot', proposedEnd: end, proposedCap: end };
    }
    case 'take-control': {
      if (state.link !== 'up' || state.stopped || state.phase !== 'idle' || state.access !== 'owner' || state.mode === 'armed') return null;
      const end = endAt(state.clock, 4);
      if (end <= state.clock) return null;
      return { ...state, phase: 'arming', intent: 'switch', requested: 'owner', proposedEnd: end, proposedCap: end };
    }
    case 'switch-owner':
    case 'switch-bot': {
      if (state.mode !== 'armed' || state.phase !== 'idle' || state.link !== 'up' || state.stopped) return null;
      const requested = event === 'switch-owner' ? 'owner' : 'bot';
      if (requested === 'owner' && state.access !== 'owner') return null;
      const end = bugs.extendOnSwitch ? endAt(state.clock, 4) : state.grantEnd;
      if (end <= state.clock) return null;
      return { ...state, phase: 'arming', intent: 'switch', requested, proposedEnd: end, proposedCap: state.grantCap };
    }
    case 'resume':
      if (!(state.link === 'up' && state.phase === 'idle' && state.mode === 'off' && !state.stopped && state.scheduleEnd > state.clock)) return null;
      return { ...state, phase: 'arming', intent: 'live', requested: 'bot', proposedEnd: state.scheduleEnd, proposedCap: state.grantCap };
    case 'request-handoff':
      if (!(state.mode === 'armed' && state.phase === 'idle' && state.access === 'owner' && state.operator === 'bot' && state.handoff === 'none' && state.link === 'up')) return null;
      return { ...state, phase: 'arming', intent: 'handoff', requested: 'owner', proposedEnd: state.grantEnd, proposedCap: state.grantCap };
    case 'complete-handoff':
      if (state.handoff !== 'waiting' || state.mode !== 'armed' || state.phase !== 'idle') return null;
      return { ...state, phase: 'arming', intent: 'handoff', requested: 'bot', proposedEnd: state.grantEnd, proposedCap: state.grantCap };
    case 'ack-ok':
    case 'ack-bad': {
      if (state.phase !== 'arming' || state.link !== 'up') return null;
      const claimed = event === 'ack-ok' ? state.requested : (state.requested === 'bot' ? 'owner' : 'bot');
      if (claimed !== state.requested && !bugs.acceptBadAck) {
        return cleared(state, { stopped: state.stopped, scheduleEnd: 0, grantCap: 0, link: 'up', access: state.access, clock: state.clock, wasLive: state.wasLive });
      }
      const handoff = state.intent === 'handoff' ? (state.requested === 'owner' ? 'waiting' : 'done') : 'none';
      return {
        ...state, phase: 'idle', mode: 'armed', operator: state.requested, host: claimed,
        grantEnd: state.proposedEnd, grantCap: state.proposedCap,
        scheduleEnd: state.requested === 'owner' ? 0 : state.proposedEnd,
        handoff, wasLive: true, intent: 'none', expired: false,
        fault: state.fault || claimed !== state.requested
      };
    }
    case 'bot-click': {
      if (state.mode !== 'armed' || state.phase !== 'idle' || state.link !== 'up') return null;
      const blocked = state.operator === 'owner' || state.access === 'owner';
      if (blocked && bugs.allowOwnerInput) return { ...state, fault: true };
      return state;
    }
    case 'bot-scroll':
      if (state.mode !== 'armed' || state.phase !== 'idle' || state.link !== 'up') return null;
      if (state.operator === 'owner') return state;
      return state;
    default:
      return null;
  }
}

export function invariantViolations(state) {
  const problems = [];
  if (state.fault) problems.push(EDITING_REFUSAL);
  if (state.mode === 'armed') {
    if (!(state.grantEnd > state.clock)) problems.push('grant-outlived');
    if (state.grantEnd > state.grantCap) problems.push('grant-extended');
    if (state.phase === 'idle' && state.operator !== state.host) problems.push('operator-unconfirmed');
  }
  if (state.stopped && state.mode !== 'off') problems.push('stop-bypassed');
  if (state.link === 'down' && (state.mode !== 'off' || state.handoff !== 'none' || state.phase !== 'idle')) problems.push('disconnected-live');
  if (state.handoff === 'waiting' && (state.operator !== 'owner' || state.mode !== 'armed' || state.link !== 'up')) problems.push('handoff-stuck');
  if (state.scheduleEnd > state.grantCap) problems.push('schedule-outlives-grant');
  return problems;
}

function note(reached, state) {
  if (state.link === 'up' && state.mode === 'off' && !state.stopped && state.phase === 'idle') reached.add('authenticated-off');
  if (state.phase === 'arming') reached.add('arming');
  if (state.mode === 'armed' && state.phase === 'idle' && state.operator === 'bot' && state.host === 'bot') reached.add('live-bot');
  if (state.mode === 'armed' && state.phase === 'idle' && state.operator === 'owner' && state.host === 'owner') reached.add('live-owner');
  if (state.handoff === 'waiting') reached.add('handoff-waiting');
  if (state.handoff === 'done' && state.mode === 'armed' && state.operator === 'bot') reached.add('handoff-completed');
  if (state.expired && state.mode === 'off') reached.add('expired');
  if (state.stopped && state.mode === 'off') reached.add('stop-latched');
  if (state.link === 'down' && state.wasLive && state.mode === 'off') reached.add('disconnected');
  if (state.mode === 'paused') reached.add('paused');
}

export function explore(bugs = {}, limit = 20000) {
  const seen = new Set();
  const queue = [initialState()];
  const violations = [];
  const reached = new Set();
  while (queue.length && seen.size < limit && violations.length < 12) {
    const state = queue.shift();
    const key = stateKey(state);
    if (seen.has(key)) continue;
    seen.add(key);
    note(reached, state);
    for (const code of invariantViolations(state)) violations.push({ code, state });
    const remoteStop = applyEvent(state, 'stop', {});
    if (!remoteStop || remoteStop.mode !== 'off' || remoteStop.handoff !== 'none' || remoteStop.grantEnd !== 0 || remoteStop.scheduleEnd !== 0) {
      violations.push({ code: 'stop-missed', state });
    }
    if (violations.length >= 12) break;
    for (const event of enabledEvents(state)) {
      const next = applyEvent(state, event, bugs);
      if (next && !seen.has(stateKey(next))) queue.push(next);
    }
  }
  return { violations, reached, states: seen.size, truncated: seen.size >= limit };
}
