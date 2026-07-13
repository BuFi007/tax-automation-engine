import { describe, expect, test } from 'bun:test';

import { assertPayloadMatchesRequest, authorityPayloadSchema, expectedIvaImporte, isAboveFceMipymeThreshold, signerRequestSchema, type AuthorityPayload, type TaxBreakdown } from './contracts';
import {
  BREAKDOWN_21,
  BREAKDOWN_MIXED,
  buildVatAdjustmentCase,
  buildVatInvoiceCase,
  fceEmission,
  ivaLine,
  makeBreakdown,
  RECEPTOR_CONSUMIDOR_FINAL,
  RECEPTOR_MONOTRIBUTO,
  RECEPTOR_RI,
} from './test-fixtures-vat';

function parsePayload(payload: AuthorityPayload) {
  return authorityPayloadSchema.parse(payload);
}

describe('WSFE class A / B receptor + IVA matrix', () => {
  test('accepts a Factura A to an RI receptor with discriminated 21% IVA', () => {
    const { payload, request } = buildVatInvoiceCase({ documentType: 1, receptor: RECEPTOR_RI, taxBreakdown: BREAKDOWN_21 });
    expect(() => parsePayload(payload)).not.toThrow();
    expect(() => assertPayloadMatchesRequest(payload, signerRequestSchema.parse(request))).not.toThrow();
    expect(payload.total.decimal).toBe('12100.00');
  });

  test('accepts a Factura A to a Monotributo receptor (RG 5616: 6 → class A, not B)', () => {
    const { payload } = buildVatInvoiceCase({ documentType: 1, receptor: RECEPTOR_MONOTRIBUTO, taxBreakdown: BREAKDOWN_21 });
    expect(() => parsePayload(payload)).not.toThrow();
  });

  test('rejects a Factura A whose receptor is not a CUIT (DocTipo 80)', () => {
    const { payload } = buildVatInvoiceCase({ documentType: 1, receptor: { docType: 96, docNumber: '12345678', condicionIvaId: 1 }, taxBreakdown: BREAKDOWN_21 });
    expect(() => parsePayload(payload)).toThrow('CLASS_A_RECEPTOR_REQUIRES_CUIT');
  });

  test('rejects a Factura A whose receptor condición is outside {1,6,13,16}', () => {
    const { payload } = buildVatInvoiceCase({ documentType: 1, receptor: { docType: 80, docNumber: RECEPTOR_RI.docNumber, condicionIvaId: 5 }, taxBreakdown: BREAKDOWN_21 });
    expect(() => parsePayload(payload)).toThrow('CONDICION_IVA_INVALID_FOR_CLASS_A');
  });

  test('accepts a Factura B to a consumidor final and still reports IVA to ARCA', () => {
    const { payload } = buildVatInvoiceCase({ documentType: 6, receptor: RECEPTOR_CONSUMIDOR_FINAL, taxBreakdown: BREAKDOWN_21 });
    expect(() => parsePayload(payload)).not.toThrow();
    // Class B carries the same net/IVA breakdown as A — it is reported, not discriminated to the receptor.
    expect(payload.taxBreakdown?.netAmount).toBe('10000.00');
  });

  test('rejects a Factura B to an RI receptor (condición 1 is class A only)', () => {
    const { payload } = buildVatInvoiceCase({ documentType: 6, receptor: { docType: 80, docNumber: RECEPTOR_RI.docNumber, condicionIvaId: 1 }, taxBreakdown: BREAKDOWN_21 });
    expect(() => parsePayload(payload)).toThrow('CONDICION_IVA_INVALID_FOR_CLASS_B');
  });

  test('rejects a Factura B to a Monotributo receptor (6 is class A only under RG 5616)', () => {
    const { payload } = buildVatInvoiceCase({ documentType: 6, receptor: { docType: 80, docNumber: RECEPTOR_RI.docNumber, condicionIvaId: 6 }, taxBreakdown: BREAKDOWN_21 });
    expect(() => parsePayload(payload)).toThrow('CONDICION_IVA_INVALID_FOR_CLASS_B');
  });

  test('requires discriminated IVA for A/B and forbids it for a class-C FCE', () => {
    const missing = buildVatInvoiceCase({ documentType: 1, receptor: RECEPTOR_RI, taxBreakdown: BREAKDOWN_21 }).payload;
    expect(() => parsePayload({ ...missing, taxBreakdown: null })).toThrow('DISCRIMINATED_IVA_REQUIRED_FOR_CLASS_A');
    const fceC = buildVatInvoiceCase({ documentType: 211, receptor: RECEPTOR_CONSUMIDOR_FINAL, taxBreakdown: null, total: '9000.00', fce: fceEmission(), concept: 1 }).payload;
    expect(() => parsePayload({ ...fceC, taxBreakdown: BREAKDOWN_21 })).toThrow('DISCRIMINATED_IVA_FORBIDDEN_FOR_CLASS_C');
  });
});

