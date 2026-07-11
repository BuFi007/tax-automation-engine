import { describe, expect, test } from 'bun:test';

import {
  addReclaimSession,
  approveFacturaEAdjustment,
  approveFacturaEIntent,
  createFacturaEAgentRun,
  deriveFacturaEAdjustmentLedger,
  draftFacturaEIntent,
  facturaENextActions,
  hashCanonical,
  ingestVerifiedReclaimProof,
  markFacturaETaxDeclared,
  prepareFacturaEAdjustment,
  recordFacturaESettlement,
  recordWsfexAuthorityResult,
  requestFacturaEApproval,
  verifyFacturaEFxIngress,
  validateFacturaEIntent,
  type FacturaEAgentRunV1,
  type FacturaEIntentV1,
  type ReclaimSessionReferenceV1,
} from './index';

const now = '2026-07-11T12:00:00.000Z';
const hash = (value: string) => hashCanonical(value);

describe('Factura E agent domain', () => {
  test('closes the Path B loop without collapsing ARCA, settlement, FX, or tax states', () => {
    let run = createRun('reclaim_copilot');
    run = requestSession(run, readinessSession()).run;
    run = ingestVerifiedReclaimProof(run, {
      proof: {
        proofHash: hash('readiness-proof'),
        sessionId: 'readiness-session',
        purpose: 'arca_taxpayer_readiness',
        providerId: 'arca-readiness-provider',
        providerVersion: '1.0.0',
        verifiedAt: now,
        attestation: { teeRequired: false, teeVerified: false },
        custodyReceipt: null,
        claims: {
          regime: 'monotributo',
          category: 'H',
          exportActivityEnabled: true,
          exportPointOfSaleActive: true,
          exportPointOfSale: 4,
        },
      },
      occurredAt: now,
      idempotencyKey: 'proof-readiness-1',
    }).run;
    expect(run.readinessState).toBe('verified');

    const drafted = draftFacturaEIntent(run, {
      intent: intent(),
      asOf: '2026-07-11',
      actorId: 'agent:tax',
      occurredAt: now,
      idempotencyKey: 'draft-intent-1',
    });
    expect(drafted.validation).toEqual(expect.objectContaining({ valid: true, errors: [] }));
    run = drafted.run;
    run = requestFacturaEApproval(run, { actorId: 'agent:tax', occurredAt: now, idempotencyKey: 'approval-request-1' }).run;
    run = approveFacturaEIntent(run, {
      actorId: 'user:owner',
      intentHash: run.intentHash!,
      occurredAt: now,
      idempotencyKey: 'approval-confirm-1',
    }).run;
    expect(run.issuanceState).toBe('manual_action_required');

    run = requestSession(run, caeSession(run.intentHash!)).run;
    run = ingestVerifiedReclaimProof(run, {
      proof: {
        proofHash: hash('cae-proof'),
        sessionId: 'cae-session',
        purpose: 'arca_cae_constatement',
        providerId: 'arca-cae-provider',
        providerVersion: '1.0.0',
        verifiedAt: now,
        attestation: { teeRequired: false, teeVerified: false },
        custodyReceipt: null,
        claims: {
          documentType: 19,
          pointOfSale: 4,
          invoiceNumber: '91',
          cae: '12345678901234',
          issuedAt: '2026-07-11',
          total: { decimal: '1000.00', currency: 'USD' },
          associatedDocumentType: null,
          associatedPointOfSale: null,
          associatedInvoiceNumber: null,
        },
      },
      occurredAt: now,
      idempotencyKey: 'proof-cae-1',
    }).run;
    expect(run.issuanceState).toBe('arca_authorized');
    expect(run.fxIngressState).toBe('unverified');
    expect(run.taxDeclarationState).toBe('not_ready');

    run = recordFacturaESettlement(run, {
      settlement: {
        settlementReferenceHash: hash('settlement'),
        asset: 'USDC',
        network: 'base',
        amount: { decimal: '1000.00', currency: 'USD' },
        observedAt: now,
        finalityState: 'final',
        fees: { decimal: '1.00', currency: 'USD' },
        reversesSettlementReferenceHash: null,
      },
      actorId: 'agent:tax',
      occurredAt: now,
      idempotencyKey: 'settlement-1',
    }).run;
    expect(run.financeEligibility).toBe('frozen');
    run = verifyFacturaEFxIngress(run, {
      evidenceHash: hash('bank-proof'),
      actorId: 'accountant:1',
      occurredAt: now,
      idempotencyKey: 'fx-proof-1',
    }).run;
    expect(run.taxDeclarationState).toBe('ready_for_accountant');
    expect(run.financeEligibility).toBe('reviewable');
    run = markFacturaETaxDeclared(run, {
      evidenceHash: hash('tax-ledger'),
      actorId: 'accountant:1',
      occurredAt: now,
      idempotencyKey: 'tax-declared-1',
    }).run;
    expect(run.taxDeclarationState).toBe('declared');
    expect(facturaENextActions(run)).toEqual([]);
  });

  test('requires readiness proof and binds CAE proof to the frozen intent', () => {
    let run = createRun('reclaim_copilot');
    run = draftFacturaEIntent(run, {
      intent: intent(), asOf: '2026-07-11', actorId: 'agent:tax', occurredAt: now, idempotencyKey: 'draft-2',
    }).run;
    expect(() => requestFacturaEApproval(run, { actorId: 'agent:tax', occurredAt: now, idempotencyKey: 'approve-2' })).toThrow('ARCA_READINESS_PROOF_REQUIRED');

    run = requestSession(run, caeSession(run.intentHash!)).run;
    expect(() => ingestVerifiedReclaimProof(run, {
      proof: {
        proofHash: hash('bad-cae'), sessionId: 'cae-session', purpose: 'arca_cae_constatement', providerId: 'arca-cae-provider', providerVersion: '1.0.0', verifiedAt: now,
        attestation: { teeRequired: false, teeVerified: false }, custodyReceipt: null,
        claims: {
          documentType: 19, pointOfSale: 5, invoiceNumber: '1', cae: '12345678901234', issuedAt: '2026-07-11', total: { decimal: '1000.00', currency: 'USD' },
          associatedDocumentType: null, associatedPointOfSale: null, associatedInvoiceNumber: null,
        },
      },
      occurredAt: now,
      idempotencyKey: 'bad-cae-proof',
    })).toThrow('CAE_PROOF_INVOICE_MISMATCH');
  });

  test('keeps WSFEX ambiguous recovery pinned to one request and payload', () => {
    let run = createRun('wsfex_delegated');
    run = { ...run, issuanceState: 'ready_for_wsfex' };
    const payloadHash = hashCanonical('vault://payload/1');
    run = recordWsfexAuthorityResult(run, {
      actorId: 'agent:tax', requestId: '1001', payloadReferenceHash: payloadHash, status: 'ambiguous', invoiceNumber: null, cae: null,
      receiptHash: hash('timeout'), reprocessed: null, occurredAt: now, idempotencyKey: 'wsfex-submit-1',
    }).run;
    expect(() => recordWsfexAuthorityResult(run, {
      actorId: 'agent:tax', requestId: '1002', payloadReferenceHash: payloadHash, status: 'accepted', invoiceNumber: '2', cae: '12345678901234',
      receiptHash: hash('receipt'), reprocessed: true, occurredAt: now, idempotencyKey: 'wsfex-recover-bad',
    })).toThrow('WSFEX_RECOVERY_REQUEST_ID_MISMATCH');
    run = recordWsfexAuthorityResult(run, {
      actorId: 'agent:tax', requestId: '1001', payloadReferenceHash: payloadHash, status: 'accepted', invoiceNumber: '2', cae: '12345678901234',
      receiptHash: hash('receipt'), reprocessed: true, occurredAt: now, idempotencyKey: 'wsfex-recover-good',
    }).run;
    expect(run).toEqual(expect.objectContaining({ issuanceState: 'arca_authorized', authority: expect.objectContaining({ reprocessed: true, requestId: '1001' }) }));
  });

  test('reconciles partial settlements and records reversals as separate freezing events', () => {
    let run: FacturaEAgentRunV1 = {
      ...createRun('reclaim_copilot'),
      intent: intent(),
      intentHash: hashCanonical(intent()),
      intentState: 'frozen',
      issuanceState: 'arca_authorized',
      fxIngressState: 'verified',
    };
    const firstReference = hash('partial-400');
    run = recordFacturaESettlement(run, {
      settlement: {
        settlementReferenceHash: firstReference, asset: 'USDC', network: 'base', amount: { decimal: '400.00', currency: 'USD' }, observedAt: now,
        finalityState: 'final', fees: null, reversesSettlementReferenceHash: null,
      },
      actorId: 'agent:tax', occurredAt: now, idempotencyKey: 'partial-400',
    }).run;
    expect(run).toEqual(expect.objectContaining({ settlementState: 'observed', financeEligibility: 'frozen' }));
    const secondReference = hash('partial-600');
    run = recordFacturaESettlement(run, {
      settlement: {
        settlementReferenceHash: secondReference, asset: 'USDC', network: 'base', amount: { decimal: '600.00', currency: 'USD' }, observedAt: now,
        finalityState: 'final', fees: null, reversesSettlementReferenceHash: null,
      },
      actorId: 'agent:tax', occurredAt: now, idempotencyKey: 'partial-600',
    }).run;
    expect(run).toEqual(expect.objectContaining({ settlementState: 'final', financeEligibility: 'reviewable' }));
    run = recordFacturaESettlement(run, {
      settlement: {
        settlementReferenceHash: hash('reversal-600'), asset: 'USDC', network: 'base', amount: { decimal: '600.00', currency: 'USD' }, observedAt: now,
        finalityState: 'reversed', fees: null, reversesSettlementReferenceHash: secondReference,
      },
      actorId: 'agent:tax', occurredAt: now, idempotencyKey: 'reversal-600',
    }).run;
    expect(run).toEqual(expect.objectContaining({ settlementState: 'reversed', financeEligibility: 'frozen' }));
  });

  test('derives the corrected balance and invalidates stale tax and finance conclusions after dilution', () => {
    const originalSettlement = {
      settlementReferenceHash: hash('settled-original'), asset: 'USDC', network: 'base', amount: { decimal: '1000.00', currency: 'USD' }, observedAt: now,
      finalityState: 'final' as const, fees: null, reversesSettlementReferenceHash: null,
    };
    let run: FacturaEAgentRunV1 = {
      ...createRun('reclaim_copilot'),
      intent: intent(),
      intentHash: hashCanonical(intent()),
      intentState: 'frozen',
      approvalState: 'user_approved',
      issuanceState: 'arca_authorized',
      settlementState: 'final',
      fxIngressState: 'verified',
      taxDeclarationState: 'declared',
      financeEligibility: 'reviewable',
      authority: {
        requestId: null, payloadReferenceHash: null, invoiceNumber: '91', cae: '12345678901234', authorizedAt: now,
        receiptHash: hash('original-cae'), reprocessed: null,
      },
      settlements: [originalSettlement],
    };
    const prepared = prepareFacturaEAdjustment(run, {
      adjustmentId: 'credit-100', documentType: 21, issueDate: '2026-07-11', amount: { decimal: '100.00', currency: 'USD' },
      reason: 'Post-issuance discount', asOf: '2026-07-11', actorId: 'agent:tax', occurredAt: now, idempotencyKey: 'prepare-credit-100',
    });
    run = prepared.run;
    expect(prepared.adjustment.ruleVersionIds).toEqual(['ar-rg-4401-factura-e-v1', 'arca-wsfex-3.1.1', 'bcra-a8330-service-exports-v1']);
    expect(deriveFacturaEAdjustmentLedger(run)).toEqual(expect.objectContaining({
      netAuthorizedTotal: '1000', netProjectedTotal: '900', finalSettlementTotal: '1000', settlementGap: '0', hasOpenAdjustment: true,
    }));
    run = approveFacturaEAdjustment(run, {
      adjustmentId: 'credit-100', intentHash: prepared.adjustment.intentHash, actorId: 'user:owner', occurredAt: now, idempotencyKey: 'approve-credit-100',
    }).run;
    const session: ReclaimSessionReferenceV1 = {
      sessionId: 'adjustment-credit-100', purpose: 'arca_adjustment_constatement', providerId: 'arca-cae-provider', providerVersion: '1.0.0',
      contextHash: hash('adjustment-context'), subjectId: 'credit-100', subjectHash: prepared.adjustment.intentHash,
      requestedAt: now, expiresAt: '2026-07-11T12:10:00.000Z', state: 'pending',
    };
    run = requestSession(run, session).run;
    run = ingestVerifiedReclaimProof(run, {
      proof: {
        proofHash: hash('credit-cae'), sessionId: session.sessionId, purpose: session.purpose, providerId: session.providerId, providerVersion: session.providerVersion,
        verifiedAt: now,
        attestation: { teeRequired: false, teeVerified: false },
        custodyReceipt: null,
        claims: {
          documentType: 21, pointOfSale: 4, invoiceNumber: '92', cae: '22345678901234', issuedAt: '2026-07-11', total: { decimal: '100', currency: 'USD' },
          associatedDocumentType: 19, associatedPointOfSale: 4, associatedInvoiceNumber: '91',
        },
      },
      occurredAt: now, idempotencyKey: 'verify-credit-cae',
    }).run;
    expect(deriveFacturaEAdjustmentLedger(run)).toEqual(expect.objectContaining({
      authorizedCreditTotal: '100', netAuthorizedTotal: '900', finalSettlementTotal: '1000', settlementGap: '-100', hasAuthorizedDilution: true,
    }));
    expect(run).toEqual(expect.objectContaining({
      settlementState: 'disputed', taxDeclarationState: 'amendment_required', financeEligibility: 'frozen',
    }));
    expect(facturaENextActions(run)).toContain('request_accountant_tax_amendment');
    expect(() => prepareFacturaEAdjustment(run, {
      adjustmentId: 'credit-too-large', documentType: 21, issueDate: '2026-07-11', amount: { decimal: '901', currency: 'USD' },
      reason: 'Invalid cumulative credit', asOf: '2026-07-11', actorId: 'agent:tax', occurredAt: now, idempotencyKey: 'prepare-credit-too-large',
    })).toThrow('CREDIT_NOTE_EXCEEDS_CORRECTED_TOTAL');
  });

  test('rejects calendar dates that JavaScript would otherwise roll into another month', () => {
    expect(validateFacturaEIntent({ ...intent(), issueDate: '2026-02-31', paymentDate: '2026-03-03' }, '2026-03-03')).toEqual(expect.objectContaining({
      valid: false,
      errors: expect.arrayContaining(['INVOICE_DATE_INVALID']),
    }));
    expect(validateFacturaEIntent({ ...intent(), issueDate: '2024-02-29', paymentDate: '2024-02-29', exchangeRate: { ...intent().exchangeRate!, observedForDate: '2024-02-28' } }, '2024-02-29').errors).not.toContain('INVOICE_DATE_INVALID');
    expect(validateFacturaEIntent({ ...intent(), pointOfSale: 99999 }, '2026-07-11').errors).toContain('EXPORT_POINT_OF_SALE_INVALID');
    expect(validateFacturaEIntent({ ...intent(), destinationCountryArcaCode: 1000 }, '2026-07-11').errors).toContain('DESTINATION_ARCA_CODE_INVALID');
    expect(validateFacturaEIntent({ ...intent(), paymentTerms: 'x'.repeat(51) }, '2026-07-11').errors).toContain('PAYMENT_TERMS_TOO_LONG');
    expect(validateFacturaEIntent({ ...intent(), lineItems: [{ ...intent().lineItems[0]!, unitCode: 100 }] }, '2026-07-11').errors).toContain('LINE_1_UNIT_CODE_INVALID');
  });
});

