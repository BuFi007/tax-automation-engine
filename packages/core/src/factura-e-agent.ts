import { createHash, randomUUID } from 'node:crypto';
import Decimal from 'decimal.js';

import type { IsoDate, IsoDateTime } from './types';
import { ARGENTINA_FACTURA_E_RULE_IDS } from './catalogue/argentina';

export type FacturaEIssuancePath = 'reclaim_copilot' | 'wsfex_delegated';
export type FacturaEProofPurpose = 'arca_taxpayer_readiness' | 'arca_cae_constatement' | 'arca_adjustment_constatement';

export type FacturaEMoney = Readonly<{
  decimal: string;
  currency: string;
}>;

export type FacturaELineItemV1 = Readonly<{
  description: string;
  quantity: string;
  unitPrice: string;
  total: string;
  unitCode: number;
}>;

export type FacturaEIntentV1 = Readonly<{
  version: 'factura-e-intent-v1';
  intentId: string;
  workspaceId: string;
  taxpayerReferenceHash: string;
  foreignCustomerReferenceHash: string;
  foreignCustomerSafeLabel: string;
  destinationCountry: string;
  destinationCountryArcaCode: number;
  documentType: 19;
  operationType: 2;
  pointOfSale: number;
  issueDate: IsoDate;
  paymentDate: IsoDate;
  sameCurrencyPayment: boolean;
  exchangeRate: Readonly<{
    decimal: string;
    sourceReferenceId: string;
    observedForDate: IsoDate;
    authorityRuleDecisionId: string;
  }> | null;
  lineItems: readonly FacturaELineItemV1[];
  total: FacturaEMoney;
  serviceDescription: string;
  paymentTerms: string;
  ruleVersionIds: readonly string[];
}>;

export type ArcaReadinessClaimsV1 = Readonly<{
  regime: 'monotributo' | 'responsable_inscripto';
  category: string | null;
  exportActivityEnabled: true;
  exportPointOfSaleActive: true;
  exportPointOfSale: number;
}>;

export type ArcaCaeClaimsV1 = Readonly<{
  documentType: 19 | 20 | 21;
  pointOfSale: number;
  invoiceNumber: string;
  cae: string;
  issuedAt: IsoDate;
  total: FacturaEMoney;
  associatedDocumentType: 19 | null;
  associatedPointOfSale: number | null;
  associatedInvoiceNumber: string | null;
}>;

export type ReclaimSessionReferenceV1 = Readonly<{
  sessionId: string;
  purpose: FacturaEProofPurpose;
  providerId: string;
  providerVersion: string;
  contextHash: string;
  subjectId: string | null;
  subjectHash: string | null;
  requestedAt: IsoDateTime;
  expiresAt: IsoDateTime;
  state: 'pending' | 'verified' | 'failed' | 'expired' | 'cancelled';
}>;

export type VerifiedReclaimProofV1 = Readonly<{
  proofHash: string;
  sessionId: string;
  purpose: FacturaEProofPurpose;
  providerId: string;
  providerVersion: string;
  verifiedAt: IsoDateTime;
  attestation: Readonly<{
    teeRequired: boolean;
    teeVerified: boolean;
  }>;
  custodyReceipt: ReclaimProofCustodyReceiptV1 | null;
  claims: ArcaReadinessClaimsV1 | ArcaCaeClaimsV1;
}>;

export type ReclaimProofCustodyReceiptV1 = Readonly<{
  version: 'reclaim-proof-custody-receipt-v1';
  opaqueReference: string;
  artifactHash: string;
  encryptionVersion: string;
  retentionPolicyId: string;
  storedAt: IsoDateTime;
}>;

export type FacturaESettlementV1 = Readonly<{
  settlementReferenceHash: string;
  asset: string;
  network: string;
  amount: FacturaEMoney;
  observedAt: IsoDateTime;
  finalityState: 'observed' | 'final' | 'reversed' | 'disputed';
  fees: FacturaEMoney | null;
  reversesSettlementReferenceHash: string | null;
}>;

export type FacturaEAdjustmentV1 = Readonly<{
  version: 'factura-e-adjustment-v1';
  adjustmentId: string;
  documentType: 20 | 21;
  associatedDocument: Readonly<{
    documentType: 19;
    pointOfSale: number;
    invoiceNumber: string;
  }>;
  issueDate: IsoDate;
  amount: FacturaEMoney;
  reason: string;
  ruleVersionIds: readonly string[];
  intentHash: string;
  approvalState: 'pending' | 'user_approved' | 'accountant_approved' | 'rejected';
  issuanceState: 'not_ready' | 'manual_action_required' | 'ready_for_wsfex' | 'ambiguous' | 'arca_authorized' | 'rejected';
  authority: Readonly<{
    requestId: string | null;
    payloadReferenceHash: string | null;
    documentNumber: string | null;
    cae: string | null;
    receiptHash: string | null;
    reprocessed: boolean | null;
  }>;
}>;

export type FacturaEAdjustmentLedgerV1 = Readonly<{
  version: 'factura-e-adjustment-ledger-v1';
  currency: string;
  originalTotal: string;
  authorizedDebitTotal: string;
  authorizedCreditTotal: string;
  pendingDebitTotal: string;
  pendingCreditTotal: string;
  netAuthorizedTotal: string;
  netProjectedTotal: string;
  finalSettlementTotal: string;
  settlementGap: string;
  hasOpenAdjustment: boolean;
  hasAuthorizedDilution: boolean;
}>;

export type FacturaEAgentEventV1 = Readonly<{
  eventId: string;
  runId: string;
  workspaceId: string;
  actorId: string;
  actorKind: 'tax_agent' | 'user' | 'accountant' | 'reclaim' | 'wsfex' | 'system';
  action: string;
  occurredAt: IsoDateTime;
  idempotencyKey: string;
  safeMetadata: Readonly<Record<string, string | number | boolean | null>>;
}>;

export type FacturaEAgentRunV1 = Readonly<{
  version: 'factura-e-agent-run-v1';
  runId: string;
  workspaceId: string;
  issuancePath: FacturaEIssuancePath;
  accountantReviewRequired: boolean;
  revision: number;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  readinessState: 'unverified' | 'proof_pending' | 'verified' | 'failed';
  intentState: 'missing' | 'drafted' | 'validated' | 'frozen';
  approvalState: 'not_requested' | 'pending' | 'user_approved' | 'accountant_approved' | 'rejected';
  issuanceState:
    | 'not_ready'
    | 'manual_action_required'
    | 'ready_for_wsfex'
    | 'submitted'
    | 'ambiguous'
    | 'arca_authorized'
    | 'rejected';
  settlementState: 'unobserved' | 'observed' | 'final' | 'reversed' | 'disputed';
  fxIngressState: 'unverified' | 'verified' | 'not_applicable';
  taxDeclarationState: 'not_ready' | 'ready_for_accountant' | 'declared' | 'amendment_required';
  financeEligibility: 'frozen' | 'reviewable';
  intent: FacturaEIntentV1 | null;
  intentHash: string | null;
  reclaimSessions: readonly ReclaimSessionReferenceV1[];
  verifiedProofs: readonly VerifiedReclaimProofV1[];
  authority: Readonly<{
    requestId: string | null;
    payloadReferenceHash: string | null;
    invoiceNumber: string | null;
    cae: string | null;
    authorizedAt: IsoDateTime | null;
    receiptHash: string | null;
    reprocessed: boolean | null;
  }>;
  settlements: readonly FacturaESettlementV1[];
  adjustments: readonly FacturaEAdjustmentV1[];
  fxIngressEvidenceHash: string | null;
  taxDeclarationEvidenceHash: string | null;
  eventIds: readonly string[];
}>;

