import type { Period, TaxProfile } from './types';

export const ARGENTINA_SERVICE_RULES = [
  { ruleId: 'ar-mipyme-f1272-2026-v1', effectiveFrom: '2026-01-01', sourceUrl: 'https://www.argentina.gob.ar/produccion/registrar-una-pyme/certificado-pyme', title: 'Registro y Certificado MiPyME · F.1272' },
  { ruleId: 'ar-knowledge-economy-f1278-v1', effectiveFrom: '2022-01-01', sourceUrl: 'https://www.argentina.gob.ar/servicio/acceder-los-beneficios-del-regimen-de-promocion-de-la-economia-del-conocimiento', title: 'Régimen de Economía del Conocimiento · F.1278/TAD' },
  { ruleId: 'bufi-income-certification-entitlement-v1', effectiveFrom: '2026-01-01', sourceUrl: 'https://bufi.finance/policies/income-certification', title: 'BUFI income-certification subscription entitlement' },
  { ruleId: 'ar-growth-path-review-v1', effectiveFrom: '2026-01-01', sourceUrl: 'https://www.arca.gob.ar/monotributo/ayuda/exclusion.asp', title: 'ARCA Monotributo exclusion and general-regime path' },
] as const;

export type ArgentinaServiceType = 'mipyme' | 'knowledge_economy' | 'income_certification' | 'growth_path';

export type ArgentinaServiceCaseV2 = Readonly<{
  version: 'argentina-service-case-v2';
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
    exception: Readonly<{ reason: string; approvedByActorId: string; recordedAt: string }> | null;
  }>[];
  preparationState: 'not_started' | 'in_progress' | 'ready_for_review';
  reviewState: 'not_requested' | 'under_review' | 'approved' | 'rejected';
  submissionState: 'not_submitted' | 'submitted';
  verificationState: 'unverified' | 'verified' | 'rejected';
  submittedArtifactHash: string | null;
  verifiedArtifactHash: string | null;
  benefitState: 'not_applicable' | 'not_verified' | 'active' | 'rejected';
  benefitArtifactHash: string | null;
  benefitValidFrom: string | null;
  benefitValidUntil: string | null;
  artifactHistory: readonly ArgentinaServiceArtifactV2[];
  serviceResultState: 'not_applicable' | 'not_issued' | 'issued' | 'rejected';
  serviceResultArtifactHash: string | null;
  serviceResultValidUntil: string | null;
}>;

export type ArgentinaServiceArtifactV2 = Readonly<{
  stage: 'submission' | 'authority_verification' | 'benefit_decision' | 'benefit_renewal' | 'service_result';
  artifactHash: string;
  recordedAt: string;
  accepted: boolean | null;
  sourceUrl: string | null;
  validFrom: string | null;
  validUntil: string | null;
}>;

export type ArgentinaServiceCommand =
  | Readonly<{ kind: 'accept_evidence'; requirementId: string; evidenceId: string }>
  | Readonly<{ kind: 'mark_not_applicable'; requirementId: string; reason: string; approvedByActorId: string; recordedAt: string }>
  | Readonly<{ kind: 'request_review' }>
  | Readonly<{ kind: 'approve_review' }>
  | Readonly<{ kind: 'reject_review' }>
  | Readonly<{ kind: 'record_submission'; artifactHash: string; recordedAt: string }>
  | Readonly<{ kind: 'record_verification'; artifactHash: string; accepted: boolean; recordedAt: string; sourceUrl: string }>
  | Readonly<{ kind: 'record_benefit'; artifactHash: string; accepted: boolean; recordedAt: string; sourceUrl: string; validFrom: string | null; validUntil: string | null }>
  | Readonly<{ kind: 'record_benefit_renewal'; verificationArtifactHash: string; benefitArtifactHash: string; recordedAt: string; sourceUrl: string; validFrom: string; validUntil: string }>
  | Readonly<{ kind: 'record_service_result'; artifactHash: string; accepted: boolean; recordedAt: string; validUntil: string | null }>;

export type ArgentinaServiceCaseInput = Readonly<{
  caseId: string;
  profile: TaxProfile;
  serviceType: ArgentinaServiceType;
  period: Period;
  subscriptionStartedAt?: string | null;
  subscriptionEntitlementMonths?: number;
  asOf: string;
}>;

