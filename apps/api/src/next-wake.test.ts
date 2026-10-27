import { describe, expect, test } from 'bun:test';

import type { ArcaSetupExecutionV1, TaxDomainEventV1 } from '@tax-engine/core';
import { DurableObjectSqlDatabase } from '@tax-engine/sql-store/durable-object';
import { createFakeDurableObjectStorage } from '@tax-engine/sql-store/testing';

import { createTaxApi } from './app';
import { ArcaSetupStore } from './arca-setup-store';
import { computeNextWakeAt, type TaxApiWakeSources } from './next-wake';
import { TaxProfileStore } from './store';

const NOW = Date.parse('2026-07-17T00:00:00.000Z');
const HASH = 'a'.repeat(64);

function facturaE(
  work: Readonly<{ candidates?: number; outboxDueAt?: string | null }>,
  enabled = true,
): NonNullable<TaxApiWakeSources['facturaE']> {
  return {
    enabled,
    pollIntervalMs: 5_000,
    store: {
      projectionCandidates: () => Array.from({ length: work.candidates ?? 0 }, (_, i) => `execution-${i}`),
      nextFeatureOutboxDueAt: () => work.outboxDueAt ?? null,
    },
  };
}
const outbox = (dueAt: string | null) => ({ nextTaxDomainEventDueAt: () => dueAt });
const idle: TaxApiWakeSources = {
  facturaE: facturaE({}),
  taxDomain: { pollIntervalMs: 10_000, outboxes: [outbox(null), outbox(null)] },
  arcaSetup: { intervalMs: 30_000, hasWork: () => false },
};

describe('computeNextWakeAt', () => {
  test('null when every loop is idle or absent', () => {
    expect(computeNextWakeAt(NOW, idle)).toBeNull();
    expect(computeNextWakeAt(NOW, { facturaE: null, taxDomain: null, arcaSetup: null })).toBeNull();
  });

  test('a claimable tax-domain outbox row wakes after one poll; a leased one at its lease end', () => {
    expect(computeNextWakeAt(NOW, { ...idle, taxDomain: { pollIntervalMs: 10_000, outboxes: [outbox('')] } }))
      .toBe(NOW + 10_000);
    expect(computeNextWakeAt(NOW, {
      ...idle, taxDomain: { pollIntervalMs: 10_000, outboxes: [outbox(null), outbox('2026-07-17T00:01:00.000Z')] },
    })).toBe(NOW + 60_000);
  });

  test('open ARCA setup work wakes after one setup tick', () => {
    expect(computeNextWakeAt(NOW, { ...idle, arcaSetup: { intervalMs: 30_000, hasWork: () => true } }))
      .toBe(NOW + 30_000);
  });

  test('Factura E projection candidates and claimable outbox rows wake after one poll', () => {
    expect(computeNextWakeAt(NOW, { ...idle, facturaE: facturaE({ candidates: 1 }) })).toBe(NOW + 5_000);
    expect(computeNextWakeAt(NOW, { ...idle, facturaE: facturaE({ outboxDueAt: new Date(NOW).toISOString() }) }))
      .toBe(NOW + 5_000);
  });

  test('a backed-off Factura E outbox row wakes at its next attempt, not at the next poll', () => {
    expect(computeNextWakeAt(NOW, { ...idle, facturaE: facturaE({ outboxDueAt: '2026-07-17T00:05:00.000Z' }) }))
      .toBe(NOW + 300_000);
  });

  test('Factura E work never wakes the Durable Object while the publication flag is off', () => {
    expect(computeNextWakeAt(NOW, {
      ...idle, facturaE: facturaE({ candidates: 3, outboxDueAt: '' }, false),
    })).toBeNull();
  });

  test('the earliest loop wins', () => {
    expect(computeNextWakeAt(NOW, {
      facturaE: facturaE({ outboxDueAt: '2026-07-17T00:05:00.000Z' }),
      taxDomain: { pollIntervalMs: 10_000, outboxes: [outbox('2026-07-17T00:00:40.000Z')] },
      arcaSetup: { intervalMs: 30_000, hasWork: () => true },
    })).toBe(NOW + 30_000);
  });
});