export type FacturaEIntentValidation = Readonly<{
  valid: boolean;
  errors: readonly string[];
  intentHash: string;
}>;

export function createFacturaEAgentRun(input: Readonly<{
  runId?: string;
  workspaceId: string;
  issuancePath: FacturaEIssuancePath;
  actorId: string;
  occurredAt: IsoDateTime;
  idempotencyKey: string;
}>): Readonly<{ run: FacturaEAgentRunV1; event: FacturaEAgentEventV1 }> {
  const runId = input.runId ?? randomUUID();
  const event = eventFor(runId, input.workspaceId, input.actorId, 'tax_agent', 'factura_e_run_created', input.occurredAt, input.idempotencyKey, {
    issuancePath: input.issuancePath,
  });
  return {
    run: {
      version: 'factura-e-agent-run-v1',
      runId,
      workspaceId: input.workspaceId,
      issuancePath: input.issuancePath,
      accountantReviewRequired: input.issuancePath === 'wsfex_delegated',
      revision: 1,
      createdAt: input.occurredAt,
      updatedAt: input.occurredAt,
      readinessState: 'unverified',
      intentState: 'missing',
      approvalState: 'not_requested',
      issuanceState: 'not_ready',
      settlementState: 'unobserved',
      fxIngressState: 'unverified',
      taxDeclarationState: 'not_ready',
      financeEligibility: 'frozen',
      intent: null,
      intentHash: null,
      reclaimSessions: [],
      verifiedProofs: [],
      authority: {
        requestId: null,
        payloadReferenceHash: null,
        invoiceNumber: null,
        cae: null,
        authorizedAt: null,
        receiptHash: null,
        reprocessed: null,
      },
      settlements: [],
      adjustments: [],
      fxIngressEvidenceHash: null,
      taxDeclarationEvidenceHash: null,
      eventIds: [event.eventId],
    },
    event,
  };
}

export function validateFacturaEIntent(intent: FacturaEIntentV1, asOf: IsoDate): FacturaEIntentValidation {
  const errors: string[] = [];
  if (intent.documentType !== 19) errors.push('FACTURA_E_DOCUMENT_TYPE_REQUIRED');
  if (intent.operationType !== 2) errors.push('SERVICE_EXPORT_OPERATION_TYPE_REQUIRED');
  if (!/^[A-Z]{2}$/.test(intent.destinationCountry)) errors.push('DESTINATION_COUNTRY_INVALID');
  if (!Number.isInteger(intent.destinationCountryArcaCode) || intent.destinationCountryArcaCode <= 0) errors.push('DESTINATION_ARCA_CODE_INVALID');
  if (!Number.isInteger(intent.pointOfSale) || intent.pointOfSale <= 0 || intent.pointOfSale > 99999) errors.push('EXPORT_POINT_OF_SALE_INVALID');
  if (!isIsoDate(intent.issueDate) || !isIsoDate(intent.paymentDate) || !isIsoDate(asOf)) errors.push('INVOICE_DATE_INVALID');
  if (isIsoDate(intent.issueDate) && isIsoDate(intent.paymentDate) && intent.paymentDate < intent.issueDate) errors.push('PAYMENT_DATE_BEFORE_ISSUE_DATE');
  if (isIsoDate(intent.issueDate) && isIsoDate(asOf) && Math.abs(daysBetween(intent.issueDate, asOf)) > 5) errors.push('AUTHORIZATION_DATE_OUTSIDE_FIVE_DAY_WINDOW');
  if (!intent.serviceDescription.trim()) errors.push('SERVICE_DESCRIPTION_REQUIRED');
  if (!intent.paymentTerms.trim()) errors.push('PAYMENT_TERMS_REQUIRED');
  if (!intent.taxpayerReferenceHash || !intent.foreignCustomerReferenceHash) errors.push('SAFE_PARTY_REFERENCES_REQUIRED');
  for (const requiredRule of ARGENTINA_FACTURA_E_RULE_IDS) {
    if (!intent.ruleVersionIds.includes(requiredRule)) errors.push(`REQUIRED_RULE_MISSING_${requiredRule.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`);
  }
  if (!/^[A-Z]{3,10}$/.test(intent.total.currency)) errors.push('CURRENCY_INVALID');
  const total = decimalOrError(intent.total.decimal, 'TOTAL_INVALID', errors);
  if (total?.isNegative()) errors.push('TOTAL_NEGATIVE');
  if (!intent.lineItems.length) errors.push('LINE_ITEM_REQUIRED');
  let calculatedTotal = new Decimal(0);
  for (const [index, item] of intent.lineItems.entries()) {
    if (!item.description.trim()) errors.push(`LINE_${index + 1}_DESCRIPTION_REQUIRED`);
    const quantity = decimalOrError(item.quantity, `LINE_${index + 1}_QUANTITY_INVALID`, errors);
    const unitPrice = decimalOrError(item.unitPrice, `LINE_${index + 1}_UNIT_PRICE_INVALID`, errors);
    const itemTotal = decimalOrError(item.total, `LINE_${index + 1}_TOTAL_INVALID`, errors);
    if (quantity && unitPrice && itemTotal) {
      if (quantity.isNegative() || unitPrice.isNegative() || itemTotal.isNegative()) errors.push(`LINE_${index + 1}_NEGATIVE_VALUE`);
      if (!quantity.mul(unitPrice).toDecimalPlaces(2).eq(itemTotal.toDecimalPlaces(2))) errors.push(`LINE_${index + 1}_TOTAL_MISMATCH`);
      calculatedTotal = calculatedTotal.add(itemTotal);
    }
  }
  if (total && !calculatedTotal.toDecimalPlaces(2).eq(total.toDecimalPlaces(2))) errors.push('INVOICE_TOTAL_MISMATCH');
  if (intent.total.currency !== 'ARS') {
    if (!intent.exchangeRate) errors.push('FOREIGN_CURRENCY_QUOTE_REQUIRED');
    else {
      const quote = decimalOrError(intent.exchangeRate.decimal, 'EXCHANGE_RATE_INVALID', errors);
      if (quote && !quote.isPositive()) errors.push('EXCHANGE_RATE_NOT_POSITIVE');
      if (!intent.exchangeRate.sourceReferenceId || !intent.exchangeRate.authorityRuleDecisionId) errors.push('EXCHANGE_RATE_PROVENANCE_REQUIRED');
      if (!isIsoDate(intent.exchangeRate.observedForDate) || intent.exchangeRate.observedForDate > intent.issueDate) errors.push('EXCHANGE_RATE_DATE_INVALID');
    }
  } else if (intent.exchangeRate) {
    errors.push('ARS_EXCHANGE_RATE_MUST_BE_NULL');
  }
  return { valid: errors.length === 0, errors, intentHash: hashCanonical(intent) };
}

