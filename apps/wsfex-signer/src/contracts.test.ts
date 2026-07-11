import { describe, expect, test } from 'bun:test';

import { assertPayloadMatchesRequest, authorityPayloadSchema, signerRequestSchema } from './contracts';
import { payload, request } from './test-fixtures';

describe('WSFEX signer contracts', () => {
  test('accepts the largest ARCA N15 request id and rejects a sixteenth digit', () => {
    expect(signerRequestSchema.parse(request({ requestId: '999999999999999' })).requestId).toBe('999999999999999');
    expect(() => signerRequestSchema.parse(request({ requestId: '1000000000000000' }))).toThrow();
  });

  test('rejects authority payload totals that do not equal the exact item sum', () => {
    expect(() => authorityPayloadSchema.parse(payload({ total: '999.99' }))).toThrow('AUTHORITY_PAYLOAD_TOTAL_MISMATCH');
  });

  test('keeps payment date and same-currency flag off adjustments and binds the exact original', () => {
    const association = { documentType: 19 as const, pointOfSale: 4, invoiceNumber: '81' };
    const adjustment = payload({
      subjectId: 'credit-note-1',
      requestId: '102',
      documentType: 21,
      invoiceNumber: '82',
      paymentDate: null,
      sameCurrencyPayment: null,
      total: '100.00',
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
