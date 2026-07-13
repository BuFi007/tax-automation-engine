import { describe, expect, test } from 'bun:test';

import { hashCanonical } from '@tax-engine/core';

import {
  assertIssueDateWithinWindow,
  assertPayloadMatchesRequest,
  authorityPayloadSchema,
  buenosAiresToday,
  isValidCuit,
  signerRequestSchema,
} from './contracts';
import { canonicalAdjustment, payload, RECEPTOR_CUIT, request } from './test-fixtures';

describe('WSFE signer domestic contracts', () => {
  test('validates receptor CUIT check digit and forces Consumidor Final to DocNro 0', () => {
    expect(isValidCuit(RECEPTOR_CUIT)).toBe(true);
    expect(() => authorityPayloadSchema.parse(payload({ receptor: { docType: 80, docNumber: '27300000000', condicionIvaId: 6 } }))).toThrow('RECEPTOR_CUIT_CUIL_CHECK_DIGIT_INVALID');
    expect(() => authorityPayloadSchema.parse(payload({ receptor: { docType: 99, docNumber: '123', condicionIvaId: 5 } }))).toThrow('CONSUMIDOR_FINAL_DOC_NUMBER_MUST_BE_ZERO');
    expect(authorityPayloadSchema.parse(payload({ receptor: { docType: 99, docNumber: '0', condicionIvaId: 5 } })).receptor.docType).toBe(99);
  });

  test('accepts the largest N15 request id and rejects a sixteenth digit', () => {
    expect(signerRequestSchema.parse(request({ requestId: '999999999999999' })).requestId).toBe('999999999999999');
    expect(() => signerRequestSchema.parse(request({ requestId: '1000000000000000' }))).toThrow();
  });

  test('binds concepto to the service period and comprobante class to the association', () => {
    expect(() => authorityPayloadSchema.parse(payload({ concept: 1 }))).toThrow('SERVICE_PERIOD_FORBIDDEN_FOR_PRODUCTS');
    expect(() => authorityPayloadSchema.parse(payload({ concept: 2, servicePeriod: null }))).toThrow('SERVICE_PERIOD_REQUIRED_FOR_SERVICES');
    expect(() => authorityPayloadSchema.parse(payload({ associatedDocument: { documentType: 11, pointOfSale: 4, invoiceNumber: '81' } }))).toThrow('INVOICE_ASSOCIATION_FORBIDDEN');
    const credit = canonicalAdjustment({ adjustmentId: 'credit-1', documentType: 13, amount: '5000.00', reason: 'Anulación parcial' });
    expect(() => authorityPayloadSchema.parse(payload({
      canonicalDocument: credit, subjectId: 'credit-1', intentHash: hashCanonical(credit), documentType: 13, invoiceNumber: '1',
      total: { decimal: '5000.00', currency: 'ARS' }, associatedDocument: null,
    }))).toThrow('ADJUSTMENT_ASSOCIATION_REQUIRED');
  });

  test('recomputes the approved canonical intent instead of trusting the payload intentHash field', () => {
    const validPayload = payload();
    const validRequest = request();
    expect(() => assertPayloadMatchesRequest(validPayload, validRequest)).not.toThrow();
    const changedCanonical = { ...validPayload.canonicalDocument, description: 'Changed after approval' };
    expect(() => assertPayloadMatchesRequest({ ...validPayload, canonicalDocument: changedCanonical }, validRequest))
      .toThrow('AUTHORITY_PAYLOAD_CANONICAL_HASH_MISMATCH');
    // A total that disagrees with the frozen expected coordinates is caught directly.
    expect(() => assertPayloadMatchesRequest({ ...validPayload, total: { decimal: '16000.00', currency: 'ARS' } }, validRequest))
      .toThrow('AUTHORITY_PAYLOAD_DOCUMENT_MISMATCH');
    // The receptor DocNro is not an expected coordinate; swapping it breaks the canonical reference hash instead.
    expect(() => assertPayloadMatchesRequest({ ...validPayload, receptor: { docType: 80, docNumber: '20111111112', condicionIvaId: 6 } }, validRequest))
      .toThrow('AUTHORITY_PAYLOAD_CANONICAL_INVOICE_MISMATCH');
  });

  test('binds a note to its exact original document and expected coordinates', () => {
    const association = { documentType: 11 as const, pointOfSale: 4, invoiceNumber: '81' };
    const credit = canonicalAdjustment({ adjustmentId: 'credit-1', documentType: 13, amount: '5000.00', reason: 'Anulación parcial' });
    const notePayload = authorityPayloadSchema.parse(payload({
      canonicalDocument: credit, subjectId: 'credit-1', intentHash: hashCanonical(credit), requestId: '102', invoiceNumber: '1', documentType: 13,
      total: { decimal: '5000.00', currency: 'ARS' }, associatedDocument: association,
    }));
    const noteRequest = signerRequestSchema.parse(request({
      subjectId: 'credit-1', requestId: '102', intentHash: credit && hashCanonical(credit), authorityPayloadRef: 'vault://wsfe/note-1',
      expected: { documentType: 13, concept: 2, pointOfSale: 4, issueDate: '2026-07-11', receptorDocType: 80, receptorCondicionIvaId: 6, total: { decimal: '5000.00', currency: 'ARS' }, servicePeriod: { from: '2026-07-01', to: '2026-07-11', paymentDueDate: '2026-07-11' }, associatedDocument: association },
    }));
    expect(() => assertPayloadMatchesRequest(notePayload, noteRequest)).not.toThrow();
    const wrongAssociation = signerRequestSchema.parse(request({
      subjectId: 'credit-1', requestId: '102', intentHash: hashCanonical(credit), authorityPayloadRef: 'vault://wsfe/note-1',
      expected: { documentType: 13, concept: 2, pointOfSale: 4, issueDate: '2026-07-11', receptorDocType: 80, receptorCondicionIvaId: 6, total: { decimal: '5000.00', currency: 'ARS' }, servicePeriod: { from: '2026-07-01', to: '2026-07-11', paymentDueDate: '2026-07-11' }, associatedDocument: { ...association, invoiceNumber: '82' } },
    }));
    expect(() => assertPayloadMatchesRequest(notePayload, wrongAssociation)).toThrow('AUTHORITY_PAYLOAD_ASSOCIATION_MISMATCH');
  });

  test('resolves today in Buenos Aires so a UTC host past 21:00 does not emit tomorrow', () => {
    // 2026-07-12T01:00Z is 2026-07-11 22:00 in Buenos Aires (UTC-3).
    expect(buenosAiresToday('2026-07-12T01:00:00.000Z')).toBe('2026-07-11');
    expect(buenosAiresToday('2026-07-11T12:00:00.000Z')).toBe('2026-07-11');
  });

  test('enforces the retro window: 10 days for services, 5 for products, no future dates', () => {
    const occurredAt = '2026-07-11T12:00:00.000Z';
    expect(() => assertIssueDateWithinWindow('2026-07-11', 2, occurredAt)).not.toThrow();
    expect(() => assertIssueDateWithinWindow('2026-07-01', 2, occurredAt)).not.toThrow();
    expect(() => assertIssueDateWithinWindow('2026-06-30', 2, occurredAt)).toThrow('WSFE_ISSUE_DATE_INVALID_RETRO_WINDOW');
    expect(() => assertIssueDateWithinWindow('2026-07-06', 1, occurredAt)).not.toThrow();
    expect(() => assertIssueDateWithinWindow('2026-07-05', 1, occurredAt)).toThrow('WSFE_ISSUE_DATE_INVALID_RETRO_WINDOW');
    expect(() => assertIssueDateWithinWindow('2026-07-12', 2, occurredAt)).toThrow('WSFE_ISSUE_DATE_INVALID_FUTURE');
  });
});