export function draftFacturaEIntent(run: FacturaEAgentRunV1, input: Readonly<{
  intent: FacturaEIntentV1;
  asOf: IsoDate;
  actorId: string;
  occurredAt: IsoDateTime;
  idempotencyKey: string;
}>): Readonly<{ run: FacturaEAgentRunV1; event: FacturaEAgentEventV1; validation: FacturaEIntentValidation }> {
  if (run.approvalState === 'user_approved' || run.intentState === 'frozen') throw new Error('APPROVED_INTENT_IS_IMMUTABLE');
  if (input.intent.workspaceId !== run.workspaceId) throw new Error('INTENT_WORKSPACE_MISMATCH');
  const validation = validateFacturaEIntent(input.intent, input.asOf);
  const event = eventFor(run.runId, run.workspaceId, input.actorId, 'tax_agent', 'factura_e_intent_drafted', input.occurredAt, input.idempotencyKey, {
    intentHash: validation.intentHash,
    valid: validation.valid,
    errorCount: validation.errors.length,
  });
  return {
    run: nextRun(run, input.occurredAt, event, {
      intent: input.intent,
      intentHash: validation.intentHash,
      intentState: validation.valid ? 'validated' : 'drafted',
      approvalState: 'not_requested',
      issuanceState: 'not_ready',
    }),
    event,
    validation,
  };
}

export function addReclaimSession(run: FacturaEAgentRunV1, input: Readonly<{
  session: ReclaimSessionReferenceV1;
  actorId: string;
  occurredAt: IsoDateTime;
  idempotencyKey: string;
}>): Readonly<{ run: FacturaEAgentRunV1; event: FacturaEAgentEventV1 }> {
  if (run.reclaimSessions.some(session => session.sessionId === input.session.sessionId)) throw new Error('RECLAIM_SESSION_ALREADY_EXISTS');
  if (input.session.purpose === 'arca_cae_constatement' && !run.intentHash) throw new Error('INVOICE_INTENT_REQUIRED');
  if (input.session.purpose === 'arca_adjustment_constatement') {
    const adjustment = run.adjustments.find(candidate => candidate.adjustmentId === input.session.subjectId);
    if (!adjustment || adjustment.intentHash !== input.session.subjectHash || adjustment.issuanceState !== 'manual_action_required') {
      throw new Error('ADJUSTMENT_NOT_READY_FOR_PROOF');
    }
  }
  const event = eventFor(run.runId, run.workspaceId, input.actorId, 'tax_agent', 'reclaim_verification_requested', input.occurredAt, input.idempotencyKey, {
    purpose: input.session.purpose,
    sessionId: input.session.sessionId,
    providerId: input.session.providerId,
  });
  return {
    run: nextRun(run, input.occurredAt, event, {
      reclaimSessions: [...run.reclaimSessions, input.session],
      readinessState: input.session.purpose === 'arca_taxpayer_readiness' ? 'proof_pending' : run.readinessState,
    }),
    event,
  };
}

export function ingestVerifiedReclaimProof(run: FacturaEAgentRunV1, input: Readonly<{
  proof: VerifiedReclaimProofV1;
  occurredAt: IsoDateTime;
  idempotencyKey: string;
}>): Readonly<{ run: FacturaEAgentRunV1; event: FacturaEAgentEventV1 }> {
  const session = run.reclaimSessions.find(candidate => candidate.sessionId === input.proof.sessionId);
  if (!session) throw new Error('RECLAIM_SESSION_NOT_FOUND');
  if (session.state === 'verified' || run.verifiedProofs.some(proof => proof.proofHash === input.proof.proofHash)) throw new Error('RECLAIM_PROOF_REPLAY');
  if (session.purpose !== input.proof.purpose || session.providerId !== input.proof.providerId || session.providerVersion !== input.proof.providerVersion) {
    throw new Error('RECLAIM_PROOF_BINDING_MISMATCH');
  }
  if (input.proof.purpose === 'arca_cae_constatement') assertCaeMatchesIntent(input.proof.claims as ArcaCaeClaimsV1, run);
  if (input.proof.purpose === 'arca_adjustment_constatement') assertCaeMatchesAdjustment(input.proof.claims as ArcaCaeClaimsV1, run, session);
  const event = eventFor(run.runId, run.workspaceId, 'reclaim', 'reclaim', 'reclaim_proof_verified', input.occurredAt, input.idempotencyKey, {
    purpose: input.proof.purpose,
    proofHash: input.proof.proofHash,
  });
  const sessions = run.reclaimSessions.map(candidate => candidate.sessionId === session.sessionId ? { ...candidate, state: 'verified' as const } : candidate);
  const readiness = input.proof.purpose === 'arca_taxpayer_readiness' ? 'verified' as const : run.readinessState;
  const caeClaims = input.proof.purpose === 'arca_cae_constatement' ? input.proof.claims as ArcaCaeClaimsV1 : null;
  const adjustmentClaims = input.proof.purpose === 'arca_adjustment_constatement' ? input.proof.claims as ArcaCaeClaimsV1 : null;
  const adjustments = adjustmentClaims
    ? run.adjustments.map(adjustment => adjustment.adjustmentId === session.subjectId
      ? {
          ...adjustment,
          issuanceState: 'arca_authorized' as const,
          authority: {
            ...adjustment.authority,
            documentNumber: adjustmentClaims.invoiceNumber,
            cae: adjustmentClaims.cae,
            receiptHash: input.proof.proofHash,
          },
        }
      : adjustment)
    : run.adjustments;
  const settlementState = adjustmentClaims ? deriveSettlementState(run, run.settlements, adjustments) : run.settlementState;
  const taxDeclarationState = adjustmentClaims
    ? deriveTaxDeclarationState(run, settlementState, true)
    : caeClaims && run.settlementState === 'final' && run.fxIngressState === 'verified'
      ? 'ready_for_accountant' as const
      : run.taxDeclarationState;
  return {
    run: nextRun(run, input.occurredAt, event, {
      reclaimSessions: sessions,
      verifiedProofs: [...run.verifiedProofs, input.proof],
      readinessState: readiness,
      issuanceState: caeClaims ? 'arca_authorized' : run.issuanceState,
      authority: caeClaims ? {
        ...run.authority,
        invoiceNumber: caeClaims.invoiceNumber,
        cae: caeClaims.cae,
        authorizedAt: input.proof.verifiedAt,
        receiptHash: input.proof.proofHash,
        reprocessed: null,
      } : run.authority,
      adjustments,
      settlementState,
      financeEligibility: adjustmentClaims ? deriveFinanceEligibility(run, settlementState, adjustments, run.settlements) : run.financeEligibility,
      taxDeclarationState,
    }),
    event,
  };
}

