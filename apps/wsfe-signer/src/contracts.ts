import { hashCanonical } from '@tax-engine/core';
// isValidCuit is a pure CUIT/CUIL check-digit validator shared with the Factura E
// signer; imported (not forked) so both signers agree on the algorithm.
import { isValidCuit } from '@tax-engine/wsfex-signer/contracts';
import Decimal from 'decimal.js';
import { z } from 'zod';

export { isValidCuit };

const unsignedDecimalSchema = z.string().regex(/^\d+(?:\.\d+)?$/);
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const invoiceNumberSchema = z.string().regex(/^[1-9]\d{0,7}$/);

// Every domestic WSFEV1 lane here is pesos-only: MonId is always 'PES' and
// MonCotiz always 1. (Foreign-currency service export lives in the WSFEX signer.)
const arsMoneySchema = z.object({ decimal: unsignedDecimalSchema, currency: z.literal('ARS') }).strict();

// ---------------------------------------------------------------------------
// Comprobante classes (WSFEV1 CbteTipo). Source: ARCA "Manual del Desarrollador
// COMPG v4.0" (WSFEV1) — https://www.afip.gob.ar/fe/documentos/manual-desarrollador-ARCA-COMPG-v4-0.pdf
//   Class C  (monotributista, no discriminated IVA):  Factura 11, ND 12, NC 13.
//   Class A  (RI → RI/monotributo, discriminated IVA): Factura 1, ND 2, NC 3.
//   Class B  (RI → CF/exento, IVA reported not discriminated): Factura 6, ND 7, NC 8.
//   FCE MiPyME (Factura de Crédito Electrónica), one triple per class:
//     FCE A: 201/202/203 · FCE B: 206/207/208 · FCE C: 211/212/213.
// ---------------------------------------------------------------------------
const CBTE_FACTURA_C = 11 as const;
const CBTE_NOTA_DEBITO_C = 12 as const;
const CBTE_NOTA_CREDITO_C = 13 as const;
const CBTE_FACTURA_A = 1 as const;
const CBTE_NOTA_DEBITO_A = 2 as const;
const CBTE_NOTA_CREDITO_A = 3 as const;
const CBTE_FACTURA_B = 6 as const;
const CBTE_NOTA_DEBITO_B = 7 as const;
const CBTE_NOTA_CREDITO_B = 8 as const;
const FCE_FACTURA_A = 201 as const;
const FCE_NOTA_DEBITO_A = 202 as const;
const FCE_NOTA_CREDITO_A = 203 as const;
const FCE_FACTURA_B = 206 as const;
const FCE_NOTA_DEBITO_B = 207 as const;
const FCE_NOTA_CREDITO_B = 208 as const;
const FCE_FACTURA_C = 211 as const;
const FCE_NOTA_DEBITO_C = 212 as const;
const FCE_NOTA_CREDITO_C = 213 as const;

// The full CbteTipo universe this signer emits, grouped by invoice vs adjustment.
const INVOICE_TYPES = [CBTE_FACTURA_C, CBTE_FACTURA_A, CBTE_FACTURA_B, FCE_FACTURA_A, FCE_FACTURA_B, FCE_FACTURA_C] as const;
const ADJUSTMENT_TYPES = [
  CBTE_NOTA_DEBITO_C, CBTE_NOTA_CREDITO_C, CBTE_NOTA_DEBITO_A, CBTE_NOTA_CREDITO_A, CBTE_NOTA_DEBITO_B, CBTE_NOTA_CREDITO_B,
  FCE_NOTA_DEBITO_A, FCE_NOTA_CREDITO_A, FCE_NOTA_DEBITO_B, FCE_NOTA_CREDITO_B, FCE_NOTA_DEBITO_C, FCE_NOTA_CREDITO_C,
] as const;

export type DocumentClass = 'A' | 'B' | 'C';
const CLASS_A_TYPES = new Set<number>([CBTE_FACTURA_A, CBTE_NOTA_DEBITO_A, CBTE_NOTA_CREDITO_A, FCE_FACTURA_A, FCE_NOTA_DEBITO_A, FCE_NOTA_CREDITO_A]);
const CLASS_B_TYPES = new Set<number>([CBTE_FACTURA_B, CBTE_NOTA_DEBITO_B, CBTE_NOTA_CREDITO_B, FCE_FACTURA_B, FCE_NOTA_DEBITO_B, FCE_NOTA_CREDITO_B]);
const FCE_TYPES = new Set<number>([FCE_FACTURA_A, FCE_NOTA_DEBITO_A, FCE_NOTA_CREDITO_A, FCE_FACTURA_B, FCE_NOTA_DEBITO_B, FCE_NOTA_CREDITO_B, FCE_FACTURA_C, FCE_NOTA_DEBITO_C, FCE_NOTA_CREDITO_C]);
const INVOICE_TYPE_SET = new Set<number>(INVOICE_TYPES);

export function documentClass(documentType: number): DocumentClass {
  if (CLASS_A_TYPES.has(documentType)) return 'A';
  if (CLASS_B_TYPES.has(documentType)) return 'B';
  return 'C';
}
export function isFceDocumentType(documentType: number): boolean {
  return FCE_TYPES.has(documentType);
}
export function isInvoiceLeg(documentType: number): boolean {
  return INVOICE_TYPE_SET.has(documentType);
}
// A NC/ND associates to the FACTURA of its own family (class + FCE-ness preserved):
// NC/ND A → 1, B → 6, C → 11, FCE-A → 201, FCE-B → 206, FCE-C → 211.
export function associatedFacturaType(adjustmentType: number): number {
  const fce = isFceDocumentType(adjustmentType);
  switch (documentClass(adjustmentType)) {
    case 'A': return fce ? FCE_FACTURA_A : CBTE_FACTURA_A;
    case 'B': return fce ? FCE_FACTURA_B : CBTE_FACTURA_B;
    default: return fce ? FCE_FACTURA_C : CBTE_FACTURA_C;
  }
}

