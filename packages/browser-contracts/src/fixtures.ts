import { buildTaxCapabilityManifestV1 } from './capabilities';
import {
  facturaEFactoringProjectionV1Schema,
  taxCaseV1Schema,
  taxWidgetSnapshotReceiptV1Schema,
  taxWidgetSnapshotV1Schema,
} from './contracts';
import { buildTaxSnapshotProblemV1 } from './problems';

const period = { start: '2026-01-01', end: '2026-12-31' } as const;
const arCacheIdentity = {
  version: 'tax-cache-identity-v1',
  projectionKey: 'annual:2026',
  caseRevision: 7,
  configurationRevision: 'cfg:ar_default_2026_0001',
  inputRevision: 'input:ar_default_2026_0001',
  snapshotRevision: 'snapshot:ar_default_2026_0001',
} as const;

export const argentinaTaxCaseV1Fixture = taxCaseV1Schema.parse({
  version: 'tax-case-v1',
  caseId: 'case:ar-exporter:2026',
  workspaceId: 'workspace:ar-exporter',
  revision: 7,
  state: 'active',
  selection: {
    jurisdiction: 'AR',
    entityType: 'individual',
    regimeId: 'monotributo_exportador',
    confirmationState: 'user_confirmed',
  },
  profile: {
    profileRef: 'profile:ar-exporter',
    profileVersion: 'profile-version:7',
    jurisdiction: 'AR',
    entityType: 'individual',
    regimeId: 'monotributo_exportador',
    confirmationState: 'user_confirmed',
    catalogueVersion: 'ar-catalogue-2026-07-15',
  },
  period,
  displayCurrency: 'ARS',
  evidenceScope: { mode: 'all_connected' },
  steps: [
    {
      stepId: 'step:profile',
      owner: 'user',
      state: 'complete',
      actionId: null,
      completionEvidenceRefs: ['evidence:profile-confirmation'],
      limitationCodes: [],
    },
    {
      stepId: 'step:evidence-review',
      owner: 'accountant',
      state: 'needs_review',
      actionId: 'action:review-evidence',
      completionEvidenceRefs: [],
      limitationCodes: ['ACCOUNTING_SOURCE_STALE'],
    },
  ],
  approvals: [{
    approvalRef: 'approval:accountant-packet',
    purpose: 'evidence_scope',
    state: 'pending',
    actorRole: 'accountant',
    decidedAt: null,
  }],
  updatedAt: '2026-07-15T10:00:00.000Z',
});

export const unsupportedTaxCaseV1Fixture = taxCaseV1Schema.parse({
  version: 'tax-case-v1',
  caseId: 'case:unsupported:2026',
  workspaceId: 'workspace:unsupported',
  revision: 1,
  state: 'blocked',
  selection: {
    jurisdiction: 'unsupported',
    entityType: null,
    regimeId: null,
    confirmationState: 'suggested',
  },
  profile: null,
  period,
  displayCurrency: 'USD',
  evidenceScope: { mode: 'all_connected' },
  steps: [{
    stepId: 'step:unsupported-jurisdiction',
    owner: 'user',
    state: 'blocked',
    actionId: null,
    completionEvidenceRefs: [],
    limitationCodes: ['TAX_JURISDICTION_UNSUPPORTED'],
  }],
  approvals: [],
  updatedAt: '2026-07-15T10:00:00.000Z',
});

