import {
  addReclaimSession,
  approveFacturaEAdjustment,
  approveFacturaEAdjustmentByAccountant,
  ARGENTINA_FACTURA_E_RULE_IDS,
  approveFacturaEIntent,
  approveFacturaEIntentByAccountant,
  buildEvidenceGraph,
  buildCapabilityManifest,
  closeReclaimSession,
  createFacturaEAgentRun,
  deriveFacturaEAdjustmentLedger,
  draftFacturaEIntent,
  facturaENextActions,
  hashCanonical,
  ingestVerifiedReclaimProof,
  markFacturaETaxDeclared,
  money as normalizeMoney,
  prepareFacturaEAdjustment,
  recordFacturaESettlement,
  recordWsfexAdjustmentAuthorityResult,
  recordWsfexAuthorityResult,
  requestFacturaEApproval,
  verifyFacturaEFxIngress,
  type FacturaEAgentRunV1,
  type FacturaEIntentV1,
  type FacturaEIssuancePath,
  type FacturaEProofPurpose,
  type FacturaESettlementV1,
  type TaxEvidenceRecord,
  type VerifiedReclaimProofV1,
} from '@tax-engine/core';

import type { ReclaimGateway, ReclaimRequestResult } from './reclaim';
import type { ReclaimProofVault } from './proof-vault';
import { buildHomologationPreflight } from './homologation';
import type { TaxProfileStore } from './store';
import type { WsfexGateway } from './wsfex';
import type { AuthorityPayloadWriter } from './authority-payload';
import type { AuthorityPayload } from '@tax-engine/wsfex-signer/contracts';

export type AgentMutationResult<T = undefined> = Readonly<{
  run: FacturaEAgentRunV1;
  replayed: boolean;
  output: T;
  nextActions: readonly string[];
}>;

export class FacturaEAgentService {
  constructor(
    private readonly store: TaxProfileStore,
    private readonly reclaim: ReclaimGateway | null,
    private readonly wsfex: WsfexGateway | null,
    private readonly proofVault: ReclaimProofVault | null = null,
    private readonly proofCustodyRequired = false,
    private readonly authorityPayloadWriter: AuthorityPayloadWriter | null = null
  ) {}

  capabilities(): Readonly<Record<string, unknown>> {
    return {
      version: 'factura-e-agent-capabilities-v1',
      execution: {
        reclaimCopilot: this.reclaim ? 'available' : 'configuration_required',
        wsfexDelegated: this.wsfex ? 'available' : 'configuration_required',
        wsfexAuthorityPayloadVault: this.authorityPayloadWriter ? 'available' : 'configuration_required',
        reclaimProofCustody: this.proofVault ? 'available' : this.proofCustodyRequired ? 'configuration_required' : 'not_required',
      },
      financialContext: buildCapabilityManifest(),
      invariants: [
        'agent_cannot_self_approve',
        'reclaim_proves_but_does_not_authorize',
        'arca_authorized_requires_verified_reclaim_or_wsfex_receipt',
        'wsfex_ambiguous_recovery_reuses_request_and_payload',
        'stablecoin_settlement_does_not_imply_fx_ingress',
        'finance_eligibility_stays_frozen_on_dispute_or_missing_evidence',
      ],
    };
  }

  homologationPreflight() {
    return buildHomologationPreflight();
  }

  createRun(input: Readonly<{
    runId: string;
    workspaceId: string;
    issuancePath: FacturaEIssuancePath;
    actorId: string;
    idempotencyKey: string;
    occurredAt: string;
  }>): AgentMutationResult {
    const replay = this.store.getFacturaEAgentRunByIdempotency(input.runId, input.idempotencyKey);
    if (replay) return result(replay, true, undefined);
    const existing = this.store.getFacturaEAgentRun(input.runId);
    if (existing) throw new Error('AGENT_RUN_ALREADY_EXISTS');
    const created = createFacturaEAgentRun(input);
    const run = this.persist(created.run, created.event, input.occurredAt);
    return result(run, false, undefined);
  }

  getRun(runId: string): FacturaEAgentRunV1 {
    const run = this.store.getFacturaEAgentRun(runId);
    if (!run) throw new Error('AGENT_RUN_NOT_FOUND');
    return run;
  }

  listRuns(workspaceId: string): readonly FacturaEAgentRunV1[] {
    return this.store.listFacturaEAgentRuns(workspaceId);
  }

  appendEvidence(records: readonly TaxEvidenceRecord[], appendedAt: string) {
    if (!records.length) throw new Error('EVIDENCE_RECORD_REQUIRED');
    const workspaceIds = new Set(records.map(record => record.workspaceId));
    if (workspaceIds.size !== 1) throw new Error('EVIDENCE_WORKSPACE_MISMATCH');
    const appended = this.store.appendEvidence(records, appendedAt);
    const workspaceId = records[0]!.workspaceId;
    const graph = buildEvidenceGraph(workspaceId, this.store.listEvidence(workspaceId));
    return { appended, graphRevision: graph.revision, gaps: graph.gaps };
  }

