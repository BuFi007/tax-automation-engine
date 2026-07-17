import { createHmac } from 'node:crypto';

import {
  buildTaxSnapshotProblemV1,
  deriveTaxSourceHealthStateV1,
  taxAuthorityReadinessV1Schema,
  taxJurisdictionProfileReadinessV1Schema,
  taxSnapshotReadResultV1Schema,
  taxWidgetSnapshotReceiptV1Schema,
  taxWidgetSnapshotV1Schema,
  TAX_JURISDICTION_PROFILE_LIMITATIONS_V1,
  TAX_AE_PROFILE_LIMITATIONS_V1,
  type TaxAuthorityReadinessV1,
  type TaxJurisdictionProfileReadinessV1,
  type TaxSnapshotProblemCodeV1,
  type TaxSnapshotReadResultV1,
  type TaxObligationKindV1,
  type TaxWidgetSnapshotReceiptV1 as BrowserTaxWidgetSnapshotReceiptV1,
  type TaxWidgetSnapshotV1 as BrowserTaxWidgetSnapshotV1,
} from '@tax-engine/browser-contracts';
import {
  normalizeTaxSnapshotProjectionKey,
  UnitedStatesJurisdictionProvider,
  type ArcaOnboardingRunV1,
  type TaxConclusionEnvelopeV1,
  type TaxProfile,
  type TaxWidgetSnapshotReceiptV1 as CoreTaxWidgetSnapshotReceiptV1,
} from '@tax-engine/core';

import type { TaxEvidenceWorkspaceService } from './evidence-workspace';
import type { TaxProfileStore } from './store';

const BROWSER_SNAPSHOT_PROBLEM_CODES = new Set<TaxSnapshotProblemCodeV1>([
  'TAX_SNAPSHOT_NOT_FOUND',
  'TAX_SNAPSHOT_PROJECTION_CONFIG_REQUIRED',
  'TAX_SNAPSHOT_STALE',
  'TAX_EVIDENCE_SOURCE_STALE',
  'TAX_SNAPSHOT_PROJECTION_CONFIG_MISMATCH',
  'TAX_SNAPSHOT_CONFIG_VERSION_CONFLICT',
  'TAX_EVIDENCE_GENERATION_CONFLICT',
  'TAX_PROFILE_VERSION_CONFLICT',
  'TAX_SNAPSHOT_EXPIRED',
]);

const EXACT_OBLIGATION_KINDS = {
  'ar:invoice-readiness': 'ar_invoice_readiness',
  'ar:iibb-review': 'ar_iibb_review',
  'ar:ganancias-individual-annual': 'ar_ganancias_individual_annual',
  'ar:bienes-personales-annual': 'ar_bienes_personales_annual',
  'ar:ganancias-simplified-review': 'ar_ganancias_simplified_review',
  'ar:monotributo-payment': 'ar_monotributo_payment',
  'ar:iva-simple': 'ar_iva_simple',
  'ar:ganancias-corporate-annual': 'ar_ganancias_corporate_annual',
  'ar:mipyme': 'ar_mipyme',
  'ar:knowledge-economy': 'ar_knowledge_economy',
  'us:state-review': 'us_state_review',
  'us:sales-tax': 'us_sales_tax',
  'us:de:llc-annual-tax': 'us_delaware_llc_annual_tax',
  'us:de:corporation-franchise': 'us_delaware_corporation_franchise',
  'us:de:income-return': 'us_delaware_income_return',
  'us:form-5472-corporation-review': 'us_form_5472_corporation_review',
  'us:payroll': 'us_payroll',
  'us:form-5472-pro-forma-1120': 'us_form_5472_pro_forma_1120',
  'us:form-1065': 'us_form_1065',
  'us:form-1120-s': 'us_form_1120_s',
  'us:form-1120': 'us_form_1120',
  'us:owner-income-return-review': 'us_owner_income_return_review',
  'ae:corporate-tax-registration': 'ae_corporate_tax_registration',
  'ae:corporate-tax-return': 'ae_corporate_tax_return',
  'ae:vat-registration': 'ae_vat_registration',
  'ae:vat-return': 'ae_vat_return',
  'ae:free-zone-qualifying-status-review': 'ae_free_zone_qualifying_status_review',
} as const satisfies Readonly<Record<string, Exclude<TaxObligationKindV1, 'unclassified'>>>;

const ARCA_SERVICE_ORDER = ['wsfex', 'wsfe'] as const;

const US_ENTITY_STRUCTURE_BY_REGIME: ReadonlyMap<
  string,
  Exclude<TaxJurisdictionProfileReadinessV1['entityStructure'], 'unclassified'>
> = new Map([
  ['llc_single_member', 'single_member_llc'],
  ['llc_multi_member', 'multi_member_llc'],
  ['s_corp', 's_corporation'],
  ['c_corp', 'c_corporation'],
]);

const ARCA_STEP_LIMITATION = {
  login_handoff: 'ARCA_LOGIN_REQUIRED',
  human_auth: 'ARCA_PRIVATE_AUTH_REQUIRED',
  service_adherence: 'ARCA_SERVICE_ADHERENCE_REQUIRED',
  point_of_sale_discovery: 'ARCA_POINT_OF_SALE_DISCOVERY_REQUIRED',
  point_of_sale_creation: 'ARCA_POINT_OF_SALE_REQUIRED',
  ws_delegation: 'ARCA_WEB_SERVICE_DELEGATION_REQUIRED',
  api_verification: 'ARCA_API_VERIFICATION_REQUIRED',
  zk_evidence: 'RECLAIM_PROOF_REQUIRED',
  ready: 'ARCA_ONBOARDING_FAILED',
} as const satisfies Readonly<Record<ArcaOnboardingRunV1['currentStep'], string>>;

