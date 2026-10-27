import { describe, expect, test } from 'bun:test';

import { hashCanonical, type ArcaOnboardingRunV1, type FacturaEAgentRunV1 } from '@tax-engine/core';
import { createHmac } from 'node:crypto';

import { HttpDeskFacturaEPrivateDataGateway, TaxOwnedFacturaEAuthorityPreparationGateway } from './tax-owned-factura-e-authority-preparation';

test('accepts only a signed commercial request for the exact TaxCase and invoice', async () => {
  const secret = 'private-data-secret-'.padEnd(40, 's');
  const input = {
    workspaceId: '11111111-1111-4111-8111-111111111111',
    runId: '22222222-2222-4222-8222-222222222222',
    ledgerInvoiceId: '33333333-3333-4333-8333-333333333333',
    idempotencyKey: 'commercial-request:22222222-2222-4222-8222-222222222222',
  };
  const customer = {
    name: 'Foreign customer', address: '123 Export Street', foreignTaxId: 'US-TAX',
    countryIso2: 'US', countryArcaCode: 200,
  };
  const material = {
    version: 'desk-factura-e-commercial-request-v1' as const,
    sourceKind: 'pre_cae_commercial_request' as const,
    ...input,
    taxpayerReferenceHash: 'a'.repeat(64),
    foreignCustomerReferenceHash: hashCanonical(customer),
    customer, requestedPointOfSale: 2, issueDate: '2026-09-23',
    servicePeriod: { start: '2026-09-01', end: '2026-09-30' },
    paymentDate: '2026-10-15', amount: '100.00', currency: 'USD' as const,
    description: 'Creative services', sameCurrencyPayment: false, frozenAt: '2026-09-23T12:00:00.000Z',
  };
  let receipt = { ...material, evidenceHash: hashCanonical(material) };
  let expectedInput = input;
  const gateway = new HttpDeskFacturaEPrivateDataGateway(
    new URL('https://desk.test/api/internal/tax/factura-e-private-data'), secret,
    async (_url, init) => {
      expect(JSON.parse(String(init?.body))).toMatchObject({
        version: 'tax-desk-factura-e-commercial-request-v1', ...expectedInput,
      });
      const raw = JSON.stringify(receipt);
      return new Response(raw, { headers: {
        'x-tax-desk-private-data-signature': createHmac('sha256', secret).update(raw).digest('hex'),
      } });
    }
  );
  expect(await gateway.getFrozenCommercialRequest(input)).toMatchObject(material);
  receipt = { ...receipt, ledgerInvoiceId: '44444444-4444-4444-8444-444444444444' };
  await expect(gateway.getFrozenCommercialRequest(input)).rejects.toThrow('BINDING_MISMATCH');
  expectedInput = { ...input, workspaceId: `personal:${input.workspaceId}` };
  const personal = {
    ...material, ...expectedInput,
    frozenManualQuote: {
      decimal: '1200.25', observedForDate: '2026-09-22',
      sourceReferenceId: 'manual-unverified-bna:2026-09-22',
    },
    sameCurrencyPayment: false as const,
  };
  receipt = { ...personal, evidenceHash: hashCanonical(personal) };
  expect(await gateway.getFrozenCommercialRequest(expectedInput)).toMatchObject(personal);
});