  listEvents(runId: string) {
    return this.store.listFacturaEAgentEvents(runId);
  }

  nextActions(run: FacturaEAgentRunV1): readonly string[] {
    return facturaENextActions(run);
  }

  copilotPacket(runId: string) {
    const run = this.getRun(runId);
    if (run.issuancePath !== 'reclaim_copilot' || run.issuanceState !== 'manual_action_required' || !run.intent || !run.intentHash) {
      throw new Error('MANUAL_ARCA_ISSUANCE_NOT_READY');
    }
    return {
      version: 'factura-e-copilot-packet-v1',
      runId: run.runId,
      intentHash: run.intentHash,
      arcaLoginUrl: 'https://auth.afip.gob.ar/contribuyente_/login.xhtml',
      service: 'Comprobantes en línea',
      credentialBoundary: 'The user enters CUIT/CUIL and Clave Fiscal only on ARCA. Motora must not receive or record them.',
      fields: {
        documentType: 19,
        operationType: 2,
        pointOfSale: run.intent.pointOfSale,
        issueDate: run.intent.issueDate,
        paymentDate: run.intent.paymentDate,
        destinationCountry: run.intent.destinationCountry,
        destinationCountryArcaCode: run.intent.destinationCountryArcaCode,
        foreignCustomerSafeLabel: run.intent.foreignCustomerSafeLabel,
        currency: run.intent.total.currency,
        exchangeRate: run.intent.exchangeRate,
        sameCurrencyPayment: run.intent.sameCurrencyPayment,
        serviceDescription: run.intent.serviceDescription,
        lineItems: run.intent.lineItems,
        total: run.intent.total,
        paymentTerms: run.intent.paymentTerms,
      },
      financialImpact: deriveFacturaEAdjustmentLedger(run),
      afterIssuance: {
        action: 'tax_ar_reclaim_start',
        purpose: 'arca_cae_constatement',
        warning: 'Do not mark the case ARCA-authorized until the CAE proof is cryptographically verified.',
      },
    };
  }

  prepareAdjustment(input: Readonly<{
    runId: string;
    adjustmentId: string;
    documentType: 20 | 21;
    issueDate: string;
    amount: Readonly<{ decimal: string; currency: string }>;
    reason: string;
    actorId: string;
    idempotencyKey: string;
    occurredAt: string;
  }>): AgentMutationResult<Readonly<{ adjustmentId: string; intentHash: string }>> {
    return this.mutate(input.runId, input.idempotencyKey, current => {
      const applied = prepareFacturaEAdjustment(current, { ...input, asOf: input.occurredAt.slice(0, 10) });
      return { run: applied.run, event: applied.event, output: { adjustmentId: applied.adjustment.adjustmentId, intentHash: applied.adjustment.intentHash } };
    }, input.occurredAt);
  }

  approveAdjustment(input: Readonly<{
    runId: string;
    adjustmentId: string;
    intentHash: string;
    actorId: string;
    idempotencyKey: string;
    occurredAt: string;
  }>): AgentMutationResult {
    return this.mutate(input.runId, input.idempotencyKey, current => {
      const applied = approveFacturaEAdjustment(current, input);
      return { ...applied, output: undefined };
    }, input.occurredAt);
  }

  approveAdjustmentByAccountant(input: Readonly<{
    runId: string;
    adjustmentId: string;
    intentHash: string;
    actorId: string;
    idempotencyKey: string;
    occurredAt: string;
  }>): AgentMutationResult {
    return this.mutate(input.runId, input.idempotencyKey, current => {
      const applied = approveFacturaEAdjustmentByAccountant(current, input);
      return { ...applied, output: undefined };
    }, input.occurredAt);
  }

  adjustmentCopilotPacket(runId: string, adjustmentId: string) {
    const run = this.getRun(runId);
    const adjustment = run.adjustments.find(candidate => candidate.adjustmentId === adjustmentId);
    if (!adjustment || run.issuancePath !== 'reclaim_copilot' || adjustment.issuanceState !== 'manual_action_required') {
      throw new Error('ADJUSTMENT_MANUAL_ISSUANCE_NOT_READY');
    }
    return {
      version: 'factura-e-adjustment-copilot-packet-v1',
      runId,
      adjustmentId,
      intentHash: adjustment.intentHash,
      arcaLoginUrl: 'https://auth.afip.gob.ar/contribuyente_/login.xhtml',
      service: 'Comprobantes en línea',
      credentialBoundary: 'The user authenticates only on ARCA. Motora never receives Clave Fiscal.',
      fields: {
        documentType: adjustment.documentType,
        pointOfSale: adjustment.associatedDocument.pointOfSale,
        issueDate: adjustment.issueDate,
        currency: adjustment.amount.currency,
        total: adjustment.amount,
        reason: adjustment.reason,
        associatedDocument: adjustment.associatedDocument,
      },
      financialImpact: deriveFacturaEAdjustmentLedger(run),
      afterIssuance: { action: 'tax_ar_reclaim_start', purpose: 'arca_adjustment_constatement', subjectId: adjustment.adjustmentId },
    };
  }