export function taxObligationKindForId(obligationId: string): TaxObligationKindV1 {
  if (/^ar:recategorization:(02|08)$/.test(obligationId)) {
    return 'ar_monotributo_recategorization';
  }
  if (/^us:c-corp-estimated:[1-4]$/.test(obligationId)) {
    return 'us_c_corp_estimated_tax';
  }
  return EXACT_OBLIGATION_KINDS[obligationId as keyof typeof EXACT_OBLIGATION_KINDS]
    ?? 'unclassified';
}

/**
 * Projects only the bounded US profile facts needed to explain specialist
 * readiness. Filing paths stay in cited obligations; owner countries, raw
 * answers, identifiers, amounts, and provider material never cross this edge.
 */
export function projectTaxJurisdictionProfileReadiness(
  profile: TaxProfile,
): TaxJurisdictionProfileReadinessV1 | undefined {
  if (profile.jurisdiction === 'AE') return projectUaeFreeZoneProfileReadiness(profile);
  if (profile.jurisdiction !== 'US') return undefined;

  const provider = new UnitedStatesJurisdictionProvider();
  const validation = provider.validateProfile(profile);
  const entityStructure = US_ENTITY_STRUCTURE_BY_REGIME.get(profile.regimeId) ?? 'unclassified';
  const founderResidency = uniqueProfileAnswer(profile, 'founder_residency');
  const ownerStatus = uniqueProfileAnswer(profile, 'owner_us_person_status');
  const classification = uniqueProfileAnswer(profile, 'tax_classification');
  const memberCount = uniqueProfileAnswer(profile, 'member_count');
  const formationState = uniqueProfileAnswer(profile, 'formation_state');
  const operatingStates = uniqueProfileAnswer(profile, 'operating_states');
  const salesStates = uniqueProfileAnswer(profile, 'sales_states');
  const hasPayroll = uniqueProfileAnswer(profile, 'has_payroll');

  const founderDomicileScope = founderResidency === 'local'
    ? 'us_domiciled'
    : founderResidency === 'foreign'
      ? 'foreign_domiciled'
      : 'unconfirmed';
  const ownerUsPersonStatus = ownerStatus === 'us_person' || ownerStatus === 'non_us_person'
    ? ownerStatus
    : ownerStatus === 'needs_classification'
      ? 'needs_review'
      : 'unconfirmed';
  const federalClassification = [
    'disregarded_entity',
    'partnership',
    's_corp',
    'c_corp',
  ].includes(String(classification))
    ? classification as 'disregarded_entity' | 'partnership' | 's_corp' | 'c_corp'
    : classification === 'needs_classification'
      ? 'needs_review'
      : 'unconfirmed';
  const memberStructure = entityStructure === 's_corporation' || entityStructure === 'c_corporation'
    ? 'not_applicable'
    : typeof memberCount === 'number' && Number.isInteger(memberCount) && memberCount >= 1
      ? memberCount === 1 ? 'single' : 'multiple'
      : 'unconfirmed';
  const formationSubdivision = typeof formationState === 'string'
    && formationState === profile.formationSubdivision
    && isUsSubdivision(formationState)
    ? formationState
    : null;
  const operatingSubdivisionCount = validUsSubdivisionSet(operatingStates)
    && validUsSubdivisionSet(profile.operatingSubdivisions)
    && sameStringSet(operatingStates, profile.operatingSubdivisions)
    ? operatingStates.length
    : null;
  const salesSubdivisionCount = validUsSubdivisionSet(salesStates)
    ? salesStates.length
    : null;
  const payrollState = hasPayroll === true
    ? 'present'
    : hasPayroll === false
      ? 'absent'
      : 'unconfirmed';

  const projectedInputsMissing = entityStructure === 'unclassified'
    || founderDomicileScope === 'unconfirmed'
    || ownerUsPersonStatus === 'unconfirmed'
    || federalClassification === 'unconfirmed'
    || memberStructure === 'unconfirmed'
    || formationSubdivision === null
    || operatingSubdivisionCount === null
    || salesSubdivisionCount === null
    || payrollState === 'unconfirmed';
  const state = projectedInputsMissing
    ? 'incomplete'
    : validation.length > 0 || profile.confirmationState !== 'accountant_confirmed'
      ? 'accountant_review'
      : 'confirmed';

  const limitations = new Set<(typeof TAX_JURISDICTION_PROFILE_LIMITATIONS_V1)[number]>();
  if (state !== 'confirmed') limitations.add('US_SPECIALIST_ACCOUNTANT_REVIEW_REQUIRED');
  if (state === 'incomplete') limitations.add('US_PROFILE_INCOMPLETE');
  if (ownerUsPersonStatus === 'unconfirmed' || ownerUsPersonStatus === 'needs_review'
    || validation.some(code => code.includes('OWNER_US_PERSON') || code.startsWith('S_CORP_NON_US_OWNER'))) {
    limitations.add('US_OWNER_STATUS_REVIEW_REQUIRED');
  }
  if (federalClassification === 'unconfirmed' || federalClassification === 'needs_review'
    || validation.some(code => code.includes('CLASSIFICATION') || code.startsWith('S_CORP_NON_US_OWNER'))) {
    limitations.add('US_FEDERAL_CLASSIFICATION_REVIEW_REQUIRED');
  }
  if (entityStructure === 'unclassified' || memberStructure === 'unconfirmed'
    || validation.some(code => code.includes('REGIME') || code.includes('MEMBER_COUNT'))) {
    limitations.add('US_ENTITY_STRUCTURE_REVIEW_REQUIRED');
  }
  if (formationSubdivision === null || operatingSubdivisionCount === null
    || salesSubdivisionCount === null || validation.some(code => code.includes('STATE'))) {
    limitations.add('US_STATE_SCOPE_REVIEW_REQUIRED');
  }
  if (payrollState === 'unconfirmed' || validation.some(code => code.includes('PAYROLL'))) {
    limitations.add('US_PAYROLL_SCOPE_REVIEW_REQUIRED');
  }

  return taxJurisdictionProfileReadinessV1Schema.parse({
    version: 'tax-jurisdiction-profile-readiness-v1',
    kind: 'us_entity',
    state,
    entityStructure,
    founderDomicileScope,
    ownerUsPersonStatus,
    federalClassification,
    memberStructure,
    formationSubdivision,
    operatingSubdivisionCount,
    salesSubdivisionCount,
    payrollState,
    accountantReviewRequired: state !== 'confirmed',
    limitationCodes: TAX_JURISDICTION_PROFILE_LIMITATIONS_V1.filter(code => limitations.has(code)),
  });
}