export const argentinaTaxWidgetSnapshotV1Fixture = taxWidgetSnapshotV1Schema.parse({
  version: 'tax-widget-snapshot-v1',
  workspaceId: argentinaTaxCaseV1Fixture.workspaceId,
  caseId: argentinaTaxCaseV1Fixture.caseId,
  profile: argentinaTaxCaseV1Fixture.profile,
  period,
  displayCurrency: 'ARS',
  taxPosition: {
    state: 'unavailable',
    taxCollected: null,
    taxPaid: null,
    netTaxPosition: null,
    limitationCodes: ['TAX_LIABILITY_RULES_NOT_PROJECTED'],
  },
  activity: {
    grossIncome: { decimal: '12345678901234567890.000001', currency: 'ARS' },
    supportedExpenses: { decimal: '1000000000000000000.000001', currency: 'ARS' },
  },
  sourceHealth: {
    state: 'degraded',
    sources: [
      {
        sourceRef: 'source:bufi-invoice',
        kind: 'bufi_invoice',
        providerDescriptor: { providerId: 'provider:bufi', displayName: 'BUFI Invoices' },
        state: 'connected',
        capabilities: [{
          capability: 'invoices',
          state: 'available',
          observedAt: '2026-07-15T09:55:00.000Z',
          safeErrorCode: null,
        }],
        lastSuccessfulSyncAt: '2026-07-15T09:55:00.000Z',
        acceptedEvidenceCount: 12,
        needsReviewCount: 0,
        safeErrorCode: null,
      },
      {
        sourceRef: 'source:accounting',
        kind: 'accounting',
        providerDescriptor: { providerId: 'provider:accounting', displayName: 'Accounting ledger' },
        state: 'stale',
        capabilities: [{
          capability: 'ledger_accounts',
          state: 'stale',
          observedAt: '2026-07-12T09:55:00.000Z',
          safeErrorCode: 'EVIDENCE_SOURCE_CHECKPOINT_STALE',
        }],
        lastSuccessfulSyncAt: '2026-07-12T09:55:00.000Z',
        acceptedEvidenceCount: 4,
        needsReviewCount: 2,
        safeErrorCode: 'EVIDENCE_SOURCE_CHECKPOINT_STALE',
      },
    ],
  },
  evidenceCoverage: {
    invoicedRevenue: { decimal: '12345678901234567890.000001', currency: 'ARS' },
    reconciledRevenue: { decimal: '12345678901234567890.000001', currency: 'ARS' },
    recordedExpenses: { decimal: '1000000000000000000.000001', currency: 'ARS' },
    supportedExpenses: { decimal: '1000000000000000000.000001', currency: 'ARS' },
    applicableObligations: 3,
    mappedObligations: 2,
    gaps: [{
      gapRef: 'gap:accounting-stale',
      kind: 'accounting_source_stale',
      severity: 'warning',
      safeSourceRefs: ['source:accounting'],
      actionId: 'action:reconnect-accounting',
    }],
  },
  capabilityManifest: buildTaxCapabilityManifestV1('partial'),
  obligations: [{
    obligationRef: 'obligation:monotributo-monthly:2026-07',
    title: 'Monotributo monthly obligation',
    dueAt: '2026-07-20T23:59:59.000-03:00',
    preparationState: 'in_progress',
    submissionState: 'not_submitted',
    satisfactionState: 'outstanding',
    actionId: 'action:review-monotributo',
  }],
  authorizedNextActions: ['action:reconnect-accounting'],
  conclusions: [{
    conclusionRef: 'conclusion:reconciled-revenue',
    kind: 'reconciled_revenue',
    safeDisplayValue: 'ARS 12,345,678,901,234,567,890.000001',
    period,
    sourceRefs: ['source:bufi-invoice'],
    freshness: 'fresh',
    confidence: 'verified',
    derivation: 'provider_fact',
    consentScopeRevision: 'consent:ar_default_2026_0001',
    evidenceRevision: 'evidence:ar_default_2026_0001',
    accountantReviewState: 'unreviewed',
    ruleVersions: [],
    limitations: ['This is reconciled activity, not a tax liability.'],
  }],
  warnings: ['Tax liability remains unavailable until deterministic jurisdiction rules are projected.'],
  cacheIdentity: arCacheIdentity,
});

export const argentinaTaxWidgetSnapshotReceiptV1Fixture = taxWidgetSnapshotReceiptV1Schema.parse({
  version: 'tax-browser-snapshot-receipt-v1',
  projectionKey: arCacheIdentity.projectionKey,
  generatedAt: '2026-07-15T10:00:00.000Z',
  asOf: '2026-07-15T09:59:00.000Z',
  expiresAt: '2026-07-16T09:59:00.000Z',
  validity: { state: 'current', checkedAt: '2026-07-15T10:00:00.000Z' },
  cacheIdentity: arCacheIdentity,
  snapshot: argentinaTaxWidgetSnapshotV1Fixture,
});

