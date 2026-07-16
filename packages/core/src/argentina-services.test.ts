import { describe, expect, test } from 'bun:test';

import { applyArgentinaServiceCommand, createArgentinaServiceCase, effectiveArgentinaServiceBenefitState, proposeRegulatoryRuleImpact, reviewRegulatoryRuleProposal } from './argentina-services';
import { argentinaProfile } from './fixtures';

const period = { start: '2026-01-01', end: '2026-12-31' } as const;

describe('Argentina accountant-service workflows', () => {
  test('keeps MiPyME preparation, professional review, submission and verification separate', () => {
    let serviceCase = createArgentinaServiceCase({ caseId: 'case:mipyme', profile: argentinaProfile(), serviceType: 'mipyme', period, asOf: '2026-07-15T00:00:00.000Z' });
    for (const requirement of serviceCase.requirements) {
      serviceCase = applyArgentinaServiceCommand(serviceCase, { kind: 'accept_evidence', requirementId: requirement.requirementId, evidenceId: `evidence:${requirement.requirementId}` });
    }
    expect(serviceCase).toMatchObject({ preparationState: 'ready_for_review', reviewState: 'not_requested', submissionState: 'not_submitted', verificationState: 'unverified' });
    expect(() => applyArgentinaServiceCommand(serviceCase, { kind: 'record_submission', artifactHash: 'a'.repeat(64) })).toThrow('ARGENTINA_SERVICE_SUBMISSION_NOT_APPROVED');
    serviceCase = applyArgentinaServiceCommand(serviceCase, { kind: 'request_review' });
    serviceCase = applyArgentinaServiceCommand(serviceCase, { kind: 'approve_review' });
    serviceCase = applyArgentinaServiceCommand(serviceCase, { kind: 'record_submission', artifactHash: 'a'.repeat(64) });
    expect(serviceCase.verificationState).toBe('unverified');
    serviceCase = applyArgentinaServiceCommand(serviceCase, { kind: 'record_verification', artifactHash: 'b'.repeat(64), accepted: true });
    expect(serviceCase.verificationState).toBe('verified');
    expect(serviceCase.benefitState).toBe('not_verified');
    serviceCase = applyArgentinaServiceCommand(serviceCase, { kind: 'record_benefit', artifactHash: 'c'.repeat(64), accepted: true, validUntil: '2027-07-15T00:00:00.000Z' });
    expect(effectiveArgentinaServiceBenefitState(serviceCase, '2027-07-15T00:00:00.000Z')).toBe('active');
    expect(effectiveArgentinaServiceBenefitState(serviceCase, '2027-07-15T00:00:00.001Z')).toBe('expired');
  });

  test('never turns submission or verification alone into an active benefit', () => {
    let serviceCase = createArgentinaServiceCase({ caseId: 'case:mipyme:separation', profile: argentinaProfile(), serviceType: 'mipyme', period, asOf: '2026-07-15T00:00:00.000Z' });
    for (const requirement of serviceCase.requirements) serviceCase = applyArgentinaServiceCommand(serviceCase, { kind: 'accept_evidence', requirementId: requirement.requirementId, evidenceId: `evidence:${requirement.requirementId}` });
    serviceCase = applyArgentinaServiceCommand(serviceCase, { kind: 'request_review' });
    serviceCase = applyArgentinaServiceCommand(serviceCase, { kind: 'approve_review' });
    serviceCase = applyArgentinaServiceCommand(serviceCase, { kind: 'record_submission', artifactHash: 'a'.repeat(64) });
    expect(() => applyArgentinaServiceCommand(serviceCase, { kind: 'record_benefit', artifactHash: 'c'.repeat(64), accepted: true, validUntil: '2027-01-01T00:00:00.000Z' })).toThrow('ARGENTINA_SERVICE_BENEFIT_NOT_VERIFIED');
    serviceCase = applyArgentinaServiceCommand(serviceCase, { kind: 'record_verification', artifactHash: 'b'.repeat(64), accepted: true });
    expect(serviceCase.benefitState).toBe('not_verified');
    expect(() => applyArgentinaServiceCommand(serviceCase, { kind: 'record_benefit', artifactHash: 'c'.repeat(64), accepted: true, validUntil: null })).toThrow('ARGENTINA_SERVICE_BENEFIT_VALIDITY_REQUIRED');
  });

  test('enforces the three-month income-certification entitlement and legal-entity knowledge path', () => {
    expect(createArgentinaServiceCase({ caseId: 'case:income:early', profile: argentinaProfile(), serviceType: 'income_certification', period, subscriptionStartedAt: '2026-05-01T00:00:00.000Z', asOf: '2026-07-15T00:00:00.000Z' }).eligibility).toBe('ineligible');
    expect(createArgentinaServiceCase({ caseId: 'case:income:ready', profile: argentinaProfile(), serviceType: 'income_certification', period, subscriptionStartedAt: '2026-04-01T00:00:00.000Z', asOf: '2026-07-15T00:00:00.000Z' }).eligibility).toBe('eligible_for_preparation');
    expect(createArgentinaServiceCase({ caseId: 'case:knowledge:individual', profile: argentinaProfile(), serviceType: 'knowledge_economy', period, asOf: '2026-07-15T00:00:00.000Z' }).eligibility).toBe('ineligible');
  });

  test('targets a cited regulatory proposal only to affected cases and requires review', () => {
    const caba = createArgentinaServiceCase({ caseId: 'case:caba', profile: argentinaProfile(), serviceType: 'growth_path', period, asOf: '2026-07-15T00:00:00.000Z' });
    const other = { ...caba, caseId: 'case:other', subdivision: 'AR-X' };
    const proposal = proposeRegulatoryRuleImpact({
      proposalId: 'proposal:1', jurisdiction: 'AR', sourceUrl: 'https://www.arca.gob.ar/example', publicationDate: '2026-07-15', effectiveFrom: '2026-08-01', priorRuleVersionId: 'rule:v1', proposedRuleVersionId: 'rule:v2', impactedRegimeIds: ['monotributo_exportador'], impactedSubdivisions: ['AR-C'], summary: 'Reviewed threshold change',
    }, [other, caba]);
    expect(proposal).toMatchObject({ affectedCaseIds: ['case:caba'], state: 'proposed', reviewerActorId: null });
    expect(reviewRegulatoryRuleProposal(proposal, 'accountant:1', false).state).toBe('reviewed_impact');

    const noImpact = proposeRegulatoryRuleImpact({ ...proposal, proposalId: 'proposal:2', impactedRegimeIds: ['responsable_inscripto'] }, [caba]);
    expect(reviewRegulatoryRuleProposal(noImpact, 'accountant:1', false).state).toBe('reviewed_no_impact');
    expect(() => proposeRegulatoryRuleImpact({ ...proposal, proposalId: 'proposal:untrusted', sourceUrl: 'https://example.com/tax-update' }, [caba])).toThrow('REGULATORY_SOURCE_NOT_OFFICIAL');
  });
});
