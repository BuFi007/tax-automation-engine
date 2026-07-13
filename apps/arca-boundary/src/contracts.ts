import { authorityPayloadSchema as wsfeAuthorityPayloadSchema } from '@tax-engine/wsfe-signer/contracts';
import { authorityPayloadSchema as wsfexAuthorityPayloadSchema, isValidCuit } from '@tax-engine/wsfex-signer/contracts';
import { z } from 'zod';

// The boundary seals two independently-schema'd authority-payload families:
// WSFEX (Factura E, `wsfex-authority-payload-v1`) and WSFE (Factura C,
// `wsfe-authority-payload-v1`). Fail closed on anything else. Each `.strict()`
// member carries a distinct `version` literal, so the union is unambiguous.
export const anyAuthorityPayloadSchema = z.union([wsfexAuthorityPayloadSchema, wsfeAuthorityPayloadSchema]);
export type AnyAuthorityPayload = z.infer<typeof anyAuthorityPayloadSchema>;

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const referenceSchema = z.string().regex(/^vault:\/\/(?:wsfex|wsfe)\/[0-9a-f-]{36}$/);
const environmentSchema = z.enum(['homologation', 'production']);
// One WSAA credential can obtain tickets for several ARCA services. The ticket
// service literal is the only field ARCA scopes per web service, so it stays a
// closed enum: 'wsfex' (Factura E), 'wsfe' (Factura C / WSFEV1), and 'wsfecred'
// (Factura de Crédito Electrónica MiPyMEs read-only lifecycle). Ticket issuance
// only — the read-only wsfecred client stores no authority payload, so the
// vault referenceSchema above stays scoped to the two issuing services.
export const wsaaServiceSchema = z.enum(['wsfex', 'wsfe', 'wsfecred']);
export type WsaaService = z.infer<typeof wsaaServiceSchema>;

export const payloadStoreRequestSchema = z.object({
  version: z.literal('authority-payload-store-v1'),
  workspaceId: z.string().min(1).max(200),
  payload: anyAuthorityPayloadSchema,
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
  certificateHolderCuit: z.string().regex(/^\d{11}$/).refine(isValidCuit, { message: 'CUIT_CHECK_DIGIT_INVALID' }),
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
  service: wsaaServiceSchema,
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
