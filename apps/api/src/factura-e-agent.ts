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
  deriveFacturaESettlementEvidenceLedger,
  draftFacturaEIntent,
  facturaENextActions,
  hashCanonical,
  ingestVerifiedReclaimProof,
  isActiveTaxEvidenceRecord,
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

export type FacturaEMutationFence = Readonly<{
  assertMutationAllowed(input: Readonly<{ runId: string; workspaceId: string }>): void;
}>;

export class FacturaEAgentService {
  constructor(
    private readonly store: TaxProfileStore,
    private readonly reclaim: ReclaimGateway | null,
    private readonly wsfex: WsfexGateway | null,
    private readonly proofVault: ReclaimProofVault | null = null,
    private readonly proofCustodyRequired = false,
    private readonly authorityPayloadWriter: AuthorityPayloadWriter | null = null,
    private readonly factoringMutationFence: FacturaEMutationFence | null = null
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
    const commandHash = facturaEAgentCommandHash('create_run', input);
    const replay = this.store.getFacturaEAgentRunByIdempotency(input.runId, input.idempotencyKey, commandHash);
    if (replay) return result(replay, true, undefined);
    const existing = this.store.getFacturaEAgentRun(input.runId);
    if (existing) throw new Error('AGENT_RUN_ALREADY_EXISTS');
    const created = createFacturaEAgentRun(input);
    return result(this.persist(created.run, created.event, input.occurredAt, commandHash), false, undefined);
  }

  bindLedgerInvoice(input: Readonly<{
    runId: string;
    ledgerInvoiceId: string;
    idempotencyKey: string;
    occurredAt: string;
  }>): { run: FacturaEAgentRunV1; replayed: boolean } {
    const run = this.getRun(input.runId);
    return {
      run,
      ...this.store.bindInvoiceTaxCase({
        workspaceId: run.workspaceId,
        invoiceId: input.ledgerInvoiceId,
        runId: run.runId,
        idempotencyKey: input.idempotencyKey,
        boundAt: input.occurredAt,
      }),
    };
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
    return this.mutate('prepare_adjustment', input, current => {
      this.factoringMutationFence?.assertMutationAllowed({
        runId: current.runId,
        workspaceId: current.workspaceId,
      });
      const applied = prepareFacturaEAdjustment(current, { ...input, asOf: input.occurredAt.slice(0, 10) });
      return { run: applied.run, event: applied.event, output: { adjustmentId: applied.adjustment.adjustmentId, intentHash: applied.adjustment.intentHash } };
    });
  }

  approveAdjustment(input: Readonly<{
    runId: string;
    adjustmentId: string;
    intentHash: string;
    actorId: string;
    idempotencyKey: string;
    occurredAt: string;
  }>): AgentMutationResult {
    return this.mutate('approve_adjustment', input, current => {
      const applied = approveFacturaEAdjustment(current, input);
      return { ...applied, output: undefined };
    });
  }

