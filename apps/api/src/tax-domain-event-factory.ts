import { createHmac, randomUUID } from 'node:crypto';

import {
  assertTaxDomainEventV1,
  hashCanonical,
  type ArcaOnboardingEventV1,
  type ArcaOnboardingRunV1,
  type TaxDomainEventV1,
  type TaxEvidenceConsentEventV1,
} from '@tax-engine/core';

type ActiveConsent = Readonly<{
  version: string;
  scopeHash: string;
}>;

export function createArcaOnboardingTaxDomainEvent(input: Readonly<{
  run: ArcaOnboardingRunV1;
  event: ArcaOnboardingEventV1;
  consent: ActiveConsent;
  commitmentSecret: string;
  eventId?: string;
}>): TaxDomainEventV1 | null {
  if (
    input.event.action !== 'record_api_verification'
    && input.event.action !== 'record_zk_evidence'
  ) return null;
  assertCommitmentSecret(input.commitmentSecret);
  const reclaim = input.event.action === 'record_zk_evidence';
  const rawEvidence = reclaim
    ? [input.run.zkEvidence?.proofHash, input.run.zkEvidence?.claimsHash]
    : input.run.steps.find(step => step.step === 'api_verification')?.evidenceHashes ?? [];
  const verifiedAt = reclaim
    ? input.run.zkEvidence?.verifiedAt
    : input.run.apiVerification.observedAt;
  if (!verifiedAt) throw new Error('TAX_DOMAIN_EVENT_VERIFIED_AT_REQUIRED');
  const commit = (purpose: string, value: string) => privacyCommitment(
    input.commitmentSecret,
    purpose,
    input.run.workspaceId,
    value,
  );
  return assertTaxDomainEventV1({
    version: 'tax-domain-event-v1',
    eventId: input.eventId ?? randomUUID(),
    workspaceId: input.run.workspaceId,
    caseRef: null,
    kind: reclaim ? 'reclaim.proof_verified' : 'arca.api_verification_completed',
    state: 'verified',
    occurredAt: input.event.occurredAt,
    idempotencyKey: `taxevt_${commit('idempotency', input.event.idempotencyKey).slice(0, 40)}`,
    correlationRef: `arca_${commit('correlation', input.run.onboardingId).slice(0, 40)}`,
    source: {
      system: reclaim ? 'reclaim' : 'arca',
      sourceEventHash: commit('source-event', hashCanonical(input.event)),
      verifiedAt,
    },
    authentication: {
      method: reclaim ? 'provider_webhook' : 'authority_receipt',
      principalRef: reclaim ? 'reclaim_proof_verifier' : 'arca_authority_verifier',
      credentialVersion: reclaim
        ? 'reclaim-proof-verifier-v1'
        : 'arca-authority-receipt-v1',
      signatureHash: commit('authentication', hashCanonical(input.event)),
    },
    consent: {
      purpose: 'tax_workspace_processing',
      version: `consent_${commit('consent-version', input.consent.version).slice(0, 40)}`,
      scopeHash: commit('consent-scope', input.consent.scopeHash),
      state: 'active',
    },
    evidenceHashes: rawEvidence
      .filter((value): value is string => Boolean(value))
      .map(value => commit('evidence', value)),
    ruleVersionIds: ['arca-onboarding-rules-v1'],
    policyVersionIds: ['tax-domain-event-minimization-v1'],
    actionRefs: [
      `arca_action_${commit('action', input.event.eventId).slice(0, 40)}`,
    ],
  });
}

export function createConsentRevokedTaxDomainEvent(input: Readonly<{
  event: TaxEvidenceConsentEventV1;
  commitmentSecret: string;
  eventId?: string;
}>): TaxDomainEventV1 | null {
  if (input.event.action !== 'revoke') return null;
  assertCommitmentSecret(input.commitmentSecret);
  const commit = (purpose: string, value: string) => privacyCommitment(
    input.commitmentSecret,
    purpose,
    input.event.workspaceId,
    value,
  );
  return assertTaxDomainEventV1({
    version: 'tax-domain-event-v1',
    eventId: input.eventId ?? randomUUID(),
    workspaceId: input.event.workspaceId,
    caseRef: null,
    kind: 'consent.revoked',
    state: 'revoked',
    occurredAt: input.event.occurredAt,
    idempotencyKey: `taxevt_${commit('idempotency', input.event.eventId).slice(0, 40)}`,
    correlationRef: `consent_${commit('correlation', input.event.consent.version).slice(0, 40)}`,
    source: {
      system: 'tax_engine',
      sourceEventHash: commit('source-event', hashCanonical(input.event)),
      verifiedAt: input.event.occurredAt,
    },
    authentication: {
      method: 'internal_outbox',
      principalRef: 'desk_subscription_authority',
      credentialVersion: 'tax-engine-outbox-v1',
      signatureHash: commit('authentication', hashCanonical(input.event)),
    },
    consent: {
      purpose: 'tax_workspace_processing',
      version: `consent_${commit('consent-version', input.event.consent.version).slice(0, 40)}`,
      scopeHash: commit('consent-scope', input.event.consent.scopeHash),
      state: 'revoked',
    },
    evidenceHashes: [],
    ruleVersionIds: [],
    policyVersionIds: ['tax-domain-event-minimization-v1'],
    actionRefs: [
      `consent_action_${commit('action', input.event.eventId).slice(0, 40)}`,
    ],
  });
}

export function resolveTaxDomainEventCommitmentSecret(
  configured = process.env.TAX_DOMAIN_EVENT_COMMITMENT_HMAC_SECRET,
  nodeEnvironment = process.env.NODE_ENV,
): string {
  if (configured) {
    assertCommitmentSecret(configured);
    return configured;
  }
  if (nodeEnvironment === 'production') {
    throw new Error('TAX_DOMAIN_EVENT_COMMITMENT_HMAC_SECRET_REQUIRED');
  }
  return 'local-tax-domain-event-commitment-secret-v1';
}

function privacyCommitment(
  secret: string,
  purpose: string,
  workspaceId: string,
  value: string,
): string {
  return createHmac('sha256', secret)
    .update(`tax-domain-event:v1:${purpose}:${workspaceId}:${value}`)
    .digest('hex');
}

function assertCommitmentSecret(secret: string): void {
  if (Buffer.byteLength(secret) < 32) {
    throw new Error('TAX_DOMAIN_EVENT_COMMITMENT_HMAC_SECRET_REQUIRED');
  }
}
