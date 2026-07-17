import { createHash, createHmac } from 'node:crypto';
import { describe, expect, test } from 'bun:test';

import { handleInvoiceSettlementAdapterRoute } from './invoice-settlement-adapter-routes';
import type { FacturaEAgentService } from './factura-e-agent';

const secret = 'invoice-settlement-adapter-secret-at-least-32';
const workspaceId = '10000000-0000-4000-8000-000000000001';
const runId = '20000000-0000-4000-8000-000000000001';

describe('canonical invoice settlement adapter route', () => {
  test('accepts only a signed canonical event and fixes the system actor', async () => {
    let recorded: Record<string, unknown> | null = null;
    const service = {
      getRun: () => ({ workspaceId }),
      recordSettlement: (input: Record<string, unknown>) => {
        recorded = input;
        return { run: { runId, workspaceId, revision: 4 }, replayed: false };
      },
    } as unknown as FacturaEAgentService;
    const body = payload();
    const request = signedRequest(body);

    const response = await handleInvoiceSettlementAdapterRoute(
      request, new URL(request.url), service, secret,
    );

    expect(response?.status).toBe(200);
    expect(recorded).toMatchObject({
      runId,
      idempotencyKey: body.idempotencyKey,
      actorId: 'system:invoice-settlement-adapter',
      occurredAt: body.event.recordedAt,
      settlement: { finalityState: 'final' },
    });
    expect(await response?.json()).toEqual({
      data: { run: { runId, workspaceId, revision: 4 }, replayed: false },
    });
  });

  test('rejects a signature that is not bound to the exact event body', async () => {
    const service = { getRun: () => ({ workspaceId }), recordSettlement: () => null } as unknown as FacturaEAgentService;
    const body = payload();
    const request = signedRequest({ ...body, idempotencyKey: 'invoice-settlement:other-event' }, body.idempotencyKey);
    await expect(handleInvoiceSettlementAdapterRoute(request, new URL(request.url), service, secret))
      .rejects.toThrow('INVOICE_SETTLEMENT_ADAPTER_SCOPE_UNAUTHORIZED');
  });
});

function payload() {
  return {
    runId,
    idempotencyKey: 'invoice-settlement:30000000-0000-4000-8000-000000000001',
    event: {
      schemaVersion: 1 as const,
      eventId: '30000000-0000-4000-8000-000000000001',
      teamId: workspaceId,
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
    version: 'invoice-settlement-adapter-principal-v1', workspaceId,
    adapterId: 'open-agents-invoice-settlement', method: 'POST',
    path: '/v1/invoice-settlements/record',
    bodyHash: createHash('sha256').update(rawBody).digest('hex'),
    idempotencyKey: principalIdempotencyKey,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
  const encoded = Buffer.from(JSON.stringify(principal)).toString('base64url');
  return new Request('http://localhost/v1/invoice-settlements/record', {
    method: 'POST', body: rawBody,
    headers: {
      'content-type': 'application/json',
      'x-invoice-settlement-principal': encoded,
      'x-invoice-settlement-principal-signature': createHmac('sha256', secret).update(encoded).digest('hex'),
    },
  });
}