  approveAdjustmentByAccountant(input: Readonly<{
    runId: string;
    adjustmentId: string;
    intentHash: string;
    actorId: string;
    idempotencyKey: string;
    occurredAt: string;
  }>): AgentMutationResult {
    return this.mutate('approve_adjustment_by_accountant', input, current => {
      const applied = approveFacturaEAdjustmentByAccountant(current, input);
      return { ...applied, output: undefined };
    });
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
        caeExpiry: run.authority.caeExpiry,
        currencyId: run.authority.currencyId,
        currencyQuote: run.authority.currencyQuote,
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
        caeExpiry: adjustment.authority.caeExpiry,
        currencyId: adjustment.authority.currencyId,
        currencyQuote: adjustment.authority.currencyQuote,
        authorityReceiptHash: adjustment.authority.receiptHash,
      })),
      financialLedger: deriveFacturaEAdjustmentLedger(run),
      settlements: run.settlements,
      settlementEvidence: deriveFacturaESettlementEvidenceLedger(run.settlements),
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

  invoiceTaxCaseStatus(input: Readonly<{ workspaceId: string; runId: string }>) {
    const run = this.getRun(input.runId);
    const binding = this.store.getInvoiceTaxCaseBindingByRun(run.workspaceId, run.runId);
    if (run.workspaceId !== input.workspaceId || !binding)
      throw new Error('TAX_INVOICE_CASE_BINDING_CONFLICT');
    return {
      runId: run.runId,
      workspaceId: run.workspaceId,
      ledgerInvoiceId: binding.invoiceId,
      intentHash: run.intentHash,
      revision: run.revision,
      readinessState: run.readinessState,
      intentState: run.intentState,
      approvalState: run.approvalState,
      issuanceState: run.issuanceState,
    };
  }

  invoiceAuthorityAttestation(input: Readonly<{
    workspaceId: string;
    runId: string;
    ledgerInvoiceId: string;
    intentHash: string;
    authorityReceiptHash: string;
    authorityExecutionId: string;
    authorityEnvironment: 'homologation' | 'production';
    authorityProviderId: string;
  }>) {
    const run = this.getRun(input.runId);
    const binding = this.store.getInvoiceTaxCaseBindingByRun(run.workspaceId, run.runId);
    if (
      run.workspaceId !== input.workspaceId ||
      run.intentHash !== input.intentHash ||
      run.issuanceState !== 'arca_authorized' ||
      !run.intent ||
      run.intent.documentType !== 19 ||
      !binding ||
      binding.invoiceId !== input.ledgerInvoiceId
    )
      throw new Error('TAX_INVOICE_AUTHORITY_BINDING_CONFLICT');
    if (
      !run.authority.invoiceNumber ||
      !run.authority.cae ||
      !run.authority.caeExpiry ||
      !run.authority.currencyId ||
      !run.authority.currencyQuote ||
      !run.authority.authorizedAt ||
      !run.authority.receiptHash ||
      run.authority.receiptHash !== input.authorityReceiptHash
    )
      throw new Error('TAX_AUTHORITY_OFFICIAL_ATTESTATION_STATE_CONFLICT');
    return {
      version: 'factura-e-invoice-authority-attestation-v1' as const,
      authorityExecutionId: input.authorityExecutionId,
      workspaceId: run.workspaceId,
      ledgerInvoiceId: binding.invoiceId,
      runId: run.runId,
      intentHash: run.intentHash,
      revision: run.revision,
      authorityState: 'officially_reconciled' as const,
      authorityEnvironment: input.authorityEnvironment,
      authorityProviderId: input.authorityProviderId,
      invoice: {
        documentType: 19 as const,
        pointOfSale: run.intent.pointOfSale,
        invoiceNumber: run.authority.invoiceNumber,
        cae: run.authority.cae,
        caeExpiry: run.authority.caeExpiry,
        currencyId: run.authority.currencyId,
        currencyQuote: run.authority.currencyQuote,
        authorizedAt: run.authority.authorizedAt,
        authorityReceiptHash: run.authority.receiptHash,
        issueDate: run.intent.issueDate,
      },
    };
  }

  authorityPreparationBinding(input: Readonly<{
    workspaceId: string;
    runId: string;
    ledgerInvoiceId: string;
    intentHash: string;
  }>) {
    const run = this.getRun(input.runId);
    const binding = this.store.getInvoiceTaxCaseBindingByRun(run.workspaceId, run.runId);
    if (
      run.workspaceId !== input.workspaceId ||
      run.intentHash !== input.intentHash ||
      run.intentState !== 'frozen' ||
      run.issuanceState !== 'ready_for_wsfex' ||
      !run.intent ||
      !binding ||
      binding.invoiceId !== input.ledgerInvoiceId
    )
      throw new Error('TAX_INVOICE_AUTHORITY_BINDING_CONFLICT');
    return {
      version: 'factura-e-authority-preparation-binding-v1' as const,
      ledgerInvoiceId: binding.invoiceId,
      taxpayerReferenceHash: run.intent.taxpayerReferenceHash,
      foreignCustomerReferenceHash: run.intent.foreignCustomerReferenceHash,
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
    return this.mutate('draft_intent', input, current => {
      const applied = draftFacturaEIntent(current, input);
      return { run: applied.run, event: applied.event, output: applied.validation };
    });
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
    const commandHash = facturaEAgentCommandHash('propose_intent_from_evidence', input);
    const replay = this.store.getFacturaEAgentRunByIdempotency(input.runId, input.idempotencyKey, commandHash);
    if (replay) return result(replay, true, { valid: replay.intentState === 'validated', errors: [], intentHash: replay.intentHash ?? '', sourceEvidenceIds: [] });
    const current = this.getRun(input.runId);
    const profile = this.store.get(current.workspaceId);
    if (!profile || profile.jurisdiction !== 'AR') throw new Error('CONFIRMED_ARGENTINA_TAX_PROFILE_REQUIRED');
    const candidates = this.store.listEvidence(current.workspaceId).filter(record =>
      record.economicEventId === input.economicEventId
      && record.reviewState === 'accepted'
      && isActiveTaxEvidenceRecord(record)
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
    const run = this.persist(applied.run, applied.event, input.occurredAt, commandHash);
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
    const commandHash = facturaEAgentCommandHash('start_reclaim', input);
    const replay = this.store.getFacturaEAgentRunByIdempotency(input.runId, input.idempotencyKey, commandHash);
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
    const run = this.persist(applied.run, applied.event, input.occurredAt, commandHash);
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
        const expiryCommand = {
          runId, sessionId, state: 'expired', reasonCode: 'RECLAIM_SESSION_EXPIRED',
          actorId: 'system:reclaim-expiry', idempotencyKey, occurredAt,
        } as const;
        const commandHash = facturaEAgentCommandHash('expire_reclaim_session', expiryCommand);
        if (!this.store.getFacturaEAgentRunByIdempotency(runId, idempotencyKey, commandHash)) {
          const closed = closeReclaimSession(current, {
            ...expiryCommand,
            actorKind: 'system',
          });
          this.persist(closed.run, closed.event, occurredAt, commandHash);
        }
      }
      throw error;
    }
    const idempotencyKey = `reclaim-proof:${proof.proofHash}`;
    const command = { runId, sessionId, proofHash: proof.proofHash, actorId: 'reclaim', idempotencyKey, occurredAt };
    const commandHash = facturaEAgentCommandHash('ingest_reclaim_proof', command);
    const replay = this.store.getFacturaEAgentRunByIdempotency(runId, idempotencyKey, commandHash);
    if (replay) return result(replay, true, undefined);
    if (this.proofCustodyRequired && !this.proofVault) throw new Error('RECLAIM_PROOF_VAULT_CONFIGURATION_REQUIRED');
    if (this.proofVault) {
      const custodyReceipt = await this.proofVault.storeVerifiedProof({ run: current, session, proof, proofPayload });
      proof = { ...proof, custodyReceipt };
    }
    const applied = ingestVerifiedReclaimProof(current, { proof, occurredAt, idempotencyKey });
    return result(this.persist(applied.run, applied.event, occurredAt, commandHash), false, undefined);
  }

  cancelReclaimSession(input: Readonly<{
    runId: string;
    sessionId: string;
    actorId: string;
    idempotencyKey: string;
    occurredAt: string;
  }>): AgentMutationResult {
    return this.mutate('cancel_reclaim_session', input, current => {
      const closed = closeReclaimSession(current, {
        ...input,
        state: 'cancelled',
        reasonCode: 'USER_CANCELLED_RECLAIM_SESSION',
        actorKind: 'user',
      });
      return { ...closed, output: undefined };
    });
  }

  requestApproval(input: Readonly<{
    runId: string;
    actorId: string;
    idempotencyKey: string;
    occurredAt: string;
  }>): AgentMutationResult {
    return this.mutate('request_approval', input, current => {
      this.assertProfileMatchesReadiness(current);
      const applied = requestFacturaEApproval(current, input);
      return { ...applied, output: undefined };
    });
  }

  approveIntent(input: Readonly<{
    runId: string;
    actorId: string;
    intentHash: string;
    idempotencyKey: string;
    occurredAt: string;
  }>): AgentMutationResult {
    return this.mutate('approve_intent', input, current => {
      const applied = approveFacturaEIntent(current, input);
      return { ...applied, output: undefined };
    });
  }

  approveIntentByAccountant(input: Readonly<{
    runId: string;
    actorId: string;
    intentHash: string;
    idempotencyKey: string;
    occurredAt: string;
  }>): AgentMutationResult {
    return this.mutate('approve_intent_by_accountant', input, current => {
      const applied = approveFacturaEIntentByAccountant(current, input);
      return { ...applied, output: undefined };
    });
  }

  async prepareAndSubmitWsfex(input: Readonly<{
    runId: string;
    adjustmentId: string | null;
    requestId: string;
    invoiceNumber: string;
    issuerProfileRef: string;
    representedCuitCommitment: string;
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
        taxpayerReferenceHash: run.intent.taxpayerReferenceHash, representedCuitCommitment: input.representedCuitCommitment,
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
        taxpayerReferenceHash: run.intent.taxpayerReferenceHash, representedCuitCommitment: input.representedCuitCommitment,
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
      runId: input.runId, requestId: input.requestId, authorityPayloadRef: payloadReceipt.reference,
      authorityPayloadHash: payloadReceipt.payloadHash, actorId: input.actorId,
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
    authorityPayloadHash: string;
    actorId: string;
    idempotencyKey: string;
    occurredAt: string;
  }>): Promise<AgentMutationResult> {
    if (!this.wsfex) throw new Error('WSFEX_CONFIGURATION_REQUIRED');
    const commandHash = facturaEAgentCommandHash('submit_wsfex', input);
    const replay = this.store.getFacturaEAgentRunByIdempotency(input.runId, input.idempotencyKey, commandHash);
    if (replay) return result(replay, true, undefined);
    const current = this.getRun(input.runId);
    const authority = await this.wsfex.authorize({ run: current, requestId: input.requestId, authorityPayloadRef: input.authorityPayloadRef, authorityPayloadHash: input.authorityPayloadHash });
    const applied = recordWsfexAuthorityResult(current, {
      ...input,
      ...authority,
      payloadReferenceHash: hashCanonical(input.authorityPayloadRef),
    });
    return result(this.persist(applied.run, applied.event, input.occurredAt, commandHash), false, undefined);
  }

  async recoverWsfex(input: Readonly<{
    runId: string;
    requestId: string;
    authorityPayloadRef: string;
    authorityPayloadHash: string;
    actorId: string;
    idempotencyKey: string;
    occurredAt: string;
  }>): Promise<AgentMutationResult> {
    if (!this.wsfex) throw new Error('WSFEX_CONFIGURATION_REQUIRED');
    const commandHash = facturaEAgentCommandHash('recover_wsfex', input);
    const replay = this.store.getFacturaEAgentRunByIdempotency(input.runId, input.idempotencyKey, commandHash);
    if (replay) return result(replay, true, undefined);
    const current = this.getRun(input.runId);
    if (current.issuanceState !== 'ambiguous') throw new Error('WSFEX_OUTCOME_NOT_AMBIGUOUS');
    if (current.authority.requestId !== input.requestId) throw new Error('WSFEX_RECOVERY_REQUEST_ID_MISMATCH');
    if (current.authority.payloadReferenceHash !== hashCanonical(input.authorityPayloadRef)) throw new Error('WSFEX_RECOVERY_PAYLOAD_MISMATCH');
    const authority = await this.wsfex.recover({ run: current, requestId: input.requestId, authorityPayloadRef: input.authorityPayloadRef, authorityPayloadHash: input.authorityPayloadHash });
    const applied = recordWsfexAuthorityResult(current, {
      ...input,
      ...authority,
      payloadReferenceHash: hashCanonical(input.authorityPayloadRef),
    });
    return result(this.persist(applied.run, applied.event, input.occurredAt, commandHash), false, undefined);
  }

  /**
   * Project an independently reconciled authority result back into the durable
   * Factura E case. The authority corridor owns submission/recovery; this
   * method only records the already verified official read so the existing
   * settlement and accounting workflow can continue from `arca_authorized`.
   */
  recordAuthorityCorridorReconciliation(input: Readonly<{
    runId: string;
    requestId: string;
    authorityPayloadRef: string;
    invoiceNumber: string;
    cae: string;
    caeExpiry: string;
    currencyId: string;
    currencyQuote: string;
    receiptHash: string;
    reprocessed: boolean | null;
    actorId: string;
    idempotencyKey: string;
    occurredAt: string;
  }>): AgentMutationResult {
    const commandHash = facturaEAgentCommandHash(
      'record_authority_corridor_reconciliation',
      input
    );
    const replay = this.store.getFacturaEAgentRunByIdempotency(
      input.runId,
      input.idempotencyKey,
      commandHash
    );
    if (replay) return result(replay, true, undefined);
    const current = this.getRun(input.runId);
    const applied = recordWsfexAuthorityResult(current, {
      actorId: input.actorId,
      requestId: input.requestId,
      payloadReferenceHash: hashCanonical(input.authorityPayloadRef),
      status: 'accepted',
      invoiceNumber: input.invoiceNumber,
      cae: input.cae,
      caeExpiry: input.caeExpiry,
      currencyId: input.currencyId,
      currencyQuote: input.currencyQuote,
      receiptHash: input.receiptHash,
      reprocessed: input.reprocessed,
      occurredAt: input.occurredAt,
      idempotencyKey: input.idempotencyKey,
    });
    return result(
      this.persist(applied.run, applied.event, input.occurredAt, commandHash),
      false,
      undefined
    );
  }

  async submitWsfexAdjustment(input: Readonly<{
    runId: string;
    adjustmentId: string;
    requestId: string;
    authorityPayloadRef: string;
    authorityPayloadHash: string;
    actorId: string;
    idempotencyKey: string;
    occurredAt: string;
  }>): Promise<AgentMutationResult> {
    if (!this.wsfex) throw new Error('WSFEX_CONFIGURATION_REQUIRED');
    const commandHash = facturaEAgentCommandHash('submit_wsfex_adjustment', input);
    const replay = this.store.getFacturaEAgentRunByIdempotency(input.runId, input.idempotencyKey, commandHash);
    if (replay) return result(replay, true, undefined);
    const current = this.getRun(input.runId);
    const adjustment = current.adjustments.find(candidate => candidate.adjustmentId === input.adjustmentId);
    if (!adjustment || adjustment.issuanceState !== 'ready_for_wsfex') throw new Error('ADJUSTMENT_WSFEX_SUBMISSION_NOT_READY');
    const authority = await this.wsfex.authorizeAdjustment({
      run: current,
      adjustmentId: input.adjustmentId,
      requestId: input.requestId,
      authorityPayloadRef: input.authorityPayloadRef,
      authorityPayloadHash: input.authorityPayloadHash,
    });
    const applied = recordWsfexAdjustmentAuthorityResult(current, {
      ...input,
      ...authority,
      documentNumber: authority.invoiceNumber,
      payloadReferenceHash: hashCanonical(input.authorityPayloadRef),
    });
    return result(this.persist(applied.run, applied.event, input.occurredAt, commandHash), false, undefined);
  }

  async recoverWsfexAdjustment(input: Readonly<{
    runId: string;
    adjustmentId: string;
    requestId: string;
    authorityPayloadRef: string;
    authorityPayloadHash: string;
    actorId: string;
    idempotencyKey: string;
    occurredAt: string;
  }>): Promise<AgentMutationResult> {
    if (!this.wsfex) throw new Error('WSFEX_CONFIGURATION_REQUIRED');
    const commandHash = facturaEAgentCommandHash('recover_wsfex_adjustment', input);
    const replay = this.store.getFacturaEAgentRunByIdempotency(input.runId, input.idempotencyKey, commandHash);
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
      authorityPayloadHash: input.authorityPayloadHash,
    });
    const applied = recordWsfexAdjustmentAuthorityResult(current, {
      ...input,
      ...authority,
      documentNumber: authority.invoiceNumber,
      payloadReferenceHash: hashCanonical(input.authorityPayloadRef),
    });
    return result(this.persist(applied.run, applied.event, input.occurredAt, commandHash), false, undefined);
  }

  recordSettlement(input: Readonly<{
    runId: string;
    settlement: FacturaESettlementV1;
    actorId: string;
    idempotencyKey: string;
    occurredAt: string;
  }>): AgentMutationResult {
    return this.mutate('record_settlement', input, current => {
      this.factoringMutationFence?.assertMutationAllowed({
        runId: current.runId,
        workspaceId: current.workspaceId,
      });
      const applied = recordFacturaESettlement(current, input);
      return { ...applied, output: undefined };
    });
  }

  verifyFxIngress(input: Readonly<{
    runId: string;
    evidenceHash: string;
    actorId: string;
    idempotencyKey: string;
    occurredAt: string;
  }>): AgentMutationResult {
    return this.mutate('verify_fx_ingress', input, current => {
      const applied = verifyFacturaEFxIngress(current, input);
      return { ...applied, output: undefined };
    });
  }

  markTaxDeclared(input: Readonly<{
    runId: string;
    evidenceHash: string;
    actorId: string;
    idempotencyKey: string;
    occurredAt: string;
  }>): AgentMutationResult {
    return this.mutate('mark_tax_declared', input, current => {
      const applied = markFacturaETaxDeclared(current, input);
      return { ...applied, output: undefined };
    });
  }

  private mutate<T, Input extends Readonly<{ runId: string; idempotencyKey: string; occurredAt: string }>>(
    operation: string,
    input: Input,
    change: (run: FacturaEAgentRunV1) => Readonly<{ run: FacturaEAgentRunV1; event: Parameters<TaxProfileStore['appendFacturaEAgentRevision']>[0]['event']; output: T }>,
  ): AgentMutationResult<T> {
    const commandHash = facturaEAgentCommandHash(operation, input);
    const replay = this.store.getFacturaEAgentRunByIdempotency(input.runId, input.idempotencyKey, commandHash);
    if (replay) return result(replay, true, undefined as T);
    const current = this.getRun(input.runId);
    const changed = change(current);
    return result(this.persist(changed.run, changed.event, input.occurredAt, commandHash), false, changed.output);
  }

  private persist(
    run: FacturaEAgentRunV1,
    event: Parameters<TaxProfileStore['appendFacturaEAgentRevision']>[0]['event'],
    appendedAt: string,
    commandHash: string
  ): FacturaEAgentRunV1 {
    return this.store.appendFacturaEAgentRevision({ run, event, stateHash: hashCanonical(run), commandHash, appendedAt });
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

function facturaEAgentCommandHash(operation: string, input: object): string {
  const command = { ...input } as Record<string, unknown>;
  // These fields identify/re-time a retry; neither changes the requested mutation.
  delete command.idempotencyKey;
  delete command.occurredAt;
  return hashCanonical({ operation, command });
}

function result<T>(run: FacturaEAgentRunV1, replayed: boolean, output: T): AgentMutationResult<T> {
  return { run, replayed, output, nextActions: facturaENextActions(run) };
}
