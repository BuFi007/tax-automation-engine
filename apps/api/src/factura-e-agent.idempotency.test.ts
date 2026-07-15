import { describe, expect, test } from 'bun:test';

import { hashCanonical, type FacturaEIntentV1 } from '@tax-engine/core';

import { FacturaEAgentService } from './factura-e-agent';
import { TaxProfileStore } from './store';

const runId = '30000000-0000-4000-8000-000000000001';
const occurredAt = '2026-07-15T15:00:00.000Z';

describe('Factura E command idempotency', () => {
  test('replays the same command but conflicts when one run/key is reused with a changed body', () => {
    const service = new FacturaEAgentService(new TaxProfileStore(':memory:'), null, null);
    service.createRun({
      runId,
      workspaceId: 'workspace-idempotency',
      issuancePath: 'reclaim_copilot',
      actorId: 'agent:tax',
      idempotencyKey: 'create-idempotency-run',
      occurredAt,
    });
    service.draftIntent({
      runId,
      intent: intent(),
      asOf: '2026-07-15',
      actorId: 'agent:tax',
      idempotencyKey: 'draft-idempotency-intent',
      occurredAt,
    });
    const settlement = {
      settlementReferenceHash: hashCanonical('idempotent-settlement'),
      asset: 'USDC',
      network: 'base',
      amount: { decimal: '1000', currency: 'USD' },
      observedAt: occurredAt,
      finalityState: 'final' as const,
      fees: null,
      reversesSettlementReferenceHash: null,
    };
    const first = service.recordSettlement({
      runId,
      settlement,
      actorId: 'agent:tax',
      idempotencyKey: 'record-idempotent-settlement',
      occurredAt,
    });
    const replay = service.recordSettlement({
      runId,
      settlement,
      actorId: 'agent:tax',
      idempotencyKey: 'record-idempotent-settlement',
      occurredAt: '2026-07-15T15:01:00.000Z',
    });
    expect(replay.replayed).toBe(true);
    expect(replay.run.revision).toBe(first.run.revision);

    expect(() => service.recordSettlement({
      runId,
      settlement: { ...settlement, amount: { decimal: '999', currency: 'USD' } },
      actorId: 'agent:tax',
      idempotencyKey: 'record-idempotent-settlement',
      occurredAt: '2026-07-15T15:02:00.000Z',
    })).toThrow('AGENT_IDEMPOTENCY_CONFLICT');
  });

  test('does not allow an idempotency key to be reused for another operation', () => {
    const service = new FacturaEAgentService(new TaxProfileStore(':memory:'), null, null);
    service.createRun({
      runId,
      workspaceId: 'workspace-idempotency',
      issuancePath: 'reclaim_copilot',
      actorId: 'agent:tax',
      idempotencyKey: 'shared-operation-key',
      occurredAt,
    });
    expect(() => service.draftIntent({
      runId,
      intent: intent(),
      asOf: '2026-07-15',
      actorId: 'agent:tax',
      idempotencyKey: 'shared-operation-key',
      occurredAt,
    })).toThrow('AGENT_IDEMPOTENCY_CONFLICT');
  });
});

function intent(): FacturaEIntentV1 {
  return {
    version: 'factura-e-intent-v1',
    intentId: 'intent-idempotency',
    workspaceId: 'workspace-idempotency',
    taxpayerReferenceHash: hashCanonical('taxpayer-idempotency'),
    foreignCustomerReferenceHash: hashCanonical('customer-idempotency'),
    foreignCustomerSafeLabel: 'Foreign customer',
    destinationCountry: 'US',
    destinationCountryArcaCode: 200,
    documentType: 19,
    operationType: 2,
    pointOfSale: 4,
    issueDate: '2026-07-15',
    paymentDate: '2026-07-15',
    sameCurrencyPayment: true,
    exchangeRate: {
      decimal: '1200',
      sourceReferenceId: 'fx:bna:2026-07-14',
      observedForDate: '2026-07-14',
      authorityRuleDecisionId: 'arca-fx-review-v1',
    },
    lineItems: [{ description: 'Software services', quantity: '1', unitPrice: '1000', total: '1000', unitCode: 7 }],
    total: { decimal: '1000', currency: 'USD' },
    serviceDescription: 'Software development services used abroad',
    paymentTerms: 'Due on receipt',
    ruleVersionIds: ['ar-rg-4401-factura-e-v1', 'arca-wsfex-3.1.1', 'bcra-a8330-service-exports-v1'],
  };
}