  accountingAttestationPacket(runId: string) {
    const run = this.getRun(runId);
    if (run.issuanceState !== 'arca_authorized' || !run.intent || !run.intentHash || !run.authority.invoiceNumber || !run.authority.cae) {
      throw new Error('ARCA_AUTHORIZATION_REQUIRED');
    }
    return {
      version: 'factura-e-accounting-attestation-packet-v1',
      runId: run.runId,
      workspaceId: run.workspaceId,
      generatedFromRevision: run.revision,
      invoice: {
        intentHash: run.intentHash,
        documentType: run.intent.documentType,
        operationType: run.intent.operationType,
        pointOfSale: run.intent.pointOfSale,
        invoiceNumber: run.authority.invoiceNumber,
        cae: run.authority.cae,
        authorizedAt: run.authority.authorizedAt,
        authorityReceiptHash: run.authority.receiptHash,
        issueDate: run.intent.issueDate,
        foreignCustomerSafeLabel: run.intent.foreignCustomerSafeLabel,
        destinationCountry: run.intent.destinationCountry,
        serviceDescription: run.intent.serviceDescription,
        lineItems: run.intent.lineItems,
        total: run.intent.total,
        ruleVersionIds: run.intent.ruleVersionIds,
      },
      adjustments: run.adjustments.map(adjustment => ({
        adjustmentId: adjustment.adjustmentId,
        intentHash: adjustment.intentHash,
        documentType: adjustment.documentType,
        association: adjustment.associatedDocument,
        issueDate: adjustment.issueDate,
        amount: adjustment.amount,
        reason: adjustment.reason,
        ruleVersionIds: adjustment.ruleVersionIds,
        issuanceState: adjustment.issuanceState,
        documentNumber: adjustment.authority.documentNumber,
        cae: adjustment.authority.cae,
        authorityReceiptHash: adjustment.authority.receiptHash,
      })),
      financialLedger: deriveFacturaEAdjustmentLedger(run),
      settlements: run.settlements,
      fxIngress: { state: run.fxIngressState, evidenceHash: run.fxIngressEvidenceHash },
      taxDeclaration: { state: run.taxDeclarationState, evidenceHash: run.taxDeclarationEvidenceHash },
      authorityProofs: run.verifiedProofs.map(proof => ({
        proofHash: proof.proofHash,
        purpose: proof.purpose,
        providerId: proof.providerId,
        providerVersion: proof.providerVersion,
        verifiedAt: proof.verifiedAt,
        attestation: proof.attestation,
        custodyReceipt: proof.custodyReceipt,
      })),
      accountingHandoff: {
        normalizedPacketReady: true,
        connectorAction: 'createInvoice',
        requiresApproval: true,
        supportedWorkspaceProviders: ['quickbooks', 'xero', 'contaazul'],
        argentinaErp: { providerId: 'contabilium', state: 'authorized_sandbox_required' },
      },
      underwritingEvidence: {
        financeEligibility: run.financeEligibility,
        state: run.financeEligibility === 'reviewable' ? 'reviewable' : 'frozen',
        paymentOutcomeOnly: true,
        limitation: 'This packet is consented evidence for review; it is not a TaxScore, credit decision, legal opinion, or factoring approval.',
      },
    };
  }

  draftIntent(input: Readonly<{
    runId: string;
    intent: FacturaEIntentV1;
    asOf: string;
    actorId: string;
    idempotencyKey: string;
    occurredAt: string;
  }>): AgentMutationResult<Readonly<{ valid: boolean; errors: readonly string[]; intentHash: string }>> {
    return this.mutate(input.runId, input.idempotencyKey, current => {
      const applied = draftFacturaEIntent(current, input);
      return { run: applied.run, event: applied.event, output: applied.validation };
    }, input.occurredAt);
  }

