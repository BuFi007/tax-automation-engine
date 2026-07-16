import { buildTaxCapabilityManifestV1 } from './capabilities';
import {
  facturaEFactoringProjectionV1Schema,
  taxCaseV1Schema,
  taxWidgetSnapshotV1Schema,
} from './contracts';
import { argentinaTaxCaseV1Fixture, argentinaTaxWidgetSnapshotV1Fixture } from './fixtures';
import { buildTaxCommandProblemV1 } from './problems';

const period = { start: '2026-01-01', end: '2026-12-31' } as const;

function taxCase(input: Readonly<{
  suffix: string;
  jurisdiction: 'AR' | 'US';
  entityType: string;
  regimeId: string;
}>) {
  return taxCaseV1Schema.parse({
    version: 'tax-case-v1',
    caseId: `case:${input.suffix}:2026`,
    workspaceId: `workspace:${input.suffix}`,
    revision: 1,
    state: 'active',
    selection: {
      jurisdiction: input.jurisdiction,
      entityType: input.entityType,
      regimeId: input.regimeId,
      confirmationState: 'accountant_confirmed',
    },
    profile: {
      profileRef: `profile:${input.suffix}`,
      profileVersion: 'profile-version:1',
      jurisdiction: input.jurisdiction,
      entityType: input.entityType,
      regimeId: input.regimeId,
      confirmationState: 'accountant_confirmed',
      catalogueVersion: `catalogue:${input.jurisdiction.toLowerCase()}:2026`,
    },
    period,
    displayCurrency: input.jurisdiction === 'AR' ? 'ARS' : 'USD',
    evidenceScope: { mode: 'all_connected' },
    steps: [{
      stepId: 'step:profile', owner: 'accountant', state: 'complete', actionId: null,
      completionEvidenceRefs: ['evidence:profile-confirmation'], limitationCodes: [],
    }],
    approvals: [],
    updatedAt: '2026-07-15T10:00:00.000Z',
  });
}

export const argentinaResponsibleInscriptoCaseV1Fixture = taxCase({
  suffix: 'ar-ri', jurisdiction: 'AR', entityType: 'individual', regimeId: 'responsable_inscripto',
});
export const usDomesticLlcCaseV1Fixture = taxCase({
  suffix: 'us-domestic-llc', jurisdiction: 'US', entityType: 'llc', regimeId: 'llc_single_member_domestic',
});
export const usForeignOwnedLlcCaseV1Fixture = taxCase({
  suffix: 'us-foreign-llc', jurisdiction: 'US', entityType: 'llc', regimeId: 'llc_single_member_foreign_owned',
});
export const usCCorpCaseV1Fixture = taxCase({
  suffix: 'us-c-corp', jurisdiction: 'US', entityType: 'c_corporation', regimeId: 'c_corp',
});

function arcaCase(
  suffix: string,
  state: 'blocked' | 'active',
  stepState: 'blocked' | 'in_progress' | 'complete',
  limitationCodes: readonly string[],
  completionEvidenceRefs: readonly string[] = [],
) {
  return taxCaseV1Schema.parse({
    ...structuredClone(argentinaTaxCaseV1Fixture),
    caseId: `case:${suffix}:2026`,
    workspaceId: `workspace:${suffix}`,
    revision: 8,
    state,
    steps: [{
      stepId: 'step:arca-authority',
      owner: 'user',
      state: stepState,
      actionId: stepState === 'complete' ? null : 'action:refresh-arca-status',
      completionEvidenceRefs,
      limitationCodes,
    }],
    approvals: [],
  });
}

export const arcaRejectedCaseV1Fixture = arcaCase('arca-rejected', 'blocked', 'blocked', ['ARCA_AUTHORITY_REJECTED']);
export const arcaAmbiguousCaseV1Fixture = arcaCase('arca-ambiguous', 'active', 'in_progress', ['ARCA_AUTHORITY_OUTCOME_AMBIGUOUS']);
export const arcaReconciledCaseV1Fixture = arcaCase('arca-reconciled', 'active', 'complete', [], ['evidence:official-authority-reconciliation']);

