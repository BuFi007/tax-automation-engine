import { describe, expect, test } from 'bun:test';

import type { ArcaSetupHandoffTicket, ArcaSetupWireControl } from '@tax-engine/arca-setup-contract';
import { applyControlRequest, atSafePoint, INITIAL_CONTROL, type ControlState } from '@tax-engine/arca-setup-contract/control';

import { currentHandoff, TICKET_REFUSAL_MESSAGES, ticketRefusal, type PolicyCurrent } from './session-policy';

const EXECUTION = '22222222-2222-4222-8222-222222222222';
const A = `actor:${'a'.repeat(64)}`;
const B = `actor:${'b'.repeat(64)}`;
const PURPOSES: ArcaSetupHandoffTicket['purpose'][] = ['customer_authentication', 'provider_authentication', 'customer_view', 'customer_control'];

let counter = 0;
function request(action: ArcaSetupWireControl['action'], actorRef = A): ArcaSetupWireControl {
  counter += 1;
  return {
    version: 'arca-setup-control-v1', executionId: EXECUTION, action, actorRef,
    requestId: `33333333-3333-4333-8333-${String(counter).padStart(12, '0')}`, requestedAt: '2026-10-26T12:00:00.000Z',
  };
}
function apply(state: ControlState, req: ArcaSetupWireControl): ControlState {
  const result = applyControlRequest(state, req);
  if (result.outcome === 'conflict') throw new Error(result.code);
  return result.state;
}
const requested = apply(INITIAL_CONTROL, request('take_control'));
const held = atSafePoint(requested, { handoff: 'none', pageOnAllowedHost: true, now: new Date('2026-10-26T12:00:05.000Z') }).state;

const awaiting = (role: 'customer' | 'provider', reason: 'authentication' | 'choice'): PolicyCurrent => ({ state: 'awaiting_handoff', handoff: { role, reason } });
const base = {
  ticketExecutionId: EXECUTION,
  actorId: A,
  metaExecutionId: EXECUTION,
  redeemed: false,
  cancelled: false,
  current: { state: 'queued', handoff: null } as PolicyCurrent | null,
  control: INITIAL_CONTROL,
  liveViewConfigured: true,
};

describe('ARCA handoff ticket policy', () => {
  test('redeemed, cancelled and mismatched tickets are refused for every purpose', () => {
    for (const purpose of PURPOSES) {
      const permissive = { ...base, purpose, current: awaiting(purpose === 'provider_authentication' ? 'provider' : 'customer', 'choice'), control: held };
      expect(ticketRefusal(permissive)).toBeNull();
      expect(ticketRefusal({ ...permissive, redeemed: true })).toBe('redeemed_or_finished');
      expect(ticketRefusal({ ...permissive, cancelled: true })).toBe('redeemed_or_finished');
      expect(ticketRefusal({ ...permissive, metaExecutionId: null })).toBe('redeemed_or_finished');
      expect(ticketRefusal({ ...permissive, metaExecutionId: '44444444-4444-4444-8444-444444444444' })).toBe('redeemed_or_finished');
    }
  });

  test('sign-in tickets need a pending handoff for the same role', () => {
    expect(ticketRefusal({ ...base, purpose: 'customer_authentication', current: awaiting('customer', 'authentication') })).toBeNull();
    expect(ticketRefusal({ ...base, purpose: 'provider_authentication', current: awaiting('provider', 'authentication') })).toBeNull();
    expect(ticketRefusal({ ...base, purpose: 'customer_authentication', current: awaiting('provider', 'authentication') })).toBe('no_pending_sign_in');
    expect(ticketRefusal({ ...base, purpose: 'provider_authentication', current: awaiting('customer', 'authentication') })).toBe('no_pending_sign_in');
    for (const purpose of ['customer_authentication', 'provider_authentication'] as const) {
      expect(ticketRefusal({ ...base, purpose })).toBe('no_pending_sign_in');
      expect(ticketRefusal({ ...base, purpose, current: null })).toBe('no_pending_sign_in');
      expect(ticketRefusal({ ...base, purpose, current: { state: 'done', handoff: null } })).toBe('no_pending_sign_in');
    }
  });

  test('the shared preview is withheld while credentials are typed or when Live View is not configured', () => {
    expect(ticketRefusal({ ...base, purpose: 'customer_view', current: awaiting('customer', 'authentication') })).toBe('private_sign_in');
    expect(ticketRefusal({ ...base, purpose: 'customer_view', current: awaiting('provider', 'authentication') })).toBe('private_sign_in');
    expect(ticketRefusal({ ...base, purpose: 'customer_view', liveViewConfigured: false })).toBe('preview_unavailable');
    expect(ticketRefusal({ ...base, purpose: 'customer_view' })).toBeNull();
    expect(ticketRefusal({ ...base, purpose: 'customer_view', current: null })).toBeNull();
    expect(ticketRefusal({ ...base, purpose: 'customer_view', current: awaiting('customer', 'choice') })).toBeNull();
  });

  test('only the acknowledged controller receives the interactive tab', () => {
    expect(ticketRefusal({ ...base, purpose: 'customer_control' })).toBe('not_controller');
    expect(ticketRefusal({ ...base, purpose: 'customer_control', control: requested })).toBe('not_controller');
    expect(ticketRefusal({ ...base, purpose: 'customer_control', control: held, actorId: B })).toBe('not_controller');
    expect(ticketRefusal({ ...base, purpose: 'customer_control', control: held })).toBeNull();
  });

  test('every refusal has a user-facing message', () => {
    for (const message of Object.values(TICKET_REFUSAL_MESSAGES)) expect(message.length).toBeGreaterThan(0);
  });

  test('the handoff a safe point sees is open only while awaiting a human', () => {
    expect(currentHandoff(null)).toBe('none');
    expect(currentHandoff({ state: 'queued', handoff: null })).toBe('none');
    expect(currentHandoff({ state: 'queued', handoff: { role: 'customer', reason: 'choice' } })).toBe('none');
    expect(currentHandoff({ state: 'awaiting_handoff', handoff: null })).toBe('none');
    expect(currentHandoff(awaiting('customer', 'authentication'))).toBe('authentication');
    expect(currentHandoff(awaiting('provider', 'choice'))).toBe('choice');
  });
});
