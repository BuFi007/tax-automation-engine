import DecimalJs from 'decimal.js';
import { z } from 'zod';

import { taxCapabilityManifestV1Schema } from './capabilities';
import {
  currencySchema,
  exactMoneySchema,
  isoDateTimeSchema,
  opaqueRevisionSchema,
  periodSchema,
  projectionKeySchema,
  safeReferenceSchema,
} from './primitives';

export const taxEvidenceScopeV1Schema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('all_connected') }).strict(),
  z.object({
    mode: z.literal('selected'),
    sourceIds: z.array(safeReferenceSchema).min(1).max(100),
    includeKnowledgeGraph: z.boolean(),
  }).strict().superRefine((scope, context) => {
    if (new Set(scope.sourceIds).size !== scope.sourceIds.length) {
      context.addIssue({ code: 'custom', message: 'Selected source IDs must be unique', path: ['sourceIds'] });
    }
  }),
]);

const taxProfileSummaryV1Schema = z.object({
  profileRef: safeReferenceSchema,
  profileVersion: safeReferenceSchema,
  jurisdiction: z.enum(['AR', 'US']),
  entityType: z.string().min(1).max(100),
  regimeId: z.string().min(1).max(100),
  confirmationState: z.enum(['user_confirmed', 'accountant_confirmed']),
  catalogueVersion: safeReferenceSchema,
}).strict();

const taxCaseStepV1Schema = z.object({
  stepId: safeReferenceSchema,
  owner: z.enum(['user', 'tax_agent', 'accountant']),
  state: z.enum(['available', 'in_progress', 'needs_review', 'complete', 'blocked']),
  actionId: safeReferenceSchema.nullable(),
  completionEvidenceRefs: z.array(safeReferenceSchema).max(20),
  limitationCodes: z.array(z.string().regex(/^[A-Z0-9_]+$/)).max(20),
}).strict().superRefine((step, context) => {
  if (step.state === 'complete' && step.completionEvidenceRefs.length === 0) {
    context.addIssue({ code: 'custom', message: 'A completed durable step requires completion evidence', path: ['completionEvidenceRefs'] });
  }
  if (step.state === 'complete' && step.actionId !== null) {
    context.addIssue({ code: 'custom', message: 'A completed step cannot expose a pending action', path: ['actionId'] });
  }
});

const taxCaseApprovalV1Schema = z.object({
  approvalRef: safeReferenceSchema,
  purpose: z.enum(['profile', 'evidence_scope', 'arca_issuance', 'factoring_offer']),
  state: z.enum(['required', 'pending', 'approved', 'rejected', 'expired', 'revoked']),
  actorRole: z.enum(['user', 'accountant', 'workspace_approver']),
  decidedAt: isoDateTimeSchema.nullable(),
}).strict().superRefine((approval, context) => {
  const decided = ['approved', 'rejected', 'expired', 'revoked'].includes(approval.state);
  if (decided !== (approval.decidedAt !== null)) {
    context.addIssue({
      code: 'custom',
      message: decided ? 'A decided approval requires decidedAt' : 'An undecided approval cannot carry decidedAt',
      path: ['decidedAt'],
    });
  }
});

export const taxCaseV1Schema = z.object({
  version: z.literal('tax-case-v1'),
  caseId: safeReferenceSchema,
  workspaceId: safeReferenceSchema,
  revision: z.number().int().positive(),
  state: z.enum(['setup_required', 'active', 'needs_review', 'blocked', 'complete']),
  selection: z.object({
    jurisdiction: z.enum(['AR', 'US', 'unsupported']),
    entityType: z.string().min(1).max(100).nullable(),
    regimeId: z.string().min(1).max(100).nullable(),
    confirmationState: z.enum(['suggested', 'user_confirmed', 'accountant_confirmed']),
  }).strict(),
  profile: taxProfileSummaryV1Schema.nullable(),
  period: periodSchema,
  displayCurrency: currencySchema,
  evidenceScope: taxEvidenceScopeV1Schema,
  steps: z.array(taxCaseStepV1Schema).max(100),
  approvals: z.array(taxCaseApprovalV1Schema).max(100),
  updatedAt: isoDateTimeSchema,
}).strict().superRefine((taxCase, context) => {
  const stepIds = taxCase.steps.map(step => step.stepId);
  if (new Set(stepIds).size !== stepIds.length) {
    context.addIssue({ code: 'custom', message: 'Tax case step IDs must be unique', path: ['steps'] });
  }
  if (taxCase.profile && taxCase.profile.jurisdiction !== taxCase.selection.jurisdiction) {
    context.addIssue({ code: 'custom', message: 'Confirmed profile and selected jurisdiction must agree', path: ['profile', 'jurisdiction'] });
  }
  if (taxCase.selection.jurisdiction === 'unsupported' && taxCase.profile !== null) {
    context.addIssue({ code: 'custom', message: 'Unsupported jurisdictions cannot carry a confirmed profile', path: ['profile'] });
  }
});