describe('WSFE discriminated IVA arithmetic', () => {
  test('computes each alícuota importe to the cent (0/2.5/5/10.5/21/27%)', () => {
    expect(expectedIvaImporte('10000.00', 5)).toBe('2100.00');
    expect(expectedIvaImporte('5000.00', 4)).toBe('525.00');
    expect(expectedIvaImporte('10000.00', 6)).toBe('2700.00');
    expect(expectedIvaImporte('10000.00', 8)).toBe('500.00');
    expect(expectedIvaImporte('10000.00', 9)).toBe('250.00');
    expect(expectedIvaImporte('10000.00', 3)).toBe('0.00');
  });

  test('accepts a mixed 21% + 10.5% invoice with an exact total', () => {
    const { payload } = buildVatInvoiceCase({ documentType: 1, receptor: RECEPTOR_RI, taxBreakdown: BREAKDOWN_MIXED });
    expect(() => parsePayload(payload)).not.toThrow();
    expect(payload.taxBreakdown?.netAmount).toBe('15000.00');
    expect(payload.total.decimal).toBe('17625.00');
  });

  test('rejects a line whose importe drifts from baseImp × rate', () => {
    const bad: TaxBreakdown = { netAmount: '10000.00', ivaLineItems: [{ alicIvaId: 5, baseImp: '10000.00', importe: '2000.00' }], impTrib: '0', impOpEx: '0' };
    const { payload } = buildVatInvoiceCase({ documentType: 1, receptor: RECEPTOR_RI, taxBreakdown: BREAKDOWN_21 });
    expect(() => parsePayload({ ...payload, taxBreakdown: bad })).toThrow('IVA_LINE_IMPORTE_DRIFT');
  });

  test('rejects a breakdown whose base sum is not ImpNeto', () => {
    const bad: TaxBreakdown = { netAmount: '9999.00', ivaLineItems: [ivaLine(5, '10000.00')], impTrib: '0', impOpEx: '0' };
    const { payload } = buildVatInvoiceCase({ documentType: 1, receptor: RECEPTOR_RI, taxBreakdown: BREAKDOWN_21 });
    expect(() => parsePayload({ ...payload, taxBreakdown: bad })).toThrow('IVA_BASE_SUM_NOT_NET');
  });

  test('rejects a duplicated alícuota id', () => {
    const bad = makeBreakdown([ivaLine(5, '10000.00'), ivaLine(5, '5000.00')]);
    const { payload } = buildVatInvoiceCase({ documentType: 1, receptor: RECEPTOR_RI, taxBreakdown: BREAKDOWN_21 });
    expect(() => parsePayload({ ...payload, taxBreakdown: bad })).toThrow('IVA_ALICUOTA_DUPLICATED');
  });

  test('rejects a total that disagrees with net + IVA + trib + opEx', () => {
    const { payload } = buildVatInvoiceCase({ documentType: 1, receptor: RECEPTOR_RI, taxBreakdown: BREAKDOWN_21 });
    expect(() => parsePayload({ ...payload, total: { decimal: '13000.00', currency: 'ARS' } })).toThrow('TAX_BREAKDOWN_TOTAL_MISMATCH');
  });

  test('honours impTrib and impOpEx in the total invariant', () => {
    const breakdown = makeBreakdown([ivaLine(5, '10000.00')], { impTrib: '300.00', impOpEx: '1000.00' });
    const { payload } = buildVatInvoiceCase({ documentType: 1, receptor: RECEPTOR_RI, taxBreakdown: breakdown });
    expect(() => parsePayload(payload)).not.toThrow();
    expect(payload.total.decimal).toBe('13400.00');
  });
});

describe('WSFE FCE MiPyME field gates', () => {
  test('accepts an FCE-A factura carrying FchVtoPago + CBU + transmisión', () => {
    const { payload, request } = buildVatInvoiceCase({ documentType: 201, receptor: RECEPTOR_RI, taxBreakdown: BREAKDOWN_21, fce: fceEmission(), concept: 1 });
    expect(() => parsePayload(payload)).not.toThrow();
    expect(() => assertPayloadMatchesRequest(payload, signerRequestSchema.parse(request))).not.toThrow();
    expect(payload.fceEmission?.emitterCbu).toHaveLength(22);
  });

  test('rejects an FCE factura missing the FCE emission block', () => {
    const { payload } = buildVatInvoiceCase({ documentType: 201, receptor: RECEPTOR_RI, taxBreakdown: BREAKDOWN_21, fce: fceEmission(), concept: 1 });
    expect(() => parsePayload({ ...payload, fceEmission: null })).toThrow('FCE_EMISSION_FIELDS_REQUIRED');
  });

  test('rejects a non-FCE invoice that carries FCE emission fields', () => {
    const { payload } = buildVatInvoiceCase({ documentType: 1, receptor: RECEPTOR_RI, taxBreakdown: BREAKDOWN_21 });
    expect(() => parsePayload({ ...payload, fceEmission: fceEmission() })).toThrow('FCE_EMISSION_FIELDS_FORBIDDEN');
  });

  test('rejects an FCE payment-due date earlier than the issue date', () => {
    const { payload } = buildVatInvoiceCase({ documentType: 201, receptor: RECEPTOR_RI, taxBreakdown: BREAKDOWN_21, fce: fceEmission({ paymentDueDate: '2026-07-10' }), concept: 1, issueDate: '2026-07-11' });
    expect(() => parsePayload(payload)).toThrow('FCE_PAYMENT_DUE_DATE_BEFORE_ISSUE');
  });

  test('accepts an FCE-C factura on the class-C money model (no IVA) with FCE fields', () => {
    const { payload } = buildVatInvoiceCase({ documentType: 211, receptor: RECEPTOR_CONSUMIDOR_FINAL, taxBreakdown: null, total: '9000.00', fce: fceEmission(), concept: 1 });
    expect(() => parsePayload(payload)).not.toThrow();
    expect(payload.taxBreakdown).toBeNull();
  });

  test('exposes the desk-side FCE threshold helper (ARS 5.549.862 default)', () => {
    expect(isAboveFceMipymeThreshold('5549862')).toBe(true);
    expect(isAboveFceMipymeThreshold('5549861')).toBe(false);
  });
});