export function closeReclaimSession(run: FacturaEAgentRunV1, input: Readonly<{
  sessionId: string;
  state: 'failed' | 'expired' | 'cancelled';
  reasonCode: string;
  actorId: string;
  actorKind: 'user' | 'reclaim' | 'system';
  occurredAt: IsoDateTime;
  idempotencyKey: string;
}>): Readonly<{ run: FacturaEAgentRunV1; event: FacturaEAgentEventV1 }> {
  const session = run.reclaimSessions.find(candidate => candidate.sessionId === input.sessionId);
  if (!session) throw new Error('RECLAIM_SESSION_NOT_FOUND');
  if (session.state !== 'pending') throw new Error('RECLAIM_SESSION_ALREADY_TERMINAL');
  if (!/^[A-Z0-9_]+$/.test(input.reasonCode)) throw new Error('RECLAIM_SESSION_REASON_INVALID');
  const event = eventFor(run.runId, run.workspaceId, input.actorId, input.actorKind, `reclaim_session_${input.state}`, input.occurredAt, input.idempotencyKey, {
    sessionId: session.sessionId,
    purpose: session.purpose,
    reasonCode: input.reasonCode,
  });
  return {
    run: nextRun(run, input.occurredAt, event, {
      reclaimSessions: run.reclaimSessions.map(candidate => candidate.sessionId === session.sessionId ? { ...candidate, state: input.state } : candidate),
      readinessState: session.purpose === 'arca_taxpayer_readiness'
        ? input.state === 'failed' ? 'failed' : 'unverified'
        : run.readinessState,
    }),
    event,
  };
}

export function requestFacturaEApproval(run: FacturaEAgentRunV1, input: Readonly<{
  actorId: string;
  occurredAt: IsoDateTime;
  idempotencyKey: string;
}>): Readonly<{ run: FacturaEAgentRunV1; event: FacturaEAgentEventV1 }> {
  if (run.readinessState !== 'verified') throw new Error('ARCA_READINESS_PROOF_REQUIRED');
  if (run.intentState !== 'validated' || !run.intentHash) throw new Error('VALIDATED_INTENT_REQUIRED');
  const readinessProof = [...run.verifiedProofs].reverse().find(proof => proof.purpose === 'arca_taxpayer_readiness');
  if (!readinessProof || !run.intent) throw new Error('ARCA_READINESS_PROOF_REQUIRED');
  const readinessClaims = readinessProof.claims as ArcaReadinessClaimsV1;
  if (readinessClaims.exportPointOfSale !== run.intent.pointOfSale) throw new Error('EXPORT_POINT_OF_SALE_PROOF_MISMATCH');
  const event = eventFor(run.runId, run.workspaceId, input.actorId, 'tax_agent', 'factura_e_user_approval_requested', input.occurredAt, input.idempotencyKey, {
    intentHash: run.intentHash,
  });
  return { run: nextRun(run, input.occurredAt, event, { approvalState: 'pending' }), event };
}

export function approveFacturaEIntent(run: FacturaEAgentRunV1, input: Readonly<{
  actorId: string;
  intentHash: string;
  occurredAt: IsoDateTime;
  idempotencyKey: string;
}>): Readonly<{ run: FacturaEAgentRunV1; event: FacturaEAgentEventV1 }> {
  if (run.approvalState !== 'pending') throw new Error('USER_APPROVAL_NOT_REQUESTED');
  if (!run.intentHash || input.intentHash !== run.intentHash) throw new Error('APPROVAL_INTENT_HASH_MISMATCH');
  const approvalState = 'user_approved' as const;
  const issuanceState = run.accountantReviewRequired
    ? 'not_ready' as const
    : run.issuancePath === 'reclaim_copilot' ? 'manual_action_required' as const : 'ready_for_wsfex' as const;
  const event = eventFor(run.runId, run.workspaceId, input.actorId, 'user', 'factura_e_intent_approved', input.occurredAt, input.idempotencyKey, {
    intentHash: run.intentHash,
    accountantReviewRequired: run.accountantReviewRequired,
    issuancePath: run.issuancePath,
  });
  return {
    run: nextRun(run, input.occurredAt, event, { approvalState, intentState: 'frozen', issuanceState }),
    event,
  };
}

export function approveFacturaEIntentByAccountant(run: FacturaEAgentRunV1, input: Readonly<{
  actorId: string;
  intentHash: string;
  occurredAt: IsoDateTime;
  idempotencyKey: string;
}>): Readonly<{ run: FacturaEAgentRunV1; event: FacturaEAgentEventV1 }> {
  if (!run.accountantReviewRequired) throw new Error('ACCOUNTANT_REVIEW_NOT_REQUIRED');
  if (run.approvalState !== 'user_approved') throw new Error('USER_APPROVAL_REQUIRED_BEFORE_ACCOUNTANT');
  if (!run.intentHash || input.intentHash !== run.intentHash) throw new Error('APPROVAL_INTENT_HASH_MISMATCH');
  const issuanceState = run.issuancePath === 'reclaim_copilot' ? 'manual_action_required' as const : 'ready_for_wsfex' as const;
  const event = eventFor(run.runId, run.workspaceId, input.actorId, 'accountant', 'factura_e_intent_accountant_approved', input.occurredAt, input.idempotencyKey, {
    intentHash: run.intentHash,
    issuancePath: run.issuancePath,
  });
  return {
    run: nextRun(run, input.occurredAt, event, { approvalState: 'accountant_approved', issuanceState }),
    event,
  };
}

