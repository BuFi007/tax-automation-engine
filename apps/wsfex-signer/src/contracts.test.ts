import { describe, expect, test } from 'bun:test';

import { hashCanonical } from '@tax-engine/core';

import {
  assertPayloadMatchesRequest,
  authorityPayloadSchema,
  hashWsfexAuthorityIdentity,
  hashWsfexReconciliationAttestation,
  isValidCuit,
  signerRequestSchema,
  signerResponseSchema,
} from './contracts';
import { canonicalAdjustment, payload, request } from './test-fixtures';

describe('WSFEX signer contracts', () => {
  test('validates represented and destination-country CUIT check digits', () => {
    expect(isValidCuit('20123456786')).toBe(true);
    expect(isValidCuit('20123456789')).toBe(false);
    expect(() => authorityPayloadSchema.parse(payload({ customer: { ...payload().customer, countryCuit: '50000000019' } }))).toThrow('CUIT_CHECK_DIGIT_INVALID');
  });

  test('accepts the largest ARCA N15 request id and rejects a sixteenth digit', () => {
    expect(signerRequestSchema.parse(request({ requestId: '999999999999999' })).requestId).toBe('999999999999999');
    expect(() => signerRequestSchema.parse(request({ requestId: '1000000000000000' }))).toThrow();
  });

  test('requires the full CAE receipt and frozen/confirmed currency on every accepted response', () => {
    const accepted = {
      requestId: '101', status: 'accepted' as const, invoiceNumber: '6', cae: '12345678901234', caeExpiry: '2026-07-21', reprocessed: false,
      authorizedDocument: {
        intentHash: request().intentHash, documentType: 19 as const, operationType: 2 as const, pointOfSale: 4, issueDate: '2026-07-11',
        total: { decimal: '1000.00', currency: 'USD' }, currencyId: 'DOL', currencyQuote: '1200.25',
      },
      reconciliation: null,
      safeErrors: [],
    };
    expect(signerResponseSchema.parse(accepted)).toEqual(accepted);
    expect(() => signerResponseSchema.parse({ ...accepted, caeExpiry: null })).toThrow('WSFEX_ACCEPTED_CAE_EXPIRY_REQUIRED');
    expect(() => signerResponseSchema.parse({ ...accepted, authorizedDocument: { ...accepted.authorizedDocument, currencyId: undefined } })).toThrow();
  });

  test('keeps official invoice identity independent of CAE while evidence binds the exact CAE', () => {
    const authorityIdentityHash = hashWsfexAuthorityIdentity({
      environment: 'production',
      representedCuitCommitment: 'a'.repeat(64),
      documentType: 19,
      pointOfSale: 4,
      invoiceNumber: '6',
    });
    const attestationMaterial = {
      version: 'arca-wsfex-reconciliation-attestation-v1' as const,
      source: 'FEXGetCMP' as const,
      environment: 'production' as const,
      representedCuitCommitment: 'a'.repeat(64),
      authorityIdentityHash,
      authorityResponseHash: 'b'.repeat(64),
      payloadHash: 'c'.repeat(64),
      requestId: '101',
      intentHash: 'd'.repeat(64),
      documentType: 19 as const,
      pointOfSale: 4,
      invoiceNumber: '6',
      cae: '12345678901234',
      observedAt: '2026-07-11T12:00:00.000Z',
    };
    const reconciliation = {
      ...attestationMaterial,
      evidenceHash: hashWsfexReconciliationAttestation(attestationMaterial),
    };
    const accepted = {
      requestId: '101',
      status: 'accepted' as const,
      invoiceNumber: '6',
      cae: attestationMaterial.cae,
      caeExpiry: '2026-07-21',
      reprocessed: true,
      authorizedDocument: {
        intentHash: attestationMaterial.intentHash,
        documentType: 19 as const,
        operationType: 2 as const,
        pointOfSale: 4,
        issueDate: '2026-07-11',
        total: { decimal: '1000.00', currency: 'USD' },
        currencyId: 'DOL',
        currencyQuote: '1200.25',
      },
      reconciliation,
      safeErrors: [],
    };
    expect(signerResponseSchema.parse(accepted).reconciliation?.authorityIdentityHash)
      .toBe(authorityIdentityHash);

    const changedCae = '99999999999999';
    expect(hashWsfexAuthorityIdentity({
      environment: 'production',
      representedCuitCommitment: 'a'.repeat(64),
      documentType: 19,
      pointOfSale: 4,
      invoiceNumber: '6',
    })).toBe(authorityIdentityHash);
    expect(() => signerResponseSchema.parse({
      ...accepted,
      cae: changedCae,
      reconciliation: { ...reconciliation, cae: changedCae },
    })).toThrow('WSFEX_RECONCILIATION_EVIDENCE_HASH_MISMATCH');
  });

  test('rejects authority payload totals that do not equal the exact item sum', () => {
    expect(() => authorityPayloadSchema.parse(payload({ total: '999.99' }))).toThrow('AUTHORITY_PAYLOAD_TOTAL_MISMATCH');
  });

  test('recomputes the approved canonical intent instead of trusting the payload intentHash field', () => {
    const validPayload = payload();
    const validRequest = request();
    expect(() => assertPayloadMatchesRequest(validPayload, validRequest)).not.toThrow();
    if (validPayload.canonicalDocument.version !== 'factura-e-intent-v1') throw new Error('invoice fixture required');
    const datedDocument = {
      ...validPayload.canonicalDocument,
      servicePeriod: { start: '2026-07-01', end: '2026-07-31' },
    };
    const datedPayload = payload({ canonicalDocument: datedDocument, intentHash: hashCanonical(datedDocument) });
    const datedRequest = request({
      intentHash: hashCanonical(datedDocument), authorityPayloadHash: hashCanonical(datedPayload),
    });
    expect(() => assertPayloadMatchesRequest(datedPayload, datedRequest)).not.toThrow();
    const changedPeriodPayload = {
      ...datedPayload,
      canonicalDocument: { ...datedDocument, servicePeriod: { ...datedDocument.servicePeriod, end: '2026-08-31' } },
    };
    expect(() => assertPayloadMatchesRequest(changedPeriodPayload, {
      ...datedRequest, authorityPayloadHash: hashCanonical(changedPeriodPayload),
    })).toThrow('AUTHORITY_PAYLOAD_CANONICAL_HASH_MISMATCH');
    const changedCanonical = { ...validPayload.canonicalDocument, paymentTerms: 'Changed after approval' };
    const changedCanonicalPayload = { ...validPayload, canonicalDocument: changedCanonical };
    expect(() => assertPayloadMatchesRequest(changedCanonicalPayload, {
      ...validRequest,
      authorityPayloadHash: hashCanonical(changedCanonicalPayload),
    }))
      .toThrow('AUTHORITY_PAYLOAD_CANONICAL_HASH_MISMATCH');
    const changedItemsPayload = {
      ...validPayload,
      items: [{ ...validPayload.items[0]!, description: 'Different unapproved service' }],
    };
    expect(() => assertPayloadMatchesRequest(changedItemsPayload, {
      ...validRequest,
      authorityPayloadHash: hashCanonical(changedItemsPayload),
    })).toThrow('AUTHORITY_PAYLOAD_CANONICAL_ITEMS_MISMATCH');
    const changedCustomerPayload = {
      ...validPayload,
      customer: { ...validPayload.customer, referenceHash: hashCanonical('different-customer') },
    };
    expect(() => assertPayloadMatchesRequest(changedCustomerPayload, {
      ...validRequest,
      authorityPayloadHash: hashCanonical(changedCustomerPayload),
    })).toThrow('AUTHORITY_PAYLOAD_CANONICAL_INVOICE_MISMATCH');
  });

  test('keeps payment date and same-currency flag off adjustments and binds the exact original', () => {
    const association = { documentType: 19 as const, pointOfSale: 4, invoiceNumber: '81' };
    const canonicalDocument = canonicalAdjustment({ adjustmentId: 'credit-note-1', documentType: 21, amount: '100.00', reason: 'Commercial credit' });
    const adjustment = payload({
      canonicalDocument,
      subjectId: 'credit-note-1',
      intentHash: hashCanonical(canonicalDocument),
      requestId: '102',
      documentType: 21,
      invoiceNumber: '82',
      paymentDate: null,
      sameCurrencyPayment: null,
      total: '100.00',
      paymentTerms: null,
      items: [{ code: null, description: 'Commercial credit', quantity: '1', unitCode: 7, unitPrice: '100.00', discount: '0', total: '100.00' }],
      associatedDocument: association,
    });
    const parsedPayload = authorityPayloadSchema.parse(adjustment);
    const parsedRequest = signerRequestSchema.parse(request({
      subjectId: 'credit-note-1',
      requestId: '102',
      intentHash: adjustment.intentHash,
      authorityPayloadHash: hashCanonical(parsedPayload),
      expected: {
        documentType: 21,
        operationType: 2,
        pointOfSale: 4,
        issueDate: '2026-07-11',
        total: { decimal: '100.00', currency: 'USD' },
        associatedDocument: association,
      },
    }));
    expect(() => assertPayloadMatchesRequest(parsedPayload, parsedRequest)).not.toThrow();
    expect(() => authorityPayloadSchema.parse({ ...adjustment, paymentDate: '2026-07-11' })).toThrow('PAYMENT_DATE_FORBIDDEN_FOR_ADJUSTMENT');
    expect(() => authorityPayloadSchema.parse({ ...adjustment, sameCurrencyPayment: false })).toThrow('SAME_CURRENCY_FLAG_FORBIDDEN_FOR_ADJUSTMENT');
  });
});