const sourceCapabilityV1Schema = z.object({
  capability: z.string().min(1).max(100),
  state: z.enum(['available', 'partial', 'unsupported', 'failed', 'stale']),
  observedAt: isoDateTimeSchema.nullable(),
  safeErrorCode: z.string().regex(/^[A-Z0-9_]+$/).nullable(),
}).strict();

const sourceHealthItemV1Schema = z.object({
  sourceRef: safeReferenceSchema,
  kind: z.enum([
    'bank',
    'wallet',
    'crypto',
    'stripe',
    'fx',
    'payroll',
    'bufi_invoice',
    'bufi_bill',
    'accounting',
    'magic_inbox',
    'transaction_enrichment',
    'knowledge_graph',
    'financial_analytics',
    'unknown',
  ]),
  providerDescriptor: z.object({
    providerId: safeReferenceSchema.nullable(),
    displayName: z.string().min(1).max(100),
  }).strict(),
  state: z.enum(['connected', 'degraded', 'failed', 'stale', 'not_connected']),
  capabilities: z.array(sourceCapabilityV1Schema).max(100),
  lastSuccessfulSyncAt: isoDateTimeSchema.nullable(),
  acceptedEvidenceCount: z.number().int().nonnegative(),
  needsReviewCount: z.number().int().nonnegative(),
  safeErrorCode: z.string().regex(/^[A-Z0-9_]+$/).nullable(),
}).strict().superRefine((source, context) => {
  const capabilityStates = new Set(source.capabilities.map(capability => capability.state));
  if (capabilityStates.has('failed') && source.state !== 'failed') {
    context.addIssue({ code: 'custom', message: 'A failed capability requires a failed source aggregate', path: ['state'] });
  } else if (capabilityStates.has('stale') && !['stale', 'failed'].includes(source.state)) {
    context.addIssue({ code: 'custom', message: 'A stale capability requires a stale or failed source aggregate', path: ['state'] });
  } else if (capabilityStates.has('partial') && !['degraded', 'stale', 'failed'].includes(source.state)) {
    context.addIssue({ code: 'custom', message: 'A partial capability requires a degraded source aggregate', path: ['state'] });
  }
  if (source.state === 'connected' && source.safeErrorCode !== null) {
    context.addIssue({ code: 'custom', message: 'A connected source cannot carry an aggregate error', path: ['safeErrorCode'] });
  }
});

export type TaxSourceHealthStateV1 = 'healthy' | 'degraded' | 'blocked' | 'not_connected';

export function deriveTaxSourceHealthStateV1(
  sources: readonly z.infer<typeof sourceHealthItemV1Schema>[],
): TaxSourceHealthStateV1 {
  if (sources.length === 0) return 'not_connected';
  if (sources.some(source => source.state === 'failed'
    || source.capabilities.some(capability => capability.state === 'failed'))) return 'blocked';
  if (sources.every(source => source.state === 'not_connected')) return 'not_connected';
  if (sources.some(source => source.state !== 'connected'
    || source.capabilities.some(capability => capability.state === 'partial' || capability.state === 'stale'))) return 'degraded';
  return 'healthy';
}

const sourceHealthV1Schema = z.object({
  state: z.enum(['healthy', 'degraded', 'blocked', 'not_connected']),
  sources: z.array(sourceHealthItemV1Schema).max(100),
}).strict().superRefine((health, context) => {
  const expected = deriveTaxSourceHealthStateV1(health.sources);
  if (health.state !== expected) {
    context.addIssue({ code: 'custom', message: `Source health must be ${expected}`, path: ['state'] });
  }
  const refs = health.sources.map(source => source.sourceRef);
  if (new Set(refs).size !== refs.length) {
    context.addIssue({ code: 'custom', message: 'Source references must be unique', path: ['sources'] });
  }
});