function projectUaeFreeZoneProfileReadiness(profile: TaxProfile): TaxJurisdictionProfileReadinessV1 | undefined {
  if (profile.regimeId !== 'uae_free_zone_person') return undefined;
  const formation = uniqueProfileAnswer(profile, 'formation_emirate');
  const corporateTax = uniqueProfileAnswer(profile, 'corporate_tax_registration');
  const vatThreshold = uniqueProfileAnswer(profile, 'vat_threshold_state');
  const vatRegistration = uniqueProfileAnswer(profile, 'vat_registration');
  const entityStructure = profile.entityType === 'fzco'
    ? 'free_zone_company'
    : profile.entityType === 'fz_llc'
      ? 'free_zone_llc'
      : profile.entityType === 'branch'
        ? 'free_zone_branch'
        : 'unclassified';
  const formationEmirate = formation === 'AE-DU' && profile.formationSubdivision === 'AE-DU' ? 'AE-DU' : null;
  const corporateTaxRegistration = oneOf(corporateTax, ['not_registered', 'submitted', 'certificate_available', 'needs_review']) ?? 'unconfirmed';
  const vatThresholdState = oneOf(vatThreshold, ['mandatory', 'voluntary', 'below', 'nonresident_taxable_supplies', 'needs_review']) ?? 'unconfirmed';
  const projectedVatRegistration = oneOf(vatRegistration, ['not_registered', 'submitted', 'certificate_available', 'exemption_identifier_available', 'needs_review']) ?? 'unconfirmed';
  const incomplete = formationEmirate === null || entityStructure === 'unclassified'
    || corporateTaxRegistration === 'unconfirmed' || vatThresholdState === 'unconfirmed'
    || projectedVatRegistration === 'unconfirmed';
  const limitations = new Set<(typeof TAX_AE_PROFILE_LIMITATIONS_V1)[number]>([
    'AE_FREE_ZONE_STATUS_REVIEW_REQUIRED',
    'AE_SPECIALIST_ACCOUNTANT_REVIEW_REQUIRED',
  ]);
  if (incomplete) limitations.add('AE_PROFILE_INCOMPLETE');
  limitations.add('AE_CORPORATE_TAX_REGISTRATION_REQUIRED');
  if (vatThresholdState === 'needs_review' || vatThresholdState === 'unconfirmed') limitations.add('AE_VAT_THRESHOLD_REVIEW_REQUIRED');

  return taxJurisdictionProfileReadinessV1Schema.parse({
    version: 'tax-jurisdiction-profile-readiness-v1',
    kind: 'ae_free_zone_entity',
    state: incomplete ? 'incomplete' : 'accountant_review',
    formationEmirate,
    entityStructure,
    corporateTaxRegistration,
    vatThresholdState,
    vatRegistration: projectedVatRegistration,
    qualifyingFreeZoneStatus: 'professional_review_required',
    accountantReviewRequired: true,
    limitationCodes: TAX_AE_PROFILE_LIMITATIONS_V1.filter(code => limitations.has(code)),
  });
}

function oneOf<const T extends readonly string[]>(value: unknown, options: T): T[number] | undefined {
  return typeof value === 'string' && options.includes(value) ? value as T[number] : undefined;
}

function uniqueProfileAnswer(profile: TaxProfile, questionId: string): TaxProfile['answers'][number]['value'] | undefined {
  const matches = profile.answers.filter(answer => answer.questionId === questionId);
  return matches.length === 1 ? matches[0]?.value : undefined;
}

function isUsSubdivision(value: string): boolean {
  return /^US-[A-Z]{2}$/.test(value);
}

function validUsSubdivisionSet(value: unknown): value is readonly string[] {
  return Array.isArray(value)
    && value.every(entry => typeof entry === 'string' && isUsSubdivision(entry))
    && new Set(value).size === value.length
    && value.length <= 100;
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const values = new Set(left);
  return right.every(value => values.has(value));
}

/**
 * Produces the only ARCA state allowed to cross the browser/agent boundary.
 * Selection may inspect internal run IDs to break ties, but the projection
 * contains only closed readiness facts and never the selected identifier.
 */