export const accountantChangesRequestedCaseV1Fixture = taxCaseV1Schema.parse({
  ...structuredClone(argentinaTaxCaseV1Fixture),
  caseId: 'case:accountant-changes:2026',
  workspaceId: 'workspace:accountant-changes',
  revision: 9,
  state: 'needs_review',
  updatedAt: '2026-07-15T10:01:00.000Z',
  approvals: [{
    approvalRef: 'approval:accountant-packet', purpose: 'evidence_scope', state: 'rejected',
    actorRole: 'accountant', decidedAt: '2026-07-15T10:01:00.000Z',
  }],
});

function sourceScenario(
  suffix: string,
  state: 'degraded' | 'blocked' | 'not_connected',
  sourceState: 'stale' | 'failed' | null,
) {
  const sourceHealth = sourceState === null
    ? { state, sources: [] }
    : {
        state,
        sources: [{
          sourceRef: `source:${suffix}`,
          kind: 'accounting',
          providerDescriptor: { providerId: `provider:${suffix}`, displayName: 'Accounting provider' },
          state: sourceState,
          capabilities: [{
            capability: 'ledger_accounts',
            state: sourceState,
            observedAt: '2026-07-12T09:55:00.000Z',
            safeErrorCode: sourceState === 'failed' ? 'PROVIDER_SYNC_FAILED' : 'EVIDENCE_SOURCE_CHECKPOINT_STALE',
          }],
          lastSuccessfulSyncAt: '2026-07-12T09:55:00.000Z',
          acceptedEvidenceCount: 0,
          needsReviewCount: 0,
          safeErrorCode: sourceState === 'failed' ? 'PROVIDER_SYNC_FAILED' : 'EVIDENCE_SOURCE_CHECKPOINT_STALE',
        }],
      };
  return taxWidgetSnapshotV1Schema.parse({
    ...structuredClone(argentinaTaxWidgetSnapshotV1Fixture),
    workspaceId: `workspace:${suffix}`,
    caseId: `case:${suffix}:2026`,
    sourceHealth,
    capabilityManifest: buildTaxCapabilityManifestV1(
      state === 'blocked' ? 'failed' : state === 'degraded' ? 'stale' : 'not_applicable',
    ),
  });
}

export const staleSourcesSnapshotV1Fixture = sourceScenario('stale-sources', 'degraded', 'stale');
export const providerFailureSnapshotV1Fixture = sourceScenario('provider-failure', 'blocked', 'failed');
export const offlineSourcesSnapshotV1Fixture = sourceScenario('offline-sources', 'not_connected', null);

export const FACTORING_SCENARIO_STATES_V1 = [
  'unavailable', 'needs_consent', 'awaiting_issuance', 'ambiguous', 'active',
  'missing_collection', 'stale', 'revoked', 'disputed', 'ineligible',
  'offer_ready', 'approval_required', 'funded',
] as const;
type FactoringScenarioState = (typeof FACTORING_SCENARIO_STATES_V1)[number];