const taxPositionV1Schema = z.object({
  state: z.enum(['unavailable', 'partial', 'available']),
  taxCollected: exactMoneySchema.nullable(),
  taxPaid: exactMoneySchema.nullable(),
  netTaxPosition: exactMoneySchema.nullable(),
  limitationCodes: z.array(z.string().regex(/^[A-Z0-9_]+$/)).max(100),
}).strict().superRefine((position, context) => {
  const amounts = [position.taxCollected, position.taxPaid, position.netTaxPosition];
  if (position.state === 'unavailable' && amounts.some(amount => amount !== null)) {
    context.addIssue({ code: 'custom', message: 'Unavailable tax liability values must remain null' });
  }
  if (position.state === 'unavailable' && position.limitationCodes.length === 0) {
    context.addIssue({ code: 'custom', message: 'Unavailable tax liability requires a named limitation', path: ['limitationCodes'] });
  }
  if (position.state === 'partial'
    && (amounts.every(amount => amount === null) || amounts.every(amount => amount !== null))) {
    context.addIssue({ code: 'custom', message: 'Partial tax liability requires both available and unavailable values' });
  }
  if (position.state === 'partial' && position.limitationCodes.length === 0) {
    context.addIssue({ code: 'custom', message: 'Partial tax liability requires a named limitation', path: ['limitationCodes'] });
  }
  if (position.state === 'available' && amounts.some(amount => amount === null)) {
    context.addIssue({ code: 'custom', message: 'Available tax liability requires all three values' });
  }
  const currencies = amounts.flatMap(amount => amount ? [amount.currency] : []);
  if (new Set(currencies).size > 1) {
    context.addIssue({ code: 'custom', message: 'Tax position values must use one display currency' });
  }
  if (position.taxCollected && position.taxPaid && position.netTaxPosition) {
    const expected = new DecimalJs(position.taxCollected.decimal).minus(position.taxPaid.decimal);
    if (!expected.equals(position.netTaxPosition.decimal)) {
      context.addIssue({ code: 'custom', message: 'Net tax position must exactly equal tax collected minus tax paid', path: ['netTaxPosition'] });
    }
  }
});

const evidenceGapV1Schema = z.object({
  gapRef: safeReferenceSchema,
  kind: z.string().min(1).max(100),
  severity: z.enum(['info', 'warning', 'blocking']),
  safeSourceRefs: z.array(safeReferenceSchema).max(20),
  actionId: safeReferenceSchema.nullable(),
}).strict();

const conclusionV1Schema = z.object({
  conclusionRef: safeReferenceSchema,
  kind: z.string().min(1).max(100),
  safeDisplayValue: z.union([z.string().max(500), z.boolean(), z.null()]),
  period: periodSchema,
  sourceRefs: z.array(safeReferenceSchema).max(100),
  freshness: z.enum(['fresh', 'stale', 'expired', 'unknown']),
  confidence: z.enum(['verified', 'high', 'medium', 'low', 'unknown']),
  derivation: z.enum(['provider_fact', 'deterministic_rule', 'human_assertion']),
  consentScopeRevision: opaqueRevisionSchema.nullable(),
  evidenceRevision: opaqueRevisionSchema,
  accountantReviewState: z.enum(['not_required', 'unreviewed', 'under_review', 'approved', 'rejected', 'disputed']),
  ruleVersions: z.array(safeReferenceSchema).max(100),
  limitations: z.array(z.string().max(500)).max(100),
}).strict();

const filingReadinessV1Schema = z.object({
  state: z.enum([
    'blocked',
    'in_progress',
    'accountant_review',
    'ready_for_submission',
    'submitted',
    'complete',
  ]),
  asOf: isoDateTimeSchema,
  blockingGapRefs: z.array(safeReferenceSchema).max(500),
  limitationCodes: z.array(z.string().regex(/^[A-Z0-9_]+$/)).max(100),
}).strict();

const evidenceTaskV1Schema = z.object({
  taskRef: safeReferenceSchema,
  title: z.string().min(1).max(200),
  state: z.enum(['open', 'under_review', 'resolved', 'blocked']),
  actor: z.enum(['user', 'tax_agent', 'accountant']),
  asOf: isoDateTimeSchema,
  safeEvidenceRefs: z.array(safeReferenceSchema).max(100),
  actionId: safeReferenceSchema.nullable(),
  limitationCodes: z.array(z.string().regex(/^[A-Z0-9_]+$/)).max(100),
}).strict();