export function recordWsfexAuthorityResult(run: FacturaEAgentRunV1, input: Readonly<{
  actorId: string;
  requestId: string;
  payloadReferenceHash: string;
  status: 'accepted' | 'rejected' | 'ambiguous';
  invoiceNumber: string | null;
  cae: string | null;
  receiptHash: string;
  reprocessed: boolean | null;
  occurredAt: IsoDateTime;
  idempotencyKey: string;
}>): Readonly<{ run: FacturaEAgentRunV1; event: FacturaEAgentEventV1 }> {
  if (run.issuancePath !== 'wsfex_delegated') throw new Error('WSFEX_PATH_REQUIRED');
  if (!/^[1-9]\d{0,18}$/.test(input.requestId)) throw new Error('WSFEX_REQUEST_ID_INVALID');
  if (run.issuanceState !== 'ready_for_wsfex' && run.issuanceState !== 'submitted' && run.issuanceState !== 'ambiguous') throw new Error('WSFEX_SUBMISSION_NOT_READY');
  if (run.authority.requestId && run.authority.requestId !== input.requestId) throw new Error('WSFEX_RECOVERY_REQUEST_ID_MISMATCH');
  if (run.authority.payloadReferenceHash && run.authority.payloadReferenceHash !== input.payloadReferenceHash) throw new Error('WSFEX_RECOVERY_PAYLOAD_MISMATCH');
  if (input.status === 'accepted' && (!input.cae || !input.invoiceNumber)) throw new Error('ACCEPTED_WSFEX_RESULT_INCOMPLETE');
  const issuanceState = input.status === 'accepted' ? 'arca_authorized' : input.status;
  const event = eventFor(run.runId, run.workspaceId, input.actorId, 'wsfex', `wsfex_${input.status}`, input.occurredAt, input.idempotencyKey, {
    requestId: input.requestId,
    receiptHash: input.receiptHash,
    reprocessed: input.reprocessed,
  });
  return {
    run: nextRun(run, input.occurredAt, event, {
      issuanceState,
      authority: {
        requestId: input.requestId,
        payloadReferenceHash: input.payloadReferenceHash,
        invoiceNumber: input.invoiceNumber,
        cae: input.cae,
        authorizedAt: input.status === 'accepted' ? input.occurredAt : null,
        receiptHash: input.receiptHash,
        reprocessed: input.reprocessed,
      },
    }),
    event,
  };
}

export function recordWsfexAdjustmentAuthorityResult(run: FacturaEAgentRunV1, input: Readonly<{
  adjustmentId: string;
  actorId: string;
  requestId: string;
  payloadReferenceHash: string;
  status: 'accepted' | 'rejected' | 'ambiguous';
  documentNumber: string | null;
  cae: string | null;
  receiptHash: string;
  reprocessed: boolean | null;
  occurredAt: IsoDateTime;
  idempotencyKey: string;
}>): Readonly<{ run: FacturaEAgentRunV1; event: FacturaEAgentEventV1 }> {
  if (run.issuancePath !== 'wsfex_delegated') throw new Error('WSFEX_PATH_REQUIRED');
  if (!/^[1-9]\d{0,18}$/.test(input.requestId)) throw new Error('WSFEX_REQUEST_ID_INVALID');
  const adjustment = run.adjustments.find(candidate => candidate.adjustmentId === input.adjustmentId);
  if (!adjustment) throw new Error('ADJUSTMENT_NOT_FOUND');
  if (!['ready_for_wsfex', 'ambiguous'].includes(adjustment.issuanceState)) throw new Error('ADJUSTMENT_WSFEX_SUBMISSION_NOT_READY');
  if (adjustment.authority.requestId && adjustment.authority.requestId !== input.requestId) throw new Error('ADJUSTMENT_WSFEX_RECOVERY_REQUEST_ID_MISMATCH');
  if (adjustment.authority.payloadReferenceHash && adjustment.authority.payloadReferenceHash !== input.payloadReferenceHash) {
    throw new Error('ADJUSTMENT_WSFEX_RECOVERY_PAYLOAD_MISMATCH');
  }
  if (input.status === 'accepted' && (!input.cae || !input.documentNumber)) throw new Error('ACCEPTED_ADJUSTMENT_WSFEX_RESULT_INCOMPLETE');
  const issuanceState = input.status === 'accepted' ? 'arca_authorized' as const : input.status;
  const adjustments = run.adjustments.map(candidate => candidate.adjustmentId === adjustment.adjustmentId
    ? {
        ...candidate,
        issuanceState,
        authority: {
          requestId: input.requestId,
          payloadReferenceHash: input.payloadReferenceHash,
          documentNumber: input.documentNumber,
          cae: input.cae,
          receiptHash: input.receiptHash,
          reprocessed: input.reprocessed,
        },
      }
    : candidate);
  const settlementState = deriveSettlementState(run, run.settlements, adjustments);
  const event = eventFor(run.runId, run.workspaceId, input.actorId, 'wsfex', `wsfex_adjustment_${input.status}`, input.occurredAt, input.idempotencyKey, {
    adjustmentId: input.adjustmentId,
    requestId: input.requestId,
    receiptHash: input.receiptHash,
    reprocessed: input.reprocessed,
  });
  return {
    run: nextRun(run, input.occurredAt, event, {
      adjustments,
      settlementState,
      taxDeclarationState: deriveTaxDeclarationState(run, settlementState, input.status === 'accepted'),
      financeEligibility: deriveFinanceEligibility(run, settlementState, adjustments, run.settlements),
    }),
    event,
  };
}

export function prepareFacturaEAdjustment(run: FacturaEAgentRunV1, input: Readonly<{
  adjustmentId: string;
  documentType: 20 | 21;
  issueDate: IsoDate;
  amount: FacturaEMoney;
  reason: string;
  asOf: IsoDate;
  actorId: string;
  occurredAt: IsoDateTime;
  idempotencyKey: string;
}>): Readonly<{ run: FacturaEAgentRunV1; event: FacturaEAgentEventV1; adjustment: FacturaEAdjustmentV1 }> {
  if (run.issuanceState !== 'arca_authorized' || !run.intent || !run.authority.invoiceNumber) throw new Error('AUTHORIZED_FACTURA_E_REQUIRED');
  if (run.adjustments.some(adjustment => adjustment.adjustmentId === input.adjustmentId)) throw new Error('ADJUSTMENT_ALREADY_EXISTS');
  if (run.adjustments.some(adjustment => !['arca_authorized', 'rejected'].includes(adjustment.issuanceState))) throw new Error('OPEN_ADJUSTMENT_EXISTS');
  if (input.documentType !== 20 && input.documentType !== 21) throw new Error('EXPORT_ADJUSTMENT_TYPE_REQUIRED');
  if (!isIsoDate(input.issueDate) || input.issueDate < run.intent.issueDate) throw new Error('ADJUSTMENT_DATE_INVALID');
  if (!isIsoDate(input.asOf) || Math.abs(daysBetween(input.issueDate, input.asOf)) > 5) throw new Error('ADJUSTMENT_DATE_OUTSIDE_FIVE_DAY_WINDOW');
  if (input.amount.currency !== run.intent.total.currency) throw new Error('ADJUSTMENT_CURRENCY_MISMATCH');
  const amount = decimalOrThrow(input.amount.decimal, 'ADJUSTMENT_AMOUNT_INVALID');
  if (!amount.isPositive()) throw new Error('ADJUSTMENT_AMOUNT_NOT_POSITIVE');
  const currentLedger = deriveFacturaEAdjustmentLedger(run);
  if (input.documentType === 21 && new Decimal(currentLedger.netProjectedTotal).sub(amount).isNegative()) {
    throw new Error('CREDIT_NOTE_EXCEEDS_CORRECTED_TOTAL');
  }
  if (!input.reason.trim()) throw new Error('ADJUSTMENT_REASON_REQUIRED');
  const base = {
    version: 'factura-e-adjustment-v1' as const,
    adjustmentId: input.adjustmentId,
    documentType: input.documentType,
    associatedDocument: {
      documentType: 19 as const,
      pointOfSale: run.intent.pointOfSale,
      invoiceNumber: run.authority.invoiceNumber,
    },
    issueDate: input.issueDate,
    amount: input.amount,
    reason: input.reason,
    ruleVersionIds: [...ARGENTINA_FACTURA_E_RULE_IDS],
  };
  const adjustment: FacturaEAdjustmentV1 = {
    ...base,
    intentHash: hashCanonical(base),
    approvalState: 'pending',
    issuanceState: 'not_ready',
    authority: { requestId: null, payloadReferenceHash: null, documentNumber: null, cae: null, receiptHash: null, reprocessed: null },
  };
  const event = eventFor(run.runId, run.workspaceId, input.actorId, 'tax_agent', 'factura_e_adjustment_prepared', input.occurredAt, input.idempotencyKey, {
    adjustmentId: adjustment.adjustmentId,
    documentType: adjustment.documentType,
    intentHash: adjustment.intentHash,
  });
  return {
    run: nextRun(run, input.occurredAt, event, { adjustments: [...run.adjustments, adjustment], financeEligibility: 'frozen' }),
    event,
    adjustment,
  };
}

