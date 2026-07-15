import { z } from 'zod';

import { safeReferenceSchema } from './primitives';

export const TAX_COMMAND_IDS_V1 = [
  'confirm_profile',
  'update_evidence_scope',
  'resolve_evidence_gap',
  'generate_accountant_packet',
  'create_arca_invoice_intent',
  'approve_arca_invoice_intent',
  'refresh_arca_invoice_status',
  'reconcile_arca_invoice',
  'grant_factoring_consent',
  'revoke_factoring_consent',
  'request_factoring_offer',
  'accept_factoring_offer',
] as const;

export const taxCommandIdV1Schema = z.enum(TAX_COMMAND_IDS_V1);

export const taxCommandDescriptorV1Schema = z.object({
  commandId: taxCommandIdV1Schema,
  risk: z.enum(['state_change', 'external_effect']),
  approval: z.enum(['user_confirmation', 'accountant_review', 'dual_control']),
  idempotencyRequired: z.literal(true),
  optimisticConcurrency: z.object({
    kind: z.literal('case_revision'),
    expectedRevisionField: z.literal('expectedCaseRevision'),
  }).strict(),
  invalidates: z.array(z.enum(['case', 'snapshot', 'factoring_projection'])).min(1),
}).strict();

export const TAX_COMMAND_DESCRIPTORS_V1 = [
  descriptor('confirm_profile', 'state_change', 'user_confirmation', ['case', 'snapshot']),
  descriptor('update_evidence_scope', 'state_change', 'user_confirmation', ['case', 'snapshot']),
  descriptor('resolve_evidence_gap', 'state_change', 'user_confirmation', ['case', 'snapshot']),
  descriptor('generate_accountant_packet', 'state_change', 'accountant_review', ['case', 'snapshot']),
  descriptor('create_arca_invoice_intent', 'external_effect', 'user_confirmation', ['case', 'snapshot']),
  descriptor('approve_arca_invoice_intent', 'external_effect', 'dual_control', ['case', 'snapshot']),
  descriptor('refresh_arca_invoice_status', 'state_change', 'user_confirmation', ['case', 'snapshot']),
  descriptor('reconcile_arca_invoice', 'state_change', 'accountant_review', ['case', 'snapshot']),
  descriptor('grant_factoring_consent', 'state_change', 'user_confirmation', ['case', 'factoring_projection']),
  descriptor('revoke_factoring_consent', 'state_change', 'user_confirmation', ['case', 'factoring_projection']),
  descriptor('request_factoring_offer', 'external_effect', 'user_confirmation', ['case', 'factoring_projection']),
  descriptor('accept_factoring_offer', 'external_effect', 'dual_control', ['case', 'factoring_projection']),
] as const;

export const taxCommandRequestV1Schema = z.object({
  version: z.literal('tax-command-request-v1'),
  commandId: taxCommandIdV1Schema,
  workspaceId: safeReferenceSchema,
  caseId: safeReferenceSchema,
  actionId: safeReferenceSchema,
  expectedCaseRevision: z.number().int().positive(),
  idempotencyKey: z.uuid(),
  payloadRef: safeReferenceSchema,
}).strict();

export const taxCommandReceiptV1Schema = z.object({
  version: z.literal('tax-command-receipt-v1'),
  commandId: taxCommandIdV1Schema,
  idempotencyKey: z.uuid(),
  operationRef: safeReferenceSchema,
  previousCaseRevision: z.number().int().positive(),
  caseRevision: z.number().int().positive(),
  replayed: z.boolean(),
}).strict().superRefine((receipt, context) => {
  if (receipt.caseRevision <= receipt.previousCaseRevision) {
    context.addIssue({
      code: 'custom',
      message: 'A command receipt always describes the original applied revision transition',
      path: ['caseRevision'],
    });
  }
});

/**
 * A replay is delivery metadata, not another state transition. The replayed
 * receipt must repeat the original operation and its original revision edge.
 */
export const taxCommandReplayPairV1Schema = z.object({
  original: taxCommandReceiptV1Schema,
  replay: taxCommandReceiptV1Schema,
}).strict().superRefine(({ original, replay }, context) => {
  if (original.replayed) {
    context.addIssue({ code: 'custom', message: 'The original delivery cannot be marked replayed', path: ['original', 'replayed'] });
  }
  if (!replay.replayed) {
    context.addIssue({ code: 'custom', message: 'The retry delivery must be marked replayed', path: ['replay', 'replayed'] });
  }

  const transitionFields = [
    'version',
    'commandId',
    'idempotencyKey',
    'operationRef',
    'previousCaseRevision',
    'caseRevision',
  ] as const;
  for (const field of transitionFields) {
    if (original[field] !== replay[field]) {
      context.addIssue({
        code: 'custom',
        message: 'An idempotent retry must return the original command transition',
        path: ['replay', field],
      });
    }
  }
});

function descriptor(
  commandId: (typeof TAX_COMMAND_IDS_V1)[number],
  risk: 'state_change' | 'external_effect',
  approval: 'user_confirmation' | 'accountant_review' | 'dual_control',
  invalidates: readonly ('case' | 'snapshot' | 'factoring_projection')[],
) {
  return taxCommandDescriptorV1Schema.parse({
    commandId,
    risk,
    approval,
    idempotencyRequired: true,
    optimisticConcurrency: {
      kind: 'case_revision',
      expectedRevisionField: 'expectedCaseRevision',
    },
    invalidates,
  });
}

export type TaxCommandDescriptorV1 = z.infer<typeof taxCommandDescriptorV1Schema>;
export type TaxCommandRequestV1 = z.infer<typeof taxCommandRequestV1Schema>;
export type TaxCommandReceiptV1 = z.infer<typeof taxCommandReceiptV1Schema>;
export type TaxCommandReplayPairV1 = z.infer<typeof taxCommandReplayPairV1Schema>;
