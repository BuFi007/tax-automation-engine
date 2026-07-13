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

// Factura C is domestic: pesos only. MonId is always 'PES' and MonCotiz always 1.
const arsMoneySchema = z.object({ decimal: unsignedDecimalSchema, currency: z.literal('ARS') }).strict();

// Comprobante classes for the domestic monotributista lane.
const CBTE_FACTURA_C = 11 as const;
const CBTE_NOTA_DEBITO_C = 12 as const;
const CBTE_NOTA_CREDITO_C = 13 as const;
const documentTypeSchema = z.union([z.literal(CBTE_FACTURA_C), z.literal(CBTE_NOTA_DEBITO_C), z.literal(CBTE_NOTA_CREDITO_C)]);
const adjustmentDocumentTypeSchema = z.union([z.literal(CBTE_NOTA_DEBITO_C), z.literal(CBTE_NOTA_CREDITO_C)]);

// DocTipo: 80 CUIT, 86 CUIL, 96 DNI, 99 Consumidor Final sin identificar (DocNro 0).
const receptorDocTypeSchema = z.union([z.literal(80), z.literal(86), z.literal(96), z.literal(99)]);
// CondicionIVAReceptorId codes confirmed against FEParamGetCondicionIvaReceptor for class C.
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

// A NC/ND C references the original Factura C (Tipo 11) via CbtesAsoc (RG 4540).
const associationSchema = z.object({
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

// Safe receptor coordinates that are legal to persist / echo: the DocTipo and
// IVA condition are enum codes, never the DocNro.
const safeReceptorSchema = z.object({
  docType: receptorDocTypeSchema,
  condicionIvaId: condicionIvaReceptorSchema,
}).strict();

// ---------------------------------------------------------------------------
// Canonical domestic intent (what Motora freezes and hashes into intentHash).
// ---------------------------------------------------------------------------
const canonicalInvoiceSchema = z.object({
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

const canonicalAdjustmentSchema = z.object({
  version: z.literal('factura-c-adjustment-v1'),
  adjustmentId: z.string().min(1),
  workspaceId: z.string().min(1),
  taxpayerReferenceHash: sha256Schema,
  receptorReferenceHash: sha256Schema,
  receptor: safeReceptorSchema,
  documentType: adjustmentDocumentTypeSchema,
  concept: conceptSchema,
  pointOfSale: z.number().int().positive().max(99998),
  issueDate: z.iso.date(),
  servicePeriod: servicePeriodSchema.nullable(),
  associatedDocument: associationSchema,
  total: arsMoneySchema,
  reason: z.string().min(1).max(4000),
  ruleVersionIds: z.array(z.string().min(1)).min(1),
}).strict();

// ---------------------------------------------------------------------------
// Frozen document coordinates echoed to Motora (never any DocNro).
// ---------------------------------------------------------------------------
const invoiceExpectedSchema = z.object({
  documentType: z.literal(CBTE_FACTURA_C),
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
  canonicalDocument: z.union([canonicalInvoiceSchema, canonicalAdjustmentSchema]),
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
  total: arsMoneySchema,
  associatedDocument: associationSchema.nullable(),
}).strict().superRefine((payload, context) => {
  refineReceptorIdentity(payload.receptor, context);
  // Concepto 1 (productos) carries no service period; 2/3 (servicios/ambos) require it.
  if (payload.concept === 1) {
    if (payload.servicePeriod) context.addIssue({ code: 'custom', message: 'SERVICE_PERIOD_FORBIDDEN_FOR_PRODUCTS', path: ['servicePeriod'] });
  } else if (!payload.servicePeriod) {
    context.addIssue({ code: 'custom', message: 'SERVICE_PERIOD_REQUIRED_FOR_SERVICES', path: ['servicePeriod'] });
  }
  if (payload.servicePeriod && payload.servicePeriod.from > payload.servicePeriod.to) {
    context.addIssue({ code: 'custom', message: 'SERVICE_PERIOD_FROM_AFTER_TO', path: ['servicePeriod'] });
  }
  // Factura C never carries an association; NC/ND C always must (RG 4540).
  if (payload.documentType === CBTE_FACTURA_C) {
    if (payload.associatedDocument) context.addIssue({ code: 'custom', message: 'INVOICE_ASSOCIATION_FORBIDDEN', path: ['associatedDocument'] });
  } else if (!payload.associatedDocument) {
    context.addIssue({ code: 'custom', message: 'ADJUSTMENT_ASSOCIATION_REQUIRED', path: ['associatedDocument'] });
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
    if (!commonMatches || payload.subjectId !== document.intentId || payload.associatedDocument !== null) {
      throw new Error('AUTHORITY_PAYLOAD_CANONICAL_INVOICE_MISMATCH');
    }
    return;
  }
  if (
    !commonMatches
    || payload.subjectId !== document.adjustmentId
    || JSON.stringify(payload.associatedDocument) !== JSON.stringify(document.associatedDocument)
  ) throw new Error('AUTHORITY_PAYLOAD_CANONICAL_ADJUSTMENT_MISMATCH');
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
