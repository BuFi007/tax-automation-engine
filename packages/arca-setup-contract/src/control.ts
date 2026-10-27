import type { ArcaSetupControlMode, ArcaSetupWireControl } from './index';

/**
 * One controller per browser session.
 *
 * This is the executor's own state machine: the session transport enforces it
 * (which Live View link it will mint, and whether automation may touch the
 * page), so a UI that forgot to disable a button cannot grant control.
 *
 * Requests are recorded immediately; they take effect only at a SAFE POINT —
 * between orders, or while automation is already waiting on a human — and
 * the acknowledgement is what callers wait for. Nothing here ever reads page
 * content or holds a Live View link.
 */

export type ControlState = Readonly<{
  mode: ArcaSetupControlMode;
  controllerRef: string | null;
  requestId: string | null;
  requestedAt: string | null;
  acknowledgedAt: string | null;
  generation: number;
  rejection: string | null;
  /** Request ids already applied, for idempotent retries. */
  applied: readonly string[];
}>;

export const INITIAL_CONTROL: ControlState = {
  mode: 'automation',
  controllerRef: null,
  requestId: null,
  requestedAt: null,
  acknowledgedAt: null,
  generation: 0,
  rejection: null,
  applied: [],
};

export type ControlRequestResult =
  | Readonly<{ outcome: 'accepted' | 'unchanged' | 'duplicate'; state: ControlState }>
  | Readonly<{ outcome: 'conflict'; code: string; state: ControlState }>;

const HUMAN_MODES: readonly ArcaSetupControlMode[] = ['control_requested', 'human', 'return_requested'];

function record(state: ControlState, request: ArcaSetupWireControl, next: Partial<ControlState>): ControlState {
  return {
    ...state,
    ...next,
    requestId: request.requestId,
    requestedAt: request.requestedAt,
    acknowledgedAt: null,
    rejection: null,
    applied: [...state.applied, request.requestId].slice(-100),
  };
}

export function applyControlRequest(state: ControlState, request: ArcaSetupWireControl): ControlRequestResult {
  if (state.applied.includes(request.requestId)) return { outcome: 'duplicate', state };
  const conflict = (code: string): ControlRequestResult => ({ outcome: 'conflict', code, state });
  const unchanged = (): ControlRequestResult => ({ outcome: 'unchanged', state: { ...state, applied: [...state.applied, request.requestId].slice(-100) } });
  const heldByOther = state.controllerRef !== null && state.controllerRef !== request.actorRef;

  switch (request.action) {
    case 'pause':
      if (state.mode === 'automation') return { outcome: 'accepted', state: record(state, request, { mode: 'pause_requested' }) };
      if (state.mode === 'pause_requested' || state.mode === 'paused') return unchanged();
      return conflict('ARCA_CONTROL_HELD_BY_HUMAN');
    case 'resume':
      if (state.mode === 'paused' || state.mode === 'pause_requested')
        return { outcome: 'accepted', state: record(state, request, { mode: 'automation' }) };
      if (state.mode === 'automation') return unchanged();
      return conflict('ARCA_CONTROL_RETURN_REQUIRED');
    case 'take_control':
      if (HUMAN_MODES.includes(state.mode)) return heldByOther ? conflict('ARCA_CONTROL_ALREADY_HELD') : unchanged();
      return { outcome: 'accepted', state: record(state, request, { mode: 'control_requested', controllerRef: request.actorRef }) };
    case 'return_control':
      if (!HUMAN_MODES.includes(state.mode)) return conflict('ARCA_CONTROL_NOT_HELD');
      if (heldByOther) return conflict('ARCA_CONTROL_NOT_HOLDER');
      if (state.mode === 'return_requested') return unchanged();
      // Withdrawn before it was granted: nothing to hand back.
      if (state.mode === 'control_requested')
        return { outcome: 'accepted', state: record(state, request, { mode: 'automation', controllerRef: null }) };
      return { outcome: 'accepted', state: record(state, request, { mode: 'return_requested' }) };
  }
}

export type SafePointContext = Readonly<{
  handoff: 'none' | 'authentication' | 'choice';
  /** Whether the tab currently sits on an allowed ARCA host. */
  pageOnAllowedHost: boolean;
  now: Date;
}>;

export type SafePointResult = Readonly<{
  state: ControlState;
  /** Open a fresh tab and close the old one, so previously issued interactive links stop working. */
  rotateTab: boolean;
  /** Control came back from a human: whatever was planned before must be re-inspected first. */
  reinspect: boolean;
}>;

/** Apply pending requests at a point where automation is not mid-operation. */
export function atSafePoint(state: ControlState, context: SafePointContext): SafePointResult {
  const at = context.now.toISOString();
  switch (state.mode) {
    case 'pause_requested':
      return { state: { ...state, mode: 'paused', acknowledgedAt: at }, rotateTab: false, reinspect: false };
    case 'control_requested':
      return {
        state: { ...state, mode: 'human', acknowledgedAt: at, generation: state.generation + 1 },
        rotateTab: true,
        reinspect: false,
      };
    case 'return_requested': {
      const rejection = context.handoff !== 'none'
        ? 'ARCA_CONTROL_HANDOFF_OPEN'
        : !context.pageOnAllowedHost ? 'ARCA_CONTROL_PAGE_OFF_ARCA' : null;
      if (rejection) return { state: { ...state, mode: 'human', rejection, acknowledgedAt: at }, rotateTab: false, reinspect: false };
      return {
        state: { ...state, mode: 'automation', controllerRef: null, acknowledgedAt: at, generation: state.generation + 1 },
        rotateTab: true,
        reinspect: true,
      };
    }
    default:
      return { state, rotateTab: false, reinspect: false };
  }
}

export function automationMayRun(state: ControlState): boolean {
  return state.mode === 'automation';
}

/** Only the acknowledged controller may receive the interactive tab. */
export function mayControl(state: ControlState, actorRef: string): boolean {
  return state.mode === 'human' && state.controllerRef === actorRef;
}
