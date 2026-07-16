import type { Period, TaxProfile } from './types';

export const ARGENTINA_SERVICE_RULES = [
  { ruleId: 'ar-mipyme-f1272-2026-v1', effectiveFrom: '2026-01-01', sourceUrl: 'https://www.argentina.gob.ar/produccion/registrar-una-pyme', title: 'Registro y Certificado MiPyME · F.1272' },
  { ruleId: 'ar-knowledge-economy-f1278-v1', effectiveFrom: '2022-01-01', sourceUrl: 'https://www.argentina.gob.ar/servicio/acceder-los-beneficios-del-regimen-de-promocion-de-la-economia-del-conocimiento', title: 'Régimen de Economía del Conocimiento · F.1278/TAD' },
  { ruleId: 'bufi-income-certification-entitlement-v1', effectiveFrom: '2026-01-01', sourceUrl: 'https://bufi.finance/policies/income-certification', title: 'BUFI income-certification subscription entitlement' },
  { ruleId: 'ar-growth-path-review-v1', effectiveFrom: '2026-01-01', sourceUrl: 'https://www.arca.gob.ar/monotributo/ayuda/exclusion.asp', title: 'ARCA Monotributo exclusion and general-regime path' },
] as const;

export type ArgentinaServiceType = 'mipyme' | 'knowledge_economy' | 'income_certification' | 'growth_path';

export type ArgentinaServiceCaseV1 = Readonly<{
  version: 'argentina-service-case-v1';
  caseId: string;
  workspaceId: string;
  serviceType: ArgentinaServiceType;
  profileVersion: string;
  regimeId: string;
  entityType: string;
  subdivision: string | null;
  period: Period;
  sourceRuleIds: readonly string[];
  eligibility: 'needs_professional_review' | 'eligible_for_preparation' | 'ineligible';
  requirements: readonly Readonly<{
    requirementId: string;
    label: string;
    state: 'missing' | 'accepted' | 'not_applicable';
    evidenceIds: readonly string[];
  }>[];
  preparationState: 'not_started' | 'in_progress' | 'ready_for_review';
  reviewState: 'not_requested' | 'under_review' | 'approved' | 'rejected';
  submissionState: 'not_submitted' | 'submitted';
  verificationState: 'unverified' | 'verified' | 'rejected';
  submittedArtifactHash: string | null;
  verifiedArtifactHash: string | null;
}>;

export type ArgentinaServiceCommand =
  | Readonly<{ kind: 'accept_evidence'; requirementId: string; evidenceId: string }>
  | Readonly<{ kind: 'mark_not_applicable'; requirementId: string }>
  | Readonly<{ kind: 'request_review' }>
  | Readonly<{ kind: 'approve_review' }>
  | Readonly<{ kind: 'reject_review' }>
  | Readonly<{ kind: 'record_submission'; artifactHash: string }>
  | Readonly<{ kind: 'record_verification'; artifactHash: string; accepted: boolean }>;

export type ArgentinaServiceCaseInput = Readonly<{
  caseId: string;
  profile: TaxProfile;
  serviceType: ArgentinaServiceType;
  period: Period;
  subscriptionStartedAt?: string | null;
  asOf: string;
}>;

export function createArgentinaServiceCase(input: ArgentinaServiceCaseInput): ArgentinaServiceCaseV1 {
  if (input.profile.jurisdiction !== 'AR') throw new Error('ARGENTINA_SERVICE_PROFILE_REQUIRED');
  const definition = SERVICE_DEFINITIONS[input.serviceType];
  let eligibility: ArgentinaServiceCaseV1['eligibility'] = 'needs_professional_review';
  if (input.serviceType === 'mipyme') eligibility = 'eligible_for_preparation';
  if (input.serviceType === 'knowledge_economy') {
    eligibility = input.profile.entityType === 'company' ? 'eligible_for_preparation' : 'ineligible';
  }
  if (input.serviceType === 'income_certification') {
    eligibility = incomeCertificationEligible(input.subscriptionStartedAt ?? null, input.asOf)
      ? 'eligible_for_preparation'
      : 'ineligible';
  }
  return {
    version: 'argentina-service-case-v1',
    caseId: input.caseId,
    workspaceId: input.profile.workspaceId,
    serviceType: input.serviceType,
    profileVersion: input.profile.version,
    regimeId: input.profile.regimeId,
    entityType: input.profile.entityType,
    subdivision: input.profile.formationSubdivision,
    period: input.period,
    sourceRuleIds: definition.ruleIds,
    eligibility,
    requirements: definition.requirements.map(requirement => ({ ...requirement, state: 'missing', evidenceIds: [] })),
    preparationState: 'not_started',
    reviewState: 'not_requested',
    submissionState: 'not_submitted',
    verificationState: 'unverified',
    submittedArtifactHash: null,
    verifiedArtifactHash: null,
  };
}