  proposeIntentFromEvidence(input: Readonly<{
    runId: string;
    economicEventId: string;
    intentId: string;
    foreignCustomerSafeLabel: string;
    destinationCountry: string;
    destinationCountryArcaCode: number;
    pointOfSale: number;
    issueDate: string;
    paymentDate: string;
    sameCurrencyPayment: boolean;
    exchangeRate: FacturaEIntentV1['exchangeRate'];
    serviceDescription: string;
    paymentTerms: string;
    unitCode: number;
    actorId: string;
    idempotencyKey: string;
    occurredAt: string;
  }>): AgentMutationResult<Readonly<{ valid: boolean; errors: readonly string[]; intentHash: string; sourceEvidenceIds: readonly string[] }>> {
    const replay = this.store.getFacturaEAgentRunByIdempotency(input.runId, input.idempotencyKey);
    if (replay) return result(replay, true, { valid: replay.intentState === 'validated', errors: [], intentHash: replay.intentHash ?? '', sourceEvidenceIds: [] });
    const current = this.getRun(input.runId);
    const profile = this.store.get(current.workspaceId);
    if (!profile || profile.jurisdiction !== 'AR') throw new Error('CONFIRMED_ARGENTINA_TAX_PROFILE_REQUIRED');
    const candidates = this.store.listEvidence(current.workspaceId).filter(record =>
      record.economicEventId === input.economicEventId
      && record.reviewState === 'accepted'
      && record.money
      && ['invoice', 'payment', 'settlement'].includes(record.economicRole)
    );
    if (!candidates.length) throw new Error('ACCEPTED_FINANCIAL_EVIDENCE_REQUIRED');
    const normalizedAmounts = candidates.map(record => normalizeMoney(record.money!.decimal, record.money!.currency));
    const moneyKeys = new Set(normalizedAmounts.map(value => `${value.currency}:${value.decimal}`));
    if (moneyKeys.size !== 1) throw new Error('FINANCIAL_EVIDENCE_AMOUNT_CONFLICT');
    const partyClaims = new Set(candidates.map(record => record.partyClaimHash).filter((value): value is string => Boolean(value)));
    if (partyClaims.size !== 1) throw new Error('FINANCIAL_EVIDENCE_COUNTERPARTY_CONFLICT');
    const money = normalizedAmounts[0]!;
    const intent: FacturaEIntentV1 = {
      version: 'factura-e-intent-v1',
      intentId: input.intentId,
      workspaceId: current.workspaceId,
      taxpayerReferenceHash: hashCanonical(profile.profileId),
      foreignCustomerReferenceHash: [...partyClaims][0]!,
      foreignCustomerSafeLabel: input.foreignCustomerSafeLabel,
      destinationCountry: input.destinationCountry,
      destinationCountryArcaCode: input.destinationCountryArcaCode,
      documentType: 19,
      operationType: 2,
      pointOfSale: input.pointOfSale,
      issueDate: input.issueDate,
      paymentDate: input.paymentDate,
      sameCurrencyPayment: input.sameCurrencyPayment,
      exchangeRate: input.exchangeRate,
      lineItems: [{ description: input.serviceDescription, quantity: '1', unitPrice: money.decimal, total: money.decimal, unitCode: input.unitCode }],
      total: money,
      serviceDescription: input.serviceDescription,
      paymentTerms: input.paymentTerms,
      ruleVersionIds: [...ARGENTINA_FACTURA_E_RULE_IDS],
    };
    const applied = draftFacturaEIntent(current, { ...input, intent, asOf: input.occurredAt.slice(0, 10) });
    const run = this.persist(applied.run, applied.event, input.occurredAt);
    return result(run, false, { ...applied.validation, sourceEvidenceIds: candidates.map(record => record.evidenceId) });
  }

  async startReclaim(input: Readonly<{
    runId: string;
    purpose: FacturaEProofPurpose;
    subjectId?: string | null;
    actorId: string;
    idempotencyKey: string;
    occurredAt: string;
  }>): Promise<AgentMutationResult<ReclaimRequestResult>> {
    if (!this.reclaim) throw new Error('RECLAIM_CONFIGURATION_REQUIRED');
    const replay = this.store.getFacturaEAgentRunByIdempotency(input.runId, input.idempotencyKey);
    if (replay) {
      const replayEvent = this.store.getFacturaEAgentEventByIdempotency(input.runId, input.idempotencyKey);
      const sessionId = replayEvent?.safeMetadata.sessionId;
      const session = typeof sessionId === 'string' ? replay.reclaimSessions.find(candidate => candidate.sessionId === sessionId) : null;
      if (!session) throw new Error('RECLAIM_REPLAY_SESSION_MISSING');
      const artifact = this.store.getReclaimRequestArtifact(session.sessionId);
      if (!artifact) throw new Error('RECLAIM_REPLAY_ARTIFACT_MISSING');
      return result(replay, true, {
        session,
        ...artifact,
      });
    }
    const current = this.getRun(input.runId);
    if (input.purpose === 'arca_cae_constatement' && current.issuanceState !== 'manual_action_required') throw new Error('MANUAL_ARCA_ISSUANCE_NOT_READY');
    if (input.purpose === 'arca_adjustment_constatement') {
      const adjustment = current.adjustments.find(candidate => candidate.adjustmentId === input.subjectId);
      if (!adjustment || adjustment.issuanceState !== 'manual_action_required') throw new Error('ADJUSTMENT_NOT_READY_FOR_PROOF');
    }
    const request = await this.reclaim.createRequest(current, input.purpose, input.occurredAt, input.subjectId);
    const applied = addReclaimSession(current, { ...input, session: request.session });
    const run = this.persist(applied.run, applied.event, input.occurredAt);
    this.store.bindReclaimSession(run.runId, request.session, input.occurredAt);
    this.store.saveReclaimRequestArtifact({
      sessionId: request.session.sessionId,
      requestUrl: request.requestUrl,
      requestConfig: request.requestConfig,
      statusUrl: request.statusUrl,
      storedAt: input.occurredAt,
    });
    return result(run, false, request);
  }