const accountantPacketV1Schema = z.object({
  state: z.enum([
    'unavailable',
    'not_generated',
    'generating',
    'ready_for_review',
    'approved',
    'rejected',
  ]),
  packetRef: safeReferenceSchema.nullable(),
  generatedAt: isoDateTimeSchema.nullable(),
  safeEvidenceRefs: z.array(safeReferenceSchema).max(500),
  actionId: safeReferenceSchema.nullable(),
  limitationCodes: z.array(z.string().regex(/^[A-Z0-9_]+$/)).max(100),
}).strict().superRefine((packet, context) => {
  if (packet.state === 'unavailable' && packet.limitationCodes.length === 0) {
    context.addIssue({
      code: 'custom',
      message: 'Unavailable accountant packet requires a named limitation',
      path: ['limitationCodes'],
    });
  }
  if (['generating', 'ready_for_review', 'approved', 'rejected'].includes(packet.state)
    && packet.packetRef === null) {
    context.addIssue({
      code: 'custom',
      message: 'Available accountant packet state requires a packet reference',
      path: ['packetRef'],
    });
  }
});

const planningForecastV1Schema = z.object({
  state: z.enum(['unavailable', 'partial', 'available']),
  horizon: periodSchema,
  asOf: isoDateTimeSchema,
  lowerBound: exactMoneySchema.nullable(),
  upperBound: exactMoneySchema.nullable(),
  safeSourceRefs: z.array(safeReferenceSchema).max(100),
  limitationCodes: z.array(z.string().regex(/^[A-Z0-9_]+$/)).max(100),
  planningOnly: z.literal(true),
}).strict().superRefine((forecast, context) => {
  if (forecast.state === 'unavailable'
    && (forecast.lowerBound !== null || forecast.upperBound !== null)) {
    context.addIssue({ code: 'custom', message: 'Unavailable forecast values must remain null' });
  }
  if (forecast.state === 'unavailable' && forecast.limitationCodes.length === 0) {
    context.addIssue({
      code: 'custom',
      message: 'Unavailable forecast requires a named limitation',
      path: ['limitationCodes'],
    });
  }
  if (forecast.state === 'available'
    && (forecast.lowerBound === null || forecast.upperBound === null)) {
    context.addIssue({ code: 'custom', message: 'Available forecast requires both bounds' });
  }
});

const supplementalEvidenceQualityV1Schema = z.object({
  state: z.enum(['unavailable', 'available']),
  band: z.enum(['limited', 'developing', 'strong']).nullable(),
  asOf: isoDateTimeSchema,
  safeSourceRefs: z.array(safeReferenceSchema).max(100),
  limitationCodes: z.array(z.string().regex(/^[A-Z0-9_]+$/)).max(100),
  use: z.literal('tax_evidence_only'),
  affectsCredit: z.literal(false),
  affectsFactoring: z.literal(false),
}).strict().superRefine((quality, context) => {
  if (quality.state === 'unavailable' && quality.band !== null) {
    context.addIssue({ code: 'custom', message: 'Unavailable evidence quality cannot carry a band' });
  }
  if (quality.state === 'available' && quality.band === null) {
    context.addIssue({ code: 'custom', message: 'Available evidence quality requires a band' });
  }
  if (quality.state === 'unavailable' && quality.limitationCodes.length === 0) {
    context.addIssue({
      code: 'custom',
      message: 'Unavailable evidence quality requires a named limitation',
      path: ['limitationCodes'],
    });
  }
});

export const taxCacheIdentityV1Schema = z.object({
  version: z.literal('tax-cache-identity-v1'),
  projectionKey: projectionKeySchema,
  caseRevision: z.number().int().positive(),
  configurationRevision: opaqueRevisionSchema,
  inputRevision: opaqueRevisionSchema,
  snapshotRevision: opaqueRevisionSchema,
}).strict();

