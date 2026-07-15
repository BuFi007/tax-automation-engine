import { hashCanonical } from '@tax-engine/core';
import Decimal from 'decimal.js';
import { z } from 'zod';

const unsignedDecimalSchema = z.string().regex(/^\d+(?:\.\d+)?$/);
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const cuitSchema = z.string().regex(/^\d{11}$/).refine(isValidCuit, { message: 'CUIT_CHECK_DIGIT_INVALID' });
const moneySchema = z.object({ decimal: unsignedDecimalSchema, currency: z.string().regex(/^[A-Z]{3,10}$/) }).strict();
const canonicalLineItemSchema = z.object({
  description: z.string().min(1).max(4000),
  quantity: unsignedDecimalSchema,
  unitPrice: unsignedDecimalSchema,
  total: unsignedDecimalSchema,
  unitCode: z.number().int().nonnegative().max(99),
}).strict();
const canonicalInvoiceSchema = z.object({
  version: z.literal('factura-e-intent-v1'),
  intentId: z.string().min(1),
  workspaceId: z.string().min(1),
  taxpayerReferenceHash: sha256Schema,
  foreignCustomerReferenceHash: sha256Schema,
  foreignCustomerSafeLabel: z.string().min(1).max(160),
  destinationCountry: z.string().regex(/^[A-Z]{2}$/),
  destinationCountryArcaCode: z.number().int().positive().max(999),
  documentType: z.literal(19),
  operationType: z.literal(2),
  pointOfSale: z.number().int().positive().max(99998),
  issueDate: z.iso.date(),
  paymentDate: z.iso.date(),
  sameCurrencyPayment: z.boolean(),
  exchangeRate: z.object({
    decimal: unsignedDecimalSchema,
    sourceReferenceId: z.string().min(1),
    observedForDate: z.iso.date(),
    authorityRuleDecisionId: z.string().min(1),
  }).strict().nullable(),
  lineItems: z.array(canonicalLineItemSchema).min(1),
  total: moneySchema,
  serviceDescription: z.string().min(1).max(4000),
  paymentTerms: z.string().min(1).max(1000),
  ruleVersionIds: z.array(z.string().min(1)).min(1),
}).strict();
const associationSchema = z.object({
  documentType: z.literal(19),
  pointOfSale: z.number().int().positive().max(99998),
  invoiceNumber: z.string().regex(/^[1-9]\d{0,7}$/),
}).strict();
const invoiceExpectedSchema = z.object({
  documentType: z.literal(19),
  operationType: z.literal(2),
  pointOfSale: z.number().int().positive().max(99998),
  issueDate: z.iso.date(),
  total: moneySchema,
}).strict();
const adjustmentExpectedSchema = z.object({
  documentType: z.union([z.literal(20), z.literal(21)]),
  operationType: z.literal(2),
  pointOfSale: z.number().int().positive().max(99998),
  issueDate: z.iso.date(),
  total: moneySchema,
  associatedDocument: associationSchema,
}).strict();
const canonicalAdjustmentSchema = z.object({
  version: z.literal('factura-e-adjustment-v1'),
  adjustmentId: z.string().min(1),
  documentType: z.union([z.literal(20), z.literal(21)]),
  associatedDocument: associationSchema,
  issueDate: z.iso.date(),
  amount: moneySchema,
  reason: z.string().min(1).max(4000),
  foreignCustomerReferenceHash: sha256Schema,
  destinationCountryArcaCode: z.number().int().positive().max(999),
  ruleVersionIds: z.array(z.string().min(1)).min(1),
}).strict();

export const signerRequestSchema = z.object({
  version: z.literal('motora-wsfex-boundary-v1'),
  environment: z.enum(['homologation', 'production']),
  workspaceId: z.string().min(1),
  runId: z.uuid(),
  requestId: z.string().regex(/^[1-9]\d{0,14}$/),
  subjectId: z.string().min(1),
  intentHash: sha256Schema,
  authorityPayloadRef: z.string().min(1),
  expected: z.union([invoiceExpectedSchema, adjustmentExpectedSchema]),
}).strict();

const lineItemSchema = z.object({
  code: z.string().max(50).nullable(),
  description: z.string().min(1).max(4000),
  quantity: unsignedDecimalSchema,
  unitCode: z.number().int().nonnegative().max(99),
  unitPrice: unsignedDecimalSchema,
  discount: unsignedDecimalSchema,
  total: z.string().regex(/^-?\d+(?:\.\d+)?$/),
}).strict();

