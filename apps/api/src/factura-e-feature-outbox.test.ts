import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, test } from 'bun:test';

import { hashTaxDomainEventV1, type TaxDomainEventV1 } from '@tax-engine/core';

import {
  FacturaEFeaturePublicationStore,
  type PrivateFacturaEFeatureSource,
} from './factura-e-feature-publication';
import {
  drainFacturaEFeatureOutbox,
  HttpFacturaEFeatureEventPublisher,
  type FacturaEFeatureEventEnvelopeV1,
} from './factura-e-feature-outbox';
import { drainTaxDomainEventOutbox } from './tax-domain-event-outbox';

const T0 = new Date('2026-07-15T12:00:00.000Z');
const T2 = new Date('2026-07-15T12:00:02.000Z');
const T7 = new Date('2026-07-15T12:00:07.000Z');
const hash = (seed: string) => Bun.CryptoHasher.hash('sha256', seed, 'hex');
const source: PrivateFacturaEFeatureSource = {
  executionId: 'execution-1',
  runId: 'run-1',
  workspaceId: 'workspace-1',
  authorityState: 'officially_reconciled',
  authorityIdentityHash: hash('private-authority'),
  reconciliationEvidenceHash: hash('private-evidence'),
  settlementState: 'unobserved',
  invoiceState: 'current',
  hasAdjustment: false,
  sourceRevision: 'source-1',
};
const { privateKey } = generateKeyPairSync('ed25519');

function createStore(databasePath?: string): FacturaEFeaturePublicationStore {
  return new FacturaEFeaturePublicationStore({
    readSource: () => source,
    signer: {
      keyVersion: 'tax-feature-key-2026-01',
      async signDigest(digestHex) {
        return sign(null, Buffer.from(digestHex, 'hex'), privateKey).toString('base64url');
      },
    },
    commitmentSecret: 'commitment-purpose-secret-that-is-more-than-32-bytes',
    policyVersion: 'ar-factura-e-factoring-v1',
    ...(databasePath === undefined ? {} : { databasePath }),
  });
}

async function fixture(databasePath?: string) {
  const store = createStore(databasePath);
  store.grantConsent({
    executionId: 'execution-1',
    workspaceId: 'workspace-1',
    consentVersion: 'factoring-consent-v1',
    actorId: 'user-1',
    idempotencyKey: 'grant-consent-0001',
    occurredAt: T0.toISOString(),
    expiresAt: '2026-07-15T13:00:00.000Z',
  });
  await store.project('execution-1', T0);
  return store;
}