const documentTypeSchema = literalUnion([...INVOICE_TYPES, ...ADJUSTMENT_TYPES]);
export type DocumentType = z.infer<typeof documentTypeSchema>;
const ALL_DOCUMENT_TYPES = new Set<number>([...INVOICE_TYPES, ...ADJUSTMENT_TYPES]);
export function isWsfeDocumentType(value: number): value is DocumentType {
  return ALL_DOCUMENT_TYPES.has(value);
}
const invoiceDocumentTypeSchema = literalUnion(INVOICE_TYPES);
const adjustmentDocumentTypeSchema = literalUnion(ADJUSTMENT_TYPES);
const facturaAssociationTypeSchema = literalUnion([CBTE_FACTURA_C, CBTE_FACTURA_A, CBTE_FACTURA_B, FCE_FACTURA_A, FCE_FACTURA_B, FCE_FACTURA_C]);
export type AssociationDocumentType = z.infer<typeof facturaAssociationTypeSchema>;
const FACTURA_ASSOCIATION_TYPES = new Set<number>([CBTE_FACTURA_C, CBTE_FACTURA_A, CBTE_FACTURA_B, FCE_FACTURA_A, FCE_FACTURA_B, FCE_FACTURA_C]);
export function isAssociationDocumentType(value: number): value is AssociationDocumentType {
  return FACTURA_ASSOCIATION_TYPES.has(value);
}

// DocTipo: 80 CUIT, 86 CUIL, 96 DNI, 99 Consumidor Final sin identificar (DocNro 0).
const receptorDocTypeSchema = z.union([z.literal(80), z.literal(86), z.literal(96), z.literal(99)]);

// CondicionIVAReceptorId (RG 5616), by comprobante class. Source: ARCA COMPG v4.0
// Anexo "Condición frente al IVA del receptor" (FEParamGetCondicionIvaReceptor).
//   A/M → {1 RI, 6 Monotributo, 13 Monotributo Social, 16 Monotributo Prom.}
//   B   → {4 Exento, 5 Consumidor Final, 7 No Categorizado, 8 Proveedor Ext,
//          9 Cliente Ext, 10 IVA Liberado L.19640, 15 IVA No Alcanzado}
//   C   → the full universe of eleven (all of the above).
// NOTE (RG 5614/5616): a Monotributo receptor (6/13/16) now takes a class-A
// comprobante, NOT class B — so 6 is deliberately absent from the B set. An RI
// receptor (1) is A/C only and is FORBIDDEN as a class-B receptor (ARCA 10242/10243).
const CONDICION_IVA_BY_CLASS: Readonly<Record<DocumentClass, ReadonlySet<number>>> = {
  A: new Set([1, 6, 13, 16]),
  B: new Set([4, 5, 7, 8, 9, 10, 15]),
  C: new Set([1, 4, 5, 6, 7, 8, 9, 10, 13, 15, 16]),
};
const condicionIvaReceptorSchema = z.union([
  z.literal(1), z.literal(4), z.literal(5), z.literal(6), z.literal(7),
  z.literal(8), z.literal(9), z.literal(10), z.literal(13), z.literal(15), z.literal(16),
]);

// Concepto: 1 productos, 2 servicios, 3 ambos. 2/3 require the service period.
const conceptSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);

const servicePeriodSchema = z.object({
  from: z.iso.date(),
  to: z.iso.date(),
  paymentDueDate: z.iso.date(),
}).strict();

// ---------------------------------------------------------------------------
// Discriminated IVA (class A and B). Iva.Id alícuota codes (FEParamGetTiposIva):
// 3=0%, 4=10.5%, 5=21%, 6=27%, 8=5%, 9=2.5% (ARCA COMPG v4.0). importe per line
// is baseImp * rate, rounded to the cent HALF_UP, and rejected on any drift.
// ---------------------------------------------------------------------------
export const IVA_ALICUOTA_RATES: Readonly<Record<number, string>> = { 3: '0', 4: '0.105', 5: '0.21', 6: '0.27', 8: '0.05', 9: '0.025' };
const alicIvaIdSchema = z.union([z.literal(3), z.literal(4), z.literal(5), z.literal(6), z.literal(8), z.literal(9)]);

export function expectedIvaImporte(baseImp: string, alicIvaId: number): string {
  const rate = IVA_ALICUOTA_RATES[alicIvaId];
  if (rate === undefined) throw new Error('IVA_ALICUOTA_ID_UNKNOWN');
  return new Decimal(baseImp).times(rate).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
}

const ivaLineItemSchema = z.object({
  alicIvaId: alicIvaIdSchema,
  baseImp: unsignedDecimalSchema,
  importe: unsignedDecimalSchema,
}).strict();

