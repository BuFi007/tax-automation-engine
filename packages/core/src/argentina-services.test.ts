import { describe, expect, test } from 'bun:test';

import { applyArgentinaServiceCommand, confirmRegulatoryRuleProposal, createArgentinaServiceCase, effectiveArgentinaServiceBenefitState, effectiveArgentinaServiceResultState, projectConfirmedRegulatoryCaseUpdate, proposeRegulatoryRuleImpact, reviewRegulatoryRuleProposal } from './argentina-services';
import { argentinaProfile } from './fixtures';

const period = { start: '2026-01-01', end: '2026-12-31' } as const;

describe('Argentina accountant-service workflows', () => {
  test('keeps MiPyME preparation, professional review, submission and verification separate', () => {
    let serviceCase = createArgentinaServiceCase({ caseId: 'case:mipyme', profile: argentinaProfile(), serviceType: 'mipyme', period, asOf: '2026-07-15T00:00:00.000Z' });
    for (const requirement of serviceCase.requirements) {
      serviceCase = applyArgentinaServiceCommand(serviceCase, { kind: 'accept_evidence', requirementId: requirement.requirementId, evidenceId: `evidence:${requirement.requirementId}` });
    }
    expect(serviceCase).toMatchObject({ preparationState: 'ready_for_review', reviewState: 'not_requested', submissionState: 'not_submitted', verificationState: 'unverified' });
    expect(() => applyArgentinaServiceCommand(serviceCase, { kind: 'record_submission', artifactHash: 'a'.repeat(64), recordedAt: '2026-07-15T10:00:00.000Z' })).toThrow('ARGENTINA_SERVICE_SUBMISSION_NOT_APPROVED');
    serviceCase = applyArgentinaServiceCommand(serviceCase, { kind: 'request_review' });
    serviceCase = applyArgentinaServiceCommand(serviceCase, { kind: 'approve_review' });
    serviceCase = applyArgentinaServiceCommand(serviceCase, { kind: 'record_submission', artifactHash: 'a'.repeat(64), recordedAt: '2026-07-15T10:00:00.000Z' });
    expect(serviceCase.verificationState).toBe('unverified');
    serviceCase = applyArgentinaServiceCommand(serviceCase, { kind: 'record_verification', artifactHash: 'b'.repeat(64), accepted: true, recordedAt: '2026-07-15T11:00:00.000Z', sourceUrl: 'https://www.argentina.gob.ar/produccion/registrar-una-pyme/certificado-pyme' });
    expect(serviceCase.verificationState).toBe('verified');
    expect(serviceCase.benefitState).toBe('not_verified');
    serviceCase = applyArgentinaServiceCommand(serviceCase, { kind: 'record_benefit', artifactHash: 'c'.repeat(64), accepted: true, recordedAt: '2026-07-15T12:00:00.000Z', sourceUrl: 'https://www.argentina.gob.ar/produccion/registrar-una-pyme/certificado-pyme', validFrom: '2026-07-15T00:00:00.000Z', validUntil: '2027-07-15T00:00:00.000Z' });
    expect(effectiveArgentinaServiceBenefitState(serviceCase, '2027-07-15T00:00:00.000Z')).toBe('active');
    expect(effectiveArgentinaServiceBenefitState(serviceCase, '2027-07-15T00:00:00.001Z')).toBe('expired');
  });

  test('never turns submission or verification alone into an active benefit', () => {
    let serviceCase = createArgentinaServiceCase({ caseId: 'case:mipyme:separation', profile: argentinaProfile(), serviceType: 'mipyme', period, asOf: '2026-07-15T00:00:00.000Z' });
    for (const requirement of serviceCase.requirements) serviceCase = applyArgentinaServiceCommand(serviceCase, { kind: 'accept_evidence', requirementId: requirement.requirementId, evidenceId: `evidence:${requirement.requirementId}` });
    serviceCase = applyArgentinaServiceCommand(serviceCase, { kind: 'request_review' });
    serviceCase = applyArgentinaServiceCommand(serviceCase, { kind: 'approve_review' });
    serviceCase = applyArgentinaServiceCommand(serviceCase, { kind: 'record_submission', artifactHash: 'a'.repeat(64), recordedAt: '2026-07-15T10:00:00.000Z' });
    expect(() => applyArgentinaServiceCommand(serviceCase, { kind: 'record_benefit', artifactHash: 'c'.repeat(64), accepted: true, recordedAt: '2026-07-15T12:00:00.000Z', sourceUrl: 'https://www.argentina.gob.ar/example', validFrom: '2026-07-15T00:00:00.000Z', validUntil: '2027-01-01T00:00:00.000Z' })).toThrow('ARGENTINA_SERVICE_BENEFIT_NOT_VERIFIED');
    serviceCase = applyArgentinaServiceCommand(serviceCase, { kind: 'record_verification', artifactHash: 'b'.repeat(64), accepted: true, recordedAt: '2026-07-15T11:00:00.000Z', sourceUrl: 'https://www.argentina.gob.ar/example' });
    expect(serviceCase.benefitState).toBe('not_verified');
    expect(() => applyArgentinaServiceCommand(serviceCase, { kind: 'record_benefit', artifactHash: 'c'.repeat(64), accepted: true, recordedAt: '2026-07-15T12:00:00.000Z', sourceUrl: 'https://www.argentina.gob.ar/example', validFrom: null, validUntil: null })).toThrow('ARGENTINA_SERVICE_BENEFIT_VALIDITY_REQUIRED');
  });

  test('enforces the three-month income-certification entitlement and legal-entity knowledge path', () => {
    expect(createArgentinaServiceCase({ caseId: 'case:income:early', profile: argentinaProfile(), serviceType: 'income_certification', period, subscriptionStartedAt: '2026-05-01T00:00:00.000Z', asOf: '2026-07-15T00:00:00.000Z' }).eligibility).toBe('ineligible');
    expect(createArgentinaServiceCase({ caseId: 'case:income:ready', profile: argentinaProfile(), serviceType: 'income_certification', period, subscriptionStartedAt: '2026-04-01T00:00:00.000Z', asOf: '2026-07-15T00:00:00.000Z' }).eligibility).toBe('eligible_for_preparation');
    expect(createArgentinaServiceCase({ caseId: 'case:income:custom', profile: argentinaProfile(), serviceType: 'income_certification', period, subscriptionStartedAt: '2026-06-01T00:00:00.000Z', subscriptionEntitlementMonths: 1, asOf: '2026-07-15T00:00:00.000Z' }).eligibility).toBe('eligible_for_preparation');
    expect(createArgentinaServiceCase({ caseId: 'case:knowledge:individual', profile: argentinaProfile(), serviceType: 'knowledge_economy', period, asOf: '2026-07-15T00:00:00.000Z' }).eligibility).toBe('ineligible');
  });

  test('preserves renewal history and rejects overlapping or already expired benefits', () => {
    let serviceCase = createArgentinaServiceCase({ caseId: 'case:mipyme:renewal', profile: argentinaProfile(), serviceType: 'mipyme', period, asOf: '2026-07-15T00:00:00.000Z' });
    for (const requirement of serviceCase.requirements) serviceCase = applyArgentinaServiceCommand(serviceCase, { kind: 'accept_evidence', requirementId: requirement.requirementId, evidenceId: `evidence:${requirement.requirementId}` });
    serviceCase = applyArgentinaServiceCommand(serviceCase, { kind: 'request_review' });
    serviceCase = applyArgentinaServiceCommand(serviceCase, { kind: 'approve_review' });
    serviceCase = applyArgentinaServiceCommand(serviceCase, { kind: 'record_submission', artifactHash: '1'.repeat(64), recordedAt: '2026-07-15T10:00:00.000Z' });
    serviceCase = applyArgentinaServiceCommand(serviceCase, { kind: 'record_verification', artifactHash: '2'.repeat(64), accepted: true, recordedAt: '2026-07-15T11:00:00.000Z', sourceUrl: 'https://www.argentina.gob.ar/produccion/registrar-una-pyme/certificado-pyme' });
    serviceCase = applyArgentinaServiceCommand(serviceCase, { kind: 'record_benefit', artifactHash: '3'.repeat(64), accepted: true, recordedAt: '2026-07-15T12:00:00.000Z', sourceUrl: 'https://www.argentina.gob.ar/produccion/registrar-una-pyme/certificado-pyme', validFrom: '2026-07-15T00:00:00.000Z', validUntil: '2027-04-30T23:59:59.999Z' });
    expect(() => applyArgentinaServiceCommand(serviceCase, { kind: 'record_benefit_renewal', verificationArtifactHash: '4'.repeat(64), benefitArtifactHash: '5'.repeat(64), recordedAt: '2027-04-20T00:00:00.000Z', sourceUrl: 'https://www.argentina.gob.ar/produccion/registrar-una-pyme/certificado-pyme', validFrom: '2027-04-30T23:59:59.999Z', validUntil: '2028-04-30T23:59:59.999Z' })).toThrow('ARGENTINA_SERVICE_RENEWAL_OVERLAP');
    serviceCase = applyArgentinaServiceCommand(serviceCase, { kind: 'record_benefit_renewal', verificationArtifactHash: '4'.repeat(64), benefitArtifactHash: '5'.repeat(64), recordedAt: '2027-04-20T00:00:00.000Z', sourceUrl: 'https://www.argentina.gob.ar/produccion/registrar-una-pyme/certificado-pyme', validFrom: '2027-05-01T00:00:00.000Z', validUntil: '2028-04-30T23:59:59.999Z' });
    expect(serviceCase.artifactHistory.map(item => item.stage)).toEqual(['submission', 'authority_verification', 'benefit_decision', 'authority_verification', 'benefit_renewal']);
    expect(serviceCase.benefitArtifactHash).toBe('5'.repeat(64));
  });

  test('requires a verified, expiring final income-certification artifact', () => {
    let serviceCase = createArgentinaServiceCase({ caseId: 'case:income:result', profile: argentinaProfile(), serviceType: 'income_certification', period, subscriptionStartedAt: '2026-01-01T00:00:00.000Z', asOf: '2026-07-15T00:00:00.000Z' });
    for (const requirement of serviceCase.requirements) serviceCase = applyArgentinaServiceCommand(serviceCase, { kind: 'accept_evidence', requirementId: requirement.requirementId, evidenceId: `evidence:${requirement.requirementId}` });
    serviceCase = applyArgentinaServiceCommand(serviceCase, { kind: 'request_review' });
    serviceCase = applyArgentinaServiceCommand(serviceCase, { kind: 'approve_review' });
    serviceCase = applyArgentinaServiceCommand(serviceCase, { kind: 'record_submission', artifactHash: '6'.repeat(64), recordedAt: '2026-07-15T10:00:00.000Z' });
    serviceCase = applyArgentinaServiceCommand(serviceCase, { kind: 'record_verification', artifactHash: '7'.repeat(64), accepted: true, recordedAt: '2026-07-15T11:00:00.000Z', sourceUrl: 'https://bufi.finance/accountant/certifications' });
    expect(() => applyArgentinaServiceCommand(serviceCase, { kind: 'record_service_result', artifactHash: '8'.repeat(64), accepted: true, recordedAt: '2026-07-15T12:00:00.000Z', validUntil: null })).toThrow('ARGENTINA_SERVICE_RESULT_VALIDITY_REQUIRED');
    serviceCase = applyArgentinaServiceCommand(serviceCase, { kind: 'record_service_result', artifactHash: '8'.repeat(64), accepted: true, recordedAt: '2026-07-15T12:00:00.000Z', validUntil: '2026-10-15T23:59:59.999Z' });
    expect(effectiveArgentinaServiceResultState(serviceCase, '2026-10-16T00:00:00.000Z')).toBe('expired');
  });

  test('targets a cited regulatory proposal only to affected cases and requires review', () => {
    const caba = createArgentinaServiceCase({ caseId: 'case:caba', profile: argentinaProfile(), serviceType: 'growth_path', period, asOf: '2026-07-15T00:00:00.000Z' });
    const other = { ...caba, caseId: 'case:other', subdivision: 'AR-X' };
    const proposal = proposeRegulatoryRuleImpact({
      proposalId: 'proposal:1', jurisdiction: 'AR', sourceUrl: 'https://www.arca.gob.ar/example', publicationDate: '2026-07-15', effectiveFrom: '2026-08-01', priorRuleVersionId: 'rule:v1', proposedRuleVersionId: 'rule:v2', impactedRegimeIds: ['monotributo_exportador'], impactedSubdivisions: ['AR-C'], summary: 'Reviewed threshold change', ruleDiffHash: 'd'.repeat(64), changedFields: ['threshold'], accessMethod: 'official_feed',
    }, [other, caba]);
    expect(proposal).toMatchObject({ affectedCaseIds: ['case:caba'], state: 'proposed', reviewerActorId: null });
    expect(reviewRegulatoryRuleProposal(proposal, 'accountant:1', false, '2026-07-16T00:00:00.000Z', 'a'.repeat(64)).state).toBe('reviewed_impact');

    const approved = reviewRegulatoryRuleProposal(proposal, 'accountant:1', true, '2026-07-16T00:00:00.000Z', 'a'.repeat(64));
    expect(approved.state).toBe('approved');
    expect(() => projectConfirmedRegulatoryCaseUpdate(approved)).toThrow('REGULATORY_PROPOSAL_NOT_CONFIRMED');
    const confirmed = confirmRegulatoryRuleProposal(approved, 'workspace-owner:1', '2026-07-16T01:00:00.000Z');
    expect(projectConfirmedRegulatoryCaseUpdate(confirmed)).toMatchObject({ affectedCaseIds: ['case:caba'], confirmedByActorId: 'workspace-owner:1', ruleDiffHash: 'd'.repeat(64) });

    const noImpact = proposeRegulatoryRuleImpact({ ...proposal, proposalId: 'proposal:2', impactedRegimeIds: ['responsable_inscripto'] }, [caba]);
    expect(reviewRegulatoryRuleProposal(noImpact, 'accountant:1', false, '2026-07-16T00:00:00.000Z', 'a'.repeat(64)).state).toBe('reviewed_no_impact');
    expect(() => proposeRegulatoryRuleImpact({ ...proposal, proposalId: 'proposal:untrusted', sourceUrl: 'https://example.com/tax-update' }, [caba])).toThrow('REGULATORY_SOURCE_NOT_OFFICIAL');
  });

  test('flags retroactive rules while targeting only overlapping cases', () => {
    const current = createArgentinaServiceCase({ caseId: 'case:retroactive', profile: argentinaProfile(), serviceType: 'growth_path', period, asOf: '2026-07-15T00:00:00.000Z' });
    const historical = { ...current, caseId: 'case:historical', period: { start: '2024-01-01', end: '2024-12-31' } };
    const proposal = proposeRegulatoryRuleImpact({
      proposalId: 'proposal:retro', jurisdiction: 'AR', sourceUrl: 'https://www.arca.gob.ar/example', publicationDate: '2026-07-15', effectiveFrom: '2026-01-01', priorRuleVersionId: 'rule:v1', proposedRuleVersionId: 'rule:v2', impactedRegimeIds: ['monotributo_exportador'], impactedSubdivisions: [], summary: 'Retroactive official correction', ruleDiffHash: 'e'.repeat(64), changedFields: ['dueDate'], accessMethod: 'manual_verified_document',
    }, [historical, current]);
    expect(proposal).toMatchObject({ retroactive: true, affectedCaseIds: ['case:retroactive'], state: 'proposed' });
  });
});