describe('Factura E feature outbox delivery', () => {
  test('publishes a minimized signed event and acknowledges only the bound receipt', async () => {
    const store = await fixture();
    const published: FacturaEFeatureEventEnvelopeV1[] = [];
    try {
      const result = await drainFacturaEFeatureOutbox(store, {
        async publish(event) {
          published.push(event);
          return { eventId: event.eventId, featureHash: event.feature.featureHash };
        },
      }, { now: T0, leaseSeconds: 30 });
      expect(result).toEqual({ claimed: 1, delivered: 1, retried: 0 });
      expect(published[0]).toMatchObject({
        version: 'factura-e-feature-event-envelope-v1',
        executionId: 'execution-1',
        workspaceId: 'workspace-1',
        feature: { lifecycle: 'active' },
      });
      const serialized = JSON.stringify(published[0]);
      expect(serialized).not.toContain(hash('private-authority'));
      expect(serialized).not.toContain(hash('private-evidence'));
      const [domainEvent] = store.listPendingTaxDomainEvents();
      if (!domainEvent) throw new Error('Expected published Tax domain event');
      expect(domainEvent).toMatchObject({
        kind: 'factura_e_feature_published',
        state: 'verified',
        workspaceId: 'workspace-1',
        caseRef: 'run-1',
        source: { system: 'factoring' },
        consent: { purpose: 'factura_e_factoring', state: 'active' },
        ruleVersionIds: ['factura-e-feature-v1', 'ar-factura-e-factoring-v1'],
      });
      const serializedDomainEvent = JSON.stringify(domainEvent);
      for (const forbidden of [
        published[0]!.feature.featureHash,
        published[0]!.feature.workspaceCommitment,
        published[0]!.feature.invoiceCommitment,
        published[0]!.feature.consent.version,
        hash('private-authority'),
        hash('private-evidence'),
      ]) expect(serializedDomainEvent).not.toContain(forbidden);

      const relayed: TaxDomainEventV1[] = [];
      expect(await drainTaxDomainEventOutbox(store, {
        async publish(event) {
          relayed.push(event);
          return { eventId: event.eventId, payloadHash: hashTaxDomainEventV1(event) };
        },
      }, { now: T2 })).toEqual({ claimed: 1, delivered: 1, retried: 0 });
      expect(relayed).toEqual([domainEvent]);
      expect(store.listPendingTaxDomainEvents()).toEqual([]);
      expect(store.claimOutbox({ limit: 1, leaseSeconds: 5, now: T2 })).toEqual([]);
    } finally {
      store.close();
    }
  });

  test('nacks with a safe code and retries after deterministic backoff', async () => {
    const store = await fixture();
    try {
      expect(await drainFacturaEFeatureOutbox(store, {
        async publish() {
          throw new Error('raw upstream response with sensitive details');
        },
      }, { now: T0, leaseSeconds: 30 })).toEqual({
        claimed: 1, delivered: 0, retried: 1,
      });
      expect(store.claimOutbox({ limit: 1, leaseSeconds: 5, now: T2 })).toEqual([]);
      expect(store.listPendingTaxDomainEvents()).toEqual([]);
      expect(await drainFacturaEFeatureOutbox(store, {
        async publish(event) {
          return { eventId: event.eventId, featureHash: event.feature.featureHash };
        },
      }, { now: T7, leaseSeconds: 30 })).toEqual({
        claimed: 1, delivered: 1, retried: 0,
      });
      expect(store.listPendingTaxDomainEvents()).toEqual([
        expect.objectContaining({ kind: 'factura_e_feature_published' }),
      ]);
    } finally {
      store.close();
    }
  });

  test('recovers the pending published event after a process restart', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'tax-feature-domain-event-'));
    const databasePath = join(directory, 'features.sqlite');
    let store = await fixture(databasePath);
    try {
      expect(await drainFacturaEFeatureOutbox(store, {
        async publish(event) {
          return { eventId: event.eventId, featureHash: event.feature.featureHash };
        },
      }, { now: T0, leaseSeconds: 30 })).toEqual({
        claimed: 1,
        delivered: 1,
        retried: 0,
      });
      expect(store.listPendingTaxDomainEvents()).toHaveLength(1);
      store.close();
      store = createStore(databasePath);
      expect(store.listPendingTaxDomainEvents()).toEqual([
        expect.objectContaining({
          kind: 'factura_e_feature_published',
          state: 'verified',
        }),
      ]);
    } finally {
      store.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test('HTTP publisher binds event body and rejects a mismatched receipt', async () => {
    const event = {
      version: 'factura-e-feature-event-envelope-v1' as const,
      eventId: '11111111-1111-4111-8111-111111111111',
      executionId: 'execution-1',
      workspaceId: 'workspace-1',
      feature: {} as never,
    };
    const publisher = new HttpFacturaEFeatureEventPublisher(
      new URL('http://127.0.0.1:4400/v1/factoring/events'),
      'event-purpose-secret-that-is-more-than-thirty-two-bytes',
      async (_url, init) => {
        expect((init?.headers as Record<string, string>)['x-tax-feature-event-signature'])
          .toMatch(/^[a-f0-9]{64}$/);
        expect(init?.redirect).toBe('error');
        return Response.json({
          version: 'factura-e-feature-event-receipt-v1',
          eventId: event.eventId,
          featureHash: 'b'.repeat(64),
          accepted: true,
        });
      }
    );
    await expect(publisher.publish({
      ...event,
      feature: { featureHash: 'a'.repeat(64) } as never,
    })).rejects.toThrow('TAX_FACTURA_E_FEATURE_EVENT_RECEIPT_MISMATCH');
  });

  test('rejects a response observed on a different origin', async () => {
    const event = {
      version: 'factura-e-feature-event-envelope-v1' as const,
      eventId: '11111111-1111-4111-8111-111111111111',
      executionId: 'execution-1',
      workspaceId: 'workspace-1',
      feature: { featureHash: 'a'.repeat(64) } as never,
    };
    const publisher = new HttpFacturaEFeatureEventPublisher(
      new URL('http://127.0.0.1:4400/v1/factoring/events'),
      'event-purpose-secret-that-is-more-than-thirty-two-bytes',
      async () => {
        const response = Response.json({
          version: 'factura-e-feature-event-receipt-v1',
          eventId: event.eventId,
          featureHash: 'a'.repeat(64),
          accepted: true,
        });
        Object.defineProperty(response, 'url', { value: 'https://attacker.invalid/events' });
        return response;
      }
    );
    await expect(publisher.publish(event))
      .rejects.toThrow('TAX_FACTURA_E_FEATURE_EVENT_RESPONSE_ORIGIN_MISMATCH');
  });

  test('bounds a chunked event receipt while reading it', async () => {
    const event = {
      version: 'factura-e-feature-event-envelope-v1' as const,
      eventId: '11111111-1111-4111-8111-111111111111',
      executionId: 'execution-1',
      workspaceId: 'workspace-1',
      feature: { featureHash: 'a'.repeat(64) } as never,
    };
    const publisher = new HttpFacturaEFeatureEventPublisher(
      new URL('http://127.0.0.1:4400/v1/factoring/events'),
      'event-purpose-secret-that-is-more-than-thirty-two-bytes',
      async () => new Response('x'.repeat(16 * 1024 + 1))
    );

    await expect(publisher.publish(event))
      .rejects.toThrow('TAX_FACTURA_E_FEATURE_EVENT_RESPONSE_TOO_LARGE');
  });
});