// ImpNeto = Σ baseImp, ImpIVA = Σ importe, ImpTotal = neto + iva + trib + opEx.
// ImpTotConc (no-gravado) is not modelled and stays 0. One line per alícuota id.
// impTrib/impOpEx are required (never defaulted) so the hashed canonical shape
// stays byte-deterministic against Motora's intentHash — callers send '0'.
const taxBreakdownSchema = z.object({
  netAmount: unsignedDecimalSchema,
  ivaLineItems: z.array(ivaLineItemSchema).min(1).max(6),
  impTrib: unsignedDecimalSchema,
  impOpEx: unsignedDecimalSchema,
}).strict().superRefine((breakdown, context) => {
  const seen = new Set<number>();
  let baseSum = new Decimal(0);
  for (const [index, line] of breakdown.ivaLineItems.entries()) {
    if (seen.has(line.alicIvaId)) context.addIssue({ code: 'custom', message: 'IVA_ALICUOTA_DUPLICATED', path: ['ivaLineItems', index, 'alicIvaId'] });
    seen.add(line.alicIvaId);
    if (!new Decimal(line.importe).eq(expectedIvaImporte(line.baseImp, line.alicIvaId))) {
      context.addIssue({ code: 'custom', message: 'IVA_LINE_IMPORTE_DRIFT', path: ['ivaLineItems', index, 'importe'] });
    }
    baseSum = baseSum.add(line.baseImp);
  }
  if (!baseSum.eq(breakdown.netAmount)) context.addIssue({ code: 'custom', message: 'IVA_BASE_SUM_NOT_NET', path: ['netAmount'] });
});
export type TaxBreakdown = z.infer<typeof taxBreakdownSchema>;

export function deriveVatTotal(breakdown: TaxBreakdown): Decimal {
  return breakdown.ivaLineItems.reduce((sum, line) => sum.add(line.importe), new Decimal(0));
}
export function deriveTaxBreakdownTotal(breakdown: TaxBreakdown): Decimal {
  return new Decimal(breakdown.netAmount).add(deriveVatTotal(breakdown)).add(breakdown.impTrib).add(breakdown.impOpEx);
}

// ---------------------------------------------------------------------------
// FCE MiPyME fields. Source: ARCA COMPG v4.0 FCE validation table.
//   Factura legs (201/206/211): FchVtoPago required (err 10163/10164, ≥ CbteFch);
//     Opcional 2101 = CBU emisor (22 digits, err 10165/10168); Opcional 2102 =
//     Alias (6–20 chars, optional, err 10166); Opcional 27 = transmisión, value
//     'SCA' (Sistema de Circulación Abierta) or 'ADC' (Agente de Depósito
//     Colectivo), required at EMISSION (err 10216).
//   ND/NC legs (202/203/207/208/212/213): Opcional 22 = código de anulación
//     'S'/'N' required (err 10173); CBU/Alias/transmisión forbidden (err 10172);
//     CbtesAsoc to the FCE original of the same class family.
// ---------------------------------------------------------------------------
export const FCE_OPCIONAL_ID_CBU = '2101' as const;
export const FCE_OPCIONAL_ID_ALIAS = '2102' as const;
export const FCE_OPCIONAL_ID_TRANSMISSION = '27' as const;
export const FCE_OPCIONAL_ID_ANULACION = '22' as const;
const cbuSchema = z.string().regex(/^\d{22}$/);
const cbuAliasSchema = z.string().regex(/^[A-Za-z0-9.\-]{6,20}$/);
const transmissionModeSchema = z.enum(['SCA', 'ADC']);
const anulacionSchema = z.enum(['S', 'N']);

const fceEmissionSchema = z.object({
  paymentDueDate: z.iso.date(),
  emitterCbu: cbuSchema,
  emitterAlias: cbuAliasSchema.nullable(),
  transmissionMode: transmissionModeSchema,
}).strict();
const fceAdjustmentSchema = z.object({ anulacion: anulacionSchema }).strict();

// FCE threshold (monto mínimo de emisión obligatoria). Resolución 1/2026 de la
// Secretaría de la PyME (SPyME) fixed ARS 5.549.862, effective 2026-04-14 (BO
// aviso 340252). The signer does NOT gate on this — the amount-≥-threshold and
// padrón MiPyME checks are DESK-side; this constant + helper exist so callers
// share one source of truth (env-overridable since the figure updates yearly).
export const FCE_MIPYME_THRESHOLD_ARS_DEFAULT = '5549862' as const;
export function fceMipymeThresholdArs(): Decimal {
  const override = process.env.FCE_MIPYME_THRESHOLD_ARS;
  return new Decimal(override && /^\d+(?:\.\d+)?$/.test(override) ? override : FCE_MIPYME_THRESHOLD_ARS_DEFAULT);
}
export function isAboveFceMipymeThreshold(amount: string): boolean {
  return new Decimal(amount).gte(fceMipymeThresholdArs());
}

// A NC/ND references its original comprobante (same class family) via CbtesAsoc (RG 4540).
const associationSchema = z.object({
  documentType: facturaAssociationTypeSchema,
  pointOfSale: z.number().int().positive().max(99998),
  invoiceNumber: invoiceNumberSchema,
}).strict();
// The legacy Factura C canonical/adjustment schemas are frozen verbatim (their
// intentHash is a signed contract), so they keep the class-C-only association.
const associationSchemaC = z.object({
  documentType: z.literal(CBTE_FACTURA_C),
  pointOfSale: z.number().int().positive().max(99998),
  invoiceNumber: invoiceNumberSchema,
}).strict();

// Full receptor identity (carries the DocNro PII). Lives only in the vaulted
// authority payload; the canonical intent binds it by reference hash.
const receptorIdentitySchema = z.object({
  docType: receptorDocTypeSchema,
  docNumber: z.string().regex(/^\d{1,11}$/),
  condicionIvaId: condicionIvaReceptorSchema,
}).strict();