  async ingestReclaimCallback(sessionId: string, proofPayload: unknown, occurredAt: string): Promise<AgentMutationResult> {
    if (!this.reclaim) throw new Error('RECLAIM_CONFIGURATION_REQUIRED');
    const runId = this.store.getRunIdForReclaimSession(sessionId);
    if (!runId) throw new Error('RECLAIM_SESSION_NOT_FOUND');
    const current = this.getRun(runId);
    const session = current.reclaimSessions.find(candidate => candidate.sessionId === sessionId);
    if (!session) throw new Error('RECLAIM_SESSION_NOT_FOUND');
    let proof: VerifiedReclaimProofV1;
    try {
      proof = await this.reclaim.verifyCallback(current, session, proofPayload, occurredAt);
    } catch (error) {
      if (error instanceof Error && error.message === 'RECLAIM_SESSION_EXPIRED') {
        const idempotencyKey = `reclaim-session-expired:${session.sessionId}:${session.expiresAt}`;
        if (!this.store.getFacturaEAgentRunByIdempotency(runId, idempotencyKey)) {
          const closed = closeReclaimSession(current, {
            sessionId,
            state: 'expired',
            reasonCode: 'RECLAIM_SESSION_EXPIRED',
            actorId: 'system:reclaim-expiry',
            actorKind: 'system',
            occurredAt,
            idempotencyKey,
          });
          this.persist(closed.run, closed.event, occurredAt);
        }
      }
      throw error;
    }
    const idempotencyKey = `reclaim-proof:${proof.proofHash}`;
    const replay = this.store.getFacturaEAgentRunByIdempotency(runId, idempotencyKey);
    if (replay) return result(replay, true, undefined);
    if (this.proofCustodyRequired && !this.proofVault) throw new Error('RECLAIM_PROOF_VAULT_CONFIGURATION_REQUIRED');
    if (this.proofVault) {
      const custodyReceipt = await this.proofVault.storeVerifiedProof({ run: current, session, proof, proofPayload });
      proof = { ...proof, custodyReceipt };
    }
    const applied = ingestVerifiedReclaimProof(current, { proof, occurredAt, idempotencyKey });
    return result(this.persist(applied.run, applied.event, occurredAt), false, undefined);
  }

  cancelReclaimSession(input: Readonly<{
    runId: string;
    sessionId: string;
    actorId: string;
    idempotencyKey: string;
    occurredAt: string;
  }>): AgentMutationResult {
    return this.mutate(input.runId, input.idempotencyKey, current => {
      const closed = closeReclaimSession(current, {
        ...input,
        state: 'cancelled',
        reasonCode: 'USER_CANCELLED_RECLAIM_SESSION',
        actorKind: 'user',
      });
      return { ...closed, output: undefined };
    }, input.occurredAt);
  }

  requestApproval(input: Readonly<{
    runId: string;
    actorId: string;
    idempotencyKey: string;
    occurredAt: string;
  }>): AgentMutationResult {
    return this.mutate(input.runId, input.idempotencyKey, current => {
      this.assertProfileMatchesReadiness(current);
      const applied = requestFacturaEApproval(current, input);
      return { ...applied, output: undefined };
    }, input.occurredAt);
  }

  approveIntent(input: Readonly<{
    runId: string;
    actorId: string;
    intentHash: string;
    idempotencyKey: string;
    occurredAt: string;
  }>): AgentMutationResult {
    return this.mutate(input.runId, input.idempotencyKey, current => {
      const applied = approveFacturaEIntent(current, input);
      return { ...applied, output: undefined };
    }, input.occurredAt);
  }

  approveIntentByAccountant(input: Readonly<{
    runId: string;
    actorId: string;
    intentHash: string;
    idempotencyKey: string;
    occurredAt: string;
  }>): AgentMutationResult {
    return this.mutate(input.runId, input.idempotencyKey, current => {
      const applied = approveFacturaEIntentByAccountant(current, input);
      return { ...applied, output: undefined };
    }, input.occurredAt);
  }

