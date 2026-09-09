export type SessionMode = 'off' | 'armed' | 'paused' | 'running';

export interface RelayState {
  mode: SessionMode;
  expiresAt: number | null;
  hostLastSeen: number | null;
  activeBot: string | null;
  leaseEndsAt: number | null;
}

export const DEFAULT_STATE: RelayState = {
  mode: 'off', expiresAt: null, hostLastSeen: null, activeBot: null, leaseEndsAt: null
};

export function normalizeMode(value: unknown): SessionMode | null {
  return ['off', 'armed', 'paused', 'running'].includes(String(value)) ? value as SessionMode : null;
}

export function clampMinutes(value: unknown): number {
  const parsed = Number.parseInt(String(value ?? '480'), 10);
  if (!Number.isFinite(parsed)) return 480;
  return Math.min(720, Math.max(5, parsed));
}

export function effectiveState(state: RelayState, now = Date.now()): RelayState {
  if ((['armed', 'running'].includes(state.mode) && !Number.isFinite(state.expiresAt)) || (state.expiresAt !== null && now >= state.expiresAt)) {
    return { ...state, mode: 'off', expiresAt: null, activeBot: null, leaseEndsAt: null };
  }
  if (state.leaseEndsAt && now >= state.leaseEndsAt) {
    return { ...state, activeBot: null, leaseEndsAt: null, mode: state.mode === 'running' ? 'armed' : state.mode };
  }
  return state;
}

export function canBotControl(state: RelayState, botId: string, now = Date.now()): { allowed: boolean; error?: string; next?: RelayState } {
  const current = effectiveState(state, now);
  if (current.mode !== 'armed' && current.mode !== 'running') return { allowed: false, error: 'not-armed', next: current };
  if (current.activeBot && current.activeBot !== botId) return { allowed: false, error: 'bot-lease-held', next: current };
  return {
    allowed: true,
    next: { ...current, mode: 'running', activeBot: botId, leaseEndsAt: Math.min(now + 60_000, current.expiresAt!) }
  };
}
