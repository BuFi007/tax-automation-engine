import { z } from 'zod';

import { taxWorkspaceIdSchema } from './evidence';
import { hashCanonical } from './factura-e-agent';

const opaqueRefSchema = z.string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9][A-Za-z0-9:._-]*$/)
  .refine(value => !/^\d{9,}$/.test(value), 'Opaque references cannot be raw identifiers');
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);

export const ACCOUNTANT_DECISION_REASON_CODES_V1 = [
  'EVIDENCE_INCOMPLETE',
  'EVIDENCE_CONTRADICTORY',
  'RULE_VERSION_STALE',
  'PROFILE_CLASSIFICATION_UNRESOLVED',
  'JURISDICTION_SCOPE_UNSUPPORTED',
  'AUTHORITY_RECEIPT_REQUIRED',
  'CLIENT_CONFIRMATION_REQUIRED',
  'PROFESSIONAL_JUDGMENT_REQUIRED',
] as const;

export const externalAccountantDecisionV1Schema = z.object({
  version: z.literal('external-accountant-decision-v1'),
  decisionId: z.uuid(),
  workspaceId: taxWorkspaceIdSchema,
  accountantActorId: opaqueRefSchema,
  mandateId: opaqueRefSchema,
  caseRef: opaqueRefSchema,
  subject: z.object({
    kind: z.enum(['tax_obligation', 'accountant_packet']),
    ref: opaqueRefSchema,
  }).strict(),
  outcome: z.enum(['approved', 'rejected', 'needs_information']),
  reasonCodes: z.array(z.enum(ACCOUNTANT_DECISION_REASON_CODES_V1)).max(16),
  evidenceHashes: z.array(hashSchema).max(15),
  ruleVersionIds: z.array(opaqueRefSchema).max(16),
  policyVersionIds: z.array(opaqueRefSchema).min(1).max(15),
  occurredAt: z.iso.datetime({ offset: true }),
  idempotencyKey: opaqueRefSchema,
}).strict().superRefine((decision, refinement) => {
  if (decision.outcome !== 'approved' && decision.reasonCodes.length === 0) {
    refinement.addIssue({
      code: 'custom',
      message: 'ACCOUNTANT_DECISION_REASON_REQUIRED',
      path: ['reasonCodes'],
    });
  }
  if (new Set(decision.reasonCodes).size !== decision.reasonCodes.length) {
    refinement.addIssue({
      code: 'custom',
      message: 'ACCOUNTANT_DECISION_REASON_DUPLICATED',
      path: ['reasonCodes'],
    });
  }
  if (new Set(decision.evidenceHashes).size !== decision.evidenceHashes.length) {
    refinement.addIssue({
      code: 'custom',
      message: 'ACCOUNTANT_DECISION_EVIDENCE_DUPLICATED',
      path: ['evidenceHashes'],
    });
  }
  if (new Set(decision.ruleVersionIds).size !== decision.ruleVersionIds.length) {
    refinement.addIssue({
      code: 'custom',
      message: 'ACCOUNTANT_DECISION_RULE_VERSION_DUPLICATED',
      path: ['ruleVersionIds'],
    });
  }
  if (new Set(decision.policyVersionIds).size !== decision.policyVersionIds.length) {
    refinement.addIssue({
      code: 'custom',
      message: 'ACCOUNTANT_DECISION_POLICY_VERSION_DUPLICATED',
      path: ['policyVersionIds'],
    });
  }
});

export type ExternalAccountantDecisionV1 = z.infer<
  typeof externalAccountantDecisionV1Schema
>;

export const externalAccountantDecisionReceiptV1Schema = z.object({
  version: z.literal('external-accountant-decision-receipt-v1'),
  decisionId: z.uuid(),
  workspaceId: taxWorkspaceIdSchema,
  eventId: z.uuid(),
  decisionHash: hashSchema,
  outcome: z.enum(['approved', 'rejected', 'needs_information']),
  recordedAt: z.iso.datetime({ offset: true }),
  replayed: z.boolean(),
}).strict();

export type ExternalAccountantDecisionReceiptV1 = z.infer<
  typeof externalAccountantDecisionReceiptV1Schema
>;

export function assertExternalAccountantDecisionV1(
  value: unknown,
): ExternalAccountantDecisionV1 {
  return externalAccountantDecisionV1Schema.parse(value);
}

export function hashExternalAccountantDecisionV1(
  decision: ExternalAccountantDecisionV1,
): string {
  return hashCanonical(assertExternalAccountantDecisionV1(decision));
}

export function accountantMandateScopeForDecision(
  decision: ExternalAccountantDecisionV1,
): 'review_tax_obligation' | 'export_accountant_packet' {
  return decision.subject.kind === 'tax_obligation'
    ? 'review_tax_obligation'
    : 'export_accountant_packet';
}