export function projectArcaAuthorityReadiness(
  jurisdiction: CoreTaxWidgetSnapshotReceiptV1['snapshot']['profile']['jurisdiction'],
  workspaceId: string,
  fallbackUpdatedAt: string,
  candidates: readonly ArcaOnboardingRunV1[],
): TaxAuthorityReadinessV1 | undefined {
  if (jurisdiction !== 'AR') return undefined;
  const run = latestWorkspaceOnboarding(workspaceId, candidates);
  if (!run) {
    return taxAuthorityReadinessV1Schema.parse({
      version: 'tax-authority-readiness-v1',
      kind: 'ar_factura_e_onboarding',
      state: 'not_started',
      environment: null,
      currentStep: null,
      requestedServices: [],
      pointOfSaleState: 'unknown',
      delegation: { wsfex: null, wsfe: null },
      apiVerification: { wsfex: null, wsfe: null, observedAt: null },
      reclaim: {
        state: 'not_started',
        teeVerified: null,
        custodyRecorded: null,
        verifiedAt: null,
      },
      updatedAt: fallbackUpdatedAt,
      limitationCodes: ['ARCA_ONBOARDING_NOT_STARTED'],
      actionId: null,
    });
  }

  const requestedServices = canonicalRequestedServices(run);
  const requested = new Set(requestedServices);
  const reclaim = projectReclaimReadiness(run);
  const failedStep = run.steps.some(step => step.state === 'failed');
  const invalidVerifiedSession = run.reclaimSession?.state === 'verified' && run.zkEvidence === null;
  const apiSatisfied = requestedServices.every(service => run.apiVerification[service]);
  const pendingVerifiedProof = run.currentStep === 'zk_evidence'
    && apiSatisfied
    && reclaim.state === 'pending';
  const requiresUserAction = run.currentStep === 'point_of_sale_discovery'
    ? (run.pointOfSale.candidates?.length ?? 0) > 1
    : !['api_verification'].includes(run.currentStep);

  let state: TaxAuthorityReadinessV1['state'];
  if (run.status === 'failed' || failedStep || invalidVerifiedSession
    || (run.currentStep === 'ready' && run.status !== 'ready')) {
    state = 'failed';
  } else if (run.status === 'ready') {
    state = 'ready';
  } else if (pendingVerifiedProof) {
    state = 'verified';
  } else if (requiresUserAction) {
    state = 'action_required';
  } else {
    state = 'in_progress';
  }

  return taxAuthorityReadinessV1Schema.parse({
    version: 'tax-authority-readiness-v1',
    kind: 'ar_factura_e_onboarding',
    state,
    environment: run.environment,
    currentStep: run.currentStep,
    requestedServices,
    pointOfSaleState: projectPointOfSaleState(run),
    delegation: {
      wsfex: requested.has('wsfex') ? run.delegation.wsfex : null,
      wsfe: requested.has('wsfe') ? run.delegation.wsfe : null,
    },
    apiVerification: {
      wsfex: requested.has('wsfex') ? run.apiVerification.wsfex : null,
      wsfe: requested.has('wsfe') ? run.apiVerification.wsfe : null,
      observedAt: run.apiVerification.observedAt,
    },
    reclaim,
    updatedAt: run.updatedAt,
    limitationCodes: state === 'ready' || state === 'verified'
      ? []
      : [state === 'failed' ? 'ARCA_ONBOARDING_FAILED' : ARCA_STEP_LIMITATION[run.currentStep]],
    // Browser actions require a separate, same-snapshot policy descriptor.
    actionId: null,
  });
}

function latestWorkspaceOnboarding(
  workspaceId: string,
  candidates: readonly ArcaOnboardingRunV1[],
): ArcaOnboardingRunV1 | null {
  if (candidates.some(candidate => candidate.workspaceId !== workspaceId)) {
    throw new Error('Tax ARCA readiness workspace scope is invalid');
  }
  return candidates
    .reduce<ArcaOnboardingRunV1 | null>((latest, candidate) => {
      if (!latest) return candidate;
      const candidateUpdatedAt = Date.parse(candidate.updatedAt);
      const latestUpdatedAt = Date.parse(latest.updatedAt);
      if (!Number.isFinite(candidateUpdatedAt) || !Number.isFinite(latestUpdatedAt)) {
        throw new Error('Tax ARCA readiness source is invalid');
      }
      const updated = candidateUpdatedAt - latestUpdatedAt;
      if (updated !== 0) return updated > 0 ? candidate : latest;
      if (candidate.revision !== latest.revision) {
        return candidate.revision > latest.revision ? candidate : latest;
      }
      return candidate.onboardingId.localeCompare(latest.onboardingId) > 0 ? candidate : latest;
    }, null);
}

function canonicalRequestedServices(
  run: ArcaOnboardingRunV1,
): readonly (typeof ARCA_SERVICE_ORDER)[number][] {
  const raw = run.requestedServices as readonly string[];
  if (raw.length === 0
    || new Set(raw).size !== raw.length
    || raw.some(service => !(ARCA_SERVICE_ORDER as readonly string[]).includes(service))) {
    throw new Error('Tax ARCA readiness source is invalid');
  }
  return ARCA_SERVICE_ORDER.filter(service => raw.includes(service));
}

function projectPointOfSaleState(
  run: ArcaOnboardingRunV1,
): TaxAuthorityReadinessV1['pointOfSaleState'] {
  if (run.pointOfSale.active && run.pointOfSale.number !== null) return 'active';
  const discovery = run.steps.find(step => step.step === 'point_of_sale_discovery');
  const discoveryCompleted = discovery?.state === 'completed'
    || discovery?.state === 'skipped'
    || discovery?.state === 'failed';
  const candidatesFound = (run.pointOfSale.candidates?.length ?? 0) > 0;
  return discoveryCompleted || candidatesFound ? 'missing' : 'unknown';
}

function projectReclaimReadiness(
  run: ArcaOnboardingRunV1,
): TaxAuthorityReadinessV1['reclaim'] {
  if (run.zkEvidence) {
    return {
      state: 'verified',
      teeVerified: run.zkEvidence.teeVerified,
      custodyRecorded: run.zkEvidence.custodyReceipt !== null,
      verifiedAt: run.zkEvidence.verifiedAt,
    };
  }
  if (run.reclaimSession) {
    return {
      state: run.reclaimSession.state === 'verified' ? 'failed' : run.reclaimSession.state,
      teeVerified: null,
      custodyRecorded: null,
      verifiedAt: null,
    };
  }
  return {
    state: 'not_started',
    teeVerified: null,
    custodyRecorded: null,
    verifiedAt: null,
  };
}

type SnapshotReader = Pick<TaxEvidenceWorkspaceService, 'latestSnapshot'>;

export type TaxBrowserSnapshotRead = Readonly<{
  status: 200 | 404 | 409 | 410;
  result: TaxSnapshotReadResultV1;
}>;