export const taxWidgetSnapshotV1Schema = z.object({
  version: z.literal('tax-widget-snapshot-v1'),
  workspaceId: safeReferenceSchema,
  caseId: safeReferenceSchema,
  profile: taxProfileSummaryV1Schema,
  period: periodSchema,
  displayCurrency: currencySchema,
  taxPosition: taxPositionV1Schema,
  activity: z.object({
    grossIncome: exactMoneySchema.nullable(),
    supportedExpenses: exactMoneySchema.nullable(),
  }).strict(),
  sourceHealth: sourceHealthV1Schema,
  evidenceCoverage: z.object({
    invoicedRevenue: exactMoneySchema.nullable(),
    reconciledRevenue: exactMoneySchema.nullable(),
    recordedExpenses: exactMoneySchema.nullable(),
    supportedExpenses: exactMoneySchema.nullable(),
    applicableObligations: z.number().int().nonnegative(),
    mappedObligations: z.number().int().nonnegative(),
    gaps: z.array(evidenceGapV1Schema).max(500),
  }).strict(),
  capabilityManifest: taxCapabilityManifestV1Schema,
  obligations: z.array(z.object({
    obligationRef: safeReferenceSchema,
    title: z.string().min(1).max(200),
    dueAt: isoDateTimeSchema.nullable(),
    preparationState: z.string().min(1).max(100),
    submissionState: z.string().min(1).max(100),
    satisfactionState: z.string().min(1).max(100),
    actionId: safeReferenceSchema.nullable(),
  }).strict()).max(500),
  filingReadiness: filingReadinessV1Schema.optional(),
  evidenceTasks: z.array(evidenceTaskV1Schema).max(500).optional(),
  accountantPacket: accountantPacketV1Schema.optional(),
  planningForecast: planningForecastV1Schema.optional(),
  supplementalEvidenceQuality: supplementalEvidenceQualityV1Schema.optional(),
  authorizedNextActions: z.array(safeReferenceSchema).max(20),
  conclusions: z.array(conclusionV1Schema).max(500),
  warnings: z.array(z.string().max(500)).max(100),
  cacheIdentity: taxCacheIdentityV1Schema,
}).strict().superRefine((snapshot, context) => {
  const moneyValues = [
    snapshot.activity.grossIncome,
    snapshot.activity.supportedExpenses,
    snapshot.evidenceCoverage.invoicedRevenue,
    snapshot.evidenceCoverage.reconciledRevenue,
    snapshot.evidenceCoverage.recordedExpenses,
    snapshot.evidenceCoverage.supportedExpenses,
    snapshot.planningForecast?.lowerBound ?? null,
    snapshot.planningForecast?.upperBound ?? null,
  ];
  for (const [index, value] of moneyValues.entries()) {
    if (value && value.currency !== snapshot.displayCurrency) {
      context.addIssue({ code: 'custom', message: 'Browser money must use displayCurrency', path: ['activity', index] });
    }
  }
  if (snapshot.evidenceCoverage.mappedObligations > snapshot.evidenceCoverage.applicableObligations) {
    context.addIssue({ code: 'custom', message: 'Mapped obligations cannot exceed applicable obligations', path: ['evidenceCoverage', 'mappedObligations'] });
  }
  if (snapshot.cacheIdentity.caseRevision < 1) {
    context.addIssue({ code: 'custom', message: 'Cache identity requires a durable case revision', path: ['cacheIdentity', 'caseRevision'] });
  }
});

export const taxWidgetSnapshotReceiptV1Schema = z.object({
  version: z.literal('tax-browser-snapshot-receipt-v1'),
  projectionKey: projectionKeySchema,
  generatedAt: isoDateTimeSchema,
  asOf: isoDateTimeSchema,
  expiresAt: isoDateTimeSchema.nullable(),
  validity: z.object({
    state: z.literal('current'),
    checkedAt: isoDateTimeSchema,
  }).strict(),
  cacheIdentity: taxCacheIdentityV1Schema,
  snapshot: taxWidgetSnapshotV1Schema,
}).strict().superRefine((receipt, context) => {
  if (receipt.projectionKey !== receipt.cacheIdentity.projectionKey
    || receipt.projectionKey !== receipt.snapshot.cacheIdentity.projectionKey) {
    context.addIssue({ code: 'custom', message: 'Receipt and snapshot projection identities must agree', path: ['projectionKey'] });
  }
  if (JSON.stringify(receipt.cacheIdentity) !== JSON.stringify(receipt.snapshot.cacheIdentity)) {
    context.addIssue({ code: 'custom', message: 'Receipt and snapshot cache identities must be byte-equivalent', path: ['cacheIdentity'] });
  }
  const asOf = Date.parse(receipt.asOf);
  const generatedAt = Date.parse(receipt.generatedAt);
  const checkedAt = Date.parse(receipt.validity.checkedAt);
  if (asOf > generatedAt) {
    context.addIssue({ code: 'custom', message: 'Snapshot asOf cannot follow generation', path: ['asOf'] });
  }
  if (checkedAt < generatedAt) {
    context.addIssue({ code: 'custom', message: 'Current validity cannot be checked before generation', path: ['validity', 'checkedAt'] });
  }
  if (receipt.expiresAt !== null) {
    const expiresAt = Date.parse(receipt.expiresAt);
    if (expiresAt <= asOf || expiresAt <= checkedAt) {
      context.addIssue({
        code: 'custom',
        message: 'A current receipt must expire after its evidence and validity check',
        path: ['expiresAt'],
      });
    }
  }
});

