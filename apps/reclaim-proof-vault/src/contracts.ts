import { z } from 'zod';

export const proofPurposeSchema = z.enum(['arca_taxpayer_readiness', 'arca_cae_constatement', 'arca_adjustment_constatement']);
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const policyIdSchema = z.string().regex(/^[a-z0-9][a-z0-9._-]{2,99}$/);
const proofReferenceSchema = z.string().regex(/^vault:\/\/reclaim\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

export const retentionPolicyRequestSchema = z.object({
  version: z.literal('reclaim-retention-policy-v1'),
  policyId: policyIdSchema,
  policyVersion: z.string().min(1).max(100),
  retentionDays: z.number().int().positive().max(3650),
  allowedPurposes: z.array(proofPurposeSchema).min(1).superRefine((values, context) => {
    if (new Set(values).size !== values.length) context.addIssue({ code: 'custom', message: 'RETENTION_POLICY_PURPOSE_DUPLICATE' });
  }),
  deletionMode: z.literal('crypto_erasure'),
  replacePolicyHash: sha256Schema.nullable(),
}).strict();

export const custodyRequestSchema = z.object({
  version: z.literal('reclaim-proof-custody-request-v1'),
  runId: z.uuid(),
  workspaceId: z.string().min(1).max(200),
  sessionId: z.string().min(1).max(500),
  purpose: proofPurposeSchema,
  providerId: z.string().min(1).max(500),
  providerVersion: z.string().min(1).max(100),
  proofHash: sha256Schema,
  retentionPolicyId: policyIdSchema,
  verifiedAt: z.iso.datetime({ offset: true }),
  proofPayload: z.unknown(),
}).strict();

export const custodyReceiptSchema = z.object({
  version: z.literal('reclaim-proof-custody-receipt-v1'),
  opaqueReference: proofReferenceSchema,
  artifactHash: sha256Schema,
  encryptionVersion: z.literal('aes-256-gcm+hkdf-sha256+wrapped-dek-v1'),
  retentionPolicyId: policyIdSchema,
  storedAt: z.iso.datetime({ offset: true }),
}).strict();

export const proofResolveRequestSchema = z.object({
  version: z.literal('reclaim-proof-resolve-v1'),
  opaqueReference: proofReferenceSchema,
}).strict();

export const proofEraseRequestSchema = z.object({
  version: z.literal('reclaim-proof-erase-v1'),
  workspaceId: z.string().min(1).max(200),
  opaqueReference: proofReferenceSchema,
  reason: z.string().min(1).max(200),
}).strict();

export const proofPurgeRequestSchema = z.object({
  version: z.literal('reclaim-proof-purge-expired-v1'),
}).strict();

export type RetentionPolicyRequest = z.infer<typeof retentionPolicyRequestSchema>;
export type CustodyRequest = z.infer<typeof custodyRequestSchema>;
export type CustodyReceipt = z.infer<typeof custodyReceiptSchema>;
