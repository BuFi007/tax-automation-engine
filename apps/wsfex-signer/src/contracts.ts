import Decimal from 'decimal.js';
import { z } from 'zod';

const unsignedDecimalSchema = z.string().regex(/^\d+(?:\.\d+)?$/);
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const moneySchema = z.object({ decimal: unsignedDecimalSchema, currency: z.string().regex(/^[A-Z]{3,10}$/) }).strict();
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
    name: z.string().min(1).max(200),
    address: z.string().min(1).max(300),
    countryCuit: z.string().regex(/^\d{11}$/),
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
    associatedDocument: associationSchema.optional(),
  }).strict().nullable(),
  safeErrors: z.array(z.object({ code: z.string(), message: z.string() }).strict()),
}).strict();

export type SignerRequest = z.infer<typeof signerRequestSchema>;
export type AuthorityPayload = z.infer<typeof authorityPayloadSchema>;
export type SignerResponse = z.infer<typeof signerResponseSchema>;

export function assertPayloadMatchesRequest(payload: AuthorityPayload, request: SignerRequest): void {
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
}
