import { describe, expect, test } from 'bun:test';

import { hashCanonical } from '@tax-engine/core';

import { assertPayloadMatchesRequest, authorityPayloadSchema, isValidCuit, signerRequestSchema } from './contracts';
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

  test('rejects authority payload totals that do not equal the exact item sum', () => {
    expect(() => authorityPayloadSchema.parse(payload({ total: '999.99' }))).toThrow('AUTHORITY_PAYLOAD_TOTAL_MISMATCH');
  });

  test('recomputes the approved canonical intent instead of trusting the payload intentHash field', () => {
    const validPayload = payload();
    const validRequest = request();
    expect(() => assertPayloadMatchesRequest(validPayload, validRequest)).not.toThrow();
    const changedCanonical = { ...validPayload.canonicalDocument, paymentTerms: 'Changed after approval' };
    expect(() => assertPayloadMatchesRequest({ ...validPayload, canonicalDocument: changedCanonical }, validRequest))
      .toThrow('AUTHORITY_PAYLOAD_CANONICAL_HASH_MISMATCH');
    expect(() => assertPayloadMatchesRequest({
      ...validPayload,
      items: [{ ...validPayload.items[0]!, description: 'Different unapproved service' }],
    }, validRequest)).toThrow('AUTHORITY_PAYLOAD_CANONICAL_ITEMS_MISMATCH');
    expect(() => assertPayloadMatchesRequest({
      ...validPayload,
      customer: { ...validPayload.customer, referenceHash: hashCanonical('different-customer') },
    }, validRequest)).toThrow('AUTHORITY_PAYLOAD_CANONICAL_INVOICE_MISMATCH');
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