function createRun(path: 'reclaim_copilot' | 'wsfex_delegated'): FacturaEAgentRunV1 {
  return createFacturaEAgentRun({
    runId: '00000000-0000-4000-8000-000000000001', workspaceId: 'workspace-ar', issuancePath: path,
    actorId: 'agent:tax', occurredAt: now, idempotencyKey: `create-${path}`,
  }).run;
}

function intent(): FacturaEIntentV1 {
  return {
    version: 'factura-e-intent-v1',
    intentId: 'intent-1',
    workspaceId: 'workspace-ar',
    taxpayerReferenceHash: hash('taxpayer'),
    foreignCustomerReferenceHash: hash('customer'),
    foreignCustomerSafeLabel: 'Foreign customer',
    destinationCountry: 'US',
    destinationCountryArcaCode: 200,
    documentType: 19,
    operationType: 2,
    pointOfSale: 4,
    issueDate: '2026-07-11',
    paymentDate: '2026-07-11',
    sameCurrencyPayment: true,
    exchangeRate: { decimal: '1200.25', sourceReferenceId: 'fx:bna:2026-07-10', observedForDate: '2026-07-10', authorityRuleDecisionId: 'arca-fx-review-v1' },
    lineItems: [{ description: 'Software services', quantity: '1', unitPrice: '1000.00', total: '1000.00', unitCode: 7 }],
    total: { decimal: '1000.00', currency: 'USD' },
    serviceDescription: 'Software development services used abroad',
    paymentTerms: 'Due on receipt',
    ruleVersionIds: ['ar-rg-4401-factura-e-v1', 'arca-wsfex-3.1.1', 'bcra-a8330-service-exports-v1'],
  };
}

function readinessSession(): ReclaimSessionReferenceV1 {
  return {
    sessionId: 'readiness-session', purpose: 'arca_taxpayer_readiness', providerId: 'arca-readiness-provider', providerVersion: '1.0.0',
    contextHash: hash('readiness-context'), subjectId: null, subjectHash: null, requestedAt: now, expiresAt: '2026-07-11T12:10:00.000Z', state: 'pending',
  };
}

function caeSession(intentHash: string): ReclaimSessionReferenceV1 {
  return {
    sessionId: 'cae-session', purpose: 'arca_cae_constatement', providerId: 'arca-cae-provider', providerVersion: '1.0.0',
    contextHash: hash(intentHash), subjectId: 'intent-1', subjectHash: intentHash, requestedAt: now, expiresAt: '2026-07-11T12:10:00.000Z', state: 'pending',
  };
}

function requestSession(run: FacturaEAgentRunV1, session: ReclaimSessionReferenceV1) {
  return addReclaimSession(run, { session, actorId: 'agent:tax', occurredAt: now, idempotencyKey: `session-${session.sessionId}` });
}
