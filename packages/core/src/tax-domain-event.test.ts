import { describe, expect, test } from 'bun:test';

import {
  assertTaxDomainEventV1,
  createTaxDomainEventDeliveryV1,
  TAX_DOMAIN_EVENT_KINDS_V1,
} from './tax-domain-event';

const HASH = 'a'.repeat(64);
const now = '2026-07-17T00:00:00.000Z';

function event(kind = 'invoice.settlement_finalized'): Record<string, unknown> {
  return {
    version: 'tax-domain-event-v1',
    eventId: '00000000-0000-4000-8000-000000000001',
    workspaceId: 'workspace_opaque_1',
    caseRef: 'taxcase_opaque_1',
    kind,
    state: 'verified',
    occurredAt: now,
    idempotencyKey: 'invoice-settlement-finalized_1',
    correlationRef: 'correlation_1',
    source: { system: 'invoice_ledger', sourceEventHash: HASH, verifiedAt: now },
    authentication: { method: 'internal_outbox', principalRef: 'principal_invoice_worker', credentialVersion: 'grant-v1', signatureHash: HASH },
    consent: { purpose: 'tax_workspace_processing', version: 'consent-v1', scopeHash: HASH, state: 'active' },
    evidenceHashes: [HASH],
    ruleVersionIds: ['rule_1'],
    policyVersionIds: ['policy_1'],
    actionRefs: ['action_review_tax_case'],
  };
}

describe('TaxDomainEventV1', () => {
  test('supports every allowlisted external truth transition', () => {
    expect(TAX_DOMAIN_EVENT_KINDS_V1).toHaveLength(9);
    for (const kind of TAX_DOMAIN_EVENT_KINDS_V1) {
      expect(assertTaxDomainEventV1(event(kind))).toMatchObject({ kind, workspaceId: 'workspace_opaque_1' });
    }
  });

  test('accepts a hash-bound durable delivery envelope', () => {
    const delivery = createTaxDomainEventDeliveryV1({
      deliveryId: '00000000-0000-4000-8000-000000000002',
      event: assertTaxDomainEventV1(event()),
      deliveredAt: now,
    });
    expect(delivery.payloadHash).toHaveLength(64);
  });

  test('fails closed on raw fiscal fields, amounts, or transport tampering', () => {
    expect(() => assertTaxDomainEventV1({ ...event(), cuit: '9'.repeat(11) })).toThrow();
    expect(() => assertTaxDomainEventV1({ ...event(), amount: { decimal: '1', currency: 'USD' } })).toThrow();
    expect(() => assertTaxDomainEventV1({ ...event(), caseRef: '9'.repeat(11) })).toThrow();
    expect(() => createTaxDomainEventDeliveryV1({
      deliveryId: '00000000-0000-4000-8000-000000000002',
      event: assertTaxDomainEventV1(event()),
      deliveredAt: 'not-an-instant',
    })).toThrow();
  });

  test('accepts opaque UUID workspace and TaxCase references used in production', () => {
    expect(assertTaxDomainEventV1({
      ...event(),
      workspaceId: '10000000-0000-4000-8000-000000000001',
      caseRef: '20000000-0000-4000-8000-000000000001',
    })).toMatchObject({
      workspaceId: '10000000-0000-4000-8000-000000000001',
      caseRef: '20000000-0000-4000-8000-000000000001',
    });
  });
});
