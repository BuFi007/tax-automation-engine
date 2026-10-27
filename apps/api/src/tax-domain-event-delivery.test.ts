import { createHmac } from 'node:crypto';

import { describe, expect, test } from 'bun:test';

import {
  hashTaxDomainEventV1,
  type TaxDomainEventV1,
} from '@tax-engine/core';

import { TaxProfileStore } from './store';
import {
  drainTaxDomainEventOutbox,
  HttpTaxDomainEventPublisher,
} from './tax-domain-event-outbox';

const HASH = 'a'.repeat(64);
const T0 = new Date('2026-07-17T00:00:00.000Z');
const T2 = new Date('2026-07-17T00:00:02.000Z');
const T5 = new Date('2026-07-17T00:00:05.000Z');
const eventId = '00000000-0000-4000-8000-000000000001';
const deliveryId = '20000000-0000-4000-8000-000000000001';
const token = 'ingress-token-that-is-at-least-thirty-two-bytes';
const secret = 'delivery-secret-that-is-at-least-thirty-two-bytes';

function event(): TaxDomainEventV1 {
  return {
    version: 'tax-domain-event-v1',
    eventId,
    workspaceId: 'workspace_opaque_1',
    caseRef: 'taxcase_opaque_1',
    kind: 'invoice.settlement_finalized',
    state: 'verified',
    occurredAt: T0.toISOString(),
    idempotencyKey: 'invoice-settlement-finalized_1',
    correlationRef: 'correlation_1',
    source: {
      system: 'invoice_ledger',
      sourceEventHash: HASH,
      verifiedAt: T0.toISOString(),
    },
    authentication: {
      method: 'internal_outbox',
      principalRef: 'principal_invoice_worker',
      credentialVersion: 'grant-v1',
      signatureHash: HASH,
    },
    consent: {
      purpose: 'tax_workspace_processing',
      version: 'consent-v1',
      scopeHash: HASH,
      state: 'active',
    },
    evidenceHashes: [HASH],
    ruleVersionIds: ['rule_1'],
    policyVersionIds: ['policy_1'],
    actionRefs: ['action_review_tax_case'],
  };
}

