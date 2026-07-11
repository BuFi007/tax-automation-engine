import { authorityPayloadSchema, isValidCuit } from '@tax-engine/wsfex-signer/contracts';
import { z } from 'zod';

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const referenceSchema = z.string().regex(/^vault:\/\/wsfex\/[0-9a-f-]{36}$/);
const environmentSchema = z.enum(['homologation', 'production']);

export const payloadStoreRequestSchema = z.object({
  version: z.literal('authority-payload-store-v1'),
  workspaceId: z.string().min(1).max(200),
  payload: authorityPayloadSchema,
  expiresAt: z.iso.datetime({ offset: true }),
}).strict();

export const payloadStoreReceiptSchema = z.object({
  version: z.literal('authority-payload-store-receipt-v1'),
  reference: referenceSchema,
  payloadHash: sha256Schema,
  storedAt: z.iso.datetime({ offset: true }),
  expiresAt: z.iso.datetime({ offset: true }),
}).strict();

export const payloadResolveRequestSchema = z.object({
  version: z.literal('authority-payload-resolve-v1'),
  reference: referenceSchema,
}).strict();

export const payloadRevokeRequestSchema = z.object({
  version: z.literal('authority-payload-revoke-v1'),
  workspaceId: z.string().min(1).max(200),
  reference: referenceSchema,
}).strict();

export const issuerProvisionRequestSchema = z.object({
  version: z.literal('wsaa-issuer-provision-v1'),
  workspaceId: z.string().min(1).max(200),
  issuerProfileRef: z.string().min(1).max(500),
  environment: environmentSchema,
  representedCuit: z.string().regex(/^\d{11}$/).refine(isValidCuit, { message: 'CUIT_CHECK_DIGIT_INVALID' }),
  certificatePem: z.string().min(1).max(32_000),
  privateKeyPem: z.string().min(1).max(32_000),
  delegationConfirmed: z.boolean(),
  replaceCertificateFingerprint: sha256Schema.nullable(),
}).strict();

export const issuerProvisionReceiptSchema = z.object({
  version: z.literal('wsaa-issuer-provision-receipt-v1'),
  issuerProfileRef: z.string(),
  environment: environmentSchema,
  certificateFingerprint: sha256Schema,
  delegationConfirmed: z.boolean(),
  storedAt: z.iso.datetime({ offset: true }),
}).strict();

export const issuerRevokeRequestSchema = z.object({
  version: z.literal('wsaa-issuer-revoke-v1'),
  issuerProfileRef: z.string().min(1).max(500),
  certificateFingerprint: sha256Schema,
}).strict();

export const ticketRequestSchema = z.object({
  version: z.literal('wsaa-ticket-request-v1'),
  service: z.literal('wsfex'),
  environment: environmentSchema,
  workspaceId: z.string().min(1).max(200),
  issuerProfileRef: z.string().min(1).max(500),
}).strict();

export const ticketResponseSchema = z.object({
  token: z.string().min(1),
  sign: z.string().min(1),
  representedCuit: z.string().regex(/^\d{11}$/).refine(isValidCuit),
  expiresAt: z.iso.datetime({ offset: true }),
}).strict();

export type PayloadStoreRequest = z.infer<typeof payloadStoreRequestSchema>;
export type PayloadStoreReceipt = z.infer<typeof payloadStoreReceiptSchema>;
export type IssuerProvisionRequest = z.infer<typeof issuerProvisionRequestSchema>;
export type IssuerProvisionReceipt = z.infer<typeof issuerProvisionReceiptSchema>;
export type TicketRequest = z.infer<typeof ticketRequestSchema>;
export type TicketResponse = z.infer<typeof ticketResponseSchema>;
