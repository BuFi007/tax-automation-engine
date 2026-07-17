import { describe, expect, test } from 'bun:test';

import type {
  ArcaOnboardingEventV1,
  ArcaOnboardingRunV1,
  TaxEvidenceConsentEventV1,
} from '@tax-engine/core';

import {
  createArcaOnboardingTaxDomainEvent,
  createConsentRevokedTaxDomainEvent,
  resolveTaxDomainEventCommitmentSecret,
} from './tax-domain-event-factory';

const SECRET = 'test-tax-domain-event-commitment-secret-v1';
const T0 = '2026-07-17T00:00:00.000Z';
const RAW_AUTHORITY_HASH = 'a'.repeat(64);
const RAW_SCOPE_HASH = 'b'.repeat(64);

function onboardingRun(workspaceId = 'workspace_opaque_1'): ArcaOnboardingRunV1 {
  return {
    version: 'arca-onboarding-run-v1',
    onboardingId: '10000000-0000-4000-8000-000000000001',
    workspaceId,
    taxpayerReferenceHash: 'c'.repeat(64),
    environment: 'homologation',
    requestedServices: ['wsfex'],
    revision: 7,
    status: 'active',
    currentStep: 'zk_evidence',
    createdAt: T0,
    updatedAt: T0,
    steps: [
      {
        step: 'api_verification',
        state: 'completed',
        requiresUserAction: false,
        requiresExplicitConfirmation: false,
        completedAt: T0,
        evidenceHashes: [RAW_AUTHORITY_HASH],
        safeMetadata: {},
      },
    ],
    pointOfSale: { number: 1, source: 'discovered', active: true },
    delegation: { wsfex: true, wsfe: false },
    authorityBinding: {
      issuerProfileReferenceHash: 'd'.repeat(64),
      representedCuitCommitment: 'e'.repeat(64),
    },
    apiVerification: { wsfex: true, wsfe: false, observedAt: T0 },
    reclaimSession: null,
    zkEvidence: null,
    processedCommandKeys: ['arca-provider-command-raw'],
    eventIds: [],
  };
}

function onboardingEvent(): ArcaOnboardingEventV1 {
  return {
    version: 'arca-onboarding-event-v1',
    eventId: '20000000-0000-4000-8000-000000000001',
    onboardingId: '10000000-0000-4000-8000-000000000001',
    workspaceId: 'workspace_opaque_1',
    actorId: 'authority-actor-raw',
    action: 'record_api_verification',
    occurredAt: T0,
    idempotencyKey: 'arca-provider-command-raw',
    safeMetadata: { authoritativeApiVerification: true },
  };
}

describe('TaxDomainEventV1 producer minimization', () => {
  test('re-commits ARCA authority evidence with a workspace-scoped HMAC', () => {
    const event = createArcaOnboardingTaxDomainEvent({
      run: onboardingRun(),
      event: onboardingEvent(),
      consent: { version: 'consent-raw-v1', scopeHash: RAW_SCOPE_HASH },
      commitmentSecret: SECRET,
      eventId: '30000000-0000-4000-8000-000000000001',
    });
    expect(event).toMatchObject({
      kind: 'arca.api_verification_completed',
      state: 'verified',
      caseRef: null,
    });
    expect(event?.evidenceHashes).toHaveLength(1);
    expect(event?.evidenceHashes[0]).toMatch(/^[a-f0-9]{64}$/);
    const firstEvidenceHash = event?.evidenceHashes[0];
    const serialized = JSON.stringify(event);
    for (const forbidden of [
      RAW_AUTHORITY_HASH,
      RAW_SCOPE_HASH,
      'authority-actor-raw',
      'arca-provider-command-raw',
      'consent-raw-v1',
    ]) expect(serialized).not.toContain(forbidden);

    const otherWorkspace = createArcaOnboardingTaxDomainEvent({
      run: onboardingRun('workspace_opaque_2'),
      event: { ...onboardingEvent(), workspaceId: 'workspace_opaque_2' },
      consent: { version: 'consent-raw-v1', scopeHash: RAW_SCOPE_HASH },
      commitmentSecret: SECRET,
      eventId: '30000000-0000-4000-8000-000000000002',
    });
    expect(otherWorkspace?.evidenceHashes[0]).not.toBe(firstEvidenceHash);
  });

  test('emits revocation without treating revoked consent as active', () => {
    const source: TaxEvidenceConsentEventV1 = {
      version: 'tax-evidence-consent-event-v1',
      eventId: '40000000-0000-4000-8000-000000000001',
      workspaceId: 'workspace_opaque_1',
      sequence: 2,
      action: 'revoke',
      authoritySource: 'desk_subscription',
      actorReferenceHash: 'f'.repeat(64),
      consent: {
        purpose: 'tax_workspace_processing',
        version: 'consent-raw-v1',
        scopeHash: RAW_SCOPE_HASH,
        sourceIds: ['provider-account-raw'],
      },
      occurredAt: T0,
    };
    const event = createConsentRevokedTaxDomainEvent({
      event: source,
      commitmentSecret: SECRET,
      eventId: '50000000-0000-4000-8000-000000000001',
    });
    expect(event).toMatchObject({
      kind: 'consent.revoked',
      state: 'revoked',
      consent: { state: 'revoked' },
      evidenceHashes: [],
    });
    expect(JSON.stringify(event)).not.toContain('provider-account-raw');
    expect(createConsentRevokedTaxDomainEvent({
      event: { ...source, action: 'grant' },
      commitmentSecret: SECRET,
    })).toBeNull();
  });

  test('requires a purpose-specific commitment secret in production', () => {
    expect(() => resolveTaxDomainEventCommitmentSecret(undefined, 'production'))
      .toThrow('TAX_DOMAIN_EVENT_COMMITMENT_HMAC_SECRET_REQUIRED');
    expect(resolveTaxDomainEventCommitmentSecret(undefined, 'test')).toHaveLength(43);
  });
});