describe('WSFE FCE NC/ND association', () => {
  test('accepts an FCE-A nota de crédito with anulación + association to the FCE original (201)', () => {
    const { payload, request } = buildVatAdjustmentCase({ documentType: 203, receptor: RECEPTOR_RI, taxBreakdown: BREAKDOWN_21, anulacion: 'N' });
    expect(() => parsePayload(payload)).not.toThrow();
    expect(() => assertPayloadMatchesRequest(payload, signerRequestSchema.parse(request))).not.toThrow();
    expect(payload.associatedDocument?.documentType).toBe(201);
    expect(payload.fceAdjustment?.anulacion).toBe('N');
  });

  test('rejects an FCE ND/NC missing the anulación code', () => {
    const { payload } = buildVatAdjustmentCase({ documentType: 203, receptor: RECEPTOR_RI, taxBreakdown: BREAKDOWN_21 });
    expect(() => parsePayload({ ...payload, fceAdjustment: null })).toThrow('FCE_ADJUSTMENT_FIELDS_REQUIRED');
  });

  test('rejects a non-FCE nota carrying an anulación code', () => {
    const { payload } = buildVatAdjustmentCase({ documentType: 3, receptor: RECEPTOR_RI, taxBreakdown: BREAKDOWN_21 });
    expect(() => parsePayload({ ...payload, fceAdjustment: { anulacion: 'N' } })).toThrow('FCE_ADJUSTMENT_FIELDS_FORBIDDEN');
  });

  test('rejects an FCE-A nota associated to a non-FCE factura A (family mismatch)', () => {
    const { payload } = buildVatAdjustmentCase({ documentType: 203, receptor: RECEPTOR_RI, taxBreakdown: BREAKDOWN_21, association: { documentType: 1, pointOfSale: 4, invoiceNumber: '81' } });
    expect(() => parsePayload(payload)).toThrow('ADJUSTMENT_ASSOCIATION_CLASS_MISMATCH');
  });
});

describe('WSFE A/B/FCE canonical binding', () => {
  test('detects a tampered breakdown that no longer matches the canonical intent', () => {
    const { payload, request } = buildVatInvoiceCase({ documentType: 1, receptor: RECEPTOR_RI, taxBreakdown: BREAKDOWN_21 });
    const parsedRequest = signerRequestSchema.parse(request);
    const tampered = { ...payload, taxBreakdown: makeBreakdown([ivaLine(5, '10000.00')], { impTrib: '0', impOpEx: '0' }) };
    // Re-pointing the breakdown to a different object with the same numbers still binds…
    expect(() => assertPayloadMatchesRequest(tampered, parsedRequest)).not.toThrow();
    // …but changing the taxed net (and total) breaks both the total invariant and the canonical hash.
    const swapped = buildVatInvoiceCase({ documentType: 1, receptor: RECEPTOR_RI, taxBreakdown: BREAKDOWN_MIXED });
    expect(() => assertPayloadMatchesRequest({ ...swapped.payload, canonicalDocument: payload.canonicalDocument }, signerRequestSchema.parse(swapped.request)))
      .toThrow('AUTHORITY_PAYLOAD_CANONICAL_HASH_MISMATCH');
  });

  test('detects an FCE CBU swapped in the payload but not the canonical', () => {
    const { payload, request } = buildVatInvoiceCase({ documentType: 201, receptor: RECEPTOR_RI, taxBreakdown: BREAKDOWN_21, fce: fceEmission(), concept: 1 });
    const forged = { ...payload, fceEmission: fceEmission({ emitterCbu: '9990590940090418135201' }) };
    expect(() => assertPayloadMatchesRequest(forged, signerRequestSchema.parse(request))).toThrow('AUTHORITY_PAYLOAD_CANONICAL_INVOICE_MISMATCH');
  });
});