export function createArgentinaServiceCase(input: ArgentinaServiceCaseInput): ArgentinaServiceCaseV2 {
  if (input.profile.jurisdiction !== 'AR') throw new Error('ARGENTINA_SERVICE_PROFILE_REQUIRED');
  const definition = SERVICE_DEFINITIONS[input.serviceType];
  let eligibility: ArgentinaServiceCaseV2['eligibility'] = 'needs_professional_review';
  if (input.serviceType === 'mipyme') eligibility = 'eligible_for_preparation';
  if (input.serviceType === 'knowledge_economy') {
    eligibility = input.profile.entityType === 'company' ? 'eligible_for_preparation' : 'ineligible';
  }
  if (input.serviceType === 'income_certification') {
    eligibility = incomeCertificationEligible(input.subscriptionStartedAt ?? null, input.asOf, input.subscriptionEntitlementMonths ?? 3)
      ? 'eligible_for_preparation'
      : 'ineligible';
  }
  return {
    version: 'argentina-service-case-v2',
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
    requirements: definition.requirements.map(requirement => ({ ...requirement, state: 'missing', evidenceIds: [], exception: null })),
    preparationState: 'not_started',
    reviewState: 'not_requested',
    submissionState: 'not_submitted',
    verificationState: 'unverified',
    submittedArtifactHash: null,
    verifiedArtifactHash: null,
    benefitState: input.serviceType === 'mipyme' || input.serviceType === 'knowledge_economy' ? 'not_verified' : 'not_applicable',
    benefitArtifactHash: null,
    benefitValidFrom: null,
    benefitValidUntil: null,
    artifactHistory: [],
    serviceResultState: input.serviceType === 'income_certification' ? 'not_issued' : 'not_applicable',
    serviceResultArtifactHash: null,
    serviceResultValidUntil: null,
  };
}