export function applyArgentinaServiceCommand(serviceCase: ArgentinaServiceCaseV1, command: ArgentinaServiceCommand): ArgentinaServiceCaseV1 {
  if (serviceCase.eligibility === 'ineligible') throw new Error('ARGENTINA_SERVICE_CASE_INELIGIBLE');
  if (command.kind === 'accept_evidence' || command.kind === 'mark_not_applicable') {
    if (serviceCase.reviewState !== 'not_requested') throw new Error('ARGENTINA_SERVICE_EVIDENCE_FROZEN');
    let found = false;
    const requirements = serviceCase.requirements.map(requirement => {
      if (requirement.requirementId !== command.requirementId) return requirement;
      found = true;
      if (command.kind === 'mark_not_applicable') return { ...requirement, state: 'not_applicable' as const };
      if (!command.evidenceId) throw new Error('ARGENTINA_SERVICE_EVIDENCE_ID_REQUIRED');
      return { ...requirement, state: 'accepted' as const, evidenceIds: [...new Set([...requirement.evidenceIds, command.evidenceId])].sort() };
    });
    if (!found) throw new Error('ARGENTINA_SERVICE_REQUIREMENT_NOT_FOUND');
    return { ...serviceCase, requirements, preparationState: requirements.every(requirement => requirement.state !== 'missing') ? 'ready_for_review' : 'in_progress' };
  }
  if (command.kind === 'request_review') {
    if (serviceCase.preparationState !== 'ready_for_review' || serviceCase.reviewState !== 'not_requested') throw new Error('ARGENTINA_SERVICE_NOT_READY_FOR_REVIEW');
    return { ...serviceCase, reviewState: 'under_review' };
  }
  if (command.kind === 'approve_review' || command.kind === 'reject_review') {
    if (serviceCase.reviewState !== 'under_review') throw new Error('ARGENTINA_SERVICE_REVIEW_NOT_STARTED');
    return { ...serviceCase, reviewState: command.kind === 'approve_review' ? 'approved' : 'rejected' };
  }
  if (command.kind === 'record_submission') {
    if (serviceCase.reviewState !== 'approved') throw new Error('ARGENTINA_SERVICE_SUBMISSION_NOT_APPROVED');
    if (!hash(command.artifactHash)) throw new Error('ARGENTINA_SERVICE_ARTIFACT_HASH_INVALID');
    return { ...serviceCase, submissionState: 'submitted', submittedArtifactHash: command.artifactHash };
  }
  if (serviceCase.submissionState !== 'submitted') throw new Error('ARGENTINA_SERVICE_NOT_SUBMITTED');
  if (!hash(command.artifactHash)) throw new Error('ARGENTINA_SERVICE_ARTIFACT_HASH_INVALID');
  return { ...serviceCase, verificationState: command.accepted ? 'verified' : 'rejected', verifiedArtifactHash: command.artifactHash };
}

export type RegulatoryRuleProposalV1 = Readonly<{
  version: 'regulatory-rule-proposal-v1';
  proposalId: string;
  jurisdiction: 'AR';
  sourceUrl: string;
  publicationDate: string;
  effectiveFrom: string;
  priorRuleVersionId: string | null;
  proposedRuleVersionId: string;
  impactedRegimeIds: readonly string[];
  impactedSubdivisions: readonly string[];
  summary: string;
  affectedCaseIds: readonly string[];
  state: 'proposed' | 'reviewed_no_impact' | 'reviewed_impact' | 'approved';
  reviewerActorId: string | null;
}>;