function refineReceptorIdentity(receptor: z.infer<typeof receptorIdentitySchema>, context: z.RefinementCtx): void {
  if (receptor.docType === 99) {
    if (receptor.docNumber !== '0') context.addIssue({ code: 'custom', message: 'CONSUMIDOR_FINAL_DOC_NUMBER_MUST_BE_ZERO', path: ['docNumber'] });
    if (receptor.condicionIvaId !== 5) context.addIssue({ code: 'custom', message: 'CONSUMIDOR_FINAL_CONDICION_MUST_BE_FINAL', path: ['condicionIvaId'] });
    return;
  }
  if (receptor.docType === 80 || receptor.docType === 86) {
    if (!isValidCuit(receptor.docNumber)) context.addIssue({ code: 'custom', message: 'RECEPTOR_CUIT_CUIL_CHECK_DIGIT_INVALID', path: ['docNumber'] });
  } else if (!/^\d{7,8}$/.test(receptor.docNumber)) {
    context.addIssue({ code: 'custom', message: 'RECEPTOR_DNI_NUMBER_INVALID', path: ['docNumber'] });
  }
}

// Class ↔ receptor ↔ IVA cross-validation. A requires a CUIT receptor (DocTipo
// 80); B forbids an RI receptor (condición 1); C is unconstrained on DocTipo.
// Discriminated IVA is required for A/B and forbidden for C.
function refineClassReceptorAndTax(
  input: Readonly<{ documentType: number; receptorDocType: number; receptorCondicionIvaId: number; taxBreakdown: TaxBreakdown | null }>,
  context: z.RefinementCtx
): void {
  const klass = documentClass(input.documentType);
  if (!CONDICION_IVA_BY_CLASS[klass].has(input.receptorCondicionIvaId)) {
    context.addIssue({ code: 'custom', message: `CONDICION_IVA_INVALID_FOR_CLASS_${klass}`, path: ['receptor', 'condicionIvaId'] });
  }
  if (klass === 'A' && input.receptorDocType !== 80) {
    context.addIssue({ code: 'custom', message: 'CLASS_A_RECEPTOR_REQUIRES_CUIT', path: ['receptor', 'docType'] });
  }
  if (klass === 'C') {
    if (input.taxBreakdown) context.addIssue({ code: 'custom', message: 'DISCRIMINATED_IVA_FORBIDDEN_FOR_CLASS_C', path: ['taxBreakdown'] });
  } else if (!input.taxBreakdown) {
    context.addIssue({ code: 'custom', message: `DISCRIMINATED_IVA_REQUIRED_FOR_CLASS_${klass}`, path: ['taxBreakdown'] });
  }
}

// FchVtoPago / service-period consistency. Concepto 1 (productos) carries no
// service period; 2/3 (servicios/ambos) require it. An FCE factura's payment due
// date shares the single WSFEV1 FchVtoPago element, so when a service period is
// also present the two dates must agree.
function refineConceptPeriodAndFce(
  input: Readonly<{ concept: number; servicePeriod: z.infer<typeof servicePeriodSchema> | null; fceEmission: z.infer<typeof fceEmissionSchema> | null }>,
  context: z.RefinementCtx
): void {
  if (input.concept === 1) {
    if (input.servicePeriod) context.addIssue({ code: 'custom', message: 'SERVICE_PERIOD_FORBIDDEN_FOR_PRODUCTS', path: ['servicePeriod'] });
  } else if (!input.servicePeriod) {
    context.addIssue({ code: 'custom', message: 'SERVICE_PERIOD_REQUIRED_FOR_SERVICES', path: ['servicePeriod'] });
  }
  if (input.servicePeriod && input.servicePeriod.from > input.servicePeriod.to) {
    context.addIssue({ code: 'custom', message: 'SERVICE_PERIOD_FROM_AFTER_TO', path: ['servicePeriod'] });
  }
  if (input.fceEmission && input.servicePeriod && input.fceEmission.paymentDueDate !== input.servicePeriod.paymentDueDate) {
    context.addIssue({ code: 'custom', message: 'FCE_PAYMENT_DUE_DATE_CONFLICTS_WITH_SERVICE_PERIOD', path: ['fceEmission', 'paymentDueDate'] });
  }
}

// Safe receptor coordinates that are legal to persist / echo: the DocTipo and
// IVA condition are enum codes, never the DocNro.
const safeReceptorSchema = z.object({
  docType: receptorDocTypeSchema,
  condicionIvaId: condicionIvaReceptorSchema,
}).strict();

// ===========================================================================
// LEGACY Factura C canonical intents — FROZEN. Their `factura-c-*-v1` shape and
// field order are a signed intentHash contract; do not touch (class-C behaviour
// stays byte-identical to PR #7). New lanes use the `wsfe-*-intent-v1` schemas.
// ===========================================================================
const canonicalInvoiceSchemaC = z.object({
  version: z.literal('factura-c-intent-v1'),
  intentId: z.string().min(1),
  workspaceId: z.string().min(1),
  taxpayerReferenceHash: sha256Schema,
  receptorReferenceHash: sha256Schema,
  receptor: safeReceptorSchema,
  documentType: z.literal(CBTE_FACTURA_C),
  concept: conceptSchema,
  pointOfSale: z.number().int().positive().max(99998),
  issueDate: z.iso.date(),
  servicePeriod: servicePeriodSchema.nullable(),
  total: arsMoneySchema,
  description: z.string().min(1).max(4000),
  ruleVersionIds: z.array(z.string().min(1)).min(1),
}).strict();

