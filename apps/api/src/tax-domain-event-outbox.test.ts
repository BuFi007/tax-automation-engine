import { describe, expect, test } from 'bun:test';

import type { TaxDomainEventV1 } from '@tax-engine/core';

import { TaxProfileStore } from './store';

const HASH = 'a'.repeat(64);
const now = '2026-07-17T00:00:00.000Z';

function event(id = '00000000-0000-4000-8000-000000000001'): TaxDomainEventV1 {
  return {
    version: 'tax-domain-event-v1', eventId: id, workspaceId: 'workspace_opaque_1', caseRef: 'taxcase_opaque_1',
    kind: 'invoice.settlement_finalized', state: 'verified', occurredAt: now,
    idempotencyKey: 'invoice-settlement-finalized_1', correlationRef: 'correlation_1',
    source: { system: 'invoice_ledger', sourceEventHash: HASH, verifiedAt: now },
    authentication: { method: 'internal_outbox', principalRef: 'principal_invoice_worker', credentialVersion: 'grant-v1', signatureHash: HASH },
    consent: { purpose: 'tax_workspace_processing', version: 'consent-v1', scopeHash: HASH, state: 'active' },
    evidenceHashes: [HASH], ruleVersionIds: ['rule_1'], policyVersionIds: ['policy_1'], actionRefs: ['action_review_tax_case'],
  };
}

describe('TaxDomainEvent outbox', () => {
  test('persists before leasing, converges a retry, and only removes work after ack', () => {
    const store = new TaxProfileStore(':memory:');
    try {
      expect(store.appendTaxDomainEvent(event(), now).replayed).toBe(false);
      expect(store.appendTaxDomainEvent(event(), now).replayed).toBe(true);
      expect(store.leaseTaxDomainEvents({ now, leaseUntil: '2026-07-17T00:01:00.000Z', limit: 10 })).toEqual([event()]);
      expect(store.listPendingTaxDomainEvents()).toEqual([event()]);
      store.ackTaxDomainEventDelivery(event().eventId, '2026-07-17T00:00:02.000Z');
      expect(store.listPendingTaxDomainEvents()).toEqual([]);
      // At-least-once acks converge as success rather than reopening the event.
      expect(() => store.ackTaxDomainEventDelivery(event().eventId, '2026-07-17T00:00:03.000Z')).not.toThrow();
    } finally {
      store.close();
    }
  });

  test('fails closed on conflicting replay and permits lease retry after a delivery failure', () => {
    const store = new TaxProfileStore(':memory:');
    try {
      store.appendTaxDomainEvent(event(), now);
      expect(() => store.appendTaxDomainEvent({ ...event(), state: 'recorded' }, now)).toThrow('TAX_DOMAIN_EVENT_IDEMPOTENCY_CONFLICT');
      const [leased] = store.leaseTaxDomainEvents({ now, leaseUntil: '2026-07-17T00:01:00.000Z', limit: 1 });
      store.releaseTaxDomainEventDelivery(leased!.eventId, '2026-07-17T00:00:10.000Z', 'TARGET_TIMEOUT');
      expect(store.leaseTaxDomainEvents({ now: '2026-07-17T00:00:10.000Z', leaseUntil: '2026-07-17T00:01:10.000Z', limit: 1 })).toEqual([event()]);
    } finally {
      store.close();
    }
  });

  test('reports when undelivered work is next due, for the work-driven alarm', () => {
    const store = new TaxProfileStore(':memory:');
    try {
      expect(store.nextTaxDomainEventDueAt()).toBeNull();
      store.appendTaxDomainEvent(event(), now);
      expect(store.nextTaxDomainEventDueAt()).toBe('');
      store.leaseTaxDomainEvents({ now, leaseUntil: '2026-07-17T00:01:00.000Z', limit: 1 });
      expect(store.nextTaxDomainEventDueAt()).toBe('2026-07-17T00:01:00.000Z');
      store.ackTaxDomainEventDelivery(event().eventId, '2026-07-17T00:00:02.000Z');
      expect(store.nextTaxDomainEventDueAt()).toBeNull();
    } finally {
      store.close();
    }
  });
});