export function resolveTaxBrowserReferenceSecret(
  configuredSecret: string | null | undefined = process.env.TAX_ENGINE_BROWSER_REFERENCE_HMAC_SECRET,
  nodeEnvironment: string | undefined = process.env.NODE_ENV,
): string | null {
  const secret = configuredSecret?.trim() || null;
  if (!secret) {
    if (nodeEnvironment === 'production') {
      throw new Error('TAX_ENGINE_BROWSER_REFERENCE_HMAC_SECRET_CONFIGURATION_REQUIRED');
    }
    return null;
  }
  if (Buffer.byteLength(secret, 'utf8') < 32) {
    throw new Error('TAX_ENGINE_BROWSER_REFERENCE_HMAC_SECRET_TOO_SHORT');
  }
  return secret;
}

/**
 * Projects the server-only Tax receipt into the frozen browser contract. Every
 * correlatable identifier is purpose/workspace/projection scoped with HMAC.
 * Raw core IDs and hashes never cross this boundary.
 */
export class TaxBrowserSnapshotProjector {
  readonly #references: TaxBrowserReferenceScope;

  constructor(secret: string) {
    const resolved = resolveTaxBrowserReferenceSecret(secret, 'production');
    if (!resolved) throw new Error('TAX_ENGINE_BROWSER_REFERENCE_HMAC_SECRET_CONFIGURATION_REQUIRED');
    this.#references = new TaxBrowserReferenceScope(resolved);
  }