export const authorityPayloadSchema = z.object({
  version: z.literal('wsfex-authority-payload-v1'),
  canonicalDocument: z.union([canonicalInvoiceSchema, canonicalAdjustmentSchema]),
  issuerProfileRef: z.string().min(1),
  subjectId: z.string().min(1),
  intentHash: sha256Schema,
  requestId: z.string().regex(/^[1-9]\d{0,14}$/),
  invoiceNumber: z.string().regex(/^[1-9]\d{0,7}$/),
  documentType: z.union([z.literal(19), z.literal(20), z.literal(21)]),
  operationType: z.literal(2),
  pointOfSale: z.number().int().positive().max(99998),
  issueDate: z.iso.date(),
  destinationCountryArcaCode: z.number().int().positive().max(999),
  customer: z.object({
    referenceHash: sha256Schema,
    name: z.string().min(1).max(200),
    address: z.string().min(1).max(300),
    countryCuit: cuitSchema,
    foreignTaxId: z.string().min(1).max(50).nullable(),
  }).strict(),
  currency: z.object({
    safeCode: z.string().regex(/^[A-Z]{3,10}$/),
    arcaId: z.string().min(1).max(3),
    quote: unsignedDecimalSchema,
  }).strict(),
  sameCurrencyPayment: z.boolean().nullable(),
  paymentDate: z.iso.date().nullable(),
  total: unsignedDecimalSchema,
  paymentTerms: z.string().max(50).nullable(),
  commercialObservation: z.string().max(4000).nullable(),
  generalObservation: z.string().max(1000).nullable(),
  language: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  associatedDocument: associationSchema.nullable(),
  items: z.array(lineItemSchema).min(1),
}).strict().superRefine((payload, context) => {
  if (payload.documentType === 19) {
    if (!payload.paymentDate) context.addIssue({ code: 'custom', message: 'PAYMENT_DATE_REQUIRED_FOR_SERVICE_INVOICE', path: ['paymentDate'] });
    if (payload.associatedDocument) context.addIssue({ code: 'custom', message: 'INVOICE_ASSOCIATION_FORBIDDEN', path: ['associatedDocument'] });
    if (payload.currency.arcaId === 'PES' && payload.sameCurrencyPayment !== null) {
      context.addIssue({ code: 'custom', message: 'SAME_CURRENCY_FLAG_FORBIDDEN_FOR_PES', path: ['sameCurrencyPayment'] });
    }
    if (payload.currency.arcaId !== 'PES' && payload.sameCurrencyPayment === null) {
      context.addIssue({ code: 'custom', message: 'SAME_CURRENCY_FLAG_REQUIRED_FOR_FOREIGN_CURRENCY', path: ['sameCurrencyPayment'] });
    }
  } else {
    if (payload.paymentDate) context.addIssue({ code: 'custom', message: 'PAYMENT_DATE_FORBIDDEN_FOR_ADJUSTMENT', path: ['paymentDate'] });
    if (payload.sameCurrencyPayment !== null) context.addIssue({ code: 'custom', message: 'SAME_CURRENCY_FLAG_FORBIDDEN_FOR_ADJUSTMENT', path: ['sameCurrencyPayment'] });
    if (!payload.associatedDocument) context.addIssue({ code: 'custom', message: 'ADJUSTMENT_ASSOCIATION_REQUIRED', path: ['associatedDocument'] });
  }
  const itemsTotal = payload.items.reduce((sum, item) => sum.add(item.total), new Decimal(0));
  if (!itemsTotal.eq(payload.total)) context.addIssue({ code: 'custom', message: 'AUTHORITY_PAYLOAD_TOTAL_MISMATCH', path: ['total'] });
});

export const signerResponseSchema = z.object({
  requestId: z.string().regex(/^[1-9]\d{0,14}$/),
  status: z.enum(['accepted', 'rejected', 'ambiguous']),
  invoiceNumber: z.string().regex(/^[1-9]\d{0,7}$/).nullable(),
  cae: z.string().regex(/^\d{10,20}$/).nullable(),
  reprocessed: z.boolean().nullable(),
  authorizedDocument: z.object({
    intentHash: sha256Schema,
    documentType: z.union([z.literal(19), z.literal(20), z.literal(21)]),
    operationType: z.literal(2),
    pointOfSale: z.number().int().positive().max(99998),
    issueDate: z.iso.date(),
    total: moneySchema,
    // The APPLIED Moneda_ctz (ARCA id + quote) echoed so the desk persists exactly
    // what was authorized. On recovery it is the ARCA-confirmed quote, already bound
    // equal to the frozen payload quote.
    currencyId: z.string().min(1).max(3),
    currencyQuote: unsignedDecimalSchema,
    associatedDocument: associationSchema.optional(),
  }).strict().nullable(),
  safeErrors: z.array(z.object({ code: z.string(), message: z.string() }).strict()),
}).strict();

export type SignerRequest = z.infer<typeof signerRequestSchema>;
export type AuthorityPayload = z.infer<typeof authorityPayloadSchema>;
export type SignerResponse = z.infer<typeof signerResponseSchema>;