const scoreSchema = z.string()
  .regex(/^(?:0|[1-9]\d?)(?:\.\d{1,6})?$|^100(?:\.0{1,6})?$/);

export const FACTURA_E_FACTORING_STATES_V1 = [
  'unavailable',
  'needs_consent',
  'awaiting_issuance',
  'ambiguous',
  'active',
  'missing_collection',
  'stale',
  'revoked',
  'disputed',
  'ineligible',
  'offer_ready',
  'approval_required',
  'funded',
] as const;

export const facturaEFactoringProjectionV1Schema = z.object({
  version: z.literal('factura-e-factoring-projection-v1'),
  workspaceRef: safeReferenceSchema,
  receivableRef: safeReferenceSchema.nullable(),
  state: z.enum(FACTURA_E_FACTORING_STATES_V1),
  consentState: z.enum(['missing', 'active', 'revoked', 'expired']),
  authorityEvidenceState: z.enum(['awaiting', 'verified', 'ambiguous', 'stale', 'revoked']),
  collectionState: z.enum(['pending', 'partial', 'confirmed', 'reversed', 'disputed']),
  kybState: z.enum(['unknown', 'pending', 'verified', 'rejected', 'expired']),
  score: z.object({
    basePaymentScore: scoreSchema.nullable(),
    facturaEContribution: scoreSchema.nullable(),
    compositePaymentScore: scoreSchema.nullable(),
    contributionCap: scoreSchema,
    feedsLimit: z.literal(false),
    policyVersion: safeReferenceSchema,
  }).strict(),
  offer: z.object({
    state: z.enum(['unavailable', 'ready', 'approval_required', 'funded']),
    offerRef: safeReferenceSchema.nullable(),
  }).strict(),
  reasonCodes: z.array(z.string().regex(/^[A-Z0-9_]+$/)).min(1).max(50),
  authorizedNextAction: safeReferenceSchema.nullable(),
  expiresAt: isoDateTimeSchema.nullable(),
  cacheIdentity: taxCacheIdentityV1Schema,
}).strict().superRefine((projection, context) => {
  const scoreValues = [
    projection.score.basePaymentScore,
    projection.score.facturaEContribution,
    projection.score.compositePaymentScore,
  ];
  if (['unavailable', 'needs_consent', 'awaiting_issuance', 'ambiguous', 'revoked'].includes(projection.state)
    && scoreValues.some(value => value !== null)) {
    context.addIssue({ code: 'custom', message: 'Unavailable or unconsented factoring states cannot expose scores', path: ['score'] });
  }
  if (projection.state === 'needs_consent' && projection.consentState !== 'missing') {
    context.addIssue({ code: 'custom', message: 'needs_consent requires missing consent', path: ['consentState'] });
  }
  if (projection.state === 'funded' && projection.offer.state !== 'funded') {
    context.addIssue({ code: 'custom', message: 'Funded projection requires a funded offer state', path: ['offer', 'state'] });
  }
});

export type TaxCaseV1 = z.infer<typeof taxCaseV1Schema>;
export type TaxWidgetSnapshotV1 = z.infer<typeof taxWidgetSnapshotV1Schema>;
export type TaxWidgetSnapshotReceiptV1 = z.infer<typeof taxWidgetSnapshotReceiptV1Schema>;
export type FacturaEFactoringProjectionV1 = z.infer<typeof facturaEFactoringProjectionV1Schema>;