export function approveFacturaEAdjustment(run: FacturaEAgentRunV1, input: Readonly<{
  adjustmentId: string;
  intentHash: string;
  actorId: string;
  occurredAt: IsoDateTime;
  idempotencyKey: string;
}>): Readonly<{ run: FacturaEAgentRunV1; event: FacturaEAgentEventV1 }> {
  const adjustment = run.adjustments.find(candidate => candidate.adjustmentId === input.adjustmentId);
  if (!adjustment) throw new Error('ADJUSTMENT_NOT_FOUND');
  if (adjustment.approvalState !== 'pending') throw new Error('ADJUSTMENT_APPROVAL_NOT_PENDING');
  if (adjustment.intentHash !== input.intentHash) throw new Error('ADJUSTMENT_APPROVAL_HASH_MISMATCH');
  const needsAccountant = run.accountantReviewRequired;
  const issuanceState = needsAccountant
    ? 'not_ready' as const
    : run.issuancePath === 'reclaim_copilot' ? 'manual_action_required' as const : 'ready_for_wsfex' as const;
  const event = eventFor(run.runId, run.workspaceId, input.actorId, 'user', 'factura_e_adjustment_user_approved', input.occurredAt, input.idempotencyKey, {
    adjustmentId: adjustment.adjustmentId,
    intentHash: adjustment.intentHash,
    accountantReviewRequired: needsAccountant,
  });
  return {
    run: nextRun(run, input.occurredAt, event, {
      adjustments: run.adjustments.map(candidate => candidate.adjustmentId === adjustment.adjustmentId
        ? { ...candidate, approvalState: 'user_approved' as const, issuanceState }
        : candidate),
    }),
    event,
  };
}

export function approveFacturaEAdjustmentByAccountant(run: FacturaEAgentRunV1, input: Readonly<{
  adjustmentId: string;
  intentHash: string;
  actorId: string;
  occurredAt: IsoDateTime;
  idempotencyKey: string;
}>): Readonly<{ run: FacturaEAgentRunV1; event: FacturaEAgentEventV1 }> {
  if (!run.accountantReviewRequired) throw new Error('ACCOUNTANT_REVIEW_NOT_REQUIRED');
  const adjustment = run.adjustments.find(candidate => candidate.adjustmentId === input.adjustmentId);
  if (!adjustment) throw new Error('ADJUSTMENT_NOT_FOUND');
  if (adjustment.approvalState !== 'user_approved') throw new Error('ADJUSTMENT_USER_APPROVAL_REQUIRED');
  if (adjustment.intentHash !== input.intentHash) throw new Error('ADJUSTMENT_APPROVAL_HASH_MISMATCH');
  const issuanceState = run.issuancePath === 'reclaim_copilot' ? 'manual_action_required' as const : 'ready_for_wsfex' as const;
  const event = eventFor(run.runId, run.workspaceId, input.actorId, 'accountant', 'factura_e_adjustment_accountant_approved', input.occurredAt, input.idempotencyKey, {
    adjustmentId: adjustment.adjustmentId,
    intentHash: adjustment.intentHash,
  });
  return {
    run: nextRun(run, input.occurredAt, event, {
      adjustments: run.adjustments.map(candidate => candidate.adjustmentId === adjustment.adjustmentId
        ? { ...candidate, approvalState: 'accountant_approved' as const, issuanceState }
        : candidate),
    }),
    event,
  };
}

export function recordFacturaESettlement(run: FacturaEAgentRunV1, input: Readonly<{
  settlement: FacturaESettlementV1;
  actorId: string;
  occurredAt: IsoDateTime;
  idempotencyKey: string;
}>): Readonly<{ run: FacturaEAgentRunV1; event: FacturaEAgentEventV1 }> {
  if (!run.intent) throw new Error('INVOICE_INTENT_REQUIRED');
  if (run.settlements.some(settlement => settlement.settlementReferenceHash === input.settlement.settlementReferenceHash)) throw new Error('SETTLEMENT_REFERENCE_REPLAY');
  if (input.settlement.amount.currency !== run.intent.total.currency) throw new Error('SETTLEMENT_CURRENCY_MISMATCH');
  const settlementAmount = decimalOrThrow(input.settlement.amount.decimal, 'SETTLEMENT_AMOUNT_INVALID');
  if (!settlementAmount.isPositive()) throw new Error('SETTLEMENT_AMOUNT_NOT_POSITIVE');
  if (input.settlement.fees) {
    const fee = decimalOrThrow(input.settlement.fees.decimal, 'SETTLEMENT_FEE_INVALID');
    if (input.settlement.fees.currency !== input.settlement.amount.currency) throw new Error('SETTLEMENT_FEE_CURRENCY_MISMATCH');
    if (fee.isNegative()) throw new Error('SETTLEMENT_FEE_NEGATIVE');
  }
  if (input.settlement.finalityState === 'reversed') {
    if (!input.settlement.reversesSettlementReferenceHash) throw new Error('REVERSED_SETTLEMENT_REFERENCE_REQUIRED');
    if (!run.settlements.some(settlement => settlement.settlementReferenceHash === input.settlement.reversesSettlementReferenceHash)) {
      throw new Error('REVERSED_SETTLEMENT_NOT_FOUND');
    }
  } else if (input.settlement.reversesSettlementReferenceHash) {
    throw new Error('REVERSAL_REFERENCE_ONLY_ALLOWED_FOR_REVERSAL');
  }
  const event = eventFor(run.runId, run.workspaceId, input.actorId, 'tax_agent', 'factura_e_settlement_recorded', input.occurredAt, input.idempotencyKey, {
    settlementReferenceHash: input.settlement.settlementReferenceHash,
    finalityState: input.settlement.finalityState,
  });
  const settlements = [...run.settlements, input.settlement];
  const settlementState = deriveSettlementState(run, settlements, run.adjustments);
  const taxDeclarationState = deriveTaxDeclarationState(run, settlementState, false);
  return {
    run: nextRun(run, input.occurredAt, event, {
      settlements,
      settlementState,
      taxDeclarationState,
      financeEligibility: deriveFinanceEligibility(run, settlementState, run.adjustments, settlements),
    }),
    event,
  };
}