const canonicalAdjustmentSchemaC = z.object({
  version: z.literal('factura-c-adjustment-v1'),
  adjustmentId: z.string().min(1),
  workspaceId: z.string().min(1),
  taxpayerReferenceHash: sha256Schema,
  receptorReferenceHash: sha256Schema,
  receptor: safeReceptorSchema,
  documentType: z.union([z.literal(CBTE_NOTA_DEBITO_C), z.literal(CBTE_NOTA_CREDITO_C)]),
  concept: conceptSchema,
  pointOfSale: z.number().int().positive().max(99998),
  issueDate: z.iso.date(),
  servicePeriod: servicePeriodSchema.nullable(),
  associatedDocument: associationSchemaC,
  total: arsMoneySchema,
  reason: z.string().min(1).max(4000),
  ruleVersionIds: z.array(z.string().min(1)).min(1),
}).strict();

// ===========================================================================
// Unified canonical intents for A, B, and every FCE lane (A/B/C). Class C plain
// stays in the frozen schemas above; FCE-C rides here because it carries the FCE
// fields the frozen C schema forbids.
// ===========================================================================
const canonicalInvoiceSchema = z.object({
  version: z.literal('wsfe-invoice-intent-v1'),
  intentId: z.string().min(1),
  workspaceId: z.string().min(1),
  taxpayerReferenceHash: sha256Schema,
  receptorReferenceHash: sha256Schema,
  receptor: safeReceptorSchema,
  documentType: literalUnion([CBTE_FACTURA_A, CBTE_FACTURA_B, FCE_FACTURA_A, FCE_FACTURA_B, FCE_FACTURA_C]),
  concept: conceptSchema,
  pointOfSale: z.number().int().positive().max(99998),
  issueDate: z.iso.date(),
  servicePeriod: servicePeriodSchema.nullable(),
  taxBreakdown: taxBreakdownSchema.nullable(),
  fce: fceEmissionSchema.nullable(),
  total: arsMoneySchema,
  description: z.string().min(1).max(4000),
  ruleVersionIds: z.array(z.string().min(1)).min(1),
}).strict().superRefine((document, context) => {
  refineClassReceptorAndTax({ documentType: document.documentType, receptorDocType: document.receptor.docType, receptorCondicionIvaId: document.receptor.condicionIvaId, taxBreakdown: document.taxBreakdown }, context);
  refineConceptPeriodAndFce({ concept: document.concept, servicePeriod: document.servicePeriod, fceEmission: document.fce }, context);
  refineInvoiceFce(document.documentType, document.fce, document.issueDate, context);
  if (document.taxBreakdown && !deriveTaxBreakdownTotal(document.taxBreakdown).eq(document.total.decimal)) {
    context.addIssue({ code: 'custom', message: 'TAX_BREAKDOWN_TOTAL_MISMATCH', path: ['total'] });
  }
});

const canonicalAdjustmentSchema = z.object({
  version: z.literal('wsfe-adjustment-intent-v1'),
  adjustmentId: z.string().min(1),
  workspaceId: z.string().min(1),
  taxpayerReferenceHash: sha256Schema,
  receptorReferenceHash: sha256Schema,
  receptor: safeReceptorSchema,
  documentType: literalUnion([
    CBTE_NOTA_DEBITO_A, CBTE_NOTA_CREDITO_A, CBTE_NOTA_DEBITO_B, CBTE_NOTA_CREDITO_B,
    FCE_NOTA_DEBITO_A, FCE_NOTA_CREDITO_A, FCE_NOTA_DEBITO_B, FCE_NOTA_CREDITO_B, FCE_NOTA_DEBITO_C, FCE_NOTA_CREDITO_C,
  ]),
  concept: conceptSchema,
  pointOfSale: z.number().int().positive().max(99998),
  issueDate: z.iso.date(),
  servicePeriod: servicePeriodSchema.nullable(),
  taxBreakdown: taxBreakdownSchema.nullable(),
  fce: fceAdjustmentSchema.nullable(),
  associatedDocument: associationSchema,
  total: arsMoneySchema,
  reason: z.string().min(1).max(4000),
  ruleVersionIds: z.array(z.string().min(1)).min(1),
}).strict().superRefine((document, context) => {
  refineClassReceptorAndTax({ documentType: document.documentType, receptorDocType: document.receptor.docType, receptorCondicionIvaId: document.receptor.condicionIvaId, taxBreakdown: document.taxBreakdown }, context);
  refineConceptPeriodAndFce({ concept: document.concept, servicePeriod: document.servicePeriod, fceEmission: null }, context);
  refineAdjustmentFce(document.documentType, document.fce, context);
  if (document.associatedDocument.documentType !== associatedFacturaType(document.documentType)) {
    context.addIssue({ code: 'custom', message: 'ADJUSTMENT_ASSOCIATION_CLASS_MISMATCH', path: ['associatedDocument', 'documentType'] });
  }
  if (document.taxBreakdown && !deriveTaxBreakdownTotal(document.taxBreakdown).eq(document.total.decimal)) {
    context.addIssue({ code: 'custom', message: 'TAX_BREAKDOWN_TOTAL_MISMATCH', path: ['total'] });
  }
});