describe('Tax-owned Factura E authority preparation', () => {
  test('never carries a manual homologation quote into production', async () => {
    const run = {
      runId: '10000000-0000-4000-8000-000000000001', workspaceId: 'workspace-1',
      intentHash: 'c'.repeat(64),
      intent: {
        intentId: 'invoice-1', taxpayerReferenceHash: 'a'.repeat(64),
        foreignCustomerReferenceHash: 'b'.repeat(64), pointOfSale: 4,
        exchangeRate: { sourceReferenceId: 'manual-unverified-bna:2026-09-22' },
      },
    } as unknown as FacturaEAgentRunV1;
    const gateway = new TaxOwnedFacturaEAuthorityPreparationGateway(
      { getRun: () => run }, { listArcaOnboardingRuns: () => [] },
      new Map([['workspace-1', 'vault://issuer/profile-1']]), new Map([['USD', 'DOL']]),
      { getFrozenPrivateData: async () => { throw new Error('must not run'); } },
      { reserveSequence: async () => { throw new Error('must not run'); } },
      'production'
    );
    await expect(gateway.prepare({
      executionId: 'execution-1', workspaceId: 'workspace-1', runId: run.runId,
      intentHash: run.intentHash!, pointOfSale: 4, currency: 'USD',
      taxpayerReferenceHash: 'a'.repeat(64), foreignCustomerReferenceHash: 'b'.repeat(64),
      idempotencyKey: 'prepare:invoice-1',
    })).rejects.toThrow('TAX_PRODUCTION_VERIFIED_EXCHANGE_RATE_REQUIRED');
  });
  test('combines only a ready ARCA binding, frozen Desk data, and signer-reserved counters', async () => {
    const intent = {
      intentId: 'invoice-1',
      workspaceId: 'workspace-1',
      taxpayerReferenceHash: 'a'.repeat(64),
      foreignCustomerReferenceHash: 'b'.repeat(64),
      pointOfSale: 4,
    };
    const intentHash = 'c'.repeat(64);
    const run = { runId: '10000000-0000-4000-8000-000000000001', workspaceId: 'workspace-1', intentHash, intent } as unknown as FacturaEAgentRunV1;
    const issuerProfileRef = 'vault://issuer/profile-1';
    const representedCuitCommitment = 'd'.repeat(64);
    const onboarding = {
      status: 'ready', environment: 'homologation', workspaceId: 'workspace-1',
      taxpayerReferenceHash: intent.taxpayerReferenceHash, requestedServices: ['wsfex'],
      delegation: { wsfex: true, wsfe: false }, apiVerification: { wsfex: true, wsfe: false, observedAt: '2026-07-16T12:00:00.000Z' },
      pointOfSale: { number: 4, source: 'discovered', active: true },
      authorityBinding: { issuerProfileReferenceHash: hashCanonical(issuerProfileRef), representedCuitCommitment },
      updatedAt: '2026-07-16T12:00:00.000Z',
    } as unknown as ArcaOnboardingRunV1;
    let reservedAfterPrivateData = false;
    const gateway = new TaxOwnedFacturaEAuthorityPreparationGateway(
      { getRun: () => run },
      { listArcaOnboardingRuns: () => [onboarding] },
      new Map([['workspace-1', issuerProfileRef]]),
      new Map([['USD', 'DOL']]),
      { getFrozenPrivateData: async input => {
        reservedAfterPrivateData = true;
        const material = {
          version: 'desk-factura-e-private-data-v1' as const,
          executionId: input.executionId, workspaceId: input.workspaceId, runId: input.runId,
          intentHash: input.intentHash, taxpayerReferenceHash: input.taxpayerReferenceHash,
          foreignCustomerReferenceHash: input.foreignCustomerReferenceHash,
          idempotencyKey: input.idempotencyKey,
          customer: { name: 'Foreign Customer', address: '123 Main St', countryCuit: '50000000016', foreignTaxId: 'US-TAX-ID' },
          language: 2 as const, commercialObservation: null, generalObservation: null,
          frozenAt: '2026-07-16T11:59:00.000Z',
        };
        return { ...material, evidenceHash: hashCanonical(material) };
      } },
      { reserveSequence: async input => {
        expect(reservedAfterPrivateData).toBe(true);
        expect(input).toEqual(expect.objectContaining({
          workspaceId: 'workspace-1', issuerProfileRef, subjectId: 'invoice-1', pointOfSale: 4,
        }));
        return {
          version: 'tax-wsfex-sequence-reservation-receipt-v1', environment: 'homologation',
          workspaceId: input.workspaceId, issuerProfileRef,
          issuerProfileReferenceHash: hashCanonical(issuerProfileRef), representedCuitCommitment,
          runId: input.runId, intentHash: input.intentHash, subjectId: input.subjectId,
          documentType: 19, pointOfSale: input.pointOfSale, requestId: '101', invoiceNumber: '6',
          idempotencyKey: input.idempotencyKey, reservedAt: '2026-07-16T12:00:00.000Z',
          expiresAt: '2026-07-16T12:10:00.000Z', replayed: false, evidenceHash: 'e'.repeat(64),
        };
      } },
      'homologation',
      () => new Date('2026-07-16T12:01:00.000Z')
    );
    const prepared = await gateway.prepare({
      executionId: 'execution-1', workspaceId: 'workspace-1', runId: run.runId,
      intentHash, pointOfSale: 4, currency: 'USD',
      taxpayerReferenceHash: intent.taxpayerReferenceHash,
      foreignCustomerReferenceHash: intent.foreignCustomerReferenceHash,
      idempotencyKey: 'prepare:invoice-1',
    });
    expect(prepared).toEqual(expect.objectContaining({
      requestId: '101', invoiceNumber: '6', issuerProfileRef,
      representedCuitCommitment, currencyArcaId: 'DOL',
    }));
    const { preparationHash, ...material } = prepared;
    expect(preparationHash).toBe(hashCanonical(material));
  });

  test('fails closed when no completed onboarding binds the configured issuer profile', async () => {
    const run = {
      runId: '10000000-0000-4000-8000-000000000001', workspaceId: 'workspace-1', intentHash: 'c'.repeat(64),
      intent: { intentId: 'invoice-1', taxpayerReferenceHash: 'a'.repeat(64), foreignCustomerReferenceHash: 'b'.repeat(64), pointOfSale: 4 },
    } as unknown as FacturaEAgentRunV1;
    const gateway = new TaxOwnedFacturaEAuthorityPreparationGateway(
      { getRun: () => run }, { listArcaOnboardingRuns: () => [] },
      new Map([['workspace-1', 'vault://issuer/profile-1']]), new Map([['USD', 'DOL']]),
      { getFrozenPrivateData: async () => { throw new Error('must not run'); } },
      { reserveSequence: async () => { throw new Error('must not run'); } },
      'homologation'
    );
    await expect(gateway.prepare({
      executionId: 'execution-1', workspaceId: 'workspace-1', runId: run.runId,
      intentHash: run.intentHash!, pointOfSale: 4, currency: 'USD',
      taxpayerReferenceHash: 'a'.repeat(64), foreignCustomerReferenceHash: 'b'.repeat(64),
      idempotencyKey: 'prepare:invoice-1',
    })).rejects.toThrow('TAX_ARCA_READY_ONBOARDING_REQUIRED');
  });
});

test('refuses a Desk private-data redirect as an unavailable upstream', async () => {
  const gateway = new HttpDeskFacturaEPrivateDataGateway(
    new URL('https://desk.test/api/internal/tax/factura-e-private-data'), 'private-data-secret-'.padEnd(40, 's'), async () => new Response(null, { status: 302, headers: { location: 'https://attacker.test/' } }),
  );
  await expect(gateway.getFrozenCommercialRequest({
    workspaceId: '11111111-1111-4111-8111-111111111111', runId: '22222222-2222-4222-8222-222222222222',
    ledgerInvoiceId: '33333333-3333-4333-8333-333333333333',
    idempotencyKey: 'commercial-request:22222222-2222-4222-8222-222222222222',
  })).rejects.toThrow(/^TAX_DESK_PRIVATE_DATA_UPSTREAM_UNAVAILABLE$/);
});
