import { createHmac } from 'node:crypto';

import {
  assertTaxDomainEventV1,
  hashCanonical,
  type ArcaOnboardingEventV1,
  type ArcaOnboardingRunV1,
  type AccountantMandateScope,
  type ExternalAccountantDecisionV1,
  type FacturaEFeatureV1,
  type FacturaEAgentEventV1,
  type FacturaEAgentRunV1,
  type TaxDomainEventV1,
  type TaxEvidenceConsentEventV1,
  type TaxObligation,
  type TaxWidgetSnapshotV1,
} from '@tax-engine/core';
import type { EvidenceGap } from '@tax-engine/core';

type ActiveConsent = Readonly<{
  version: string;
  scopeHash: string;
}>;

type ActiveAccountantMandate = Readonly<{
  mandateId: string;
}>;

type TaxDomainEventSpec = Readonly<{
  kind: TaxDomainEventV1['kind'];
  state: TaxDomainEventV1['state'];
  sourceSystem: TaxDomainEventV1['source']['system'];
  authenticationMethod: TaxDomainEventV1['authentication']['method'];
  principalRef: string;
  credentialVersion: string;
  verifiedAt: string;
  evidenceValues: readonly string[];
}>;

const ACCOUNTANT_DECISION_SCOPES: Readonly<Record<string, AccountantMandateScope>> = {
  factura_e_intent_accountant_approved: 'approve_invoice_intent',
  factura_e_adjustment_accountant_approved: 'approve_invoice_adjustment',
  factura_e_fx_ingress_verified: 'verify_fx_ingress',
  factura_e_tax_declared: 'record_tax_declaration',
};

const INVOICE_SETTLEMENT_AUTHORITY_ACTOR = 'agent:tax-settlement';