  sourceFingerprint(
    receipt: CoreTaxWidgetSnapshotReceiptV1,
    authorityReadiness?: TaxAuthorityReadinessV1,
  ): string {
    return this.#references.digest('source-fingerprint', receipt.snapshot.workspaceId, receipt.projectionKey, JSON.stringify({
      snapshotHash: receipt.snapshotHash,
      inputHash: receipt.inputHash,
      configHash: receipt.configHash,
      evidenceGeneration: receipt.evidenceGeneration,
      generatedAt: receipt.generatedAt,
      asOf: receipt.asOf,
      expiresAt: receipt.expiresAt,
      profileVersion: receipt.snapshot.profile.version,
      authorityReadiness: authorityReadiness ?? null,
      jurisdictionProfileReadiness: projectTaxJurisdictionProfileReadiness(receipt.snapshot.profile) ?? null,
    }));
  }

  caseReference(workspaceId: string, projectionKey: string): string {
    return this.#references.reference('case', workspaceId, projectionKey, 'durable-tax-case-v1');
  }

  workspaceReference(workspaceId: string, projectionKey: string): string {
    return this.#references.reference('workspace', workspaceId, projectionKey, workspaceId);
  }

  project(
    receipt: CoreTaxWidgetSnapshotReceiptV1,
    durable: Readonly<{ caseRef: string; caseRevision: number; sourceFingerprint: string }>,
    authorityReadiness?: TaxAuthorityReadinessV1,
  ): BrowserTaxWidgetSnapshotV1 {
    const workspaceId = receipt.snapshot.workspaceId;
    const projectionKey = receipt.projectionKey;
    const ref = (purpose: string, value: string): string => (
      this.#references.reference(purpose, workspaceId, projectionKey, value)
    );
    const revision = (prefix: string, purpose: string, value: string): string => (
      this.#references.revision(prefix, purpose, workspaceId, projectionKey, value)
    );
    const sourceRefForId = (value: string): string => ref('source', sourceReferenceSubject(value));
    const sourceRefForWrappedReference = (value: string): string => (
      sourceRefForId(unwrapCoreSourceReference(value))
    );
    const profile = receipt.snapshot.profile;
    const jurisdictionProfileReadiness = projectTaxJurisdictionProfileReadiness(profile);
    const cacheIdentity = {
      version: 'tax-cache-identity-v1' as const,
      projectionKey,
      caseRevision: durable.caseRevision,
      configurationRevision: revision('cfg', 'configuration', receipt.configHash),
      inputRevision: revision(
        'input',
        'input',
        JSON.stringify({ inputHash: receipt.inputHash, evidenceGeneration: receipt.evidenceGeneration }),
      ),
      snapshotRevision: revision(
        'snapshot',
        'snapshot',
        JSON.stringify({ sourceFingerprint: durable.sourceFingerprint, caseRevision: durable.caseRevision }),
      ),
    };
    const sources = receipt.snapshot.sourceCoverage.map(source => ({
      sourceRef: sourceRefForId(source.sourceId),
      kind: source.kind,
      providerDescriptor: {
        providerId: source.providerId === null ? null : ref('provider', source.providerId),
        displayName: safeSourceDisplayName(source.kind),
      },
      state: source.connectionState,
      capabilities: source.capabilities.map(capability => ({ ...capability })),
      lastSuccessfulSyncAt: source.lastSuccessfulSyncAt,
      acceptedEvidenceCount: source.acceptedEvidenceCount,
      needsReviewCount: source.needsReviewCount,
      safeErrorCode: source.safeErrorCode,
    }));
    const conclusions = receipt.snapshot.facts.flatMap(fact => {
      const projected = projectConclusion(fact, {
        ref,
        revision,
        sourceRef: sourceRefForWrappedReference,
      });
      return projected ? [projected] : [];
    });

    return parseBrowserSnapshot({
      version: 'tax-widget-snapshot-v1',
      workspaceId: ref('workspace', workspaceId),
      caseId: durable.caseRef,
      profile: {
        profileRef: ref('profile', profile.profileId),
        profileVersion: ref('profile-version', profile.version),
        jurisdiction: profile.jurisdiction,
        entityType: profile.entityType,
        regimeId: profile.regimeId,
        confirmationState: profile.confirmationState,
        catalogueVersion: ref('catalogue-version', profile.catalogueVersion),
      },
      period: receipt.snapshot.period,
      displayCurrency: receipt.snapshot.displayCurrency,
      taxPosition: {
        state: 'unavailable',
        taxCollected: null,
        taxPaid: null,
        netTaxPosition: null,
        limitationCodes: ['TAX_LIABILITY_RULES_NOT_PROJECTED'],
      },
      activity: {
        grossIncome: receipt.snapshot.metrics.grossIncome,
        supportedExpenses: receipt.snapshot.metrics.supportedExpenses,
      },
      sourceHealth: {
        state: deriveTaxSourceHealthStateV1(sources),
        sources,
      },
      evidenceCoverage: {
        invoicedRevenue: receipt.snapshot.evidenceCoverage.revenue.invoiced,
        reconciledRevenue: receipt.snapshot.evidenceCoverage.revenue.reconciled,
        recordedExpenses: receipt.snapshot.evidenceCoverage.expenses.recorded,
        supportedExpenses: receipt.snapshot.evidenceCoverage.expenses.supported,
        applicableObligations: receipt.snapshot.evidenceCoverage.obligations.applicable,
        mappedObligations: receipt.snapshot.evidenceCoverage.obligations.mapped,
        gaps: receipt.snapshot.evidenceCoverage.gaps.map(gap => ({
          gapRef: ref('gap', gap.id),
          kind: gap.kind,
          severity: gap.severity,
          safeSourceRefs: gap.safeSourceReferenceIds.map(sourceRefForWrappedReference),
          // Actions remain non-authoritative until an explicit policy projection proves them.
          actionId: null,
        })),
      },
      capabilityManifest: {
        ...receipt.snapshot.capabilityManifest,
        reads: receipt.snapshot.capabilityManifest.reads.map(read => ({ ...read })),
        approvalAwareActions: receipt.snapshot.capabilityManifest.approvalAwareActions.map(action => ({
          ...action,
          state: 'policy_blocked' as const,
          actionId: null,
        })),
      },
      obligations: receipt.snapshot.obligations.map(obligation => ({
        obligationRef: ref('obligation', obligation.id),
        kind: taxObligationKindForId(obligation.id),
        title: obligation.title,
        dueAt: obligation.dueAt,
        preparationState: obligation.preparationState,
        submissionState: obligation.submissionState,
        satisfactionState: obligation.satisfactionState,
        actionId: null,
        ruleVersionRefs: obligation.ruleVersionIds
          .filter(ruleVersionId => ruleVersionId.trim().length > 0)
          .map(ruleVersionId => ref('rule-version', ruleVersionId)),
      })),
      filingReadiness: {
        state: deriveFilingReadinessState(receipt.snapshot),
        asOf: receipt.asOf,
        blockingGapRefs: receipt.snapshot.evidenceCoverage.gaps
          .filter(gap => gap.severity === 'blocking')
          .map(gap => ref('gap', gap.id)),
        limitationCodes: receipt.snapshot.evidenceCoverage.gaps.some(
          gap => gap.severity === 'blocking',
        ) ? ['EVIDENCE_GAP_BLOCKING'] : [],
      },
      ...(authorityReadiness ? { authorityReadiness } : {}),
      ...(jurisdictionProfileReadiness ? { jurisdictionProfileReadiness } : {}),
      evidenceTasks: receipt.snapshot.evidenceCoverage.gaps.map(gap => ({
        taskRef: ref('evidence-task', gap.id),
        title: evidenceTaskTitle(gap.kind),
        state: gap.severity === 'blocking' ? ('blocked' as const) : ('open' as const),
        actor: evidenceTaskActor(gap.kind),
        asOf: receipt.asOf,
        safeEvidenceRefs: gap.safeSourceReferenceIds.map(sourceRefForWrappedReference),
        // Task execution stays unavailable until an explicit policy descriptor authorizes it.
        actionId: null,
        limitationCodes: gap.severity === 'blocking' ? ['EVIDENCE_TASK_BLOCKING'] : [],
      })),
      accountantPacket: {
        state: 'unavailable',
        packetRef: null,
        generatedAt: null,
        safeEvidenceRefs: [],
        actionId: null,
        limitationCodes: ['ACCOUNTANT_PACKET_NOT_PROJECTED'],
      },
      planningForecast: {
        state: 'unavailable',
        horizon: receipt.snapshot.period,
        asOf: receipt.asOf,
        lowerBound: null,
        upperBound: null,
        safeSourceRefs: [],
        limitationCodes: ['TAX_FORECAST_NOT_PROJECTED'],
        planningOnly: true,
      },
      supplementalEvidenceQuality: {
        ...projectEvidenceQuality(receipt.snapshot.evidenceQuality, {
          ref,
          revision,
          sourceRef: sourceRefForWrappedReference,
        }, receipt.asOf),
      },
      authorizedNextActions: [],
      conclusions,
      warnings: [
        'Tax liability remains unavailable until deterministic jurisdiction rules are projected.',
      ],
      cacheIdentity,
    });
  }
}