// FCE-invoice presence rules: an FCE factura MUST carry the emission block (CBU +
// transmisión + FchVtoPago ≥ issueDate); a non-FCE invoice must NOT carry it.
function refineInvoiceFce(documentType: number, fce: z.infer<typeof fceEmissionSchema> | null, issueDate: string, context: z.RefinementCtx): void {
  if (isFceDocumentType(documentType)) {
    if (!fce) { context.addIssue({ code: 'custom', message: 'FCE_EMISSION_FIELDS_REQUIRED', path: ['fce'] }); return; }
    if (fce.paymentDueDate < issueDate) context.addIssue({ code: 'custom', message: 'FCE_PAYMENT_DUE_DATE_BEFORE_ISSUE', path: ['fce', 'paymentDueDate'] });
  } else if (fce) {
    context.addIssue({ code: 'custom', message: 'FCE_EMISSION_FIELDS_FORBIDDEN', path: ['fce'] });
  }
}
// FCE-adjustment presence rules: an FCE ND/NC MUST carry the anulación code; a
// non-FCE ND/NC must NOT carry it.
function refineAdjustmentFce(documentType: number, fce: z.infer<typeof fceAdjustmentSchema> | null, context: z.RefinementCtx): void {
  if (isFceDocumentType(documentType)) {
    if (!fce) context.addIssue({ code: 'custom', message: 'FCE_ADJUSTMENT_FIELDS_REQUIRED', path: ['fce'] });
  } else if (fce) {
    context.addIssue({ code: 'custom', message: 'FCE_ADJUSTMENT_FIELDS_FORBIDDEN', path: ['fce'] });
  }
}

// ---------------------------------------------------------------------------
// Frozen document coordinates echoed to Motora (never any DocNro). taxBreakdown
// and the FCE fields are frozen in the vaulted payload/canonical (bound by
// intentHash), so `expected` only carries the widened docType + association.
// ---------------------------------------------------------------------------
const invoiceExpectedSchema = z.object({
  documentType: invoiceDocumentTypeSchema,
  concept: conceptSchema,
  pointOfSale: z.number().int().positive().max(99998),
  issueDate: z.iso.date(),
  receptorDocType: receptorDocTypeSchema,
  receptorCondicionIvaId: condicionIvaReceptorSchema,
  total: arsMoneySchema,
  servicePeriod: servicePeriodSchema.nullable(),
}).strict();
const adjustmentExpectedSchema = z.object({
  documentType: adjustmentDocumentTypeSchema,
  concept: conceptSchema,
  pointOfSale: z.number().int().positive().max(99998),
  issueDate: z.iso.date(),
  receptorDocType: receptorDocTypeSchema,
  receptorCondicionIvaId: condicionIvaReceptorSchema,
  total: arsMoneySchema,
  servicePeriod: servicePeriodSchema.nullable(),
  associatedDocument: associationSchema,
}).strict();

export const signerRequestSchema = z.object({
  version: z.literal('motora-wsfe-boundary-v1'),
  environment: z.enum(['homologation', 'production']),
  workspaceId: z.string().min(1),
  runId: z.uuid(),
  // Client-generated idempotency token. WSFEV1 has NO server-side request-id
  // counter; this only keys the signer's own attempt store and Idempotency-Key.
  requestId: z.string().regex(/^[1-9]\d{0,14}$/),
  subjectId: z.string().min(1),
  intentHash: sha256Schema,
  authorityPayloadRef: z.string().min(1),
  expected: z.union([invoiceExpectedSchema, adjustmentExpectedSchema]),
}).strict();

export const authorityPayloadSchema = z.object({
  version: z.literal('wsfe-authority-payload-v1'),
  canonicalDocument: z.union([canonicalInvoiceSchemaC, canonicalAdjustmentSchemaC, canonicalInvoiceSchema, canonicalAdjustmentSchema]),
  issuerProfileRef: z.string().min(1),
  subjectId: z.string().min(1),
  intentHash: sha256Schema,
  requestId: z.string().regex(/^[1-9]\d{0,14}$/),
  // CbteNro frozen at last-authorized + 1 before the first send; recovery
  // re-sends this exact number, never a recomputed one.
  invoiceNumber: invoiceNumberSchema,
  documentType: documentTypeSchema,
  concept: conceptSchema,
  pointOfSale: z.number().int().positive().max(99998),
  issueDate: z.iso.date(),
  receptor: receptorIdentitySchema,
  servicePeriod: servicePeriodSchema.nullable(),
  // Optional AND nullable, never defaulted: absent stays absent (no injection),
  // so the vault's re-hash of the resolved payload stays byte-stable and legacy
  // class-C authority payloads that never carried IVA/FCE data still validate.
  // The A/B/FCE lanes are still forced to populate these by the superRefine below.
  taxBreakdown: taxBreakdownSchema.nullable().optional(),
  // Exactly one FCE block by leg: fceEmission for facturas, fceAdjustment for
  // NC/ND. Both absent for non-FCE comprobantes.
  fceEmission: fceEmissionSchema.nullable().optional(),
  fceAdjustment: fceAdjustmentSchema.nullable().optional(),
  total: arsMoneySchema,
  associatedDocument: associationSchema.nullable(),
}).strict().superRefine((payload, context) => {
  const taxBreakdown = payload.taxBreakdown ?? null;
  const fceEmission = payload.fceEmission ?? null;
  const fceAdjustment = payload.fceAdjustment ?? null;
  refineReceptorIdentity(payload.receptor, context);
  refineClassReceptorAndTax({ documentType: payload.documentType, receptorDocType: payload.receptor.docType, receptorCondicionIvaId: payload.receptor.condicionIvaId, taxBreakdown }, context);
  refineConceptPeriodAndFce({ concept: payload.concept, servicePeriod: payload.servicePeriod, fceEmission }, context);
  const invoice = isInvoiceLeg(payload.documentType);
  // Invoice vs adjustment shape: facturas never carry an association nor an
  // anulación; NC/ND always carry a same-family association (RG 4540).
  if (invoice) {
    if (payload.associatedDocument) context.addIssue({ code: 'custom', message: 'INVOICE_ASSOCIATION_FORBIDDEN', path: ['associatedDocument'] });
    if (fceAdjustment) context.addIssue({ code: 'custom', message: 'INVOICE_FCE_ADJUSTMENT_FORBIDDEN', path: ['fceAdjustment'] });
    refineInvoiceFce(payload.documentType, fceEmission, payload.issueDate, context);
  } else {
    if (!payload.associatedDocument) context.addIssue({ code: 'custom', message: 'ADJUSTMENT_ASSOCIATION_REQUIRED', path: ['associatedDocument'] });
    else if (payload.associatedDocument.documentType !== associatedFacturaType(payload.documentType)) {
      context.addIssue({ code: 'custom', message: 'ADJUSTMENT_ASSOCIATION_CLASS_MISMATCH', path: ['associatedDocument', 'documentType'] });
    }
    if (fceEmission) context.addIssue({ code: 'custom', message: 'ADJUSTMENT_FCE_EMISSION_FORBIDDEN', path: ['fceEmission'] });
    refineAdjustmentFce(payload.documentType, fceAdjustment, context);
  }
  if (taxBreakdown && !deriveTaxBreakdownTotal(taxBreakdown).eq(payload.total.decimal)) {
    context.addIssue({ code: 'custom', message: 'TAX_BREAKDOWN_TOTAL_MISMATCH', path: ['total'] });
  }
});

