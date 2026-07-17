import { z } from 'zod';

import { isoDateTimeSchema, safeReferenceSchema } from './primitives';

const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const opaqueAccountantReferenceSchema = safeReferenceSchema.refine(
  value => !/^\d{9,}$/.test(value),
  'Accountant review references cannot be raw identifiers',
);
export const ACCOUNTANT_REVIEW_REASON_CODES_V1 = [
  'EVIDENCE_INCOMPLETE',
  'EVIDENCE_CONTRADICTORY',
  'RULE_VERSION_STALE',
  'PROFILE_CLASSIFICATION_UNRESOLVED',
  'JURISDICTION_SCOPE_UNSUPPORTED',
  'AUTHORITY_RECEIPT_REQUIRED',
  'CLIENT_CONFIRMATION_REQUIRED',
  'PROFESSIONAL_JUDGMENT_REQUIRED',
] as const;

export const ACCOUNTANT_REVIEW_ALLOWED_OUTCOMES_V1 = [
  'approved',
  'rejected',
  'needs_information',
] as const;

export const ACCOUNTANT_REVIEW_POLICY_VERSION_V1 =
  'external-accountant-decision-policy-v1';

const reasonCodeSchema = z.enum(ACCOUNTANT_REVIEW_REASON_CODES_V1);

export const accountantReviewQueueItemV1Schema = z.object({
  version: z.literal('accountant-review-queue-item-v1'),
  workspaceId: safeReferenceSchema,
  mandateId: opaqueAccountantReferenceSchema,
  caseRef: opaqueAccountantReferenceSchema,
  subject: z.object({
    kind: z.enum(['tax_obligation', 'accountant_packet']),
    ref: opaqueAccountantReferenceSchema,
  }).strict(),
  title: z.string().min(1).max(200),
  dueAt: isoDateTimeSchema.nullable(),
  reviewState: z.literal('ready_for_review'),
  snapshotRevision: safeReferenceSchema,
  caseRevision: z.number().int().positive(),
  evidenceHashes: z.array(hashSchema).min(1).max(15),
  ruleVersionIds: z.array(safeReferenceSchema).max(16),
  policyVersionIds: z.array(safeReferenceSchema).min(1).max(15),
  limitationCodes: z.array(z.string().regex(/^[A-Z0-9_]+$/)).max(32),
  allowedOutcomes: z.tuple([
    z.literal(ACCOUNTANT_REVIEW_ALLOWED_OUTCOMES_V1[0]),
    z.literal(ACCOUNTANT_REVIEW_ALLOWED_OUTCOMES_V1[1]),
    z.literal(ACCOUNTANT_REVIEW_ALLOWED_OUTCOMES_V1[2]),
  ]),
  allowedReasonCodes: z.array(reasonCodeSchema).length(8),
}).strict().superRefine((item, context) => {
  for (const [field, values] of [
    ['evidenceHashes', item.evidenceHashes],
    ['ruleVersionIds', item.ruleVersionIds],
    ['policyVersionIds', item.policyVersionIds],
    ['limitationCodes', item.limitationCodes],
    ['allowedReasonCodes', item.allowedReasonCodes],
  ] as const) {
    if (new Set(values).size !== values.length) {
      context.addIssue({
        code: 'custom',
        message: 'Accountant review queue values must be unique',
        path: [field],
      });
    }
  }
});

export const accountantReviewQueueV1Schema = z.object({
  version: z.literal('accountant-review-queue-v1'),
  accountantActorId: opaqueAccountantReferenceSchema,
  accountantOrganizationId: safeReferenceSchema,
  asOf: isoDateTimeSchema,
  items: z.array(accountantReviewQueueItemV1Schema).max(500),
  unavailableClients: z.array(z.object({
    workspaceId: safeReferenceSchema,
    code: z.enum([
      'ACCOUNTANT_REVIEW_SNAPSHOT_MISSING',
      'ACCOUNTANT_REVIEW_SNAPSHOT_STALE',
      'ACCOUNTANT_REVIEW_SNAPSHOT_INVALID',
    ]),
  }).strict()).max(500),
}).strict().superRefine((queue, context) => {
  const keys = queue.items.map(item => (
    `${item.workspaceId}\0${item.subject.kind}\0${item.subject.ref}`
  ));
  if (new Set(keys).size !== keys.length) {
    context.addIssue({
      code: 'custom',
      message: 'Accountant review queue subjects must be unique',
      path: ['items'],
    });
  }
  const unavailableWorkspaceIds = queue.unavailableClients.map(client => client.workspaceId);
  if (new Set(unavailableWorkspaceIds).size !== unavailableWorkspaceIds.length) {
    context.addIssue({
      code: 'custom',
      message: 'Unavailable accountant review clients must be unique',
      path: ['unavailableClients'],
    });
  }
});

export const accountantReviewQueueEnvelopeV1Schema = z.object({
  data: accountantReviewQueueV1Schema,
}).strict();

export type AccountantReviewQueueItemV1 = z.infer<typeof accountantReviewQueueItemV1Schema>;
export type AccountantReviewQueueV1 = z.infer<typeof accountantReviewQueueV1Schema>;