export function verifyFacturaEFxIngress(run: FacturaEAgentRunV1, input: Readonly<{
  evidenceHash: string;
  actorId: string;
  occurredAt: IsoDateTime;
  idempotencyKey: string;
}>): Readonly<{ run: FacturaEAgentRunV1; event: FacturaEAgentEventV1 }> {
  if (run.issuanceState !== 'arca_authorized') throw new Error('ARCA_AUTHORIZATION_REQUIRED');
  if (!input.evidenceHash) throw new Error('FX_INGRESS_EVIDENCE_REQUIRED');
  const event = eventFor(run.runId, run.workspaceId, input.actorId, 'accountant', 'factura_e_fx_ingress_verified', input.occurredAt, input.idempotencyKey, {
    evidenceHash: input.evidenceHash,
  });
  const updatedFxRun = { ...run, fxIngressState: 'verified' as const };
  return {
    run: nextRun(run, input.occurredAt, event, {
      fxIngressState: 'verified',
      fxIngressEvidenceHash: input.evidenceHash,
      taxDeclarationState: deriveTaxDeclarationState(updatedFxRun, run.settlementState, false),
      financeEligibility: deriveFinanceEligibility(updatedFxRun, run.settlementState, run.adjustments, run.settlements),
    }),
    event,
  };
}

export function markFacturaETaxDeclared(run: FacturaEAgentRunV1, input: Readonly<{
  evidenceHash: string;
  actorId: string;
  occurredAt: IsoDateTime;
  idempotencyKey: string;
}>): Readonly<{ run: FacturaEAgentRunV1; event: FacturaEAgentEventV1 }> {
  if (run.taxDeclarationState !== 'ready_for_accountant' && run.taxDeclarationState !== 'amendment_required') throw new Error('TAX_DECLARATION_NOT_READY');
  const event = eventFor(run.runId, run.workspaceId, input.actorId, 'accountant', 'factura_e_tax_declared', input.occurredAt, input.idempotencyKey, {
    evidenceHash: input.evidenceHash,
  });
  return {
    run: nextRun(run, input.occurredAt, event, { taxDeclarationState: 'declared', taxDeclarationEvidenceHash: input.evidenceHash }),
    event,
  };
}

export function facturaENextActions(run: FacturaEAgentRunV1): readonly string[] {
  const actions: string[] = [];
  if (run.readinessState !== 'verified') actions.push('request_arca_readiness_proof');
  if (run.intentState === 'missing' || run.intentState === 'drafted') actions.push('draft_or_fix_invoice_intent');
  if (run.readinessState === 'verified' && run.intentState === 'validated' && run.approvalState === 'not_requested') actions.push('request_user_approval');
  if (run.approvalState === 'pending') actions.push('wait_for_user_approval');
  if (run.approvalState === 'user_approved' && run.accountantReviewRequired) actions.push('wait_for_accountant_approval');
  if (run.issuanceState === 'manual_action_required') actions.push('guide_user_through_comprobantes_en_linea');
  if (run.issuanceState === 'manual_action_required') actions.push('request_arca_cae_proof');
  if (run.issuanceState === 'ready_for_wsfex') actions.push('submit_exact_approved_intent_to_wsfex');
  if (run.issuanceState === 'ambiguous') actions.push('recover_wsfex_outcome_with_same_request_id');
  if (run.issuanceState === 'arca_authorized' && run.settlementState !== 'final') actions.push('reconcile_final_settlement');
  if (run.issuanceState === 'arca_authorized' && run.fxIngressState !== 'verified') actions.push('verify_fx_ingress_evidence');
  if (run.taxDeclarationState === 'ready_for_accountant') actions.push('request_accountant_tax_declaration');
  if (run.taxDeclarationState === 'amendment_required') actions.push('request_accountant_tax_amendment');
  for (const adjustment of run.adjustments) {
    if (adjustment.approvalState === 'pending') actions.push(`wait_for_adjustment_user_approval:${adjustment.adjustmentId}`);
    if (adjustment.approvalState === 'user_approved' && run.accountantReviewRequired) actions.push(`wait_for_adjustment_accountant_approval:${adjustment.adjustmentId}`);
    if (adjustment.issuanceState === 'manual_action_required') actions.push(`guide_adjustment_in_comprobantes_en_linea:${adjustment.adjustmentId}`);
    if (adjustment.issuanceState === 'manual_action_required') actions.push(`request_arca_adjustment_proof:${adjustment.adjustmentId}`);
    if (adjustment.issuanceState === 'ready_for_wsfex') actions.push(`submit_adjustment_to_wsfex:${adjustment.adjustmentId}`);
    if (adjustment.issuanceState === 'ambiguous') actions.push(`recover_adjustment_wsfex:${adjustment.adjustmentId}`);
  }
  return actions;
}

export function hashCanonical(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(sortCanonical(value))).digest('hex');
}

export function deriveFacturaEAdjustmentLedger(
  run: FacturaEAgentRunV1,
  adjustments: readonly FacturaEAdjustmentV1[] = run.adjustments,
  settlements: readonly FacturaESettlementV1[] = run.settlements
): FacturaEAdjustmentLedgerV1 {
  if (!run.intent) throw new Error('INVOICE_INTENT_REQUIRED');
  const sumAdjustments = (documentType: 20 | 21, states: readonly FacturaEAdjustmentV1['issuanceState'][]) => adjustments
    .filter(adjustment => adjustment.documentType === documentType && states.includes(adjustment.issuanceState))
    .reduce((sum, adjustment) => sum.add(adjustment.amount.decimal), new Decimal(0));
  const authorizedDebits = sumAdjustments(20, ['arca_authorized']);
  const authorizedCredits = sumAdjustments(21, ['arca_authorized']);
  const openStates: readonly FacturaEAdjustmentV1['issuanceState'][] = ['not_ready', 'manual_action_required', 'ready_for_wsfex', 'ambiguous'];
  const pendingDebits = sumAdjustments(20, openStates);
  const pendingCredits = sumAdjustments(21, openStates);
  const original = new Decimal(run.intent.total.decimal);
  const netAuthorized = original.add(authorizedDebits).sub(authorizedCredits);
  const netProjected = netAuthorized.add(pendingDebits).sub(pendingCredits);
  const finalSettlements = finalSettlementAmount(settlements);
  return {
    version: 'factura-e-adjustment-ledger-v1',
    currency: run.intent.total.currency,
    originalTotal: original.toString(),
    authorizedDebitTotal: authorizedDebits.toString(),
    authorizedCreditTotal: authorizedCredits.toString(),
    pendingDebitTotal: pendingDebits.toString(),
    pendingCreditTotal: pendingCredits.toString(),
    netAuthorizedTotal: netAuthorized.toString(),
    netProjectedTotal: netProjected.toString(),
    finalSettlementTotal: finalSettlements.toString(),
    settlementGap: netAuthorized.sub(finalSettlements).toString(),
    hasOpenAdjustment: adjustments.some(adjustment => openStates.includes(adjustment.issuanceState)),
    hasAuthorizedDilution: adjustments.some(adjustment => adjustment.documentType === 21 && adjustment.issuanceState === 'arca_authorized'),
  };
}