const feCompConsultarEchoSchema = z.object({
  pointOfSale: z.number().int().positive().max(99998),
  documentType: documentTypeSchema,
  invoiceNumber: invoiceNumberSchema,
  issueDate: z.iso.date(),
  concept: conceptSchema,
  receptorDocType: receptorDocTypeSchema,
  total: arsMoneySchema,
  cae: z.string().regex(/^\d{14}$/),
  caeExpiry: z.iso.date(),
  resultado: z.literal('A'),
  associatedDocument: associationSchema.nullable(),
}).strict();

const authorizedDocumentSchema = z.object({
  intentHash: sha256Schema,
  documentType: documentTypeSchema,
  concept: conceptSchema,
  pointOfSale: z.number().int().positive().max(99998),
  issueDate: z.iso.date(),
  receptorDocType: receptorDocTypeSchema,
  receptorCondicionIvaId: condicionIvaReceptorSchema,
  total: arsMoneySchema,
  servicePeriod: servicePeriodSchema.nullable(),
  associatedDocument: associationSchema.optional(),
}).strict();

export const signerResponseSchema = z.object({
  requestId: z.string().regex(/^[1-9]\d{0,14}$/),
  status: z.enum(['accepted', 'rejected', 'ambiguous']),
  resultado: z.enum(['A', 'R']).nullable(),
  cae: z.string().regex(/^\d{14}$/).nullable(),
  caeFchVto: z.iso.date().nullable(),
  cbteTipo: documentTypeSchema.nullable(),
  ptoVta: z.number().int().positive().max(99998).nullable(),
  cbteNro: invoiceNumberSchema.nullable(),
  reprocessed: z.boolean().nullable(),
  feCompConsultarEcho: feCompConsultarEchoSchema.nullable(),
  authorizedDocument: authorizedDocumentSchema.nullable(),
  safeErrors: z.array(z.object({ code: z.string(), message: z.string() }).strict()),
}).strict();

export type SignerRequest = z.infer<typeof signerRequestSchema>;
export type AuthorityPayload = z.infer<typeof authorityPayloadSchema>;
export type SignerResponse = z.infer<typeof signerResponseSchema>;
export type FeCompConsultarEcho = z.infer<typeof feCompConsultarEchoSchema>;
export type WsfeExpectedDocument = SignerRequest['expected'];

export function assertPayloadMatchesRequest(payload: AuthorityPayload, request: SignerRequest): void {
  if (hashCanonical(payload.canonicalDocument) !== request.intentHash) throw new Error('AUTHORITY_PAYLOAD_CANONICAL_HASH_MISMATCH');
  if (payload.subjectId !== request.subjectId || payload.intentHash !== request.intentHash || payload.requestId !== request.requestId) {
    throw new Error('AUTHORITY_PAYLOAD_BINDING_MISMATCH');
  }
  if (
    payload.documentType !== request.expected.documentType
    || payload.concept !== request.expected.concept
    || payload.pointOfSale !== request.expected.pointOfSale
    || payload.issueDate !== request.expected.issueDate
    || payload.receptor.docType !== request.expected.receptorDocType
    || payload.receptor.condicionIvaId !== request.expected.receptorCondicionIvaId
    || payload.total.currency !== request.expected.total.currency
    || !new Decimal(payload.total.decimal).eq(request.expected.total.decimal)
    || JSON.stringify(payload.servicePeriod) !== JSON.stringify(request.expected.servicePeriod)
  ) throw new Error('AUTHORITY_PAYLOAD_DOCUMENT_MISMATCH');
  const expectedAssociation = 'associatedDocument' in request.expected ? request.expected.associatedDocument : null;
  if (JSON.stringify(payload.associatedDocument) !== JSON.stringify(expectedAssociation)) throw new Error('AUTHORITY_PAYLOAD_ASSOCIATION_MISMATCH');
  assertCanonicalDocumentMatchesPayload(payload);
}

