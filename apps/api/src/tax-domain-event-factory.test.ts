import { describe, expect, test } from 'bun:test';

import { createFacturaEAgentRun } from '@tax-engine/core';
import type {
  ArcaOnboardingEventV1,
  ArcaOnboardingRunV1,
  FacturaEAgentEventV1,
  FacturaEAgentRunV1,
  TaxEvidenceConsentEventV1,
} from '@tax-engine/core';

import {
  createArcaOnboardingTaxDomainEvent,
  createConsentRevokedTaxDomainEvent,
  createFacturaEAgentTaxDomainEvents,
  resolveTaxDomainEventCommitmentSecret,
} from './tax-domain-event-factory';

const SECRET = 'test-tax-domain-event-commitment-secret-v1';
const T0 = '2026-07-17T00:00:00.000Z';
const PROOF_VERIFIED_AT = '2026-07-16T23:58:00.000Z';
const SETTLEMENT_VERIFIED_AT = '2026-07-16T23:59:00.000Z';
const RAW_AUTHORITY_HASH = 'a'.repeat(64);
const RAW_SCOPE_HASH = 'b'.repeat(64);
const RAW_PROOF_HASH = 'c'.repeat(64);
const RAW_SETTLEMENT_REFERENCE = 'd'.repeat(64);
const RAW_SETTLEMENT_EVIDENCE = 'e'.repeat(64);

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

function facturaERun(): FacturaEAgentRunV1 {
  const created = createFacturaEAgentRun({
    runId: 'taxcase_opaque_1',
    workspaceId: 'workspace_opaque_1',
    issuancePath: 'wsfex_delegated',
    actorId: 'agent-actor-raw',
    occurredAt: T0,
    idempotencyKey: 'create-run-raw',
  }).run;
  return {
    ...created,
    issuanceState: 'arca_authorized',
    authority: {
      ...created.authority,
      receiptHash: RAW_AUTHORITY_HASH,
      authorizedAt: T0,
    },
    verifiedProofs: [{
      proofHash: RAW_PROOF_HASH,
      sessionId: 'reclaim-session-opaque',
      purpose: 'arca_cae_constatement',
      providerId: 'reclaim-provider-opaque',
      providerVersion: 'v1',
      verifiedAt: PROOF_VERIFIED_AT,
      attestation: { teeRequired: false, teeVerified: false },
      custodyReceipt: null,
      claims: {
        documentType: 19,
        pointOfSale: 1,
        invoiceNumber: '1',
        cae: '12345678901234',
        issuedAt: '2026-07-16',
        total: { decimal: '100', currency: 'USD' },
        associatedDocumentType: null,
        associatedPointOfSale: null,
        associatedInvoiceNumber: null,
      },
    }],
    settlements: [{
      settlementReferenceHash: RAW_SETTLEMENT_REFERENCE,
      asset: 'USD',
      network: 'ethereum',
      amount: { decimal: '100', currency: 'USD' },
      observedAt: T0,
      finalityState: 'final',
      fees: null,
      reversesSettlementReferenceHash: null,
      evidence: {
        version: 'factura-e-settlement-evidence-v1',
        source: {
          kind: 'recibu_payment',
          provider: 'bufi',
          identityHash: 'f'.repeat(64),
          revision: 1,
        },
        sourceMoney: {
          currency: 'USD',
          grossAmount: '100',
          feeAmount: '0',
          netAmount: '100',
        },
        sourceEquivalentAmount: '100',
        allocationBasis: 'gross',
        fx: null,
        verification: {
          method: 'provider_webhook',
          evidenceHash: RAW_SETTLEMENT_EVIDENCE,
          verifiedAt: SETTLEMENT_VERIFIED_AT,
        },
      },
    }],
  };
}