export function applyArgentinaServiceCommand(serviceCase: ArgentinaServiceCaseV2, command: ArgentinaServiceCommand): ArgentinaServiceCaseV2 {
  if (serviceCase.eligibility === 'ineligible') throw new Error('ARGENTINA_SERVICE_CASE_INELIGIBLE');
  if (command.kind === 'accept_evidence' || command.kind === 'mark_not_applicable') {
    if (serviceCase.reviewState !== 'not_requested') throw new Error('ARGENTINA_SERVICE_EVIDENCE_FROZEN');
    let found = false;
    const requirements = serviceCase.requirements.map(requirement => {
      if (requirement.requirementId !== command.requirementId) return requirement;
      found = true;
      if (command.kind === 'mark_not_applicable') {
        if (!command.reason.trim() || !command.approvedByActorId) throw new Error('ARGENTINA_SERVICE_EXCEPTION_APPROVAL_REQUIRED');
        serviceInstant(command.recordedAt);
        return {
          ...requirement,
          state: 'not_applicable' as const,
          exception: { reason: command.reason.trim(), approvedByActorId: command.approvedByActorId, recordedAt: command.recordedAt },
        };
      }
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
    serviceInstant(command.recordedAt);
    const artifact = {
      stage: 'submission' as const, artifactHash: command.artifactHash, recordedAt: command.recordedAt,
      accepted: null, sourceUrl: null, validFrom: null, validUntil: null,
    };
    if (serviceCase.submissionState === 'submitted') {
      if (serviceCase.submittedArtifactHash !== command.artifactHash) throw new Error('ARGENTINA_SERVICE_SUBMISSION_CONFLICT');
      appendArtifact(serviceCase.artifactHistory, artifact);
      return serviceCase;
    }
    return {
      ...serviceCase,
      submissionState: 'submitted',
      submittedArtifactHash: command.artifactHash,
      artifactHistory: appendArtifact(serviceCase.artifactHistory, artifact),
    };
  }
  if (command.kind === 'record_benefit_renewal') {
    if (serviceCase.benefitState !== 'active') throw new Error('ARGENTINA_SERVICE_BENEFIT_NOT_ACTIVE');
    if (!hash(command.verificationArtifactHash) || !hash(command.benefitArtifactHash)) throw new Error('ARGENTINA_SERVICE_ARTIFACT_HASH_INVALID');
    const recordedAt = serviceInstant(command.recordedAt);
    const validFrom = serviceInstant(command.validFrom);
    const validUntil = serviceInstant(command.validUntil);
    if (!officialRegulatorySource(command.sourceUrl)) throw new Error('ARGENTINA_SERVICE_AUTHORITY_SOURCE_REQUIRED');
    if (validFrom > validUntil || recordedAt > validUntil) throw new Error('ARGENTINA_SERVICE_BENEFIT_VALIDITY_INVALID');
    const verification = {
      stage: 'authority_verification' as const, artifactHash: command.verificationArtifactHash,
      recordedAt: command.recordedAt, accepted: true, sourceUrl: command.sourceUrl, validFrom: null, validUntil: null,
    };
    const benefit = {
      stage: 'benefit_renewal' as const, artifactHash: command.benefitArtifactHash,
      recordedAt: command.recordedAt, accepted: true, sourceUrl: command.sourceUrl,
      validFrom: command.validFrom, validUntil: command.validUntil,
    };
    if (serviceCase.benefitArtifactHash === command.benefitArtifactHash && serviceCase.benefitValidFrom === command.validFrom && serviceCase.benefitValidUntil === command.validUntil) {
      appendArtifact(serviceCase.artifactHistory, verification);
      appendArtifact(serviceCase.artifactHistory, benefit);
      return serviceCase;
    }
    if (serviceCase.benefitValidUntil && validFrom <= serviceInstant(serviceCase.benefitValidUntil)) throw new Error('ARGENTINA_SERVICE_RENEWAL_OVERLAP');
    return {
      ...serviceCase,
      benefitArtifactHash: command.benefitArtifactHash,
      benefitValidFrom: command.validFrom,
      benefitValidUntil: command.validUntil,
      artifactHistory: appendArtifact(appendArtifact(serviceCase.artifactHistory, verification), benefit),
    };
  }
  if (command.kind === 'record_benefit') {
    if (serviceCase.benefitState === 'not_applicable') throw new Error('ARGENTINA_SERVICE_BENEFIT_NOT_APPLICABLE');
    if (serviceCase.verificationState !== 'verified') throw new Error('ARGENTINA_SERVICE_BENEFIT_NOT_VERIFIED');
    if (!hash(command.artifactHash)) throw new Error('ARGENTINA_SERVICE_ARTIFACT_HASH_INVALID');
    if (command.accepted && command.validUntil === null) throw new Error('ARGENTINA_SERVICE_BENEFIT_VALIDITY_REQUIRED');
    const recordedAt = serviceInstant(command.recordedAt);
    if (!officialRegulatorySource(command.sourceUrl)) throw new Error('ARGENTINA_SERVICE_AUTHORITY_SOURCE_REQUIRED');
    const validFrom = command.validFrom === null ? null : serviceInstant(command.validFrom);
    const validUntil = command.validUntil === null ? null : serviceInstant(command.validUntil);
    if (command.accepted && validFrom === null) throw new Error('ARGENTINA_SERVICE_BENEFIT_VALIDITY_REQUIRED');
    if (validFrom !== null && validUntil !== null && (validFrom > validUntil || recordedAt > validUntil)) throw new Error('ARGENTINA_SERVICE_BENEFIT_VALIDITY_INVALID');
    const artifact = {
      stage: 'benefit_decision' as const, artifactHash: command.artifactHash, recordedAt: command.recordedAt,
      accepted: command.accepted, sourceUrl: command.sourceUrl, validFrom: command.validFrom, validUntil: command.validUntil,
    };
    if (serviceCase.benefitState !== 'not_verified') {
      if (serviceCase.benefitArtifactHash !== command.artifactHash || serviceCase.benefitValidFrom !== command.validFrom || serviceCase.benefitValidUntil !== command.validUntil || serviceCase.benefitState !== (command.accepted ? 'active' : 'rejected')) throw new Error('ARGENTINA_SERVICE_BENEFIT_CONFLICT');
      appendArtifact(serviceCase.artifactHistory, artifact);
      return serviceCase;
    }
    return {
      ...serviceCase,
      benefitState: command.accepted ? 'active' : 'rejected',
      benefitArtifactHash: command.artifactHash,
      benefitValidFrom: command.validFrom,
      benefitValidUntil: command.validUntil,
      artifactHistory: appendArtifact(serviceCase.artifactHistory, artifact),
    };
  }
  if (command.kind === 'record_service_result') {
    if (serviceCase.serviceResultState === 'not_applicable') throw new Error('ARGENTINA_SERVICE_RESULT_NOT_APPLICABLE');
    if (serviceCase.verificationState !== 'verified') throw new Error('ARGENTINA_SERVICE_RESULT_NOT_VERIFIED');
    if (!hash(command.artifactHash)) throw new Error('ARGENTINA_SERVICE_ARTIFACT_HASH_INVALID');
    const recordedAt = serviceInstant(command.recordedAt);
    const validUntil = command.validUntil === null ? null : serviceInstant(command.validUntil);
    if (command.accepted && validUntil === null) throw new Error('ARGENTINA_SERVICE_RESULT_VALIDITY_REQUIRED');
    if (validUntil !== null && recordedAt > validUntil) throw new Error('ARGENTINA_SERVICE_RESULT_VALIDITY_INVALID');
    const expectedState = command.accepted ? 'issued' : 'rejected';
    const artifact = {
      stage: 'service_result' as const, artifactHash: command.artifactHash, recordedAt: command.recordedAt,
      accepted: command.accepted, sourceUrl: null, validFrom: null, validUntil: command.validUntil,
    };
    if (serviceCase.serviceResultState !== 'not_issued') {
      if (serviceCase.serviceResultState !== expectedState || serviceCase.serviceResultArtifactHash !== command.artifactHash || serviceCase.serviceResultValidUntil !== command.validUntil) throw new Error('ARGENTINA_SERVICE_RESULT_CONFLICT');
      appendArtifact(serviceCase.artifactHistory, artifact);
      return serviceCase;
    }
    return {
      ...serviceCase,
      serviceResultState: expectedState,
      serviceResultArtifactHash: command.artifactHash,
      serviceResultValidUntil: command.validUntil,
      artifactHistory: appendArtifact(serviceCase.artifactHistory, artifact),
    };
  }
  if (serviceCase.submissionState !== 'submitted') throw new Error('ARGENTINA_SERVICE_NOT_SUBMITTED');
  if (!hash(command.artifactHash)) throw new Error('ARGENTINA_SERVICE_ARTIFACT_HASH_INVALID');
  if (serviceCase.verificationState !== 'unverified') {
    if (serviceCase.verifiedArtifactHash !== command.artifactHash || serviceCase.verificationState !== (command.accepted ? 'verified' : 'rejected')) throw new Error('ARGENTINA_SERVICE_VERIFICATION_CONFLICT');
    appendArtifact(serviceCase.artifactHistory, {
      stage: 'authority_verification', artifactHash: command.artifactHash, recordedAt: command.recordedAt,
      accepted: command.accepted, sourceUrl: command.sourceUrl, validFrom: null, validUntil: null,
    });
    return serviceCase;
  }
  serviceInstant(command.recordedAt);
  if (!serviceVerificationSource(serviceCase.serviceType, command.sourceUrl)) throw new Error('ARGENTINA_SERVICE_AUTHORITY_SOURCE_REQUIRED');
  return {
    ...serviceCase,
    verificationState: command.accepted ? 'verified' : 'rejected',
    verifiedArtifactHash: command.artifactHash,
    artifactHistory: appendArtifact(serviceCase.artifactHistory, {
      stage: 'authority_verification', artifactHash: command.artifactHash, recordedAt: command.recordedAt,
      accepted: command.accepted, sourceUrl: command.sourceUrl, validFrom: null, validUntil: null,
    }),
  };
}

export function effectiveArgentinaServiceBenefitState(serviceCase: ArgentinaServiceCaseV2, asOf: string): ArgentinaServiceCaseV2['benefitState'] | 'expired' {
  const at = serviceInstant(asOf);
  if (serviceCase.benefitState !== 'active') return serviceCase.benefitState;
  if (serviceCase.benefitValidUntil === null) throw new Error('ARGENTINA_SERVICE_BENEFIT_VALIDITY_REQUIRED');
  return at > serviceInstant(serviceCase.benefitValidUntil) ? 'expired' : 'active';
}

export function effectiveArgentinaServiceResultState(serviceCase: ArgentinaServiceCaseV2, asOf: string): ArgentinaServiceCaseV2['serviceResultState'] | 'expired' {
  const at = serviceInstant(asOf);
  if (serviceCase.serviceResultState !== 'issued') return serviceCase.serviceResultState;
  if (serviceCase.serviceResultValidUntil === null) throw new Error('ARGENTINA_SERVICE_RESULT_VALIDITY_REQUIRED');
  return at > serviceInstant(serviceCase.serviceResultValidUntil) ? 'expired' : 'issued';
}

export type RegulatoryRuleProposalV2 = Readonly<{
  version: 'regulatory-rule-proposal-v2';
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
  ruleDiffHash: string;
  changedFields: readonly string[];
  accessMethod: 'official_feed' | 'delegated_portal' | 'manual_verified_document';
  retroactive: boolean;
  affectedCaseIds: readonly string[];
  state: 'proposed' | 'reviewed_no_impact' | 'reviewed_impact' | 'approved' | 'confirmed';
  reviewerActorId: string | null;
  reviewedAt: string | null;
  reviewArtifactHash: string | null;
  confirmedByActorId: string | null;
  confirmedAt: string | null;
}>;

export function proposeRegulatoryRuleImpact(
  input: Omit<RegulatoryRuleProposalV2, 'version' | 'retroactive' | 'affectedCaseIds' | 'state' | 'reviewerActorId' | 'reviewedAt' | 'reviewArtifactHash' | 'confirmedByActorId' | 'confirmedAt'>,
  cases: readonly ArgentinaServiceCaseV2[],
): RegulatoryRuleProposalV2 {
  const source = officialRegulatorySource(input.sourceUrl);
  if (!source) throw new Error('REGULATORY_SOURCE_NOT_OFFICIAL');
  isoDate(input.publicationDate);
  isoDate(input.effectiveFrom);
  if (!hash(input.ruleDiffHash) || input.changedFields.length === 0) throw new Error('REGULATORY_RULE_DIFF_REQUIRED');
  if (input.priorRuleVersionId !== null && input.priorRuleVersionId === input.proposedRuleVersionId) throw new Error('REGULATORY_RULE_VERSION_CONFLICT');
  const affectedCaseIds = cases.filter(serviceCase => {
    if (!input.impactedRegimeIds.includes(serviceCase.regimeId)) return false;
    if (input.impactedSubdivisions.length > 0 && (!serviceCase.subdivision || !input.impactedSubdivisions.includes(serviceCase.subdivision))) return false;
    return rangesOverlap(serviceCase.period, { start: input.effectiveFrom, end: '9999-12-31' });
  }).map(serviceCase => serviceCase.caseId).sort();
  return {
    ...input,
    changedFields: [...new Set(input.changedFields)].sort(),
    version: 'regulatory-rule-proposal-v2',
    retroactive: input.effectiveFrom < input.publicationDate,
    affectedCaseIds,
    state: 'proposed',
    reviewerActorId: null,
    reviewedAt: null,
    reviewArtifactHash: null,
    confirmedByActorId: null,
    confirmedAt: null,
  };
}

export function reviewRegulatoryRuleProposal(proposal: RegulatoryRuleProposalV2, reviewerActorId: string, approve: boolean, reviewedAt: string, reviewArtifactHash: string): RegulatoryRuleProposalV2 {
  if (proposal.state !== 'proposed') throw new Error('REGULATORY_PROPOSAL_ALREADY_REVIEWED');
  if (!reviewerActorId) throw new Error('REGULATORY_REVIEWER_REQUIRED');
  serviceInstant(reviewedAt);
  if (!hash(reviewArtifactHash)) throw new Error('REGULATORY_REVIEW_ARTIFACT_REQUIRED');
  const review = { reviewerActorId, reviewedAt, reviewArtifactHash };
  if (approve) return { ...proposal, ...review, state: 'approved' };
  return { ...proposal, ...review, state: proposal.affectedCaseIds.length === 0 ? 'reviewed_no_impact' : 'reviewed_impact' };
}

export function confirmRegulatoryRuleProposal(proposal: RegulatoryRuleProposalV2, actorId: string, confirmedAt: string): RegulatoryRuleProposalV2 {
  if (proposal.state !== 'approved') throw new Error('REGULATORY_PROPOSAL_NOT_APPROVED');
  if (!actorId) throw new Error('REGULATORY_CONFIRMATION_ACTOR_REQUIRED');
  serviceInstant(confirmedAt);
  return { ...proposal, state: 'confirmed', confirmedByActorId: actorId, confirmedAt };
}

export type ConfirmedRegulatoryCaseUpdateV1 = Readonly<{
  version: 'confirmed-regulatory-case-update-v1';
  proposalId: string;
  affectedCaseIds: readonly string[];
  sourceUrl: string;
  publicationDate: string;
  effectiveFrom: string;
  retroactive: boolean;
  ruleDiffHash: string;
  changedFields: readonly string[];
  proposedRuleVersionId: string;
  confirmedByActorId: string;
  confirmedAt: string;
}>;

export function projectConfirmedRegulatoryCaseUpdate(proposal: RegulatoryRuleProposalV2): ConfirmedRegulatoryCaseUpdateV1 {
  if (proposal.state !== 'confirmed' || !proposal.confirmedByActorId || !proposal.confirmedAt) throw new Error('REGULATORY_PROPOSAL_NOT_CONFIRMED');
  return {
    version: 'confirmed-regulatory-case-update-v1',
    proposalId: proposal.proposalId,
    affectedCaseIds: proposal.affectedCaseIds,
    sourceUrl: proposal.sourceUrl,
    publicationDate: proposal.publicationDate,
    effectiveFrom: proposal.effectiveFrom,
    retroactive: proposal.retroactive,
    ruleDiffHash: proposal.ruleDiffHash,
    changedFields: proposal.changedFields,
    proposedRuleVersionId: proposal.proposedRuleVersionId,
    confirmedByActorId: proposal.confirmedByActorId,
    confirmedAt: proposal.confirmedAt,
  };
}

function incomeCertificationEligible(subscriptionStartedAt: string | null, asOf: string, entitlementMonths: number): boolean {
  if (!Number.isInteger(entitlementMonths) || entitlementMonths < 0 || entitlementMonths > 120) throw new Error('ARGENTINA_SERVICE_ENTITLEMENT_INVALID');
  if (!subscriptionStartedAt) return false;
  const start = new Date(subscriptionStartedAt);
  const current = new Date(asOf);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(current.getTime())) throw new Error('ARGENTINA_SERVICE_TIMESTAMP_INVALID');
  return current.getTime() >= addUtcMonths(start, entitlementMonths).getTime();
}

function rangesOverlap(left: Period, right: Period): boolean {
  return left.start <= right.end && right.start <= left.end;
}

function hash(value: string): boolean {
  return /^[a-f0-9]{64}$/.test(value);
}

function isoDate(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('REGULATORY_DATE_INVALID');
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new Error('REGULATORY_DATE_INVALID');
}

function addUtcMonths(value: Date, months: number): Date {
  const result = new Date(value.getTime());
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const finalDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(day, finalDay));
  return result;
}