function assertCaeMatchesIntent(claims: ArcaCaeClaimsV1, run: FacturaEAgentRunV1): void {
  if (!run.intent) throw new Error('INVOICE_INTENT_REQUIRED');
  if (claims.documentType !== 19 || claims.pointOfSale !== run.intent.pointOfSale) throw new Error('CAE_PROOF_INVOICE_MISMATCH');
  if (claims.associatedDocumentType || claims.associatedPointOfSale || claims.associatedInvoiceNumber) throw new Error('CAE_PROOF_UNEXPECTED_ASSOCIATION');
  if (claims.total.currency !== run.intent.total.currency || !new Decimal(claims.total.decimal).eq(run.intent.total.decimal)) throw new Error('CAE_PROOF_TOTAL_MISMATCH');
}

function assertCaeMatchesAdjustment(claims: ArcaCaeClaimsV1, run: FacturaEAgentRunV1, session: ReclaimSessionReferenceV1): void {
  const adjustment = run.adjustments.find(candidate => candidate.adjustmentId === session.subjectId);
  if (!adjustment || adjustment.intentHash !== session.subjectHash) throw new Error('ADJUSTMENT_PROOF_SUBJECT_MISMATCH');
  if (
    claims.documentType !== adjustment.documentType
    || claims.pointOfSale !== adjustment.associatedDocument.pointOfSale
    || claims.total.currency !== adjustment.amount.currency
    || !new Decimal(claims.total.decimal).eq(adjustment.amount.decimal)
  ) throw new Error('ADJUSTMENT_PROOF_DOCUMENT_MISMATCH');
  if (
    claims.associatedDocumentType !== 19
    || claims.associatedPointOfSale !== adjustment.associatedDocument.pointOfSale
    || claims.associatedInvoiceNumber !== adjustment.associatedDocument.invoiceNumber
  ) throw new Error('ADJUSTMENT_PROOF_ASSOCIATION_MISMATCH');
}

function finalSettlementAmount(settlements: readonly FacturaESettlementV1[]): Decimal {
  const reversedReferences = new Set(settlements
    .filter(settlement => settlement.finalityState === 'reversed')
    .map(settlement => settlement.reversesSettlementReferenceHash)
    .filter((reference): reference is string => Boolean(reference)));
  return settlements
    .filter(settlement => settlement.finalityState === 'final' && !reversedReferences.has(settlement.settlementReferenceHash))
    .reduce((sum, settlement) => sum.add(settlement.amount.decimal), new Decimal(0));
}

function deriveSettlementState(
  run: FacturaEAgentRunV1,
  settlements: readonly FacturaESettlementV1[],
  adjustments: readonly FacturaEAdjustmentV1[]
): FacturaEAgentRunV1['settlementState'] {
  if (!settlements.length) return 'unobserved';
  const target = new Decimal(deriveFacturaEAdjustmentLedger(run, adjustments, settlements).netAuthorizedTotal);
  const finalAmount = finalSettlementAmount(settlements);
  if (settlements.some(settlement => settlement.finalityState === 'disputed') || finalAmount.gt(target)) return 'disputed';
  if (finalAmount.eq(target)) return 'final';
  if (settlements.some(settlement => settlement.finalityState === 'reversed')) return 'reversed';
  return 'observed';
}

function deriveTaxDeclarationState(
  run: FacturaEAgentRunV1,
  settlementState: FacturaEAgentRunV1['settlementState'],
  adjustmentAuthorized: boolean
): FacturaEAgentRunV1['taxDeclarationState'] {
  if (adjustmentAuthorized && run.taxDeclarationState === 'declared') return 'amendment_required';
  if (run.taxDeclarationState === 'declared' || run.taxDeclarationState === 'amendment_required') return run.taxDeclarationState;
  return settlementState === 'final' && run.issuanceState === 'arca_authorized' && run.fxIngressState === 'verified'
    ? 'ready_for_accountant'
    : 'not_ready';
}

function deriveFinanceEligibility(
  run: FacturaEAgentRunV1,
  settlementState: FacturaEAgentRunV1['settlementState'],
  adjustments: readonly FacturaEAdjustmentV1[],
  settlements: readonly FacturaESettlementV1[]
): FacturaEAgentRunV1['financeEligibility'] {
  const ledger = run.intent ? deriveFacturaEAdjustmentLedger(run, adjustments, settlements) : null;
  return settlementState === 'final'
    && run.issuanceState === 'arca_authorized'
    && run.fxIngressState === 'verified'
    && !ledger?.hasOpenAdjustment
    && !ledger?.hasAuthorizedDilution
    ? 'reviewable'
    : 'frozen';
}

function nextRun(run: FacturaEAgentRunV1, occurredAt: IsoDateTime, event: FacturaEAgentEventV1, patch: Partial<FacturaEAgentRunV1>): FacturaEAgentRunV1 {
  return { ...run, ...patch, revision: run.revision + 1, updatedAt: occurredAt, eventIds: [...run.eventIds, event.eventId] };
}

function eventFor(
  runId: string,
  workspaceId: string,
  actorId: string,
  actorKind: FacturaEAgentEventV1['actorKind'],
  action: string,
  occurredAt: IsoDateTime,
  idempotencyKey: string,
  safeMetadata: FacturaEAgentEventV1['safeMetadata']
): FacturaEAgentEventV1 {
  return { eventId: randomUUID(), runId, workspaceId, actorId, actorKind, action, occurredAt, idempotencyKey, safeMetadata };
}

function decimalOrError(value: string, code: string, errors: string[]): Decimal | null {
  try {
    if (!/^-?\d+(?:\.\d+)?$/.test(value)) throw new Error(code);
    return new Decimal(value);
  } catch {
    errors.push(code);
    return null;
  }
}

function decimalOrThrow(value: string, code: string): Decimal {
  if (!/^-?\d+(?:\.\d+)?$/.test(value)) throw new Error(code);
  return new Decimal(value);
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function daysBetween(left: IsoDate, right: IsoDate): number {
  return Math.round((Date.parse(`${right}T00:00:00Z`) - Date.parse(`${left}T00:00:00Z`)) / 86_400_000);
}

function sortCanonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortCanonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, sortCanonical(child)]));
  }
  return value;
}
