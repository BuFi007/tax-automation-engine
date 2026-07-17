import { describe, expect, test } from 'bun:test';

import type { AccountantMandateV1 } from './accountant-mandate';
import { buildDigitalAssetAccountantPackage, buildDigitalAssetLedger, type DigitalAssetAcquisitionV1, type DigitalAssetDisposalV1 } from './digital-assets';

describe('digital asset tax evidence ledger', () => {
  test('reconciles an invoice-funded stablecoin lot into payroll with exact FIFO cost and fees', () => {
    const ledger = buildDigitalAssetLedger([
      acquisition('acq:invoice', '1000', '1000', 'event:factura-e-settlement'),
      disposal('dispose:payroll', '400', '400', '2', 'event:payroll-batch'),
    ]);

    expect(ledger.openLots).toEqual([expect.objectContaining({
      acquisitionEventId: 'acq:invoice',
      assetId: 'eip155:1/erc20:usdc',
      remainingQuantity: '600',
      remainingCostBasis: { decimal: '600', currency: 'USD' },
      economicEventId: 'event:factura-e-settlement',
      valuation: expect.objectContaining({ pair: 'USDC/USD', rate: '1' }),
    })]);
    expect(ledger.dispositions[0]).toMatchObject({
      purpose: 'payroll',
      state: 'active',
      allocatedCostBasis: { decimal: '400', currency: 'USD' },
      realizedResult: { decimal: '-2', currency: 'USD' },
      lotMatches: [{ acquisitionEventId: 'acq:invoice', quantity: '400', allocatedCostBasis: { decimal: '400', currency: 'USD' } }],
    });
  });

  test('full settlement reversal reopens the original lot and tombstones the disposition', () => {
    const ledger = buildDigitalAssetLedger([
      acquisition('acq:invoice', '1000', '1000', 'event:factura-e-settlement'),
      disposal('dispose:payroll', '400', '400', '2', 'event:payroll-batch'),
      {
        version: 'digital-asset-event-v1', kind: 'disposal_reversal', eventId: 'reverse:payroll', workspaceId: 'workspace:1', occurredAt: '2026-07-12T00:00:00.000Z', reversesEventId: 'dispose:payroll', provenance: { economicEventId: 'event:payroll-reversal', sourceEvidenceIds: ['evidence:provider-reversal'] },
      },
    ]);

    expect(ledger.openLots[0]).toMatchObject({ remainingQuantity: '1000', remainingCostBasis: { decimal: '1000', currency: 'USD' } });
    expect(ledger.dispositions[0]).toMatchObject({ state: 'reversed', allocatedCostBasis: null, realizedResult: null, lotMatches: [] });
    expect(ledger.reversalEventIds).toEqual(['reverse:payroll']);
  });

  test('rejects over-disposal, cross-currency fees and unprovenanced records', () => {
    expect(() => buildDigitalAssetLedger([
      acquisition('acq:invoice', '100', '100', 'event:invoice'),
      disposal('dispose:too-much', '101', '101', '0', 'event:sale'),
    ])).toThrow('DIGITAL_ASSET_INSUFFICIENT_LOTS');

    expect(() => buildDigitalAssetLedger([
      acquisition('acq:invoice', '100', '100', 'event:invoice'),
      { ...disposal('dispose:currency', '10', '10', '1', 'event:sale'), fee: { decimal: '1', currency: 'ARS' } },
    ])).toThrow('DIGITAL_ASSET_QUOTE_CURRENCY_MISMATCH');

    expect(() => buildDigitalAssetLedger([
      { ...acquisition('acq:no-proof', '100', '100', 'event:invoice'), provenance: { economicEventId: 'event:invoice', sourceEvidenceIds: [] } },
    ])).toThrow('DIGITAL_ASSET_PROVENANCE_REQUIRED');
  });

  test('never mixes same-symbol assets with different canonical identities', () => {
    expect(() => buildDigitalAssetLedger([
      acquisition('acq:ethereum', '100', '100', 'event:invoice'),
      { ...disposal('dispose:solana', '10', '10', '0', 'event:sale'), assetId: 'solana:mainnet/spl:usdc' },
    ])).toThrow('DIGITAL_ASSET_INSUFFICIENT_LOTS');
  });

  test('rejects duplicate economic events and untraceable or future valuations', () => {
    expect(() => buildDigitalAssetLedger([
      acquisition('acq:first', '100', '100', 'event:onchain:1'),
      acquisition('acq:duplicate', '100', '100', 'event:onchain:1'),
    ])).toThrow('DIGITAL_ASSET_ECONOMIC_EVENT_CONFLICT');

    expect(() => buildDigitalAssetLedger([
      { ...acquisition('acq:future-rate', '100', '100', 'event:onchain:2'), valuation: valuation('2026-07-11T00:00:00.000Z') },
    ])).toThrow('DIGITAL_ASSET_VALUATION_FROM_FUTURE');

    expect(() => buildDigitalAssetLedger([
      { ...acquisition('acq:wrong-pair', '100', '100', 'event:onchain:3'), valuation: { ...valuation('2026-07-10T00:00:00.000Z'), pair: 'USDT/USD' } },
    ])).toThrow('DIGITAL_ASSET_VALUATION_PAIR_MISMATCH');
  });

  test('requires verified or reviewed valuations and opaque evidence references', () => {
    expect(() => buildDigitalAssetLedger([
      {
        ...acquisition('acq:unreviewed-rate', '100', '100', 'event:onchain:4'),
        valuation: { ...valuation('2026-07-10T00:00:00.000Z'), confidence: 'unreviewed' },
      },
    ])).toThrow('DIGITAL_ASSET_VALUATION_VERIFICATION_REQUIRED');

    expect(() => buildDigitalAssetLedger([
      {
        ...acquisition('acq:raw-wallet-ref', '100', '100', 'event:onchain:5'),
        provenance: {
          economicEventId: 'event:onchain:5',
          sourceEvidenceIds: ['0x1234567890abcdef1234567890abcdef12345678'],
        },
      },
    ])).toThrow('DIGITAL_ASSET_PROVENANCE_REQUIRED');
  });

  test('builds a reproducible, mandate-scoped accountant CSV package with explicit partial coverage', () => {
    const historicalAcquisition = {
      ...acquisition('acq:historical', '10', '10', 'event:historical-acquisition'),
      occurredAt: '2025-01-10T00:00:00.000Z',
      valuation: valuation('2025-01-10T00:00:00.000Z'),
      provenance: { economicEventId: 'event:historical-acquisition', sourceEvidenceIds: ['evidence:historical-acquisition'] },
    };
    const historicalDisposal = {
      ...disposal('dispose:historical', '10', '10', '0', 'event:historical-disposal'),
      occurredAt: '2025-01-11T00:00:00.000Z',
      valuation: valuation('2025-01-11T00:00:00.000Z'),
      provenance: { economicEventId: 'event:historical-disposal', sourceEvidenceIds: ['evidence:historical-disposal'] },
    };
    const ledger = buildDigitalAssetLedger([
      historicalAcquisition,
      historicalDisposal,
      acquisition('acq:invoice', '1000', '1000', 'event:factura-e-settlement'),
      disposal('dispose:payroll', '400', '400', '2', 'event:payroll-batch'),
    ]);
    const input = {
      ledger,
      period: { start: '2026-01-01', end: '2026-12-31' },
      evidenceCoverageThrough: '2026-07-15T23:59:59.999Z',
      preparedAt: '2026-07-16T00:00:00.000Z',
      accountantActorId: 'accountant:1',
      mandate: accountantMandate(),
    } as const;
    const first = buildDigitalAssetAccountantPackage(input);
    const replay = buildDigitalAssetAccountantPackage(input);

    expect(first).toEqual(replay);
    expect(first).toMatchObject({
      version: 'digital-asset-accountant-package-v1',
      workspaceId: 'workspace:1',
      method: 'FIFO',
      coverageState: 'partial',
      accountantAuthority: {
        mandateId: 'mandate:export',
        accountantActorId: 'accountant:1',
        accountantOrganizationId: 'accounting-firm:1',
      },
    });
    expect(first.limitations).toContain('PARTIAL_EVIDENCE_COVERAGE');
    expect(first.files.map(file => [file.fileName, file.rowCount])).toEqual([
      ['holdings.csv', 1],
      ['dispositions.csv', 1],
      ['lot-matches.csv', 1],
      ['source-manifest.csv', 5],
    ]);
    expect(first.files.every(file => /^[a-f0-9]{64}$/.test(file.sha256) && file.contents.endsWith('\n'))).toBe(true);
    expect(first.files.find(file => file.fileName === 'dispositions.csv')?.contents).toContain('dispose:payroll');
    expect(first.files.find(file => file.fileName === 'source-manifest.csv')?.contents).not.toContain('historical-disposal');
    expect(first.packageHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(first)).not.toContain('walletAddress');
  });

  test('marks year-end coverage complete without claiming filing or jurisdiction classification', () => {
    const ledger = buildDigitalAssetLedger([acquisition('acq:invoice', '1000', '1000', 'event:factura-e-settlement')]);
    const packet = buildDigitalAssetAccountantPackage({
      ledger,
      period: { start: '2026-01-01', end: '2026-12-31' },
      evidenceCoverageThrough: '2026-12-31T23:59:59.999Z',
      preparedAt: '2027-01-01T00:00:00.000Z',
      accountantActorId: 'accountant:1',
      mandate: { ...accountantMandate(), expiresAt: '2027-02-01T00:00:00.000Z' },
    });

    expect(packet.coverageState).toBe('complete');
    expect(packet.limitations).toEqual(['ACCOUNTANT_REVIEW_REQUIRED', 'JURISDICTION_CLASSIFICATION_NOT_INFERRED']);
  });

  test('refuses accountant export without exact active authority or coherent evidence coverage', () => {
    const ledger = buildDigitalAssetLedger([acquisition('acq:invoice', '1000', '1000', 'event:factura-e-settlement')]);
    const base = {
      ledger,
      period: { start: '2026-01-01', end: '2026-12-31' },
      evidenceCoverageThrough: '2026-07-15T23:59:59.999Z',
      preparedAt: '2026-07-16T00:00:00.000Z',
      accountantActorId: 'accountant:1',
      mandate: accountantMandate(),
    } as const;

    expect(() => buildDigitalAssetAccountantPackage({ ...base, mandate: { ...base.mandate, scopes: ['review_tax_obligation'] } }))
      .toThrow('ACCOUNTANT_MANDATE_SCOPE_UNAUTHORIZED');
    expect(() => buildDigitalAssetAccountantPackage({ ...base, accountantActorId: 'accountant:other' }))
      .toThrow('ACCOUNTANT_MANDATE_ACTOR_UNAUTHORIZED');
    expect(() => buildDigitalAssetAccountantPackage({ ...base, evidenceCoverageThrough: '2026-07-01T00:00:00.000Z' }))
      .toThrow('DIGITAL_ASSET_EXPORT_COVERAGE_BEFORE_LEDGER');
    expect(() => buildDigitalAssetAccountantPackage({ ...base, evidenceCoverageThrough: '2027-01-01T00:00:00.000Z', preparedAt: '2027-01-02T00:00:00.000Z' }))
      .toThrow('DIGITAL_ASSET_EXPORT_COVERAGE_AFTER_PERIOD');
  });
});