export function proposeRegulatoryRuleImpact(
  input: Omit<RegulatoryRuleProposalV1, 'version' | 'affectedCaseIds' | 'state' | 'reviewerActorId'>,
  cases: readonly ArgentinaServiceCaseV1[],
): RegulatoryRuleProposalV1 {
  const source = officialRegulatorySource(input.sourceUrl);
  if (!source) throw new Error('REGULATORY_SOURCE_NOT_OFFICIAL');
  const affectedCaseIds = cases.filter(serviceCase => {
    if (!input.impactedRegimeIds.includes(serviceCase.regimeId)) return false;
    if (input.impactedSubdivisions.length > 0 && (!serviceCase.subdivision || !input.impactedSubdivisions.includes(serviceCase.subdivision))) return false;
    return rangesOverlap(serviceCase.period, { start: input.effectiveFrom, end: '9999-12-31' });
  }).map(serviceCase => serviceCase.caseId).sort();
  return { ...input, version: 'regulatory-rule-proposal-v1', affectedCaseIds, state: 'proposed', reviewerActorId: null };
}

export function reviewRegulatoryRuleProposal(proposal: RegulatoryRuleProposalV1, reviewerActorId: string, approve: boolean): RegulatoryRuleProposalV1 {
  if (proposal.state !== 'proposed') throw new Error('REGULATORY_PROPOSAL_ALREADY_REVIEWED');
  if (!reviewerActorId) throw new Error('REGULATORY_REVIEWER_REQUIRED');
  if (approve) return { ...proposal, state: 'approved', reviewerActorId };
  return { ...proposal, state: proposal.affectedCaseIds.length === 0 ? 'reviewed_no_impact' : 'reviewed_impact', reviewerActorId };
}

function incomeCertificationEligible(subscriptionStartedAt: string | null, asOf: string): boolean {
  if (!subscriptionStartedAt) return false;
  const start = new Date(subscriptionStartedAt);
  const current = new Date(asOf);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(current.getTime())) throw new Error('ARGENTINA_SERVICE_TIMESTAMP_INVALID');
  start.setUTCMonth(start.getUTCMonth() + 3);
  return current.getTime() >= start.getTime();
}

function rangesOverlap(left: Period, right: Period): boolean {
  return left.start <= right.end && right.start <= left.end;
}

function hash(value: string): boolean {
  return /^[a-f0-9]{64}$/.test(value);
}

function officialRegulatorySource(value: string): boolean {
  let hostname: string;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return false;
    hostname = url.hostname.toLowerCase();
  } catch {
    return false;
  }
  return ['arca.gob.ar', 'argentina.gob.ar', 'bcra.gob.ar', 'agip.gob.ar', 'arba.gov.ar']
    .some(domain => hostname === domain || hostname.endsWith(`.${domain}`));
}

const SERVICE_DEFINITIONS: Readonly<Record<ArgentinaServiceType, Readonly<{
  ruleIds: readonly string[];
  requirements: readonly Readonly<{ requirementId: string; label: string }>[];
}>>> = {
  mipyme: {
    ruleIds: ['ar-mipyme-f1272-2026-v1'],
    requirements: [
      { requirementId: 'f1272', label: 'F.1272 readiness or renewal review' },
      { requirementId: 'tax-filings', label: 'Required tax and social-security filings' },
      { requirementId: 'activity-and-sales', label: 'Activity, sales, employment and export evidence' },
      { requirementId: 'ownership', label: 'Ownership and related-company evidence' },
    ],
  },
  knowledge_economy: {
    ruleIds: ['ar-knowledge-economy-f1278-v1'],
    requirements: [
      { requirementId: 'f1278', label: 'F.1278 preparation evidence' },
      { requirementId: 'promoted-activity', label: 'Promoted-activity and revenue evidence' },
      { requirementId: 'personnel-payroll', label: 'Personnel, payroll and training evidence' },
      { requirementId: 'invoices-exports', label: 'Invoice and export evidence' },
      { requirementId: 'tad-packet', label: 'TAD declarations and representation evidence' },
    ],
  },
  income_certification: {
    ruleIds: ['bufi-income-certification-entitlement-v1'],
    requirements: [
      { requirementId: 'subscription-entitlement', label: 'Three-month subscription entitlement' },
      { requirementId: 'income-ledger', label: 'Reconciled income evidence period' },
      { requirementId: 'tax-profile', label: 'Confirmed tax profile' },
      { requirementId: 'accountant-signature', label: 'Accountant signature packet' },
    ],
  },
  growth_path: {
    ruleIds: ['ar-growth-path-review-v1'],
    requirements: [
      { requirementId: 'rolling-revenue', label: 'Rolling revenue and category evidence' },
      { requirementId: 'tax-debt', label: 'Tax status and debt evidence' },
      { requirementId: 'entity-options', label: 'RI/company formation option review' },
      { requirementId: 'professional-handoff', label: 'Accountant/legal handoff' },
    ],
  },
};
