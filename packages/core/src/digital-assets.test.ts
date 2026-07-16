import { describe, expect, test } from 'bun:test';

import { buildDigitalAssetLedger, type DigitalAssetAcquisitionV1, type DigitalAssetDisposalV1 } from './digital-assets';

describe('digital asset tax evidence ledger', () => {
  test('reconciles an invoice-funded stablecoin lot into payroll with exact FIFO cost and fees', () => {
    const ledger = buildDigitalAssetLedger([
      acquisition('acq:invoice', '1000', '1000', 'event:factura-e-settlement'),
      disposal('dispose:payroll', '400', '400', '2', 'event:payroll-batch'),
    ]);

    expect(ledger.openLots).toEqual([expect.objectContaining({
      acquisitionEventId: 'acq:invoice',
      remainingQuantity: '600',
      remainingCostBasis: { decimal: '600', currency: 'USD' },
      economicEventId: 'event:factura-e-settlement',
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
});

function acquisition(eventId: string, quantity: string, cost: string, economicEventId: string): DigitalAssetAcquisitionV1 {
  return {
    version: 'digital-asset-event-v1', kind: 'acquisition', eventId, workspaceId: 'workspace:1', occurredAt: '2026-07-10T00:00:00.000Z', asset: 'USDC', quantity, costBasis: { decimal: cost, currency: 'USD' }, purpose: 'invoice_settlement', provenance: { economicEventId, sourceEvidenceIds: ['evidence:onchain-receipt', 'evidence:factura-e'] },
  };
}

function disposal(eventId: string, quantity: string, proceeds: string, fee: string, economicEventId: string): DigitalAssetDisposalV1 {
  return {
    version: 'digital-asset-event-v1', kind: 'disposal', eventId, workspaceId: 'workspace:1', occurredAt: '2026-07-11T00:00:00.000Z', asset: 'USDC', quantity, proceeds: { decimal: proceeds, currency: 'USD' }, fee: { decimal: fee, currency: 'USD' }, purpose: 'payroll', provenance: { economicEventId, sourceEvidenceIds: ['evidence:payroll-settlement'] },
  };
}