export const unitedStatesTaxWidgetSnapshotV1Fixture = taxWidgetSnapshotV1Schema.parse({
  ...argentinaTaxWidgetSnapshotV1Fixture,
  workspaceId: 'workspace:us-llc',
  caseId: 'case:us-llc:2026',
  profile: {
    profileRef: 'profile:us-llc',
    profileVersion: 'profile-version:3',
    jurisdiction: 'US',
    entityType: 'llc',
    regimeId: 'llc_single_member_foreign_owned',
    confirmationState: 'accountant_confirmed',
    catalogueVersion: 'us-catalogue-2026-07-15',
  },
  displayCurrency: 'USD',
  activity: {
    grossIncome: { decimal: '10000.01', currency: 'USD' },
    supportedExpenses: { decimal: '2500.01', currency: 'USD' },
  },
  sourceHealth: {
    state: 'healthy',
    sources: [{
      sourceRef: 'source:quickbooks',
      kind: 'accounting',
      providerDescriptor: { providerId: 'provider:quickbooks', displayName: 'QuickBooks' },
      state: 'connected',
      capabilities: [{
        capability: 'ledger_accounts',
        state: 'available',
        observedAt: '2026-07-15T09:55:00.000Z',
        safeErrorCode: null,
      }],
      lastSuccessfulSyncAt: '2026-07-15T09:55:00.000Z',
      acceptedEvidenceCount: 20,
      needsReviewCount: 0,
      safeErrorCode: null,
    }],
  },
  evidenceCoverage: {
    invoicedRevenue: { decimal: '10000.01', currency: 'USD' },
    reconciledRevenue: { decimal: '10000.01', currency: 'USD' },
    recordedExpenses: { decimal: '2500.01', currency: 'USD' },
    supportedExpenses: { decimal: '2500.01', currency: 'USD' },
    applicableObligations: 2,
    mappedObligations: 2,
    gaps: [],
  },
  capabilityManifest: buildTaxCapabilityManifestV1(),
  obligations: [{
    obligationRef: 'obligation:form-5472:2026',
    title: 'Foreign-owned disregarded entity information return',
    dueAt: '2027-04-15T23:59:59.000-04:00',
    preparationState: 'not_started',
    submissionState: 'not_submitted',
    satisfactionState: 'not_due',
    actionId: 'action:review-us-filing',
  }],
  authorizedNextActions: ['action:review-us-filing'],
  conclusions: [],
  warnings: ['Tax liability remains unavailable until deterministic federal and state rules are projected.'],
  cacheIdentity: {
    version: 'tax-cache-identity-v1',
    projectionKey: 'annual:2026',
    caseRevision: 3,
    configurationRevision: 'cfg:us_default_2026_0001',
    inputRevision: 'input:us_default_2026_0001',
    snapshotRevision: 'snapshot:us_default_2026_0001',
  },
});

export const facturaENeedsConsentProjectionV1Fixture = facturaEFactoringProjectionV1Schema.parse({
  version: 'factura-e-factoring-projection-v1',
  workspaceRef: 'workspace:ar-exporter',
  receivableRef: null,
  state: 'needs_consent',
  consentState: 'missing',
  authorityEvidenceState: 'awaiting',
  collectionState: 'pending',
  kybState: 'unknown',
  score: {
    basePaymentScore: null,
    facturaEContribution: null,
    compositePaymentScore: null,
    contributionCap: '0',
    feedsLimit: false,
    policyVersion: 'factoring-policy:disabled-v1',
  },
  offer: { state: 'unavailable', offerRef: null },
  reasonCodes: ['FACTORING_CONSENT_REQUIRED'],
  authorizedNextAction: 'action:grant-factoring-consent',
  expiresAt: null,
  cacheIdentity: arCacheIdentity,
});

export const taxSnapshotProblemFixturesV1 = {
  setupRequired: buildTaxSnapshotProblemV1('TAX_SNAPSHOT_NOT_FOUND', 'trace:setup_000000000001'),
  syncing: buildTaxSnapshotProblemV1('TAX_SNAPSHOT_STALE', 'trace:syncing_0000000001'),
  refreshRequired: buildTaxSnapshotProblemV1('TAX_SNAPSHOT_EXPIRED', 'trace:expired_0000000001'),
} as const;

export const TAX_BROWSER_GOLDEN_FIXTURES_V1 = {
  argentinaCase: argentinaTaxCaseV1Fixture,
  unsupportedCase: unsupportedTaxCaseV1Fixture,
  argentinaSnapshot: argentinaTaxWidgetSnapshotV1Fixture,
  argentinaReceipt: argentinaTaxWidgetSnapshotReceiptV1Fixture,
  unitedStatesSnapshot: unitedStatesTaxWidgetSnapshotV1Fixture,
  facturaENeedsConsent: facturaENeedsConsentProjectionV1Fixture,
  problems: taxSnapshotProblemFixturesV1,
} as const;

/** SHA-256 of JSON.stringify(TAX_BROWSER_GOLDEN_FIXTURES_V1). */
export const TAX_BROWSER_GOLDEN_FIXTURES_V1_SHA256 = 'c8d1e73d9672a1240245682846ebae10174e2a66ada342e33838a5e45d6fe38d';