export function createArcaOnboardingTaxDomainEvent(input: Readonly<{
  run: ArcaOnboardingRunV1;
  event: ArcaOnboardingEventV1;
  consent: ActiveConsent;
  commitmentSecret: string;
  eventId?: string;
}>): TaxDomainEventV1 | null {
  if (
    input.event.action !== 'record_api_verification'
    && !(input.event.action === 'record_service_api_verification' && input.run.currentStep !== 'api_verification')
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
    eventId: input.eventId ?? uuidFromCommitment(
      commit(
        'event-id',
        input.event.eventId + ':' + (
          reclaim ? 'reclaim.proof_verified' : 'arca.api_verification_completed'
        ),
      ),
    ),
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
    eventId: input.eventId ?? uuidFromCommitment(
      commit('event-id', input.event.eventId + ':consent.revoked'),
    ),
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

/**
 * Publish a decision made by an external accountant workspace only after the
 * API has verified its request-bound principal, active mandate, and consent.
 * The event contains privacy commitments and closed state only; it is not the
 * source of the decision and cannot turn a reviewer note into approval.
 */
export function createExternalAccountantDecisionTaxDomainEvent(input: Readonly<{
  decision: ExternalAccountantDecisionV1;
  consent: ActiveConsent;
  authenticationProofHash: string;
  verifiedAt: string;
  commitmentSecret: string;
}>): TaxDomainEventV1 {
  assertCommitmentSecret(input.commitmentSecret);
  const decision = input.decision;
  const commit = (purpose: string, value: string) => privacyCommitment(
    input.commitmentSecret,
    purpose,
    decision.workspaceId,
    value,
  );
  const sourceHash = hashCanonical(decision);
  const eventSeed = `${decision.decisionId}:accountant.decision_recorded`;
  return assertTaxDomainEventV1({
    version: 'tax-domain-event-v1',
    eventId: uuidFromCommitment(commit('event-id', eventSeed)),
    workspaceId: decision.workspaceId,
    caseRef: decision.caseRef,
    kind: 'accountant.decision_recorded',
    state: decision.outcome === 'approved'
      ? 'recorded'
      : decision.outcome === 'rejected'
        ? 'rejected'
        : 'blocked',
    occurredAt: decision.occurredAt,
    idempotencyKey: `taxevt_${commit('idempotency', decision.idempotencyKey).slice(0, 40)}`,
    correlationRef: `taxcase_${commit('correlation', decision.caseRef).slice(0, 40)}`,
    source: {
      system: 'accountant_workspace',
      sourceEventHash: commit('source-event', sourceHash),
      verifiedAt: input.verifiedAt,
    },
    authentication: {
      method: 'm2m_signed_grant',
      principalRef: 'external_accountant_decision_ingress',
      credentialVersion: 'tax-tenant-principal-v3',
      signatureHash: commit('authentication', input.authenticationProofHash),
    },
    consent: {
      purpose: 'tax_workspace_processing',
      version: `consent_${commit('consent-version', input.consent.version).slice(0, 40)}`,
      scopeHash: commit('consent-scope', input.consent.scopeHash),
      state: 'active',
    },
    evidenceHashes: [decision.mandateId, ...decision.evidenceHashes]
      .map(value => commit('evidence', value)),
    ruleVersionIds: decision.ruleVersionIds,
    policyVersionIds: [
      ...decision.policyVersionIds,
      'tax-domain-event-minimization-v1',
    ],
    actionRefs: [
      `accountant_decision_${commit('action', `${decision.subject.kind}:${decision.subject.ref}`).slice(0, 40)}`,
    ],
  });
}

/**
 * Translate already-persistable Factura E state transitions into the one
 * privacy-minimized event contract consumed by Open Agents.
 *
 * This function does not decide authority or settlement truth. It only maps a
 * transition already accepted by the deterministic Factura E state machine.
 */
export function createFacturaEAgentTaxDomainEvents(input: Readonly<{
  run: FacturaEAgentRunV1;
  event: FacturaEAgentEventV1;
  consent: ActiveConsent;
  accountantMandate?: ActiveAccountantMandate | null;
  commitmentSecret: string;
}>): readonly TaxDomainEventV1[] {
  assertCommitmentSecret(input.commitmentSecret);
  const specs: TaxDomainEventSpec[] = [];
  const metadata = input.event.safeMetadata;

  if (input.event.action === 'reclaim_proof_verified') {
    const proofHash = stringValue(metadata.proofHash);
    const proof = input.run.verifiedProofs.find(
      candidate => candidate.proofHash === proofHash,
    );
    if (!proof) throw new Error('TAX_DOMAIN_EVENT_RECLAIM_PROOF_REQUIRED');
    specs.push({
      kind: 'reclaim.proof_verified',
      state: 'verified',
      sourceSystem: 'reclaim',
      authenticationMethod: 'provider_webhook',
      principalRef: 'reclaim_proof_verifier',
      credentialVersion: 'reclaim-proof-verifier-v1',
      verifiedAt: proof.verifiedAt,
      evidenceValues: strings(proofHash),
    });
    if (
      input.run.issuanceState === 'arca_authorized'
      && (
        metadata.purpose === 'arca_cae_constatement'
        || metadata.purpose === 'arca_adjustment_constatement'
      )
    ) {
      specs.push(authoritySpec(input.run, metadata, proof.verifiedAt));
    }
  }

  if (
    input.event.action === 'wsfex_accepted'
    || input.event.action === 'wsfex_adjustment_accepted'
  ) {
    specs.push(authoritySpec(input.run, metadata, input.event.occurredAt));
  }

  if (input.event.action === 'factura_e_settlement_recorded') {
    const finalityState = metadata.finalityState;
    if (
      finalityState === 'final'
      || finalityState === 'reversed'
      || finalityState === 'disputed'
    ) {
      const settlementReferenceHash = stringValue(metadata.settlementReferenceHash);
      const settlement = input.run.settlements.find(
        candidate => candidate.settlementReferenceHash === settlementReferenceHash,
      );
      if (
        input.event.actorId === INVOICE_SETTLEMENT_AUTHORITY_ACTOR
        && settlement?.evidence
      ) specs.push({
        kind: 'invoice.settlement_finalized',
        state:
          finalityState === 'final'
            ? 'verified'
            : finalityState === 'reversed'
              ? 'revoked'
              : 'blocked',
        sourceSystem: 'invoice_ledger',
        authenticationMethod: 'm2m_signed_grant',
        principalRef: 'invoice_settlement_verifier',
        credentialVersion: 'invoice-settlement-finalized-v1',
        verifiedAt: settlement.evidence.verification.verifiedAt,
        evidenceValues: strings(
          settlementReferenceHash,
          settlement?.evidence?.source.identityHash,
          settlement?.evidence?.verification.evidenceHash,
          settlement?.evidence?.fx?.evidenceHash,
        ),
      });
    }
  }

  if (
    input.event.actorKind === 'accountant'
    && accountantMandateScopeForFacturaEEvent(input.event) !== null
  ) {
    if (!input.accountantMandate) {
      throw new Error('TAX_DOMAIN_EVENT_ACCOUNTANT_MANDATE_REQUIRED');
    }
    specs.push({
      kind: 'accountant.decision_recorded',
      state: 'recorded',
      sourceSystem: 'accountant_workspace',
      authenticationMethod: 'm2m_signed_grant',
      principalRef: 'accountant_mandate_verifier',
      credentialVersion: 'accountant-decision-v1',
      verifiedAt: input.event.occurredAt,
      evidenceValues: strings(
        input.accountantMandate.mandateId,
        metadata.intentHash,
        metadata.evidenceHash,
        metadata.adjustmentId,
      ),
    });
  }

  const commit = (purpose: string, value: string) => privacyCommitment(
    input.commitmentSecret,
    purpose,
    input.run.workspaceId,
    value,
  );
  const sourceEventHash = hashCanonical(input.event);
  return specs.map(spec => assertTaxDomainEventV1({
    version: 'tax-domain-event-v1',
    eventId: uuidFromCommitment(
      commit('event-id', input.event.eventId + ':' + spec.kind),
    ),
    workspaceId: input.run.workspaceId,
    caseRef: input.run.runId,
    kind: spec.kind,
    state: spec.state,
    occurredAt: input.event.occurredAt,
    idempotencyKey: 'taxevt_' + commit(
      'idempotency',
      input.event.idempotencyKey + ':' + spec.kind,
    ).slice(0, 40),
    correlationRef: 'taxcase_' + commit('correlation', input.run.runId).slice(0, 40),
    source: {
      system: spec.sourceSystem,
      sourceEventHash: commit('source-event', sourceEventHash),
      verifiedAt: spec.verifiedAt,
    },
    authentication: {
      method: spec.authenticationMethod,
      principalRef: spec.principalRef,
      credentialVersion: spec.credentialVersion,
      signatureHash: commit('authentication', sourceEventHash),
    },
    consent: {
      purpose: 'tax_workspace_processing',
      version: 'consent_' + commit('consent-version', input.consent.version).slice(0, 40),
      scopeHash: commit('consent-scope', input.consent.scopeHash),
      state: 'active',
    },
    evidenceHashes: spec.evidenceValues.map(value => commit('evidence', value)),
    ruleVersionIds: facturaERuleVersions(input.run, metadata),
    policyVersionIds: ['tax-domain-event-minimization-v1'],
    actionRefs: [
      'tax_action_' + commit(
        'action',
        input.event.eventId + ':' + spec.kind,
      ).slice(0, 40),
    ],
  }));
}

export function accountantMandateScopeForFacturaEEvent(
  event: FacturaEAgentEventV1,
): AccountantMandateScope | null {
  if (event.actorKind !== 'accountant') return null;
  return ACCOUNTANT_DECISION_SCOPES[event.action] ?? null;
}

/**
 * Produce workspace-level notifications from the canonical durable Tax
 * projection. The snapshot remains the source of truth; these events contain
 * only enough information to wake a TaxCase and explain that a deterministic
 * state transition occurred.
 */
export function createSnapshotTaxDomainEvents(input: Readonly<{
  snapshot: TaxWidgetSnapshotV1;
  previousSnapshot: TaxWidgetSnapshotV1 | null;
  previousAsOf: string | null;
  projectionKey: string;
  asOf: string;
  generatedAt: string;
  consent: ActiveConsent;
  commitmentSecret: string;
}>): readonly TaxDomainEventV1[] {
  assertCommitmentSecret(input.commitmentSecret);
  if (
    input.previousSnapshot
    && input.previousSnapshot.workspaceId !== input.snapshot.workspaceId
  ) throw new Error('TAX_DOMAIN_EVENT_SNAPSHOT_WORKSPACE_MISMATCH');
  const events: TaxDomainEventV1[] = [];
  const currentGaps = new Map(
    input.snapshot.evidenceCoverage.gaps.map(gap => [gap.id, gap]),
  );
  const previousGaps = new Map(
    (input.previousSnapshot?.evidenceCoverage.gaps ?? []).map(gap => [gap.id, gap]),
  );
  for (const gap of currentGaps.values()) {
    const previous = previousGaps.get(gap.id);
    if (previous && hashCanonical(previous) === hashCanonical(gap)) continue;
    events.push(snapshotDomainEvent(input, gapEventSpec(gap)));
  }
  for (const gap of previousGaps.values()) {
    if (currentGaps.has(gap.id)) continue;
    events.push(snapshotDomainEvent(input, gapEventSpec(gap, true)));
  }

  const previousObligations = new Map(
    (input.previousSnapshot?.obligations ?? []).map(obligation => [obligation.id, obligation]),
  );
  const asOf = Date.parse(input.asOf);
  if (!Number.isFinite(asOf)) throw new Error('TAX_DOMAIN_EVENT_SNAPSHOT_AS_OF_INVALID');
  const previousAsOf = input.previousAsOf === null
    ? null
    : Date.parse(input.previousAsOf);
  if (previousAsOf !== null && !Number.isFinite(previousAsOf)) {
    throw new Error('TAX_DOMAIN_EVENT_PREVIOUS_SNAPSHOT_AS_OF_INVALID');
  }
  for (const obligation of input.snapshot.obligations) {
    if (!isDueObligation(obligation, asOf)) continue;
    const previous = previousObligations.get(obligation.id);
    if (
      previous
      && previousAsOf !== null
      && isDueObligation(previous, previousAsOf)
      && hashCanonical(previous) === hashCanonical(obligation)
    ) continue;
    events.push(snapshotDomainEvent(input, obligationEventSpec(obligation)));
  }
  return events;
}

/**
 * Translate the bound factoring-consumer receipt into the final event in the
 * canonical TaxDomainEventV1 vocabulary. The caller must append this event in
 * the same transaction that acknowledges the Factura E feature outbox row.
 */
export function createFacturaEFeaturePublishedTaxDomainEvent(input: Readonly<{
  feature: FacturaEFeatureV1;
  caseRef: string;
  workspaceId: string;
  receipt: Readonly<{
    version: 'factura-e-feature-event-receipt-v1';
    eventId: string;
    featureHash: string;
    accepted: true;
  }>;
  occurredAt: string;
  commitmentSecret: string;
}>): TaxDomainEventV1 {
  assertCommitmentSecret(input.commitmentSecret);
  if (
    input.receipt.eventId !== input.feature.eventId
    || input.receipt.featureHash !== input.feature.featureHash
  ) throw new Error('TAX_DOMAIN_EVENT_FACTURA_E_FEATURE_RECEIPT_MISMATCH');
  const commit = (purpose: string, value: string) => privacyCommitment(
    input.commitmentSecret,
    purpose,
    input.workspaceId,
    value,
  );
  const sourceReceiptHash = hashCanonical({
    version: input.receipt.version,
    eventId: input.receipt.eventId,
    featureHash: input.receipt.featureHash,
    accepted: input.receipt.accepted,
  });
  const eventSeed = `${input.feature.eventId}:factura_e_feature_published`;
  return assertTaxDomainEventV1({
    version: 'tax-domain-event-v1',
    eventId: uuidFromCommitment(commit('event-id', eventSeed)),
    workspaceId: input.workspaceId,
    caseRef: input.caseRef,
    kind: 'factura_e_feature_published',
    state: input.feature.lifecycle === 'active' ? 'verified' : 'revoked',
    occurredAt: input.occurredAt,
    idempotencyKey: 'taxevt_' + commit('idempotency', eventSeed).slice(0, 40),
    correlationRef: 'factura_feature_' + commit(
      'correlation',
      input.feature.featureId,
    ).slice(0, 40),
    source: {
      system: 'factoring',
      sourceEventHash: commit('source-event', sourceReceiptHash),
      verifiedAt: input.occurredAt,
    },
    authentication: {
      method: 'internal_outbox',
      principalRef: 'factura_e_feature_delivery_worker',
      credentialVersion: 'factura-e-feature-event-receipt-v1',
      signatureHash: commit('authentication', sourceReceiptHash),
    },
    consent: {
      purpose: 'factura_e_factoring',
      version: 'consent_' + commit(
        'consent-version',
        input.feature.consent.version,
      ).slice(0, 40),
      scopeHash: commit(
        'consent-scope',
        [
          input.feature.purpose,
          input.feature.workspaceCommitment,
          input.feature.invoiceCommitment,
        ].join(':'),
      ),
      state: input.feature.consent.state === 'active' ? 'active' : 'revoked',
    },
    evidenceHashes: [commit('evidence', input.feature.featureHash)],
    ruleVersionIds: [input.feature.schemaVersion, input.feature.policyVersion],
    policyVersionIds: ['tax-domain-event-minimization-v1'],
    actionRefs: [
      'tax_action_' + commit(
        'action',
        `${input.feature.eventId}:${input.feature.lifecycle}`,
      ).slice(0, 40),
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

type SnapshotEventSpec = Readonly<{
  kind: 'evidence.gap_changed' | 'obligation.due';
  state: TaxDomainEventV1['state'];
  subjectId: string;
  sourceSystem: 'evidence_graph' | 'tax_engine';
  evidenceValues: readonly string[];
  ruleVersionIds: readonly string[];
  actionId: string | null;
  transitionHash: string;
}>;

function snapshotDomainEvent(
  input: Parameters<typeof createSnapshotTaxDomainEvents>[0],
  spec: SnapshotEventSpec,
): TaxDomainEventV1 {
  const workspaceId = input.snapshot.workspaceId;
  const commit = (purpose: string, value: string) => privacyCommitment(
    input.commitmentSecret,
    purpose,
    workspaceId,
    value,
  );
  const eventSeed = [
    input.projectionKey,
    input.snapshot.period.start,
    input.snapshot.period.end,
    spec.kind,
    spec.subjectId,
    spec.transitionHash,
  ].join(':');
  const sourceHash = hashCanonical({
    projectionKey: input.projectionKey,
    period: input.snapshot.period,
    inputHash: input.snapshot.inputHash,
    kind: spec.kind,
    subjectId: spec.subjectId,
    transitionHash: spec.transitionHash,
  });
  return assertTaxDomainEventV1({
    version: 'tax-domain-event-v1',
    eventId: uuidFromCommitment(commit('event-id', eventSeed)),
    workspaceId,
    caseRef: null,
    kind: spec.kind,
    state: spec.state,
    occurredAt: input.generatedAt,
    idempotencyKey: 'taxevt_' + commit('idempotency', eventSeed).slice(0, 40),
    correlationRef: 'taxprojection_' + commit(
      'correlation',
      `${input.projectionKey}:${input.snapshot.period.start}:${input.snapshot.period.end}`,
    ).slice(0, 40),
    source: {
      system: spec.sourceSystem,
      sourceEventHash: commit('source-event', sourceHash),
      verifiedAt: input.asOf,
    },
    authentication: {
      method: 'internal_outbox',
      principalRef: spec.sourceSystem === 'evidence_graph'
        ? 'tax_evidence_graph_projection'
        : 'tax_obligation_catalogue_projection',
      credentialVersion: 'tax-snapshot-projection-v1',
      signatureHash: commit('authentication', sourceHash),
    },
    consent: {
      purpose: 'tax_workspace_processing',
      version: 'consent_' + commit('consent-version', input.consent.version).slice(0, 40),
      scopeHash: commit('consent-scope', input.consent.scopeHash),
      state: 'active',
    },
    evidenceHashes: spec.evidenceValues.map(value => commit('evidence', value)),
    ruleVersionIds: spec.ruleVersionIds,
    policyVersionIds: ['tax-domain-event-minimization-v1'],
    actionRefs: [
      'tax_action_' + commit(
        'action',
        spec.actionId ?? spec.subjectId,
      ).slice(0, 40),
    ],
  });
}

function gapEventSpec(gap: EvidenceGap, resolved = false): SnapshotEventSpec {
  return {
    kind: 'evidence.gap_changed',
    state: resolved
      ? 'verified'
      : gap.severity === 'blocking'
        ? 'blocked'
        : 'pending',
    subjectId: gap.id,
    sourceSystem: 'evidence_graph',
    evidenceValues: strings(
      gap.id,
      gap.economicEventId,
      ...gap.safeSourceReferenceIds,
    ),
    ruleVersionIds: ['tax-evidence-graph-v1'],
    actionId: gap.actionId,
    transitionHash: hashCanonical({ gap, resolved }),
  };
}

function obligationEventSpec(obligation: TaxObligation): SnapshotEventSpec {
  return {
    kind: 'obligation.due',
    state: obligation.applicability === 'applicable' ? 'ready' : 'blocked',
    subjectId: obligation.id,
    sourceSystem: 'tax_engine',
    evidenceValues: strings(
      obligation.id,
      obligation.dueAt,
      obligation.applicability,
    ),
    ruleVersionIds: obligation.ruleVersionIds,
    actionId: obligation.actionId,
    transitionHash: hashCanonical({
      id: obligation.id,
      dueAt: obligation.dueAt,
      applicability: obligation.applicability,
      preparationState: obligation.preparationState,
      submissionState: obligation.submissionState,
      satisfactionState: obligation.satisfactionState,
      ruleVersionIds: obligation.ruleVersionIds,
      actionId: obligation.actionId,
    }),
  };
}

function isDueObligation(obligation: TaxObligation, asOf: number): boolean {
  if (
    obligation.applicability === 'not_applicable'
    || obligation.dueAt === null
    || obligation.submissionState === 'accepted'
    || obligation.satisfactionState === 'satisfied'
  ) return false;
  const dueAt = Date.parse(obligation.dueAt);
  if (!Number.isFinite(dueAt)) throw new Error('TAX_DOMAIN_EVENT_OBLIGATION_DUE_AT_INVALID');
  return dueAt <= asOf;
}

function authoritySpec(
  run: FacturaEAgentRunV1,
  metadata: FacturaEAgentEventV1['safeMetadata'],
  fallbackVerifiedAt: string,
): TaxDomainEventSpec {
  const adjustmentId = stringValue(metadata.adjustmentId);
  const adjustment = adjustmentId
    ? run.adjustments.find(candidate => candidate.adjustmentId === adjustmentId)
    : null;
  return {
    kind: 'factura_e.authority_verified',
    state: 'verified',
    sourceSystem: 'arca',
    authenticationMethod: 'authority_receipt',
    principalRef: 'arca_factura_e_authority_verifier',
    credentialVersion: 'factura-e-authority-receipt-v1',
    verifiedAt: adjustment || stringValue(metadata.proofHash)
      ? fallbackVerifiedAt
      : run.authority.authorizedAt ?? fallbackVerifiedAt,
    evidenceValues: strings(
      run.authority.receiptHash,
      adjustment?.authority.receiptHash,
      metadata.receiptHash,
      metadata.proofHash,
    ),
  };
}

function facturaERuleVersions(
  run: FacturaEAgentRunV1,
  metadata: FacturaEAgentEventV1['safeMetadata'],
): readonly string[] {
  const adjustmentId = stringValue(metadata.adjustmentId);
  const adjustment = adjustmentId
    ? run.adjustments.find(candidate => candidate.adjustmentId === adjustmentId)
    : null;
  return [...new Set([
    ...(run.intent?.ruleVersionIds ?? []),
    ...(adjustment?.ruleVersionIds ?? []),
  ])].slice(0, 16);
}

function stringValue(value: string | number | boolean | null | undefined): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function strings(
  ...values: readonly (string | number | boolean | null | undefined)[]
): readonly string[] {
  return [...new Set(values.flatMap(value => {
    const normalized = stringValue(value);
    return normalized ? [normalized] : [];
  }))].slice(0, 16);
}

function assertCommitmentSecret(secret: string): void {
  if (Buffer.byteLength(secret) < 32) {
    throw new Error('TAX_DOMAIN_EVENT_COMMITMENT_HMAC_SECRET_REQUIRED');
  }
}

function uuidFromCommitment(commitment: string): string {
  if (!/^[a-f0-9]{64}$/.test(commitment)) {
    throw new Error('TAX_DOMAIN_EVENT_COMMITMENT_INVALID');
  }
  const bytes = Buffer.from(commitment.slice(0, 32), 'hex');
  bytes[6] = (bytes.readUInt8(6) & 0x0f) | 0x50;
  bytes[8] = (bytes.readUInt8(8) & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}