function accountantMandate(): AccountantMandateV1 {
  return {
    version: 'accountant-mandate-v1',
    mandateId: 'mandate:export',
    workspaceId: 'workspace:1',
    accountantActorId: 'accountant:1',
    accountantOrganizationId: 'accounting-firm:1',
    scopes: ['export_accountant_packet'],
    grantedByActorId: 'user:owner',
    grantedAt: '2026-07-01T00:00:00.000Z',
    expiresAt: '2026-08-01T00:00:00.000Z',
    revokedAt: null,
  };
}

function acquisition(eventId: string, quantity: string, cost: string, economicEventId: string): DigitalAssetAcquisitionV1 {
  return {
    version: 'digital-asset-event-v1', kind: 'acquisition', eventId, workspaceId: 'workspace:1', occurredAt: '2026-07-10T00:00:00.000Z', asset: 'USDC', assetId: 'eip155:1/erc20:usdc', quantity, costBasis: { decimal: cost, currency: 'USD' }, valuation: valuation('2026-07-10T00:00:00.000Z'), purpose: 'invoice_settlement', provenance: { economicEventId, sourceEvidenceIds: ['evidence:onchain-receipt', 'evidence:factura-e'] },
  };
}

function disposal(eventId: string, quantity: string, proceeds: string, fee: string, economicEventId: string): DigitalAssetDisposalV1 {
  return {
    version: 'digital-asset-event-v1', kind: 'disposal', eventId, workspaceId: 'workspace:1', occurredAt: '2026-07-11T00:00:00.000Z', asset: 'USDC', assetId: 'eip155:1/erc20:usdc', quantity, proceeds: { decimal: proceeds, currency: 'USD' }, fee: { decimal: fee, currency: 'USD' }, valuation: valuation('2026-07-11T00:00:00.000Z'), purpose: 'payroll', provenance: { economicEventId, sourceEvidenceIds: ['evidence:payroll-settlement'] },
  };
}

function valuation(observedAt: string) {
  return { provider: 'provider:historical-prices', pair: 'USDC/USD', observedAt, rate: '1', confidence: 'verified' as const, evidenceId: 'evidence:historical-price' };
}
