import { describe, expect, test } from 'bun:test';

import type { ArcaSetupWireControl } from './index';

import { applyControlRequest, atSafePoint, automationMayRun, INITIAL_CONTROL, mayControl, type ControlState } from './control';

const A = `actor:${'a'.repeat(64)}`;
const B = `actor:${'b'.repeat(64)}`;
let counter = 0;
function request(action: ArcaSetupWireControl['action'], actorRef = A): ArcaSetupWireControl {
  counter += 1;
  return {
    version: 'arca-setup-control-v1', executionId: '22222222-2222-4222-8222-222222222222', action, actorRef,
    requestId: `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`, requestedAt: '2026-10-26T12:00:00.000Z',
  };
}
const ctx = { handoff: 'none' as const, pageOnAllowedHost: true, now: new Date('2026-10-26T12:00:05.000Z') };
function apply(state: ControlState, req: ArcaSetupWireControl): ControlState {
  const result = applyControlRequest(state, req);
  if (result.outcome === 'conflict') throw new Error(result.code);
  return result.state;
}

describe('one controller per browser session', () => {
  test('pause stays pending until the executor acknowledges it at a safe point', () => {
    const pending = apply(INITIAL_CONTROL, request('pause'));
    expect(pending.mode).toBe('pause_requested');
    expect(pending.acknowledgedAt).toBeNull();
    expect(automationMayRun(pending)).toBe(false);
    const paused = atSafePoint(pending, ctx).state;
    expect(paused).toMatchObject({ mode: 'paused', acknowledgedAt: ctx.now.toISOString() });
    expect(apply(paused, request('resume')).mode).toBe('automation');
  });

  test('a retried request is a duplicate, not a second transition', () => {
    const req = request('pause');
    const once = apply(INITIAL_CONTROL, req);
    expect(applyControlRequest(once, req).outcome).toBe('duplicate');
  });

  test('take control grants exactly one actor, after acknowledgement, and rotates the tab', () => {
    const requested = apply(INITIAL_CONTROL, request('take_control', A));
    expect(mayControl(requested, A)).toBe(false); // not yet acknowledged
    const granted = atSafePoint(requested, ctx);
    expect(granted.rotateTab).toBe(true);
    expect(granted.state.generation).toBe(1);
    expect(mayControl(granted.state, A)).toBe(true);
    expect(mayControl(granted.state, B)).toBe(false);
    expect(applyControlRequest(granted.state, request('take_control', B))).toMatchObject({ outcome: 'conflict', code: 'ARCA_CONTROL_ALREADY_HELD' });
    expect(applyControlRequest(granted.state, request('return_control', B))).toMatchObject({ outcome: 'conflict', code: 'ARCA_CONTROL_NOT_HOLDER' });
    expect(applyControlRequest(granted.state, request('pause', B))).toMatchObject({ outcome: 'conflict', code: 'ARCA_CONTROL_HELD_BY_HUMAN' });
    expect(applyControlRequest(granted.state, request('resume', A))).toMatchObject({ outcome: 'conflict', code: 'ARCA_CONTROL_RETURN_REQUIRED' });
  });

  test('return control is validated by the executor before automation resumes', () => {
    const human = atSafePoint(apply(INITIAL_CONTROL, request('take_control')), ctx).state;
    const returning = apply(human, request('return_control'));
    expect(returning.mode).toBe('return_requested');
    const openHandoff = atSafePoint(returning, { ...ctx, handoff: 'choice' });
    expect(openHandoff.state).toMatchObject({ mode: 'human', rejection: 'ARCA_CONTROL_HANDOFF_OPEN', controllerRef: A });
    const offArca = atSafePoint(returning, { ...ctx, pageOnAllowedHost: false });
    expect(offArca.state.rejection).toBe('ARCA_CONTROL_PAGE_OFF_ARCA');
    const back = atSafePoint(returning, ctx);
    expect(back).toMatchObject({ rotateTab: true, reinspect: true });
    expect(back.state).toMatchObject({ mode: 'automation', controllerRef: null, generation: 2 });
    expect(mayControl(back.state, A)).toBe(false);
  });

  test('a take-control request can be withdrawn before it is granted', () => {
    const requested = apply(INITIAL_CONTROL, request('take_control'));
    expect(apply(requested, request('return_control')).mode).toBe('automation');
    expect(applyControlRequest(INITIAL_CONTROL, request('return_control'))).toMatchObject({ outcome: 'conflict', code: 'ARCA_CONTROL_NOT_HELD' });
  });
});