function assertCanonicalDocumentMatchesPayload(payload: AuthorityPayload): void {
  const document = payload.canonicalDocument;
  // Normalize the optional payload-level fields so an omitted value binds the
  // same as an explicit null (class-C payloads may carry neither).
  const taxBreakdown = payload.taxBreakdown ?? null;
  const fceEmission = payload.fceEmission ?? null;
  const fceAdjustment = payload.fceAdjustment ?? null;
  const receptorReferenceHash = hashCanonical({
    docType: payload.receptor.docType,
    docNumber: payload.receptor.docNumber,
    condicionIvaId: payload.receptor.condicionIvaId,
  });
  const commonMatches = document.receptorReferenceHash === receptorReferenceHash
    && document.receptor.docType === payload.receptor.docType
    && document.receptor.condicionIvaId === payload.receptor.condicionIvaId
    && document.documentType === payload.documentType
    && document.concept === payload.concept
    && document.pointOfSale === payload.pointOfSale
    && document.issueDate === payload.issueDate
    && JSON.stringify(document.servicePeriod) === JSON.stringify(payload.servicePeriod)
    && document.total.currency === payload.total.currency
    && new Decimal(document.total.decimal).eq(payload.total.decimal);
  if (document.version === 'factura-c-intent-v1') {
    if (!commonMatches || payload.subjectId !== document.intentId || payload.associatedDocument !== null
      || taxBreakdown !== null || fceEmission !== null || fceAdjustment !== null) {
      throw new Error('AUTHORITY_PAYLOAD_CANONICAL_INVOICE_MISMATCH');
    }
    return;
  }
  if (document.version === 'factura-c-adjustment-v1') {
    if (
      !commonMatches
      || payload.subjectId !== document.adjustmentId
      || JSON.stringify(payload.associatedDocument) !== JSON.stringify(document.associatedDocument)
      || taxBreakdown !== null || fceEmission !== null || fceAdjustment !== null
    ) throw new Error('AUTHORITY_PAYLOAD_CANONICAL_ADJUSTMENT_MISMATCH');
    return;
  }
  if (document.version === 'wsfe-invoice-intent-v1') {
    if (
      !commonMatches
      || payload.subjectId !== document.intentId
      || payload.associatedDocument !== null
      || fceAdjustment !== null
      || !taxBreakdownEquals(taxBreakdown, document.taxBreakdown)
      || !fceEmissionEquals(fceEmission, document.fce)
    ) throw new Error('AUTHORITY_PAYLOAD_CANONICAL_INVOICE_MISMATCH');
    return;
  }
  if (
    !commonMatches
    || payload.subjectId !== document.adjustmentId
    || JSON.stringify(payload.associatedDocument) !== JSON.stringify(document.associatedDocument)
    || fceEmission !== null
    || !taxBreakdownEquals(taxBreakdown, document.taxBreakdown)
    || !fceAdjustmentEquals(fceAdjustment, document.fce)
  ) throw new Error('AUTHORITY_PAYLOAD_CANONICAL_ADJUSTMENT_MISMATCH');
}

// Decimal-aware equality so '0' vs '0.00' never reads as a mismatch.
export function taxBreakdownEquals(a: TaxBreakdown | null, b: TaxBreakdown | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.ivaLineItems.length !== b.ivaLineItems.length) return false;
  if (!new Decimal(a.netAmount).eq(b.netAmount) || !new Decimal(a.impTrib).eq(b.impTrib) || !new Decimal(a.impOpEx).eq(b.impOpEx)) return false;
  return a.ivaLineItems.every((line, index) => {
    const other = b.ivaLineItems[index]!;
    return line.alicIvaId === other.alicIvaId && new Decimal(line.baseImp).eq(other.baseImp) && new Decimal(line.importe).eq(other.importe);
  });
}
function fceEmissionEquals(a: z.infer<typeof fceEmissionSchema> | null, b: z.infer<typeof fceEmissionSchema> | null): boolean {
  if (a === null || b === null) return a === b;
  return a.paymentDueDate === b.paymentDueDate && a.emitterCbu === b.emitterCbu && a.emitterAlias === b.emitterAlias && a.transmissionMode === b.transmissionMode;
}
function fceAdjustmentEquals(a: z.infer<typeof fceAdjustmentSchema> | null, b: z.infer<typeof fceAdjustmentSchema> | null): boolean {
  if (a === null || b === null) return a === b;
  return a.anulacion === b.anulacion;
}

// z.union needs a ≥2-member tuple; build one from a literal number list while
// preserving each element's literal type so z.infer stays a precise union.
function literalUnion<const T extends readonly [number, number, ...number[]]>(values: T) {
  const literals = values.map(value => z.literal(value)) as unknown as { [K in keyof T]: z.ZodLiteral<T[K]> };
  return z.union(literals);
}

// ---------------------------------------------------------------------------
// Dates. CbteFch is an int aaaammdd; "today" is resolved in Buenos Aires so a
// UTC host does not emit tomorrow's date after 21:00 (NOTAS-ARCA field note).
// ---------------------------------------------------------------------------
export function buenosAiresToday(instant: string): string {
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) throw new Error('WSFE_OCCURRED_AT_INVALID');
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function assertIssueDateWithinWindow(issueDate: string, concept: 1 | 2 | 3, occurredAt: string): void {
  const today = buenosAiresToday(occurredAt);
  if (issueDate > today) throw new Error('WSFE_ISSUE_DATE_INVALID_FUTURE');
  // ARCA accepts back-dating up to 10 days for services (concepto 2/3) and 5 for products (concepto 1).
  const earliest = shiftIsoDate(today, concept === 1 ? -5 : -10);
  if (issueDate < earliest) throw new Error('WSFE_ISSUE_DATE_INVALID_RETRO_WINDOW');
}

function shiftIsoDate(iso: string, days: number): string {
  const [year, month, day] = iso.split('-').map(Number) as [number, number, number];
  const shifted = new Date(Date.UTC(year, month - 1, day));
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}
