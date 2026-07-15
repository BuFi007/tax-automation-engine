import { createHmac } from 'node:crypto';

import { describe, expect, test } from 'bun:test';

import {
  hashFacturaEAuthorityPrivatePreparation,
  HttpFacturaEAuthorityPreparationGateway,
} from './factura-e-authority-preparation';

const secret = 'preparation-secret-that-is-at-least-thirty-two-bytes';
const now = new Date('2026-07-15T12:00:00.000Z');
const input = {
  executionId: 'execution-1',
  workspaceId: 'workspace-1',
  runId: 'run-1',
  intentHash: 'a'.repeat(64),
  pointOfSale: 4,
  currency: 'USD',
  taxpayerReferenceHash: 'c'.repeat(64),
  foreignCustomerReferenceHash: 'b'.repeat(64),
  idempotencyKey: 'execution-1:prepare',
};

function preparation(overrides: Record<string, unknown> = {}) {
  const value = {
    version: 'factura-e-authority-private-preparation-v1' as const,
    executionId: input.executionId,
    workspaceId: input.workspaceId,
    runId: input.runId,
    intentHash: input.intentHash,
    taxpayerReferenceHash: input.taxpayerReferenceHash,
    foreignCustomerReferenceHash: input.foreignCustomerReferenceHash,
    representedCuitCommitment: 'd'.repeat(64),
    idempotencyKey: input.idempotencyKey,
    requestId: '101',
    invoiceNumber: '6',
    issuerProfileRef: 'vault://issuer/workspace-1/primary',
    customer: {
      name: 'Foreign Customer',
      address: '123 Main St',
      countryCuit: '50000000016',
      foreignTaxId: 'US-TAX-ID',
    },
    currencyArcaId: 'DOL',
    language: 2 as const,
    commercialObservation: null,
    generalObservation: null,
    preparedAt: '2026-07-15T12:00:00.000Z',
    expiresAt: '2026-07-15T13:00:00.000Z',
    ...overrides,
  };
  return {
    ...value,
    preparationHash: hashFacturaEAuthorityPrivatePreparation(value as never),
  };
}

describe('private Factura E authority preparation gateway', () => {
  test('body-binds the request and accepts only a signed, exact, live receipt', async () => {
    const gateway = new HttpFacturaEAuthorityPreparationGateway(
      new URL('https://preparation.test/v1/factura-e/prepare'),
      secret,
      async (_request, init) => {
        const rawRequest = String(init?.body);
        expect(new Headers(init?.headers).get('idempotency-key')).toBe(input.idempotencyKey);
        expect(new Headers(init?.headers).get('x-tax-authority-preparation-signature'))
          .toBe(createHmac('sha256', secret).update(rawRequest).digest('hex'));
        expect(JSON.parse(rawRequest)).toEqual(expect.objectContaining({
          executionId: input.executionId,
          intentHash: input.intentHash,
          pointOfSale: 4,
          taxpayerReferenceHash: input.taxpayerReferenceHash,
          foreignCustomerReferenceHash: input.foreignCustomerReferenceHash,
        }));
        const raw = JSON.stringify(preparation());
        return new Response(raw, {
          headers: {
            'x-tax-authority-preparation-signature': createHmac('sha256', secret)
              .update(raw)
              .digest('hex'),
          },
        });
      },
      () => now
    );

    await expect(gateway.prepare(input)).resolves.toEqual(expect.objectContaining({
      requestId: '101',
      invoiceNumber: '6',
      currencyArcaId: 'DOL',
    }));
  });

  test('rejects an unsigned or cross-execution response', async () => {
    const unsigned = new HttpFacturaEAuthorityPreparationGateway(
      new URL('https://preparation.test/v1/factura-e/prepare'),
      secret,
      async () => Response.json(preparation()),
      () => now
    );
    await expect(unsigned.prepare(input)).rejects
      .toThrow('TAX_ARCA_PREPARATION_RECEIPT_UNAUTHORIZED');

    const rebound = preparation({ executionId: 'execution-other' });
    const raw = JSON.stringify(rebound);
    const crossExecution = new HttpFacturaEAuthorityPreparationGateway(
      new URL('https://preparation.test/v1/factura-e/prepare'),
      secret,
      async () => new Response(raw, { headers: {
        'x-tax-authority-preparation-signature': createHmac('sha256', secret)
          .update(raw)
          .digest('hex'),
      } }),
      () => now
    );
    await expect(crossExecution.prepare(input)).rejects
      .toThrow('TAX_ARCA_PREPARATION_RECEIPT_BINDING_MISMATCH');
  });

  test('rejects expired allocation material and non-HTTPS production endpoints', async () => {
    const expired = preparation({ expiresAt: '2026-07-15T11:59:59.000Z' });
    const raw = JSON.stringify(expired);
    const gateway = new HttpFacturaEAuthorityPreparationGateway(
      new URL('https://preparation.test/v1/factura-e/prepare'),
      secret,
      async () => new Response(raw, { headers: {
        'x-tax-authority-preparation-signature': createHmac('sha256', secret)
          .update(raw)
          .digest('hex'),
      } }),
      () => now
    );
    await expect(gateway.prepare(input)).rejects
      .toThrow('TAX_ARCA_PREPARATION_RECEIPT_EXPIRED');

    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      expect(() => new HttpFacturaEAuthorityPreparationGateway(
        new URL('http://preparation.test/v1/factura-e/prepare'),
        secret
      )).toThrow('TAX_ARCA_PREPARATION_HTTPS_REQUIRED');
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous;
    }
  });

  test('stops a chunked response once the streaming byte limit is exceeded', async () => {
    let cancelled = false;
    const chunk = new Uint8Array(20 * 1024).fill(97);
    const gateway = new HttpFacturaEAuthorityPreparationGateway(
      new URL('https://preparation.test/v1/factura-e/prepare'),
      secret,
      async (_request, init) => {
        expect(init?.redirect).toBe('error');
        return new Response(new ReadableStream<Uint8Array>({
          pull(controller) {
            controller.enqueue(chunk);
          },
          cancel() {
            cancelled = true;
          },
        }));
      },
      () => now
    );
    await expect(gateway.prepare(input)).rejects
      .toThrow('TAX_ARCA_PREPARATION_RESPONSE_TOO_LARGE');
    expect(cancelled).toBe(true);
  });
});
