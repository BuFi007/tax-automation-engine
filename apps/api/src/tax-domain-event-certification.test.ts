import { createHmac } from 'node:crypto';

import { describe, expect, test } from 'bun:test';

import {
  certifyTaxDomainEventCorridor,
  type TaxDomainEventCertificationConfig,
} from './tax-domain-event-certification';

const certificationId = '10000000-0000-4000-8000-000000000001';
const eventId = '20000000-0000-4000-8000-000000000001';
const ingressToken = 'ingress-token-that-is-at-least-thirty-two-bytes';
const hmacSecret = 'hmac-secret-that-is-at-least-thirty-two-bytes';
const certificationSecret =
  'certification-secret-that-is-at-least-thirty-two-bytes';
const caseRef = 'taxcase_e2e_' + 'a'.repeat(40);
const runRef = 'taxcert_' + 'b'.repeat(40);
const workflowRunRef = 'workflow_certification_1';
const now = new Date('2026-07-17T12:00:00.000Z');

function config(
  fetchImpl: NonNullable<TaxDomainEventCertificationConfig['fetchImpl']>,
) {
  return {
    eventEndpoint: new URL(
      'http://127.0.0.1:4400/api/bufi/tax-domain-event',
    ),
    ingressToken,
    hmacSecret,
    certificationSecret,
    fetchImpl,
    sleepImpl: async () => undefined,
    now: () => now,
    nextEventId: () => eventId,
    timeoutMs: 5_000,
  };
}

describe('live TaxDomainEventV1 corridor certification', () => {
  test('uses the real outbox publisher and waits for the durable workflow result', async () => {
    let deliveredEventId: string | null = null;
    const calls: string[] = [];
    const fetchImpl = async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      const endpoint = new URL(String(input));
      const method = init?.method ?? 'GET';
      calls.push(`${method}:${endpoint.pathname}`);
      if (
        endpoint.pathname ===
          '/api/internal/certification/tax-domain-event' &&
        method === 'POST'
      ) {
        expect((init?.headers as Record<string, string>).authorization).toBe(
          `Bearer ${certificationSecret}`,
        );
        return Response.json(
          {
            version: 'tax-domain-event-certification-start-v1',
            certificationId,
            workspaceRef: certificationId,
            caseRef,
            runRef,
            workflowRunRef,
            status: 'pending',
            replayed: false,
          },
          { status: 202 },
        );
      }
      if (endpoint.pathname === '/api/bufi/tax-domain-event') {
        const rawBody = String(init?.body);
        const headers = init?.headers as Record<string, string>;
        expect(headers.authorization).toBe(`Bearer ${ingressToken}`);
        expect(headers['x-bufi-tax-event-signature']).toBe(
          createHmac('sha256', hmacSecret).update(rawBody).digest('hex'),
        );
        const envelope = JSON.parse(rawBody) as {
          deliveryId: string;
          event: Record<string, unknown> & { eventId: string };
          payloadHash: string;
        };
        deliveredEventId = envelope.event.eventId;
        expect(envelope.event).toMatchObject({
          workspaceId: certificationId,
          caseRef,
          kind: 'evidence.gap_changed',
          state: 'blocked',
        });
        expect(JSON.stringify(envelope.event)).not.toMatch(
          /cuit|amount|recipient|wallet|credentialValue/i,
        );
        return Response.json({
          version: 'tax-domain-event-receipt-v1',
          deliveryId: envelope.deliveryId,
          eventId: envelope.event.eventId,
          payloadHash: envelope.payloadHash,
          accepted: true,
          status: 'woken',
          replayed: false,
        });
      }
      expect(endpoint.searchParams.get('certificationId')).toBe(
        certificationId,
      );
      return Response.json({
        version: 'tax-domain-event-certification-status-v1',
        certificationId,
        runRef,
        caseRef,
        workflowRunRef,
        status: 'completed',
        eventId: deliveredEventId,
      });
    };

    await expect(
      certifyTaxDomainEventCorridor(config(fetchImpl), certificationId),
    ).resolves.toEqual({
      version: 'tax-domain-event-corridor-certification-v1',
      certificationId,
      runRef,
      caseRef,
      eventId,
      outboxDelivered: true,
      workflowStatus: 'completed',
      replayed: false,
      certifiedAt: now.toISOString(),
    });
    expect(calls).toEqual([
      'POST:/api/internal/certification/tax-domain-event',
      'POST:/api/bufi/tax-domain-event',
      'GET:/api/internal/certification/tax-domain-event',
    ]);
  });

  test('rejects non-preview remote targets without an explicit production approval', async () => {
    await expect(
      certifyTaxDomainEventCorridor(
        {
          ...config(async () => Response.json({})),
          eventEndpoint: new URL(
            'https://open-agents.example.com/api/bufi/tax-domain-event',
          ),
        },
        certificationId,
      ),
    ).rejects.toThrow('TAX_DOMAIN_EVENT_CERTIFICATION_PREVIEW_REQUIRED');
  });

  test('rejects a status projection for another case', async () => {
    let delivered = false;
    const fetchImpl = async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      const endpoint = new URL(String(input));
      if (endpoint.pathname === '/api/bufi/tax-domain-event') {
        const envelope = JSON.parse(String(init?.body)) as {
          deliveryId: string;
          event: { eventId: string };
          payloadHash: string;
        };
        delivered = true;
        return Response.json({
          version: 'tax-domain-event-receipt-v1',
          deliveryId: envelope.deliveryId,
          eventId: envelope.event.eventId,
          payloadHash: envelope.payloadHash,
          accepted: true,
          status: 'woken',
          replayed: false,
        });
      }
      if ((init?.method ?? 'GET') === 'POST')
        return Response.json({
          version: 'tax-domain-event-certification-start-v1',
          certificationId,
          workspaceRef: certificationId,
          caseRef,
          runRef,
          workflowRunRef,
          status: 'pending',
          replayed: false,
        });
      expect(delivered).toBe(true);
      return Response.json({
        version: 'tax-domain-event-certification-status-v1',
        certificationId,
        runRef,
        caseRef: 'taxcase_e2e_' + 'c'.repeat(40),
        workflowRunRef,
        status: 'completed',
        eventId,
      });
    };
    await expect(
      certifyTaxDomainEventCorridor(config(fetchImpl), certificationId),
    ).rejects.toThrow('TAX_DOMAIN_EVENT_CERTIFICATION_IDENTITY_MISMATCH');
  });
});

test('refuses a certification redirect as an unavailable target', async () => {
  await expect(certifyTaxDomainEventCorridor(config(async () => new Response(null, { status: 302, headers: { location: 'https://attacker.test/' } })), certificationId))
    .rejects.toThrow(/^TAX_DOMAIN_EVENT_CERTIFICATION_TARGET_UNAVAILABLE$/);
});