function factoringProjection(state: FactoringScenarioState) {
  const scored = ['active', 'offer_ready', 'approval_required', 'funded'].includes(state);
  const consentState = state === 'needs_consent' || state === 'unavailable' ? 'missing'
    : state === 'revoked' ? 'revoked' : 'active';
  const authorityEvidenceState = state === 'ambiguous' ? 'ambiguous'
    : state === 'stale' ? 'stale'
      : state === 'revoked' ? 'revoked'
        : ['unavailable', 'needs_consent', 'awaiting_issuance'].includes(state) ? 'awaiting' : 'verified';
  const collectionState = state === 'disputed' ? 'disputed' : state === 'funded' ? 'partial' : 'pending';
  const kybState = state === 'ineligible' ? 'rejected' : scored ? 'verified' : 'unknown';
  const score = scored
    ? { basePaymentScore: '72', facturaEContribution: '8', compositePaymentScore: '80', contributionCap: '10', feedsLimit: false, policyVersion: 'factoring-policy:v1' }
    : { basePaymentScore: null, facturaEContribution: null, compositePaymentScore: null, contributionCap: '10', feedsLimit: false, policyVersion: 'factoring-policy:v1' };
  const offerState = state === 'offer_ready' ? 'ready'
    : state === 'approval_required' ? 'approval_required'
      : state === 'funded' ? 'funded' : 'unavailable';
  return facturaEFactoringProjectionV1Schema.parse({
    version: 'factura-e-factoring-projection-v1',
    workspaceRef: `workspace:factoring-${state}`,
    receivableRef: ['unavailable', 'needs_consent'].includes(state) ? null : `receivable:${state}`,
    state,
    consentState,
    authorityEvidenceState,
    collectionState,
    kybState,
    score,
    offer: { state: offerState, offerRef: offerState === 'unavailable' ? null : `offer:${state}` },
    reasonCodes: [`FACTORING_${state.toUpperCase()}`],
    authorizedNextAction: state === 'needs_consent' ? 'action:grant-factoring-consent'
      : state === 'offer_ready' ? 'action:review-offer'
        : state === 'approval_required' ? 'action:approve-offer' : null,
    expiresAt: scored ? '2026-07-16T10:00:00.000Z' : null,
    cacheIdentity: {
      version: 'tax-cache-identity-v1',
      projectionKey: `factoring:${state}`,
      caseRevision: 1,
      configurationRevision: 'cfg:factoring_config_2026_v1',
      inputRevision: `input:factoring_${state}_2026_v1`,
      snapshotRevision: `snapshot:factoring_${state}_2026_v1`,
    },
  });
}

export const FACTURA_E_FACTORING_SCENARIO_FIXTURES_V1 = Object.fromEntries(
  FACTORING_SCENARIO_STATES_V1.map(state => [state, factoringProjection(state)]),
) as Readonly<Record<FactoringScenarioState, ReturnType<typeof factoringProjection>>>;

export const TAX_BROWSER_SCENARIO_FIXTURES_V1 = {
  cases: {
    argentinaMonotributistaExporter: argentinaTaxCaseV1Fixture,
    argentinaResponsibleInscripto: argentinaResponsibleInscriptoCaseV1Fixture,
    usDomesticLlc: usDomesticLlcCaseV1Fixture,
    usForeignOwnedLlc: usForeignOwnedLlcCaseV1Fixture,
    usCCorp: usCCorpCaseV1Fixture,
    accountantChangesRequested: accountantChangesRequestedCaseV1Fixture,
    arcaRejected: arcaRejectedCaseV1Fixture,
    arcaAmbiguous: arcaAmbiguousCaseV1Fixture,
    arcaReconciled: arcaReconciledCaseV1Fixture,
  },
  sourceHealth: {
    partial: argentinaTaxWidgetSnapshotV1Fixture,
    stale: staleSourcesSnapshotV1Fixture,
    offline: offlineSourcesSnapshotV1Fixture,
    providerFailure: providerFailureSnapshotV1Fixture,
  },
  factoring: FACTURA_E_FACTORING_SCENARIO_FIXTURES_V1,
  commandProblems: {
    crossTenantDenied: buildTaxCommandProblemV1('TAX_TENANT_SCOPE_FORBIDDEN', { traceRef: 'trace:cross-tenant-denied' }),
    optimisticConcurrency: buildTaxCommandProblemV1('TAX_CASE_REVISION_CONFLICT', { traceRef: 'trace:case-conflict', currentCaseRevision: 9 }),
    idempotencyConflict: buildTaxCommandProblemV1('TAX_COMMAND_IDEMPOTENCY_CONFLICT', { traceRef: 'trace:idempotency-conflict' }),
    authorityAmbiguous: buildTaxCommandProblemV1('TAX_EXTERNAL_EFFECT_AMBIGUOUS', { traceRef: 'trace:authority-ambiguous' }),
  },
} as const;

/** SHA-256 of JSON.stringify(TAX_BROWSER_SCENARIO_FIXTURES_V1). */
export const TAX_BROWSER_SCENARIO_FIXTURES_V1_SHA256 = 'b851e35b18dfc9c3a71b0abf3a7df5e62506cd2c2e6421c072d656dc76d65ad0';
