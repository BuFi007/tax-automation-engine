import { describe, expect, test } from 'bun:test';

import { assertTaxEvidenceBatchV1, hashTaxEvidenceConsentScope, resolveActiveEvidenceRecords } from './evidence';
import { buildStripeTaxEvidenceBatchV1, routeStripeTaxAuthority, stripeTaxTransactionEvidence } from './stripe-tax';

const base = {
  issuerCountry: 'US',
  customerCountry: 'US',
  productType: 'service' as const,
  requestedAuthority: 'stripe_tax_supported_jurisdiction' as const,
  invoiceDocumentKind: 'commercial_invoice' as const,
  stripeLocationValidated: true,
  stripeRegistrationState: 'confirmed' as const,
  customerTaxIdType: null,
};

describe('Stripe Tax authority routing', () => {
  test('never treats Stripe as Argentine fiscal authority or a Factura E', () => {
    const decision = routeStripeTaxAuthority({ ...base, issuerCountry: 'AR', customerCountry: 'US', customerTaxIdType: 'ar_cuit' });
    expect(decision).toMatchObject({
      issuerCountry: 'AR',
      customerCountry: 'US',
      productType: 'service',
      fiscalAuthority: 'arca',
      stripeRole: 'payment_evidence_only',
      calculationState: 'unsupported_seller_country',
      filingState: 'not_applicable',
    });
    expect(decision.warnings).toEqual(['STRIPE_DOCUMENT_IS_NOT_AN_ARCA_FISCAL_INVOICE', 'STRIPE_AR_CUIT_IS_DISPLAY_ONLY']);
  });

  test('allows supported indirect-tax calculation while retaining filing responsibility', () => {
    const decision = routeStripeTaxAuthority(base);
    expect(decision).toMatchObject({
      fiscalAuthority: 'stripe_tax_supported_jurisdiction',
      stripeRole: 'indirect_tax_calculation_evidence',
      calculationState: 'eligible_registered',
      filingState: 'user_responsible',
    });
    expect(decision.warnings).toContain('FILING_AND_REMITTANCE_AUTHORITY_NOT_PROVEN');
  });

  test('fails closed for product or location gaps', () => {
    expect(routeStripeTaxAuthority({ ...base, customerCountry: 'CL', productType: 'service' }).calculationState).toBe('unsupported_product_type');
    expect(routeStripeTaxAuthority({ ...base, customerCountry: 'CL', productType: 'digital' }).fiscalAuthority).toBe('stripe_tax_supported_jurisdiction');
    expect(routeStripeTaxAuthority({ ...base, customerCountry: 'CV', productType: 'digital' }).fiscalAuthority).toBe('stripe_tax_supported_jurisdiction');
    expect(routeStripeTaxAuthority({ ...base, customerCountry: 'ZA', productType: 'service' }).fiscalAuthority).toBe('stripe_tax_supported_jurisdiction');
    expect(routeStripeTaxAuthority({ ...base, issuerCountry: 'ZA', customerCountry: 'US' }).calculationState).toBe('unsupported_seller_country');
    expect(routeStripeTaxAuthority({ ...base, stripeLocationValidated: false }).calculationState).toBe('customer_location_unverified');
  });

  test('emits only non-counting canonical tax evidence from an eligible Stripe transaction', () => {
    const route = routeStripeTaxAuthority(base);
    const record = stripeTaxTransactionEvidence({
      workspaceId: 'workspace:1', sourceId: 'stripe:acct:1', consentVersion: 'consent-v1', issuerJurisdiction: 'US', period: { start: '2026-07-01', end: '2026-07-31' }, observedAt: '2026-07-15T00:00:00.000Z', economicEventId: 'event:invoice:1', providerTransactionHash: 'a'.repeat(64), providerRevision: '1', taxAmount: { decimal: '8.25', currency: 'USD' }, route, supersedes: null,
    });
    expect(record).toMatchObject({ sourceKind: 'stripe', canonicalProviderId: 'stripe_tax', economicRole: 'tax', countingDimension: 'none', direction: 'neutral', money: { decimal: '8.25', currency: 'USD' } });
    expect(record.idempotencyKey).toMatch(/^[a-f0-9]{64}$/);
    expect(() => assertTaxEvidenceBatchV1({
      version: 'tax-evidence-batch-v1',
      batchId: '10000000-0000-4000-8000-000000000001',
      workspaceId: 'workspace:1',
      source: { sourceId: 'stripe:acct:1', sourceKind: 'stripe', canonicalProviderId: 'stripe_tax', adapterSchemaVersion: 'stripe-tax-evidence-v1' },
      checkpoint: { sequence: 1, revision: '1', observedAt: '2026-07-15T00:00:00.000Z' },
      mode: 'incremental',
      consent: { purpose: 'tax_workspace_processing', version: 'consent-v1', scopeHash: hashTaxEvidenceConsentScope('consent-v1', ['stripe:acct:1']), sourceIds: ['stripe:acct:1'] },
      capabilities: [{ capability: 'tax_lines', state: 'available', observedAt: '2026-07-15T00:00:00.000Z', safeErrorCode: null }],
      records: [record],
      producedAt: '2026-07-15T00:00:00.000Z',
    })).not.toThrow();
  });

  test('binds calculation evidence to the exact seller jurisdiction', () => {
    const route = routeStripeTaxAuthority(base);
    const evidenceInput = {
      workspaceId: 'workspace:1', sourceId: 'stripe:acct:1', consentVersion: 'consent-v1', issuerJurisdiction: 'US' as const, period: { start: '2026-07-01', end: '2026-07-31' }, observedAt: '2026-07-15T00:00:00.000Z', economicEventId: 'event:invoice:1', providerTransactionHash: 'b'.repeat(64), providerRevision: '1', taxAmount: { decimal: '8.25', currency: 'USD' }, route, supersedes: null,
    };
    expect(() => stripeTaxTransactionEvidence({ ...evidenceInput, issuerJurisdiction: 'AR' })).toThrow('STRIPE_TAX_EVIDENCE_JURISDICTION_MISMATCH');
    expect(() => routeStripeTaxAuthority({ ...base, issuerCountry: 'US', invoiceDocumentKind: 'arca_factura_e' })).toThrow('STRIPE_TAX_ARCA_DOCUMENT_ISSUER_MISMATCH');

    const globalRoute = routeStripeTaxAuthority({ ...base, issuerCountry: 'GB', customerCountry: 'DE' });
    expect(stripeTaxTransactionEvidence({
      ...evidenceInput,
      issuerJurisdiction: null,
      providerTransactionHash: 'e'.repeat(64),
      route: globalRoute,
    }).jurisdiction).toBeNull();
    expect(() => stripeTaxTransactionEvidence({
      ...evidenceInput,
      issuerJurisdiction: 'US',
      providerTransactionHash: 'f'.repeat(64),
      route: globalRoute,
    })).toThrow('STRIPE_TAX_EVIDENCE_JURISDICTION_MISMATCH');
  });

  test('rejects a forged eligible route that is outside the pinned support matrix', () => {
    const forged = { ...routeStripeTaxAuthority(base), issuerCountry: 'AR' };
    expect(() => stripeTaxTransactionEvidence({
      workspaceId: 'workspace:1', sourceId: 'stripe:acct:1', consentVersion: 'consent-v1', issuerJurisdiction: 'AR', period: { start: '2026-07-01', end: '2026-07-31' }, observedAt: '2026-07-15T00:00:00.000Z', economicEventId: 'event:invoice:1', providerTransactionHash: 'c'.repeat(64), providerRevision: '1', taxAmount: { decimal: '8.25', currency: 'USD' }, route: forged, supersedes: null,
    })).toThrow('STRIPE_TAX_SUPPORT_MATRIX_ROUTE_INVALID');
  });

  test('builds an idempotent canonical batch and supersedes a corrected Stripe Tax revision', () => {
    const route = routeStripeTaxAuthority(base);
    const firstHash = 'd'.repeat(64);
    const batch = buildStripeTaxEvidenceBatchV1({
      batchId: '10000000-0000-4000-8000-000000000002',
      workspaceId: 'workspace:1',
      sourceId: 'stripe:acct:1',
      consentVersion: 'consent-v1',
      consentSourceIds: ['stripe:acct:1'],
      checkpoint: { sequence: 2, revision: 'report:2026-07-16', observedAt: '2026-07-16T00:00:00.000Z' },
      mode: 'incremental',
      producedAt: '2026-07-16T00:00:00.000Z',
      transactions: [
        { issuerJurisdiction: 'US', period: { start: '2026-07-01', end: '2026-07-31' }, observedAt: '2026-07-15T00:00:00.000Z', economicEventId: 'event:invoice:2', providerTransactionHash: firstHash, providerRevision: '1', taxAmount: { decimal: '8.25', currency: 'USD' }, route, supersedes: null },
        { issuerJurisdiction: 'US', period: { start: '2026-07-01', end: '2026-07-31' }, observedAt: '2026-07-16T00:00:00.000Z', economicEventId: 'event:invoice:2', providerTransactionHash: firstHash, providerRevision: '2', taxAmount: { decimal: '7.50', currency: 'USD' }, route, supersedes: { providerTransactionHash: firstHash, providerRevision: '1' } },
      ],
    });

    expect(batch.source).toMatchObject({ sourceKind: 'stripe', canonicalProviderId: 'stripe_tax', adapterSchemaVersion: 'stripe-tax-evidence-v2' });
    expect(batch.capabilities).toEqual(expect.arrayContaining([
      expect.objectContaining({ capability: 'tax_lines', state: 'available' }),
      expect.objectContaining({ capability: 'tax_documents', state: 'partial', safeErrorCode: 'STRIPE_DOCUMENT_NOT_FISCAL_AUTHORITY_RECEIPT' }),
    ]));
    expect(() => assertTaxEvidenceBatchV1(batch)).not.toThrow();
    expect(resolveActiveEvidenceRecords(batch.records)).toHaveLength(1);
    expect(resolveActiveEvidenceRecords(batch.records)[0]?.money).toEqual({ decimal: '7.5', currency: 'USD' });
    expect(JSON.stringify(batch)).not.toContain('sk_live');
  });
});