describe('TaxDomainEvent durable delivery', () => {
  test('signs a hash-bound envelope and accepts only its bound receipt', async () => {
    const publisher = new HttpTaxDomainEventPublisher(
      new URL('http://127.0.0.1:4400/api/bufi/tax-domain-event'),
      token,
      secret,
      async (_url, init) => {
        const rawBody = String(init?.body);
        const headers = init?.headers as Record<string, string>;
        expect(headers.authorization).toBe(`Bearer ${token}`);
        expect(headers['x-bufi-tax-event-signature']).toBe(
          createHmac('sha256', secret).update(rawBody).digest('hex')
        );
        const envelope = JSON.parse(rawBody) as {
          deliveryId: string;
          event: TaxDomainEventV1;
          payloadHash: string;
        };
        expect(envelope.event).toEqual(event());
        return Response.json({
          version: 'tax-domain-event-receipt-v1',
          deliveryId: envelope.deliveryId,
          eventId: envelope.event.eventId,
          payloadHash: envelope.payloadHash,
          accepted: true,
          status: 'woken',
          replayed: false,
        });
      },
      () => deliveryId
    );
    await expect(publisher.publish(event(), T0.toISOString())).resolves.toEqual({
      eventId,
      payloadHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
  });

  test('does not acknowledge a 202 receipt while the Tax Case is unbound', async () => {
    const store = new TaxProfileStore(':memory:');
    store.appendTaxDomainEvent(event(), T0.toISOString());
    try {
      expect(await drainTaxDomainEventOutbox(store, {
        async publish() {
          throw new Error('TAX_DOMAIN_EVENT_TARGET_NOT_READY');
        },
      }, { now: T0 })).toEqual({ claimed: 1, delivered: 0, retried: 1 });
      expect(store.listPendingTaxDomainEvents()).toEqual([event()]);
      expect(await drainTaxDomainEventOutbox(store, {
        async publish(deliveredEvent) {
          return {
            eventId: deliveredEvent.eventId,
            payloadHash: HASH,
          };
        },
      }, { now: T2 })).toEqual({ claimed: 0, delivered: 0, retried: 0 });
      expect(await drainTaxDomainEventOutbox(store, {
        async publish(deliveredEvent) {
          const [claim] = store.listPendingTaxDomainEvents();
          expect(claim).toEqual(deliveredEvent);
          return {
            eventId: deliveredEvent.eventId,
            payloadHash: hashTaxDomainEventV1(deliveredEvent),
          };
        },
      }, { now: T5 })).toEqual({ claimed: 1, delivered: 1, retried: 0 });
      expect(store.listPendingTaxDomainEvents()).toEqual([]);
    } finally {
      store.close();
    }
  });

  test('treats a signed waiting receipt as retryable rather than delivered', async () => {
    const publisher = new HttpTaxDomainEventPublisher(
      new URL('http://127.0.0.1:4400/api/bufi/tax-domain-event'),
      token,
      secret,
      async (_url, init) => {
        const envelope = JSON.parse(String(init?.body)) as {
          deliveryId: string;
          event: TaxDomainEventV1;
          payloadHash: string;
        };
        return Response.json({
          version: 'tax-domain-event-receipt-v1',
          deliveryId: envelope.deliveryId,
          eventId: envelope.event.eventId,
          payloadHash: envelope.payloadHash,
          accepted: false,
          status: 'waiting_for_tax_case',
          replayed: false,
        }, { status: 202 });
      },
      () => deliveryId
    );
    await expect(publisher.publish(event(), T0.toISOString()))
      .rejects.toThrow('TAX_DOMAIN_EVENT_TARGET_NOT_READY');
  });

  test('fences an expired worker after a lease takeover', () => {
    const store = new TaxProfileStore(':memory:');
    store.appendTaxDomainEvent(event(), T0.toISOString());
    try {
      const [first] = store.claimTaxDomainEvents({
        now: T0.toISOString(),
        leaseUntil: T2.toISOString(),
        limit: 1,
      });
      const [second] = store.claimTaxDomainEvents({
        now: T2.toISOString(),
        leaseUntil: T5.toISOString(),
        limit: 1,
      });
      expect(first?.leaseToken).not.toBe(second?.leaseToken);
      expect(() => store.ackTaxDomainEventClaim(
        eventId,
        first!.leaseToken,
        T2.toISOString()
      )).toThrow('TAX_DOMAIN_EVENT_OUTBOX_ACK_FENCE_REJECTED');
      store.ackTaxDomainEventClaim(eventId, second!.leaseToken, T2.toISOString());
      expect(store.listPendingTaxDomainEvents()).toEqual([]);
    } finally {
      store.close();
    }
  });

  test('rejects a receipt for another delivery', async () => {
    const publisher = new HttpTaxDomainEventPublisher(
      new URL('http://127.0.0.1:4400/api/bufi/tax-domain-event'),
      token,
      secret,
      async (_url, init) => {
        const envelope = JSON.parse(String(init?.body)) as {
          event: TaxDomainEventV1;
          payloadHash: string;
        };
        return Response.json({
          version: 'tax-domain-event-receipt-v1',
          deliveryId: '30000000-0000-4000-8000-000000000001',
          eventId: envelope.event.eventId,
          payloadHash: envelope.payloadHash,
          accepted: true,
          status: 'woken',
          replayed: false,
        });
      },
      () => deliveryId
    );
    await expect(publisher.publish(event(), T0.toISOString()))
      .rejects.toThrow('TAX_DOMAIN_EVENT_RECEIPT_MISMATCH');
  });
});

test('refuses a delivery redirect as an unavailable target', async () => {
  const publisher = new HttpTaxDomainEventPublisher(
    new URL('http://127.0.0.1:4400/api/bufi/tax-domain-event'), token, secret, async () => new Response(null, { status: 302, headers: { location: 'https://attacker.test/' } }), () => deliveryId,
  );
  await expect(publisher.publish(event(), T0.toISOString())).rejects.toThrow(/^TAX_DOMAIN_EVENT_TARGET_UNAVAILABLE$/);
});