function projectEvidenceQuality(
  quality: CoreTaxWidgetSnapshotReceiptV1['snapshot']['evidenceQuality'] | undefined,
  references: Readonly<{
    ref: (purpose: string, value: string) => string;
    revision: (prefix: string, purpose: string, value: string) => string;
    sourceRef: (value: string) => string;
  }>,
  fallbackAsOf: string,
): NonNullable<BrowserTaxWidgetSnapshotV1['supplementalEvidenceQuality']> {
  if (!quality) {
    return {
      version: 'tax-evidence-quality-v1',
      purpose: 'tax_evidence_quality',
      state: 'unknown',
      asOf: fallbackAsOf,
      validUntil: null,
      safeSourceRefs: [],
      limitationCodes: ['TAX_EVIDENCE_QUALITY_NOT_PROJECTED'],
      use: 'tax_evidence_only',
      affectsCredit: false,
      affectsFactoring: false,
    };
  }
  const base = {
    version: quality.version,
    purpose: quality.purpose,
    asOf: quality.asOf,
    validUntil: quality.validUntil,
    safeSourceRefs: quality.safeSourceReferenceIds.map(references.sourceRef),
    limitationCodes: [...quality.limitationCodes],
    use: 'tax_evidence_only' as const,
    affectsCredit: false as const,
    affectsFactoring: false as const,
  };
  if (quality.state !== 'ready') return { ...base, state: quality.state };
  return {
    ...base,
    state: 'ready',
    value: quality.value,
    band: quality.band,
    dimensions: quality.dimensions.map(dimension => ({
      id: dimension.id,
      score: dimension.score,
      weight: dimension.weight,
      safeSourceRefs: dimension.safeSourceReferenceIds.map(references.sourceRef),
      safeRevisionRefs: dimension.safeRevisionReferenceIds.map(value => references.revision(
        'evidence',
        'evidence-quality-source-revision',
        value,
      )),
      bindingState: dimension.bindingState,
      freshnessState: dimension.freshnessState,
      reviewState: dimension.reviewState,
      supersessionState: dimension.supersessionState,
      limitationCodes: [...dimension.limitationCodes],
      ruleVersion: references.ref('evidence-quality-rule-version', dimension.ruleVersion),
    })),
    reasonCodes: [...quality.reasonCodes],
    authorizedActionIds: [...quality.authorizedActionIds],
    consentVersion: references.ref('evidence-quality-consent-version', quality.consentVersion),
    consentScopeRevision: references.revision(
      'consent',
      'evidence-quality-consent-scope',
      quality.consentScopeHash,
    ),
  };
}

function deriveFilingReadinessState(
  snapshot: CoreTaxWidgetSnapshotReceiptV1['snapshot'],
): NonNullable<BrowserTaxWidgetSnapshotV1['filingReadiness']>['state'] {
  if (snapshot.evidenceCoverage.gaps.some(gap => gap.severity === 'blocking')) return 'blocked';
  if (snapshot.obligations.length > 0 && snapshot.obligations.every(obligation => (
    obligation.submissionState === 'accepted'
    && obligation.satisfactionState === 'satisfied'
  ))) return 'complete';
  if (snapshot.obligations.some(obligation => (
    obligation.submissionState === 'submitted'
    || obligation.submissionState === 'authority_receipt_pending'
  ))) return 'submitted';
  if (snapshot.obligations.length > 0 && snapshot.obligations.every(obligation => (
    obligation.preparationState === 'accountant_approved'
    && obligation.submissionState === 'ready_for_submission'
  ))) return 'ready_for_submission';
  if (snapshot.obligations.some(obligation => (
    obligation.preparationState === 'ready_for_review'
    || obligation.preparationState === 'under_accountant_review'
    || obligation.preparationState === 'changes_requested'
  ))) return 'accountant_review';
  return 'in_progress';
}

function evidenceTaskTitle(kind: string): string {
  const normalized = kind.replace(/[_-]+/g, ' ').trim();
  return `Resolve evidence gap: ${normalized || 'review required'}`.slice(0, 200);
}

function evidenceTaskActor(
  kind: string,
): NonNullable<BrowserTaxWidgetSnapshotV1['evidenceTasks']>[number]['actor'] {
  return /(accounting|ledger|erp|classification|entity)/i.test(kind) ? 'accountant' : 'user';
}

export class TaxBrowserSnapshotService {
  constructor(
    private readonly store: TaxProfileStore,
    private readonly snapshots: SnapshotReader,
    private readonly projector: TaxBrowserSnapshotProjector | null,
    private readonly now: () => Date = () => new Date(),
  ) {}

  read(workspaceId: string, projectionKey?: string): TaxBrowserSnapshotRead {
    const normalizedProjectionKey = normalizeTaxSnapshotProjectionKey(projectionKey);
    if (!this.projector) throw new Error('TAX_ENGINE_BROWSER_REFERENCE_HMAC_SECRET_CONFIGURATION_REQUIRED');
    try {
      const internal = this.snapshots.latestSnapshot(workspaceId, normalizedProjectionKey);
      const checkedAt = this.now().toISOString();
      if (internal.expiresAt !== null && Date.parse(checkedAt) >= Date.parse(internal.expiresAt)) {
        return problemRead('TAX_SNAPSHOT_EXPIRED');
      }
      const isArgentina = internal.snapshot.profile.jurisdiction === 'AR';
      const authorityReadiness = projectArcaAuthorityReadiness(
        internal.snapshot.profile.jurisdiction,
        workspaceId,
        internal.asOf,
        isArgentina ? this.store.listArcaOnboardingRuns(workspaceId) : [],
      );
      const sourceFingerprint = this.projector.sourceFingerprint(internal, authorityReadiness);
      const stamped = this.store.stampBrowserTaxSnapshot({
        receipt: internal,
        sourceFingerprint,
        caseRef: this.projector.caseReference(workspaceId, normalizedProjectionKey),
        assertSourceCurrent: () => {
          const currentAuthorityReadiness = projectArcaAuthorityReadiness(
            internal.snapshot.profile.jurisdiction,
            workspaceId,
            internal.asOf,
            isArgentina ? this.store.listArcaOnboardingRuns(workspaceId) : [],
          );
          if (this.projector!.sourceFingerprint(internal, currentAuthorityReadiness)
            !== sourceFingerprint) {
            throw new Error('TAX_EVIDENCE_GENERATION_CONFLICT');
          }
        },
        buildSnapshot: durable => this.projector!.project(internal, {
          ...durable,
          sourceFingerprint,
        }, authorityReadiness),
      });
      const receipt = parseBrowserReceipt({
        version: 'tax-browser-snapshot-receipt-v1',
        projectionKey: normalizedProjectionKey,
        generatedAt: internal.generatedAt,
        asOf: internal.asOf,
        expiresAt: internal.expiresAt,
        validity: { state: 'current', checkedAt },
        cacheIdentity: stamped.snapshot.cacheIdentity,
        snapshot: stamped.snapshot,
      });
      return {
        status: 200,
        result: parseBrowserReadResult({ ok: true, data: receipt }),
      };
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      if (isBrowserSnapshotProblemCode(code)) return problemRead(code);
      throw new Error('Tax browser snapshot read failed closed');
    }
  }
}