function appendArtifact(history: readonly ArgentinaServiceArtifactV2[], artifact: ArgentinaServiceArtifactV2): readonly ArgentinaServiceArtifactV2[] {
  const existing = history.find(entry => entry.stage === artifact.stage && entry.artifactHash === artifact.artifactHash);
  if (existing) {
    if (JSON.stringify(existing) !== JSON.stringify(artifact)) throw new Error('ARGENTINA_SERVICE_ARTIFACT_CONFLICT');
    return history;
  }
  return [...history, artifact];
}

function serviceInstant(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || !/[zZ]|[+-]\d\d:\d\d$/.test(value)) throw new Error('ARGENTINA_SERVICE_TIMESTAMP_INVALID');
  return parsed;
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
  return ['arca.gob.ar', 'argentina.gob.ar', 'bcra.gob.ar', 'boletinoficial.gob.ar', 'agip.gob.ar', 'arba.gov.ar', 'comarb.gob.ar']
    .some(domain => hostname === domain || hostname.endsWith(`.${domain}`));
}

function serviceVerificationSource(serviceType: ArgentinaServiceType, value: string): boolean {
  if (officialRegulatorySource(value)) return true;
  if (serviceType !== 'income_certification') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && (url.hostname === 'bufi.finance' || url.hostname.endsWith('.bufi.finance'));
  } catch {
    return false;
  }
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
      { requirementId: 'export-benefit', label: 'Export-benefit applicability and authority evidence' },
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
      { requirementId: 'annual-compliance', label: 'Annual compliance, revalidation and benefit evidence' },
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
