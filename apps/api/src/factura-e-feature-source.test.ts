import { describe, expect, test } from 'bun:test';

import { hashCanonical, type FacturaEAgentRunV1 } from '@tax-engine/core';

import type { FacturaEAuthorityExecutionRecord } from './authority-execution';
import { FacturaEFeatureSourceReader } from './factura-e-feature-source';

const hash = (seed: string) => hashCanonical(seed);

function authority(
  overrides: Partial<FacturaEAuthorityExecutionRecord> = {}
): FacturaEAuthorityExecutionRecord {
  return {
    executionId: 'execution-1',
    workspaceId: 'workspace-1',
    runId: 'run-1',
    intentHash: hash('intent'),
    authorityEnvironment: 'production',
    authorityProviderId: 'motora-arca-signer-v1',
    state: 'authority_accepted_unverified',
    createdByActorHash: hash('actor'),
    approvalActorHash: null,
    approvalRefHash: null,
    requestId: null,
    authorityPayloadRef: null,
    authorityPayloadHash: null,
    authorityIdentityHash: null,
    receiptHash: null,
    createIdempotencyKey: 'create-1',
    approvalIdempotencyKey: null,
    executeIdempotencyKey: null,
    recoverIdempotencyKey: null,
    reconcileIdempotencyKey: null,
    createdAt: '2026-07-15T12:00:00.000Z',
    updatedAt: '2026-07-15T12:00:00.000Z',
    ...overrides,
  };
}

function run(overrides: Partial<FacturaEAgentRunV1> = {}): FacturaEAgentRunV1 {
  return {
    version: 'factura-e-agent-run-v1',
    runId: 'run-1',
    workspaceId: 'workspace-1',
    issuancePath: 'wsfex_delegated',
    accountantReviewRequired: false,
    revision: 4,
    createdAt: '2026-07-15T11:00:00.000Z',
    updatedAt: '2026-07-15T12:00:00.000Z',
    readinessState: 'verified',
    intentState: 'frozen',
    approvalState: 'user_approved',
    issuanceState: 'ready_for_wsfex',
    settlementState: 'unobserved',
    fxIngressState: 'unverified',
    taxDeclarationState: 'not_ready',
    financeEligibility: 'frozen',
    intent: {
      version: 'factura-e-intent-v1',
      intentId: 'intent-1',
      workspaceId: 'workspace-1',
      taxpayerReferenceHash: hash('taxpayer'),
      foreignCustomerReferenceHash: hash('customer'),
      foreignCustomerSafeLabel: 'Customer',
      destinationCountry: 'US',
      destinationCountryArcaCode: 212,
      documentType: 19,
      operationType: 2,
      pointOfSale: 4,
      issueDate: '2026-07-15',
      paymentDate: '2026-08-15',
      sameCurrencyPayment: true,
      exchangeRate: null,
      lineItems: [{
        description: 'Services', quantity: '1', unitPrice: '1000', total: '1000', unitCode: 7,
      }],
      total: { decimal: '1000', currency: 'USD' },
      serviceDescription: 'Services',
      paymentTerms: 'Net 30',
      ruleVersionIds: [],
    },
    intentHash: hash('intent'),
    reclaimSessions: [],
    verifiedProofs: [],
    authority: {
      requestId: null, payloadReferenceHash: null, invoiceNumber: null, cae: null,
      caeExpiry: null, currencyId: null, currencyQuote: null, authorizedAt: null,
      receiptHash: null, reprocessed: null,
    },
    settlements: [],
    adjustments: [],
    fxIngressEvidenceHash: null,
    taxDeclarationEvidenceHash: null,
    eventIds: [],
    ...overrides,
  };
}

describe('Factura E private feature source', () => {
  test('requires the independent authority reconciliation ledger', () => {
    let a = authority();
    const r = run();
    const reader = new FacturaEFeatureSourceReader(
      { get: () => a },
      { getRun: () => r }
    );
    expect(reader.read('execution-1')).toMatchObject({
      authorityState: 'unverified',
      authorityIdentityHash: null,
      reconciliationEvidenceHash: null,
      settlementState: 'unobserved',
      hasAdjustment: false,
    });
    a = authority({
      state: 'officially_reconciled',
      authorityIdentityHash: hash('official-identity'),
      receiptHash: hash('official-read'),
      updatedAt: '2026-07-15T12:01:00.000Z',
    });
    expect(reader.read('execution-1')).toMatchObject({
      authorityState: 'officially_reconciled',
      authorityIdentityHash: hash('official-identity'),
      reconciliationEvidenceHash: hash('official-read'),
    });
    a = authority({
      state: 'officially_reconciled',
      authorityEnvironment: 'homologation',
      authorityIdentityHash: hash('homologation-identity'),
      receiptHash: hash('homologation-read'),
    });
    expect(reader.read('execution-1')).toMatchObject({
      authorityState: 'unverified',
      authorityIdentityHash: null,
      reconciliationEvidenceHash: null,
    });
  });

  test('takes settlement and adjustment blocks only from the Tax run ledger', () => {
    const a = authority({
      state: 'officially_reconciled',
      authorityIdentityHash: hash('official-identity'),
      receiptHash: hash('official-read'),
    });
    let r = run({ settlementState: 'observed' });
    const reader = new FacturaEFeatureSourceReader({ get: () => a }, { getRun: () => r });
    expect(reader.read('execution-1')).toMatchObject({
      settlementState: 'observed', hasAdjustment: false,
    });
    r = run({
      adjustments: [{
        version: 'factura-e-adjustment-v1',
        adjustmentId: 'credit-1',
        documentType: 21,
        associatedDocument: { documentType: 19, pointOfSale: 4, invoiceNumber: '10' },
        issueDate: '2026-07-15',
        amount: { decimal: '100', currency: 'USD' },
        reason: 'Credit',
        foreignCustomerReferenceHash: hash('customer'),
        destinationCountryArcaCode: 212,
        ruleVersionIds: [],
        intentHash: hash('credit'),
        approvalState: 'pending',
        issuanceState: 'not_ready',
        authority: {
          requestId: null, payloadReferenceHash: null, documentNumber: null, cae: null,
          caeExpiry: null, currencyId: null, currencyQuote: null, receiptHash: null,
          reprocessed: null,
        },
      }],
    });
    expect(reader.read('execution-1').hasAdjustment).toBe(true);
    expect(reader.read('execution-1').sourceRevision).toMatch(/^[a-f0-9]{64}$/);
  });

  test('fails closed on ledger binding or incomplete official evidence', () => {
    const badBinding = new FacturaEFeatureSourceReader(
      { get: () => authority() },
      { getRun: () => run({ workspaceId: 'workspace-2' }) }
    );
    expect(() => badBinding.read('execution-1'))
      .toThrow('FACTURA_E_FEATURE_LEDGER_BINDING_CONFLICT');

    const missingEvidence = new FacturaEFeatureSourceReader(
      { get: () => authority({ state: 'officially_reconciled' }) },
      { getRun: () => run() }
    );
    expect(() => missingEvidence.read('execution-1'))
      .toThrow('FACTURA_E_FEATURE_OFFICIAL_EVIDENCE_MISSING');
  });
});