function facturaEEvent(
  action: string,
  actorKind: FacturaEAgentEventV1['actorKind'],
  safeMetadata: FacturaEAgentEventV1['safeMetadata'],
  actorId = 'source-actor-raw',
): FacturaEAgentEventV1 {
  return {
    eventId: '60000000-0000-4000-8000-000000000001',
    runId: 'taxcase_opaque_1',
    workspaceId: 'workspace_opaque_1',
    actorId,
    actorKind,
    action,
    occurredAt: T0,
    idempotencyKey: 'source-command-raw',
    safeMetadata,
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

  test('maps existing Factura E authority, proof, settlement, and accountant truth', () => {
    const common = {
      run: facturaERun(),
      consent: { version: 'consent-raw-v1', scopeHash: RAW_SCOPE_HASH },
      commitmentSecret: SECRET,
    };
    const proofEvents = createFacturaEAgentTaxDomainEvents({
      ...common,
      event: facturaEEvent('reclaim_proof_verified', 'reclaim', {
        purpose: 'arca_cae_constatement',
        proofHash: RAW_PROOF_HASH,
      }),
    });
    expect(proofEvents.map(event => event.kind)).toEqual([
      'reclaim.proof_verified',
      'factura_e.authority_verified',
    ]);
    expect(proofEvents.map(event => event.source.verifiedAt)).toEqual([
      PROOF_VERIFIED_AT,
      PROOF_VERIFIED_AT,
    ]);

    const authority = createFacturaEAgentTaxDomainEvents({
      ...common,
      event: facturaEEvent('wsfex_accepted', 'wsfex', {
        receiptHash: RAW_AUTHORITY_HASH,
      }),
    });
    expect(authority).toHaveLength(1);
    expect(authority[0]).toMatchObject({
      kind: 'factura_e.authority_verified',
      state: 'verified',
      caseRef: 'taxcase_opaque_1',
    });

    const settlementEvents = [];
    for (const [finalityState, expectedState] of [
      ['final', 'verified'],
      ['reversed', 'revoked'],
      ['disputed', 'blocked'],
    ] as const) {
      const settlement = createFacturaEAgentTaxDomainEvents({
        ...common,
        event: facturaEEvent(
          'factura_e_settlement_recorded',
          'tax_agent',
          { settlementReferenceHash: RAW_SETTLEMENT_REFERENCE, finalityState },
          'agent:tax-settlement',
        ),
      });
      expect(settlement).toHaveLength(1);
      expect(settlement[0]).toMatchObject({
        kind: 'invoice.settlement_finalized',
        state: expectedState,
        source: { verifiedAt: SETTLEMENT_VERIFIED_AT },
      });
      settlementEvents.push(...settlement);
    }
    expect(createFacturaEAgentTaxDomainEvents({
      ...common,
      event: facturaEEvent('factura_e_settlement_recorded', 'tax_agent', {
        settlementReferenceHash: RAW_SETTLEMENT_REFERENCE,
        finalityState: 'observed',
      }),
    })).toEqual([]);

    const accountant = createFacturaEAgentTaxDomainEvents({
      ...common,
      event: facturaEEvent('factura_e_fx_ingress_verified', 'accountant', {
        evidenceHash: RAW_SETTLEMENT_EVIDENCE,
      }),
      accountantMandate: { mandateId: 'mandate-raw-opaque' },
    });
    expect(accountant[0]).toMatchObject({
      kind: 'accountant.decision_recorded',
      state: 'recorded',
      source: { system: 'accountant_workspace' },
    });

    const serialized = JSON.stringify([
      ...proofEvents,
      ...authority,
      ...settlementEvents,
      ...accountant,
    ]);
    for (const forbidden of [
      RAW_AUTHORITY_HASH,
      RAW_PROOF_HASH,
      RAW_SETTLEMENT_REFERENCE,
      RAW_SETTLEMENT_EVIDENCE,
      RAW_SCOPE_HASH,
      'source-actor-raw',
      'source-command-raw',
      'consent-raw-v1',
      'mandate-raw-opaque',
    ]) expect(serialized).not.toContain(forbidden);
  });

  test('requires canonical settlement and accountant authorities before publishing truth', () => {
    const common = {
      run: facturaERun(),
      consent: { version: 'consent-raw-v1', scopeHash: RAW_SCOPE_HASH },
      commitmentSecret: SECRET,
    };
    expect(createFacturaEAgentTaxDomainEvents({
      ...common,
      event: facturaEEvent('factura_e_settlement_recorded', 'tax_agent', {
        settlementReferenceHash: RAW_SETTLEMENT_REFERENCE,
        finalityState: 'final',
      }),
    })).toEqual([]);
    expect(() => createFacturaEAgentTaxDomainEvents({
      ...common,
      event: facturaEEvent('factura_e_fx_ingress_verified', 'accountant', {
        evidenceHash: RAW_SETTLEMENT_EVIDENCE,
      }),
    })).toThrow('TAX_DOMAIN_EVENT_ACCOUNTANT_MANDATE_REQUIRED');
  });

  test('derives stable workspace-scoped event identities for safe replay', () => {
    const input = {
      run: facturaERun(),
      event: facturaEEvent('wsfex_accepted', 'wsfex', {
        receiptHash: RAW_AUTHORITY_HASH,
      }),
      consent: { version: 'consent-raw-v1', scopeHash: RAW_SCOPE_HASH },
      commitmentSecret: SECRET,
    };
    expect(createFacturaEAgentTaxDomainEvents(input)).toEqual(
      createFacturaEAgentTaxDomainEvents(input),
    );
    const otherWorkspace = {
      ...input,
      run: { ...input.run, workspaceId: 'workspace_opaque_2' },
      event: { ...input.event, workspaceId: 'workspace_opaque_2' },
    };
    expect(createFacturaEAgentTaxDomainEvents(otherWorkspace)[0]?.eventId)
      .not.toBe(createFacturaEAgentTaxDomainEvents(input)[0]?.eventId);
  });
});