function projectConclusion(
  fact: TaxConclusionEnvelopeV1<unknown>,
  scope: Readonly<{
    ref: (purpose: string, value: string) => string;
    revision: (prefix: string, purpose: string, value: string) => string;
    sourceRef: (value: string) => string;
  }>,
): BrowserTaxWidgetSnapshotV1['conclusions'][number] | null {
  if (fact.confidence.derivation === 'ai_candidate') return null;
  const value = safeFactValue(fact.value);
  if (!value) return null;
  return {
    conclusionRef: scope.ref('conclusion', fact.conclusionId),
    kind: value.kind,
    safeDisplayValue: value.safeDisplayValue,
    period: fact.period,
    sourceRefs: fact.sourceReferenceIds
      .filter(value => value.startsWith('source:'))
      .map(scope.sourceRef),
    freshness: fact.freshness.state,
    confidence: fact.confidence.level,
    derivation: fact.confidence.derivation,
    consentScopeRevision: fact.consent.scopeHash === null
      ? null
      : scope.revision('consent', 'consent-scope', fact.consent.scopeHash),
    evidenceRevision: scope.revision('evidence', 'evidence', fact.evidenceHash),
    accountantReviewState: fact.accountantReview.state,
    ruleVersions: fact.ruleVersionIds.map(value => scope.ref('rule-version', value)),
    limitations: [...fact.limitations],
  };
}

function safeFactValue(value: unknown): Readonly<{
  kind: string;
  safeDisplayValue: string | boolean | null;
}> | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (typeof record.kind !== 'string') return null;
  if (record.safeDisplayValue !== null
    && typeof record.safeDisplayValue !== 'string'
    && typeof record.safeDisplayValue !== 'boolean') return null;
  return { kind: record.kind, safeDisplayValue: record.safeDisplayValue } as const;
}

function unwrapCoreSourceReference(value: string): string {
  if (!value.startsWith('source:')) {
    throw new Error('Tax browser source reference is not canonical');
  }
  return value.slice('source:'.length);
}

function sourceReferenceSubject(sourceId: string): string {
  // Namespace raw IDs before hashing. Without this tag, a raw source ID such
  // as `source:bank` aliases the canonical wrapped reference for raw `bank`.
  return `source-id:${sourceId}`;
}

function safeSourceDisplayName(kind: CoreTaxWidgetSnapshotReceiptV1['snapshot']['sourceCoverage'][number]['kind']): string {
  return ({
    bank: 'Bank source',
    wallet: 'Wallet source',
    crypto: 'Crypto source',
    stripe: 'Stripe source',
    fx: 'FX source',
    payroll: 'Payroll source',
    bufi_invoice: 'Invoice source',
    bufi_bill: 'Bill source',
    accounting: 'Accounting source',
    magic_inbox: 'Magic Inbox source',
    transaction_enrichment: 'Transaction enrichment',
    knowledge_graph: 'Knowledge graph',
    financial_analytics: 'Financial analytics',
    unknown: 'Financial source',
  } as const)[kind];
}

function problemRead(code: TaxSnapshotProblemCodeV1): TaxBrowserSnapshotRead {
  const problem = buildTaxSnapshotProblemV1(code);
  return {
    status: problem.status,
    result: parseBrowserReadResult({ ok: false, problem }),
  };
}

function isBrowserSnapshotProblemCode(code: string): code is TaxSnapshotProblemCodeV1 {
  return BROWSER_SNAPSHOT_PROBLEM_CODES.has(code as TaxSnapshotProblemCodeV1);
}

function parseBrowserSnapshot(value: unknown): BrowserTaxWidgetSnapshotV1 {
  try {
    return taxWidgetSnapshotV1Schema.parse(value);
  } catch {
    throw new Error('Tax browser snapshot projection failed schema validation');
  }
}

function parseBrowserReceipt(value: unknown): BrowserTaxWidgetSnapshotReceiptV1 {
  try {
    return taxWidgetSnapshotReceiptV1Schema.parse(value);
  } catch {
    throw new Error('Tax browser snapshot receipt failed schema validation');
  }
}

function parseBrowserReadResult(value: unknown): TaxSnapshotReadResultV1 {
  try {
    return taxSnapshotReadResultV1Schema.parse(value);
  } catch {
    throw new Error('Tax browser snapshot read result failed schema validation');
  }
}

class TaxBrowserReferenceScope {
  constructor(private readonly secret: string) {}

  reference(purpose: string, workspaceId: string, projectionKey: string, value: string): string {
    return `${safePrefix(purpose)}:${this.digest(purpose, workspaceId, projectionKey, value)}`;
  }

  revision(
    prefix: string,
    purpose: string,
    workspaceId: string,
    projectionKey: string,
    value: string,
  ): string {
    return `${safePrefix(prefix)}:${this.digest(purpose, workspaceId, projectionKey, value)}`;
  }

  digest(purpose: string, workspaceId: string, projectionKey: string, value: string): string {
    return createHmac('sha256', this.secret)
      .update(JSON.stringify([
        'tax-browser-reference-v1',
        purpose,
        workspaceId,
        projectionKey,
        value,
      ]), 'utf8')
      .digest('base64url');
  }
}

function safePrefix(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 31);
  if (!/^[a-z][a-z0-9_]{0,30}$/.test(normalized)) throw new Error('Tax browser reference purpose is invalid');
  return normalized;
}