  async prepareAndSubmitWsfex(input: Readonly<{
    runId: string;
    adjustmentId: string | null;
    requestId: string;
    invoiceNumber: string;
    issuerProfileRef: string;
    customer: Omit<AuthorityPayload['customer'], 'referenceHash'>;
    currencyArcaId: string;
    language: 1 | 2 | 3;
    commercialObservation: string | null;
    generalObservation: string | null;
    expiresAt: string;
    actorId: string;
    idempotencyKey: string;
    occurredAt: string;
  }>) {
    if (!this.authorityPayloadWriter) throw new Error('ARCA_BOUNDARY_CONFIGURATION_REQUIRED');
    if (!this.wsfex) throw new Error('WSFEX_CONFIGURATION_REQUIRED');
    const run = this.getRun(input.runId);
    if (!run.intent || !run.intentHash) throw new Error('FROZEN_INTENT_REQUIRED');
    const quote = run.intent.exchangeRate?.decimal ?? '1';
    let payload: AuthorityPayload;
    if (input.adjustmentId) {
      const adjustment = run.adjustments.find(candidate => candidate.adjustmentId === input.adjustmentId);
      if (!adjustment || adjustment.issuanceState !== 'ready_for_wsfex') throw new Error('ADJUSTMENT_WSFEX_SUBMISSION_NOT_READY');
      const canonicalDocument = {
        version: 'factura-e-adjustment-v1' as const,
        adjustmentId: adjustment.adjustmentId,
        documentType: adjustment.documentType,
        associatedDocument: adjustment.associatedDocument,
        issueDate: adjustment.issueDate,
        amount: adjustment.amount,
        reason: adjustment.reason,
        foreignCustomerReferenceHash: adjustment.foreignCustomerReferenceHash,
        destinationCountryArcaCode: adjustment.destinationCountryArcaCode,
        ruleVersionIds: [...adjustment.ruleVersionIds],
      };
      if (hashCanonical(canonicalDocument) !== adjustment.intentHash) throw new Error('ADJUSTMENT_CANONICAL_HASH_MISMATCH');
      payload = {
        version: 'wsfex-authority-payload-v1', canonicalDocument, issuerProfileRef: input.issuerProfileRef,
        subjectId: adjustment.adjustmentId, intentHash: adjustment.intentHash, requestId: input.requestId, invoiceNumber: input.invoiceNumber,
        documentType: adjustment.documentType, operationType: 2, pointOfSale: adjustment.associatedDocument.pointOfSale, issueDate: adjustment.issueDate,
        destinationCountryArcaCode: run.intent.destinationCountryArcaCode,
        customer: { referenceHash: run.intent.foreignCustomerReferenceHash, ...input.customer },
        currency: { safeCode: adjustment.amount.currency, arcaId: input.currencyArcaId, quote },
        sameCurrencyPayment: null, paymentDate: null, total: adjustment.amount.decimal, paymentTerms: null,
        commercialObservation: input.commercialObservation, generalObservation: input.generalObservation, language: input.language,
        associatedDocument: adjustment.associatedDocument,
        items: [{ code: null, description: adjustment.reason, quantity: '1', unitCode: 7, unitPrice: adjustment.amount.decimal, discount: '0', total: adjustment.amount.decimal }],
      };
    } else {
      if (run.issuanceState !== 'ready_for_wsfex' || run.intentState !== 'frozen') throw new Error('WSFEX_SUBMISSION_NOT_READY');
      if (hashCanonical(run.intent) !== run.intentHash) throw new Error('FACTURA_E_CANONICAL_HASH_MISMATCH');
      const canonicalDocument = {
        ...run.intent,
        lineItems: run.intent.lineItems.map(item => ({ ...item })),
        ruleVersionIds: [...run.intent.ruleVersionIds],
      };
      payload = {
        version: 'wsfex-authority-payload-v1', canonicalDocument, issuerProfileRef: input.issuerProfileRef,
        subjectId: run.intent.intentId, intentHash: run.intentHash, requestId: input.requestId, invoiceNumber: input.invoiceNumber,
        documentType: 19, operationType: 2, pointOfSale: run.intent.pointOfSale, issueDate: run.intent.issueDate,
        destinationCountryArcaCode: run.intent.destinationCountryArcaCode,
        customer: { referenceHash: run.intent.foreignCustomerReferenceHash, ...input.customer },
        currency: { safeCode: run.intent.total.currency, arcaId: input.currencyArcaId, quote },
        sameCurrencyPayment: run.intent.total.currency === 'ARS' ? null : run.intent.sameCurrencyPayment,
        paymentDate: run.intent.paymentDate, total: run.intent.total.decimal, paymentTerms: run.intent.paymentTerms,
        commercialObservation: input.commercialObservation, generalObservation: input.generalObservation, language: input.language,
        associatedDocument: null,
        items: run.intent.lineItems.map(item => ({ code: null, description: item.description, quantity: item.quantity, unitCode: item.unitCode, unitPrice: item.unitPrice, discount: '0', total: item.total })),
      };
    }
    const payloadReceipt = await this.authorityPayloadWriter.store({
      workspaceId: run.workspaceId, payload, expiresAt: input.expiresAt, idempotencyKey: `${input.idempotencyKey}:vault`,
    });
    const command = {
      runId: input.runId, requestId: input.requestId, authorityPayloadRef: payloadReceipt.reference, actorId: input.actorId,
      idempotencyKey: `${input.idempotencyKey}:submit`, occurredAt: input.occurredAt,
    };
    const submission = input.adjustmentId
      ? await this.submitWsfexAdjustment({ ...command, adjustmentId: input.adjustmentId })
      : await this.submitWsfex(command);
    return { payloadReceipt, submission };
  }