function domainEvent(): TaxDomainEventV1 {
  const at = new Date(NOW).toISOString();
  return {
    version: 'tax-domain-event-v1', eventId: '00000000-0000-4000-8000-000000000001', workspaceId: 'workspace_opaque_1',
    caseRef: 'taxcase_opaque_1', kind: 'invoice.settlement_finalized', state: 'verified', occurredAt: at,
    idempotencyKey: 'invoice-settlement-finalized_1', correlationRef: 'correlation_1',
    source: { system: 'invoice_ledger', sourceEventHash: HASH, verifiedAt: at },
    authentication: { method: 'internal_outbox', principalRef: 'principal_invoice_worker', credentialVersion: 'grant-v1', signatureHash: HASH },
    consent: { purpose: 'tax_workspace_processing', version: 'consent-v1', scopeHash: HASH, state: 'active' },
    evidenceHashes: [HASH], ruleVersionIds: ['rule_1'], policyVersionIds: ['policy_1'], actionRefs: ['action_review_tax_case'],
  };
}

const secret = (label: string) => `${label}-secret-of-at-least-thirty-two-characters`;
const SETUP_ENV = {
  TAX_ARCA_SETUP_ENABLED: 'true',
  ARCA_SETUP_ORDER_SECRET: secret('order'),
  ARCA_SETUP_RECEIPT_SECRET: secret('receipt'),
  ARCA_SETUP_HANDOFF_SECRET: secret('handoff'),
  TAX_ENGINE_ARCA_PROVIDER_OPERATOR_TOKEN: secret('operator'),
  ARCA_BOUNDARY_SETUP_TOKEN: secret('boundary'),
};

/** The real `createTaxApi` over one fake DO database, as the TaxState Durable Object runs it. */
function withApi(env: Record<string, string>, run: (api: ReturnType<typeof createTaxApi>, database: DurableObjectSqlDatabase) => void) {
  const storage = createFakeDurableObjectStorage();
  try {
    const database = new DurableObjectSqlDatabase(storage);
    run(createTaxApi({ env: { ARCA_ENVIRONMENT: 'homologation', ...env }, openDatabase: () => database }), database);
  } finally {
    storage.close();
  }
}

describe('createTaxApi nextWakeAt', () => {
  test('an open ARCA setup session or a pending cleanup wakes the API', () => {
    withApi(SETUP_ENV, (api, database) => {
      expect(api.nextWakeAt(NOW)).toBeNull();
      const setup = new ArcaSetupStore(database);
      setup.append({
        executionId: 'execution-1', revision: 1, workspaceId: 'workspace-1', onboardingId: 'onboarding-1',
        phase: 'awaiting_user', taxpayerReferenceHash: HASH, environment: 'homologation',
      } as unknown as ArcaSetupExecutionV1, null, 'start-1', new Date(NOW).toISOString());
      expect(api.nextWakeAt(NOW)).toBe(NOW + 30_000);
    });
    withApi(SETUP_ENV, (api, database) => {
      new ArcaSetupStore(database).setPrivate('execution-2', { cleanupPending: true }, new Date(NOW).toISOString());
      expect(api.nextWakeAt(NOW)).toBe(NOW + 30_000);
    });
  });

  test('a pending tax-domain outbox row wakes the API', () => {
    const delivery = {
      TAX_DOMAIN_EVENT_OPEN_AGENTS_URL: 'https://open-agents.example.test/v1/tax-events',
      TAX_DOMAIN_EVENT_OPEN_AGENTS_TOKEN: secret('ingress'),
      TAX_DOMAIN_EVENT_HMAC_SECRET: secret('hmac'),
    };
    const saved = Object.fromEntries(Object.keys(delivery).map(key => [key, process.env[key]]));
    Object.assign(process.env, delivery);
    try {
      withApi({ TAX_DOMAIN_EVENT_DELIVERY_ENABLED: 'true', TAX_DOMAIN_EVENT_POLL_INTERVAL_MS: '10000', ...delivery }, (api, database) => {
        expect(api.nextWakeAt(NOW)).toBeNull();
        new TaxProfileStore(database).appendTaxDomainEvent(domainEvent(), new Date(NOW).toISOString());
        expect(api.nextWakeAt(NOW)).toBe(NOW + 10_000);
      });
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});
