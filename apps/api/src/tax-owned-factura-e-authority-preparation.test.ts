import { describe, expect, test } from 'bun:test';

import { hashCanonical, type ArcaOnboardingRunV1, type FacturaEAgentRunV1 } from '@tax-engine/core';

import { TaxOwnedFacturaEAuthorityPreparationGateway } from './tax-owned-factura-e-authority-preparation';

describe('Tax-owned Factura E authority preparation', () => {
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