export function assertPayloadMatchesRequest(payload: AuthorityPayload, request: SignerRequest): void {
  if (hashDocument(payload.canonicalDocument) !== request.intentHash) throw new Error('AUTHORITY_PAYLOAD_CANONICAL_HASH_MISMATCH');
  if (payload.subjectId !== request.subjectId || payload.intentHash !== request.intentHash || payload.requestId !== request.requestId) throw new Error('AUTHORITY_PAYLOAD_BINDING_MISMATCH');
  if (
    payload.documentType !== request.expected.documentType
    || payload.operationType !== request.expected.operationType
    || payload.pointOfSale !== request.expected.pointOfSale
    || payload.issueDate !== request.expected.issueDate
    || payload.currency.safeCode !== request.expected.total.currency
    || !new Decimal(payload.total).eq(request.expected.total.decimal)
  ) throw new Error('AUTHORITY_PAYLOAD_DOCUMENT_MISMATCH');
  const expectedAssociation = 'associatedDocument' in request.expected ? request.expected.associatedDocument : null;
  if (JSON.stringify(payload.associatedDocument) !== JSON.stringify(expectedAssociation)) throw new Error('AUTHORITY_PAYLOAD_ASSOCIATION_MISMATCH');
  assertCanonicalDocumentMatchesPayload(payload);
}

export function isValidCuit(value: string): boolean {
  if (!/^\d{11}$/.test(value)) return false;
  const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const sum = weights.reduce((total, weight, index) => total + Number(value[index]) * weight, 0);
  const remainder = 11 - (sum % 11);
  const expected = remainder === 11 ? 0 : remainder === 10 ? 9 : remainder;
  return Number(value[10]) === expected;
}

function hashDocument(document: AuthorityPayload['canonicalDocument']): string {
  return hashCanonical(document);
}

function assertCanonicalDocumentMatchesPayload(payload: AuthorityPayload): void {
  const document = payload.canonicalDocument;
  if (document.version === 'factura-e-intent-v1') {
    if (
      payload.documentType !== 19
      || payload.subjectId !== document.intentId
      || payload.destinationCountryArcaCode !== document.destinationCountryArcaCode
      || payload.pointOfSale !== document.pointOfSale
      || payload.issueDate !== document.issueDate
      || payload.paymentDate !== document.paymentDate
      || payload.sameCurrencyPayment !== document.sameCurrencyPayment
      || payload.currency.safeCode !== document.total.currency
      || !new Decimal(payload.total).eq(document.total.decimal)
      || payload.paymentTerms !== document.paymentTerms
      || payload.customer.referenceHash !== document.foreignCustomerReferenceHash
      || payload.associatedDocument !== null
    ) throw new Error('AUTHORITY_PAYLOAD_CANONICAL_INVOICE_MISMATCH');
    if (document.total.currency === 'ARS') {
      if (document.exchangeRate !== null || payload.currency.arcaId !== 'PES' || !new Decimal(payload.currency.quote).eq(1)) throw new Error('AUTHORITY_PAYLOAD_CANONICAL_FX_MISMATCH');
    } else if (!document.exchangeRate || !new Decimal(payload.currency.quote).eq(document.exchangeRate.decimal)) {
      throw new Error('AUTHORITY_PAYLOAD_CANONICAL_FX_MISMATCH');
    }
    if (payload.items.length !== document.lineItems.length) throw new Error('AUTHORITY_PAYLOAD_CANONICAL_ITEMS_MISMATCH');
    for (const [index, item] of payload.items.entries()) {
      const canonical = document.lineItems[index]!;
      if (
        item.description !== canonical.description
        || !new Decimal(item.quantity).eq(canonical.quantity)
        || item.unitCode !== canonical.unitCode
        || !new Decimal(item.unitPrice).eq(canonical.unitPrice)
        || !new Decimal(item.discount).eq(0)
        || !new Decimal(item.total).eq(canonical.total)
      ) throw new Error('AUTHORITY_PAYLOAD_CANONICAL_ITEMS_MISMATCH');
    }
    return;
  }
  if (
    payload.documentType !== document.documentType
    || payload.subjectId !== document.adjustmentId
    || payload.pointOfSale !== document.associatedDocument.pointOfSale
    || payload.issueDate !== document.issueDate
    || payload.destinationCountryArcaCode !== document.destinationCountryArcaCode
    || payload.customer.referenceHash !== document.foreignCustomerReferenceHash
    || payload.currency.safeCode !== document.amount.currency
    || !new Decimal(payload.total).eq(document.amount.decimal)
    || JSON.stringify(payload.associatedDocument) !== JSON.stringify(document.associatedDocument)
    || payload.paymentTerms !== null
    || payload.items.length !== 1
  ) throw new Error('AUTHORITY_PAYLOAD_CANONICAL_ADJUSTMENT_MISMATCH');
  const item = payload.items[0]!;
  if (
    item.description !== document.reason
    || !new Decimal(item.quantity).eq(1)
    || !new Decimal(item.unitPrice).eq(document.amount.decimal)
    || !new Decimal(item.discount).eq(0)
    || !new Decimal(item.total).eq(document.amount.decimal)
  ) throw new Error('AUTHORITY_PAYLOAD_CANONICAL_ADJUSTMENT_MISMATCH');
}