  async submitWsfex(input: Readonly<{
    runId: string;
    requestId: string;
    authorityPayloadRef: string;
    actorId: string;
    idempotencyKey: string;
    occurredAt: string;
  }>): Promise<AgentMutationResult> {
    if (!this.wsfex) throw new Error('WSFEX_CONFIGURATION_REQUIRED');
    const replay = this.store.getFacturaEAgentRunByIdempotency(input.runId, input.idempotencyKey);
    if (replay) return result(replay, true, undefined);
    const current = this.getRun(input.runId);
    const authority = await this.wsfex.authorize({ run: current, requestId: input.requestId, authorityPayloadRef: input.authorityPayloadRef });
    const applied = recordWsfexAuthorityResult(current, {
      ...input,
      ...authority,
      payloadReferenceHash: hashCanonical(input.authorityPayloadRef),
    });
    return result(this.persist(applied.run, applied.event, input.occurredAt), false, undefined);
  }

  async recoverWsfex(input: Readonly<{
    runId: string;
    requestId: string;
    authorityPayloadRef: string;
    actorId: string;
    idempotencyKey: string;
    occurredAt: string;
  }>): Promise<AgentMutationResult> {
    if (!this.wsfex) throw new Error('WSFEX_CONFIGURATION_REQUIRED');
    const replay = this.store.getFacturaEAgentRunByIdempotency(input.runId, input.idempotencyKey);
    if (replay) return result(replay, true, undefined);
    const current = this.getRun(input.runId);
    if (current.issuanceState !== 'ambiguous') throw new Error('WSFEX_OUTCOME_NOT_AMBIGUOUS');
    if (current.authority.requestId !== input.requestId) throw new Error('WSFEX_RECOVERY_REQUEST_ID_MISMATCH');
    if (current.authority.payloadReferenceHash !== hashCanonical(input.authorityPayloadRef)) throw new Error('WSFEX_RECOVERY_PAYLOAD_MISMATCH');
    const authority = await this.wsfex.recover({ run: current, requestId: input.requestId, authorityPayloadRef: input.authorityPayloadRef });
    const applied = recordWsfexAuthorityResult(current, {
      ...input,
      ...authority,
      payloadReferenceHash: hashCanonical(input.authorityPayloadRef),
    });
    return result(this.persist(applied.run, applied.event, input.occurredAt), false, undefined);
  }

  async submitWsfexAdjustment(input: Readonly<{
    runId: string;
    adjustmentId: string;
    requestId: string;
    authorityPayloadRef: string;
    actorId: string;
    idempotencyKey: string;
    occurredAt: string;
  }>): Promise<AgentMutationResult> {
    if (!this.wsfex) throw new Error('WSFEX_CONFIGURATION_REQUIRED');
    const replay = this.store.getFacturaEAgentRunByIdempotency(input.runId, input.idempotencyKey);
    if (replay) return result(replay, true, undefined);
    const current = this.getRun(input.runId);
    const adjustment = current.adjustments.find(candidate => candidate.adjustmentId === input.adjustmentId);
    if (!adjustment || adjustment.issuanceState !== 'ready_for_wsfex') throw new Error('ADJUSTMENT_WSFEX_SUBMISSION_NOT_READY');
    const authority = await this.wsfex.authorizeAdjustment({
      run: current,
      adjustmentId: input.adjustmentId,
      requestId: input.requestId,
      authorityPayloadRef: input.authorityPayloadRef,
    });
    const applied = recordWsfexAdjustmentAuthorityResult(current, {
      ...input,
      ...authority,
      documentNumber: authority.invoiceNumber,
      payloadReferenceHash: hashCanonical(input.authorityPayloadRef),
    });
    return result(this.persist(applied.run, applied.event, input.occurredAt), false, undefined);
  }

