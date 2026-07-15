import { describe, expect, test } from 'bun:test';

import {
  addReclaimSession,
  approveFacturaEAdjustment,
  approveFacturaEIntent,
  createFacturaEAgentRun,
  deriveFacturaEAdjustmentLedger,
  deriveFacturaESettlementEvidenceLedger,
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

  test('preserves full reversal behavior for one of multiple final settlements', () => {
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
    expect(deriveFacturaEAdjustmentLedger(run)).toEqual(expect.objectContaining({
      finalSettlementTotal: '400',
      settlementGap: '600',
    }));
  });

  test('subtracts partial and multiple reversals from the referenced final settlement', () => {
    let run: FacturaEAgentRunV1 = {
      ...createRun('reclaim_copilot'),
      intent: intent(),
      intentHash: hashCanonical(intent()),
      intentState: 'frozen',
      issuanceState: 'arca_authorized',
      fxIngressState: 'verified',
    };
    const finalReference = hash('final-1000');
    run = recordFacturaESettlement(run, {
      settlement: {
        settlementReferenceHash: finalReference, asset: 'USDC', network: 'base', amount: { decimal: '1000.00', currency: 'USD' }, observedAt: now,
        finalityState: 'final', fees: null, reversesSettlementReferenceHash: null,
      },
      actorId: 'agent:tax', occurredAt: now, idempotencyKey: 'final-1000',
    }).run;
    const firstReversalReference = hash('reversal-250');
    run = recordFacturaESettlement(run, {
      settlement: {
        settlementReferenceHash: firstReversalReference, asset: 'USDC', network: 'base', amount: { decimal: '250.00', currency: 'USD' }, observedAt: now,
        finalityState: 'reversed', fees: null, reversesSettlementReferenceHash: finalReference,
      },
      actorId: 'agent:tax', occurredAt: now, idempotencyKey: 'reversal-250',
    }).run;
    expect(deriveFacturaEAdjustmentLedger(run).finalSettlementTotal).toBe('750');
    run = recordFacturaESettlement(run, {
      settlement: {
        settlementReferenceHash: hash('reversal-350'), asset: 'USDC', network: 'base', amount: { decimal: '350.00', currency: 'USD' }, observedAt: now,
        finalityState: 'reversed', fees: null, reversesSettlementReferenceHash: finalReference,
      },
      actorId: 'agent:tax', occurredAt: now, idempotencyKey: 'reversal-350',
    }).run;
    expect(run).toEqual(expect.objectContaining({ settlementState: 'reversed', financeEligibility: 'frozen' }));
    expect(deriveFacturaEAdjustmentLedger(run)).toEqual(expect.objectContaining({
      finalSettlementTotal: '400',
      settlementGap: '600',
    }));

    expect(() => recordFacturaESettlement(run, {
      settlement: {
        settlementReferenceHash: hash('reversal-of-reversal'), asset: 'USDC', network: 'base', amount: { decimal: '1.00', currency: 'USD' }, observedAt: now,
        finalityState: 'reversed', fees: null, reversesSettlementReferenceHash: firstReversalReference,
      },
      actorId: 'agent:tax', occurredAt: now, idempotencyKey: 'reversal-of-reversal',
    })).toThrow('REVERSED_SETTLEMENT_NOT_FINAL');
  });

  test('requires a tax amendment after a full reversal invalidates a declared final settlement', () => {
    const finalReference = hash('declared-full-reversal-final');
    let run: FacturaEAgentRunV1 = {
      ...createRun('reclaim_copilot'),
      intent: intent(),
      intentHash: hashCanonical(intent()),
      intentState: 'frozen',
      issuanceState: 'arca_authorized',
      settlementState: 'final',
      fxIngressState: 'verified',
      taxDeclarationState: 'declared',
      financeEligibility: 'reviewable',
      settlements: [{
        settlementReferenceHash: finalReference, asset: 'USDC', network: 'base', amount: { decimal: '1000.00', currency: 'USD' }, observedAt: now,
        finalityState: 'final', fees: null, reversesSettlementReferenceHash: null,
      }],
    };
    run = recordFacturaESettlement(run, {
      settlement: {
        settlementReferenceHash: hash('declared-full-reversal'), asset: 'USDC', network: 'base', amount: { decimal: '1000.00', currency: 'USD' }, observedAt: now,
        finalityState: 'reversed', fees: null, reversesSettlementReferenceHash: finalReference,
      },
      actorId: 'agent:tax', occurredAt: now, idempotencyKey: 'declared-full-reversal',
    }).run;
    expect(run).toEqual(expect.objectContaining({
      settlementState: 'reversed', taxDeclarationState: 'amendment_required', financeEligibility: 'frozen',
    }));
    expect(facturaENextActions(run)).toContain('request_accountant_tax_amendment');
  });

  test('requires a tax amendment after a partial reversal invalidates a declared final settlement', () => {
    const finalReference = hash('declared-partial-reversal-final');
    let run: FacturaEAgentRunV1 = {
      ...createRun('reclaim_copilot'),
      intent: intent(),
      intentHash: hashCanonical(intent()),
      intentState: 'frozen',
      issuanceState: 'arca_authorized',
      settlementState: 'final',
      fxIngressState: 'verified',
      taxDeclarationState: 'declared',
      financeEligibility: 'reviewable',
      settlements: [{
        settlementReferenceHash: finalReference, asset: 'USDC', network: 'base', amount: { decimal: '1000.00', currency: 'USD' }, observedAt: now,
        finalityState: 'final', fees: null, reversesSettlementReferenceHash: null,
      }],
    };
    run = recordFacturaESettlement(run, {
      settlement: {
        settlementReferenceHash: hash('declared-partial-reversal'), asset: 'USDC', network: 'base', amount: { decimal: '250.00', currency: 'USD' }, observedAt: now,
        finalityState: 'reversed', fees: null, reversesSettlementReferenceHash: finalReference,
      },
      actorId: 'agent:tax', occurredAt: now, idempotencyKey: 'declared-partial-reversal',
    }).run;
    expect(run).toEqual(expect.objectContaining({
      settlementState: 'reversed', taxDeclarationState: 'amendment_required', financeEligibility: 'frozen',
    }));
    expect(deriveFacturaEAdjustmentLedger(run).finalSettlementTotal).toBe('750');
  });

  test('rejects cumulative reversals above the original final settlement amount', () => {
    let run: FacturaEAgentRunV1 = {
      ...createRun('reclaim_copilot'),
      intent: intent(),
      intentHash: hashCanonical(intent()),
      intentState: 'frozen',
    };
    const finalReference = hash('over-reversal-final');
    run = recordFacturaESettlement(run, {
      settlement: {
        settlementReferenceHash: finalReference, asset: 'USDC', network: 'base', amount: { decimal: '1000.00', currency: 'USD' }, observedAt: now,
        finalityState: 'final', fees: null, reversesSettlementReferenceHash: null,
      },
      actorId: 'agent:tax', occurredAt: now, idempotencyKey: 'over-reversal-final',
    }).run;
    run = recordFacturaESettlement(run, {
      settlement: {
        settlementReferenceHash: hash('over-reversal-600'), asset: 'USDC', network: 'base', amount: { decimal: '600.00', currency: 'USD' }, observedAt: now,
        finalityState: 'reversed', fees: null, reversesSettlementReferenceHash: finalReference,
      },
      actorId: 'agent:tax', occurredAt: now, idempotencyKey: 'over-reversal-600',
    }).run;
    expect(() => recordFacturaESettlement(run, {
      settlement: {
        settlementReferenceHash: hash('over-reversal-400-01'), asset: 'USDC', network: 'base', amount: { decimal: '400.01', currency: 'USD' }, observedAt: now,
        finalityState: 'reversed', fees: null, reversesSettlementReferenceHash: finalReference,
      },
      actorId: 'agent:tax', occurredAt: now, idempotencyKey: 'over-reversal-400-01',
    })).toThrow('REVERSED_SETTLEMENT_AMOUNT_EXCEEDED');
  });

  test('retains a privacy-safe settlement envelope and deduplicates source fees across allocations', () => {
    let run: FacturaEAgentRunV1 = {
      ...createRun('reclaim_copilot'),
      intent: intent(),
      intentHash: hashCanonical(intent()),
      intentState: 'frozen',
    };
    const sourceIdentityHash = hash('shared-source-receipt');
    const evidence = {
      version: 'factura-e-settlement-evidence-v1' as const,
      source: { kind: 'circle_transfer' as const, provider: 'circle', identityHash: sourceIdentityHash, revision: 1 },
      sourceMoney: { currency: 'USD', grossAmount: '1001', feeAmount: '1', netAmount: '1000' },
      sourceEquivalentAmount: '400',
      allocationBasis: 'net' as const,
      fx: null,
      verification: { method: 'provider_webhook' as const, evidenceHash: hash('provider-proof'), verifiedAt: now },
    };
    run = recordFacturaESettlement(run, {
      settlement: {
        settlementReferenceHash: hash('shared-source-allocation-400'), asset: 'USD', network: 'bank', amount: { decimal: '400', currency: 'USD' }, observedAt: now,
        finalityState: 'final', fees: null, reversesSettlementReferenceHash: null, evidence,
      },
      actorId: 'agent:tax', occurredAt: now, idempotencyKey: 'shared-source-allocation-400',
    }).run;
    run = recordFacturaESettlement(run, {
      settlement: {
        settlementReferenceHash: hash('shared-source-allocation-600'), asset: 'USD', network: 'bank', amount: { decimal: '600', currency: 'USD' }, observedAt: now,
        finalityState: 'final', fees: null, reversesSettlementReferenceHash: null,
        evidence: { ...evidence, sourceEquivalentAmount: '600' },
      },
      actorId: 'agent:tax', occurredAt: now, idempotencyKey: 'shared-source-allocation-600',
    }).run;
    const ledger = deriveFacturaESettlementEvidenceLedger(run.settlements);
    expect(ledger).toEqual(expect.objectContaining({
      completeness: 'complete',
      feeSemantics: {
        sourceFeeScope: 'source_receipt', sourceFeeDedupeKey: 'sourceIdentityHash', allocationFeeScope: 'settlement_allocation',
      },
      sources: [expect.objectContaining({ sourceIdentityHash, money: expect.objectContaining({ feeAmount: '1' }) })],
    }));
    expect(ledger.allocations).toHaveLength(2);
    expect(ledger.allocations.every(allocation => allocation.allocationFees === null)).toBe(true);

    run = recordFacturaESettlement(run, {
      settlement: {
        settlementReferenceHash: hash('shared-source-reversal-100'), asset: 'USD', network: 'bank', amount: { decimal: '100', currency: 'USD' }, observedAt: now,
        finalityState: 'reversed', fees: null, reversesSettlementReferenceHash: hash('shared-source-allocation-600'),
        evidence: {
          ...evidence,
          source: { ...evidence.source, kind: 'provider_reversal', revision: 2 },
          sourceEquivalentAmount: '100',
        },
      },
      actorId: 'agent:tax', occurredAt: now, idempotencyKey: 'shared-source-reversal-100',
    }).run;
    expect(deriveFacturaESettlementEvidenceLedger(run.settlements)).toEqual(expect.objectContaining({
      completeness: 'complete',
      sources: [expect.objectContaining({ sourceIdentityHash, sourceKind: 'provider_reversal', sourceRevision: 2 })],
      allocations: expect.arrayContaining([expect.objectContaining({
        finalityState: 'reversed', sourceIdentityHash, sourceEquivalentAmount: '100', allocationFees: null,
      })]),
    }));
  });

  test('rejects a source-level fee projected onto a partial invoice allocation', () => {
    const run: FacturaEAgentRunV1 = {
      ...createRun('reclaim_copilot'), intent: intent(), intentHash: hashCanonical(intent()), intentState: 'frozen',
    };
    expect(() => recordFacturaESettlement(run, {
      settlement: {
        settlementReferenceHash: hash('partial-source-fee'), asset: 'USD', network: 'bank', amount: { decimal: '400', currency: 'USD' }, observedAt: now,
        finalityState: 'final', fees: { decimal: '1', currency: 'USD' }, reversesSettlementReferenceHash: null,
        evidence: {
          version: 'factura-e-settlement-evidence-v1',
          source: { kind: 'reviewed_bank_match', provider: 'plaid', identityHash: hash('partial-source'), revision: 1 },
          sourceMoney: { currency: 'USD', grossAmount: '1001', feeAmount: '1', netAmount: '1000' },
          sourceEquivalentAmount: '400', allocationBasis: 'net', fx: null,
          verification: { method: 'reviewed_financial_match', evidenceHash: hash('bank-review'), verifiedAt: now },
        },
      },
      actorId: 'agent:tax', occurredAt: now, idempotencyKey: 'partial-source-fee',
    })).toThrow('SETTLEMENT_PARTIAL_ALLOCATION_FEE_FORBIDDEN');
  });

  test('requires hash-bound FX evidence for a cross-currency source allocation', () => {
    let run: FacturaEAgentRunV1 = {
      ...createRun('reclaim_copilot'), intent: intent(), intentHash: hashCanonical(intent()), intentState: 'frozen',
    };
    const evidence = {
      version: 'factura-e-settlement-evidence-v1' as const,
      source: { kind: 'external_wallet_receipt' as const, provider: 'external.wallet', identityHash: hash('cross-currency-source'), revision: 1 },
      sourceMoney: { currency: 'USDC', grossAmount: '1000', feeAmount: '0', netAmount: '1000' },
      sourceEquivalentAmount: '1000', allocationBasis: 'net' as const,
      fx: {
        rate: '1', sourceCurrency: 'USDC', allocationCurrency: 'USD', evidenceHash: hash('cross-currency-fx'), verifiedAt: now,
      },
      verification: { method: 'onchain_receipt' as const, evidenceHash: hash('wallet-proof'), verifiedAt: now },
    };
    const settlement = {
      settlementReferenceHash: hash('cross-currency-allocation'), asset: 'USDC', network: 'base', amount: { decimal: '1000', currency: 'USD' }, observedAt: now,
      finalityState: 'final' as const, fees: null, reversesSettlementReferenceHash: null, evidence,
    };
    run = recordFacturaESettlement(run, {
      settlement, actorId: 'agent:tax', occurredAt: now, idempotencyKey: 'cross-currency-allocation',
    }).run;
    expect(deriveFacturaESettlementEvidenceLedger(run.settlements).allocations[0]?.fx).toEqual(evidence.fx);
    expect(() => recordFacturaESettlement({ ...run, settlements: [] }, {
      settlement: { ...settlement, evidence: { ...evidence, fx: null } },
      actorId: 'agent:tax', occurredAt: now, idempotencyKey: 'cross-currency-without-fx',
    })).toThrow('SETTLEMENT_FX_EVIDENCE_REQUIRED');
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
