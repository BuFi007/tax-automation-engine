import { createHash, createHmac } from 'node:crypto';
import { describe, expect, test } from 'bun:test';

import { handleInvoiceSettlementAdapterRoute } from './invoice-settlement-adapter-routes';
import type { InvoiceSettlementInboxEvent } from './invoice-settlement-adapter-routes';
import { TaxProfileStore } from './store';

const secret = 'invoice-settlement-adapter-secret-at-least-32';
const workspaceId = '10000000-0000-4000-8000-000000000001';

describe('Desk invoice settlement inbox route', () => {
  test('accepts only a signed canonical event and durably appends it', async () => {
    let recorded: InvoiceSettlementInboxEvent | null = null;
    const service = {
      appendInvoiceSettlementEvent: (input: InvoiceSettlementInboxEvent) => {
        recorded = input;
        return { replayed: false };
      },
    };
    const body = payload();
    const request = signedRequest(body);

    const response = await handleInvoiceSettlementAdapterRoute(
      request, new URL(request.url), service, secret,
    );

    expect(response?.status).toBe(200);
    expect(recorded).toMatchObject({
      idempotencyKey: body.idempotencyKey,
      workspaceId,
      invoiceId: body.event.invoiceId,
      recordedAt: body.event.recordedAt,
      settlement: { finalityState: 'final' },
    });
    expect(await response?.json()).toEqual({
      data: { eventId: body.event.eventId, replayed: false },
    });
  });

  test('rejects a signature that is not bound to the exact event body', async () => {
    const service = { appendInvoiceSettlementEvent: () => ({ replayed: false }) };
    const body = payload();
    const request = signedRequest({ ...body, idempotencyKey: 'invoice-settlement:other-event' }, body.idempotencyKey);
    await expect(handleInvoiceSettlementAdapterRoute(request, new URL(request.url), service, secret))
      .rejects.toThrow('INVOICE_SETTLEMENT_ADAPTER_SCOPE_UNAUTHORIZED');
  });

  test('keeps an immutable, idempotent inbox before any TaxCase projection', () => {
    const store = new TaxProfileStore(':memory:', 'settlement-inbox-test-secret-at-least-32');
    const body = payload();
    const event: InvoiceSettlementInboxEvent = {
      workspaceId: body.event.teamId,
      invoiceId: body.event.invoiceId,
      eventId: body.event.eventId,
      eventType: body.event.eventType,
      replayKey: body.event.replayKey,
      recordedAt: body.event.recordedAt,
      idempotencyKey: body.idempotencyKey,
      settlement: body.settlement,
    };
    expect(store.appendInvoiceSettlementEvent(event)).toEqual({ replayed: false });
    expect(store.appendInvoiceSettlementEvent(event)).toEqual({ replayed: true });
    expect(() => store.appendInvoiceSettlementEvent({ ...event, settlement: { ...event.settlement, asset: 'EUR' } }))
      .toThrow('INVOICE_SETTLEMENT_EVENT_CONFLICT');
  });
});

function payload() {
  return {
    idempotencyKey: 'invoice-settlement:30000000-0000-4000-8000-000000000001',
    event: {
      schemaVersion: 1 as const,
      eventId: '30000000-0000-4000-8000-000000000001',
      teamId: workspaceId,
      invoiceId: '40000000-0000-4000-8000-000000000001',
      eventType: 'InvoiceSettlementFinalizedV1' as const,
      replayKey: 'a'.repeat(64),
      recordedAt: '2026-07-17T00:00:00.000Z',
    },
    settlement: {
      settlementReferenceHash: 'b'.repeat(64), asset: 'USDC', network: 'base',
      amount: { decimal: '100', currency: 'USD' }, observedAt: '2026-07-17T00:00:00.000Z',
      finalityState: 'final' as const, fees: null, reversesSettlementReferenceHash: null,
      evidence: {
        version: 'factura-e-settlement-evidence-v1' as const,
        source: { kind: 'external_wallet_receipt' as const, provider: 'circle', identityHash: 'c'.repeat(64), revision: 1 },
        sourceMoney: { currency: 'USDC', grossAmount: '100', feeAmount: '0', netAmount: '100' },
        sourceEquivalentAmount: '100', allocationBasis: 'gross' as const, fx: null,
        verification: { method: 'onchain_receipt' as const, evidenceHash: 'd'.repeat(64), verifiedAt: '2026-07-17T00:00:00.000Z' },
      },
    },
  };
}

function signedRequest(body: ReturnType<typeof payload>, principalIdempotencyKey = body.idempotencyKey): Request {
  const rawBody = JSON.stringify(body);
  const principal = {
    version: 'desk-invoice-settlement-principal-v1', workspaceId,
    adapterId: 'desk-invoice-settlement-publisher', method: 'POST',
    path: '/v1/invoice-settlements/events',
    bodyHash: createHash('sha256').update(rawBody).digest('hex'),
    idempotencyKey: principalIdempotencyKey,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
  const encoded = Buffer.from(JSON.stringify(principal)).toString('base64url');
  return new Request('http://localhost/v1/invoice-settlements/events', {
    method: 'POST', body: rawBody,
    headers: {
      'content-type': 'application/json',
      'x-invoice-settlement-principal': encoded,
      'x-invoice-settlement-principal-signature': createHmac('sha256', secret).update(encoded).digest('hex'),
    },
  });
}