  async recoverWsfexAdjustment(input: Readonly<{
    runId: string;
    adjustmentId: string;
    requestId: string;
    authorityPayloadRef: string;
    actorId: string;
    idempotencyKey: string;
    occurredAt: string;
  }>): Promise<AgentMutationResult> {
    if (!this.wsfex) throw new Error('WSFEX_CONFIGURATION_REQUIRED');
    const replay = this.store.getFacturaEAgentRunByIdempotency(input.runId, input.idempotencyKey);
    if (replay) return result(replay, true, undefined);
    const current = this.getRun(input.runId);
    const adjustment = current.adjustments.find(candidate => candidate.adjustmentId === input.adjustmentId);
    if (!adjustment || adjustment.issuanceState !== 'ambiguous') throw new Error('ADJUSTMENT_WSFEX_OUTCOME_NOT_AMBIGUOUS');
    if (adjustment.authority.requestId !== input.requestId) throw new Error('ADJUSTMENT_WSFEX_RECOVERY_REQUEST_ID_MISMATCH');
    if (adjustment.authority.payloadReferenceHash !== hashCanonical(input.authorityPayloadRef)) throw new Error('ADJUSTMENT_WSFEX_RECOVERY_PAYLOAD_MISMATCH');
    const authority = await this.wsfex.recoverAdjustment({
      run: current,
      adjustmentId: input.adjustmentId,
      requestId: input.requestId,
      authorityPayloadRef: input.authorityPayloadRef,
    });
    const applied = recordWsfexAdjustmentAuthorityResult(current, {
      ...input,
      ...authority,
      documentNumber: authority.invoiceNumber,
      payloadReferenceHash: hashCanonical(input.authorityPayloadRef),
    });
    return result(this.persist(applied.run, applied.event, input.occurredAt), false, undefined);
  }

  recordSettlement(input: Readonly<{
    runId: string;
    settlement: FacturaESettlementV1;
    actorId: string;
    idempotencyKey: string;
    occurredAt: string;
  }>): AgentMutationResult {
    return this.mutate(input.runId, input.idempotencyKey, current => {
      const applied = recordFacturaESettlement(current, input);
      return { ...applied, output: undefined };
    }, input.occurredAt);
  }

  verifyFxIngress(input: Readonly<{
    runId: string;
    evidenceHash: string;
    actorId: string;
    idempotencyKey: string;
    occurredAt: string;
  }>): AgentMutationResult {
    return this.mutate(input.runId, input.idempotencyKey, current => {
      const applied = verifyFacturaEFxIngress(current, input);
      return { ...applied, output: undefined };
    }, input.occurredAt);
  }

  markTaxDeclared(input: Readonly<{
    runId: string;
    evidenceHash: string;
    actorId: string;
    idempotencyKey: string;
    occurredAt: string;
  }>): AgentMutationResult {
    return this.mutate(input.runId, input.idempotencyKey, current => {
      const applied = markFacturaETaxDeclared(current, input);
      return { ...applied, output: undefined };
    }, input.occurredAt);
  }

  private mutate<T>(
    runId: string,
    idempotencyKey: string,
    change: (run: FacturaEAgentRunV1) => Readonly<{ run: FacturaEAgentRunV1; event: Parameters<TaxProfileStore['appendFacturaEAgentRevision']>[0]['event']; output: T }>,
    occurredAt: string
  ): AgentMutationResult<T> {
    const replay = this.store.getFacturaEAgentRunByIdempotency(runId, idempotencyKey);
    if (replay) return result(replay, true, undefined as T);
    const current = this.getRun(runId);
    const changed = change(current);
    return result(this.persist(changed.run, changed.event, occurredAt), false, changed.output);
  }

  private persist(
    run: FacturaEAgentRunV1,
    event: Parameters<TaxProfileStore['appendFacturaEAgentRevision']>[0]['event'],
    appendedAt: string
  ): FacturaEAgentRunV1 {
    return this.store.appendFacturaEAgentRevision({ run, event, stateHash: hashCanonical(run), appendedAt });
  }

  private assertProfileMatchesReadiness(run: FacturaEAgentRunV1): void {
    const profile = this.store.get(run.workspaceId);
    if (!profile || profile.jurisdiction !== 'AR') throw new Error('CONFIRMED_ARGENTINA_TAX_PROFILE_REQUIRED');
    const expectedRegime = profile.regimeId === 'monotributo_exportador'
      ? 'monotributo'
      : profile.regimeId === 'responsable_inscripto'
        ? 'responsable_inscripto'
        : null;
    if (!expectedRegime) throw new Error('FACTURA_E_INDIVIDUAL_REGIME_REQUIRED');
    const proof = [...run.verifiedProofs].reverse().find(candidate => candidate.purpose === 'arca_taxpayer_readiness');
    if (!proof || !('regime' in proof.claims)) throw new Error('ARCA_READINESS_PROOF_REQUIRED');
    if (proof.claims.regime !== expectedRegime) throw new Error('ARCA_READINESS_PROFILE_MISMATCH');
  }
}

function result<T>(run: FacturaEAgentRunV1, replayed: boolean, output: T): AgentMutationResult<T> {
  return { run, replayed, output, nextActions: facturaENextActions(run) };
}
