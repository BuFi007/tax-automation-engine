import { hashCanonical, type FacturaEAgentRunV1 } from '@tax-engine/core';

import type {
  FacturaEAuthorityExecutionRecord,
  FacturaEAuthorityExecutionStore,
} from './authority-execution';
import type { PrivateFacturaEFeatureSource } from './factura-e-feature-publication';

export type FacturaERunReader = Readonly<{
  getRun(runId: string): FacturaEAgentRunV1;
}>;

/**
 * Joins the private Tax-owned authority and invoice ledgers. No caller may
 * supply any of these predicates, and the returned object never crosses the
 * Tax boundary.
 */
export class FacturaEFeatureSourceReader {
  constructor(
    private readonly authorityStore: Pick<FacturaEAuthorityExecutionStore, 'get'>,
    private readonly runReader: FacturaERunReader
  ) {}

  read(executionId: string): PrivateFacturaEFeatureSource {
    const authority = this.authorityStore.get(executionId);
    if (!authority) throw new Error('FACTURA_E_FEATURE_AUTHORITY_EXECUTION_NOT_FOUND');
    const run = this.runReader.getRun(authority.runId);
    assertLedgerBinding(authority, run);
    // Homologation or legacy-unbound receipts can never back a finance feature.
    const authorityState = authority.authorityEnvironment === 'production'
      ? featureAuthorityState(authority)
      : 'unverified';
    if (
      authorityState === 'officially_reconciled'
      && (!authority.authorityIdentityHash || !authority.receiptHash)
    ) {
      throw new Error('FACTURA_E_FEATURE_OFFICIAL_EVIDENCE_MISSING');
    }
    const hasAdjustment = run.adjustments.some(adjustment => (
      adjustment.approvalState !== 'rejected'
      && adjustment.issuanceState !== 'rejected'
    ));
    const sourceRevision = hashCanonical({
      executionId: authority.executionId,
      authorityState,
      authorityEnvironment: authority.authorityEnvironment,
      authorityProviderId: authority.authorityProviderId,
      authorityUpdatedAt: authority.updatedAt,
      authorityIdentityHash: authority.authorityIdentityHash,
      reconciliationEvidenceHash: authority.receiptHash,
      runId: run.runId,
      runRevision: run.revision,
      runUpdatedAt: run.updatedAt,
      settlementState: run.settlementState,
      settlementReferences: run.settlements.map(settlement => ({
        reference: settlement.settlementReferenceHash,
        finality: settlement.finalityState,
      })),
      adjustmentStates: run.adjustments.map(adjustment => ({
        id: adjustment.adjustmentId,
        approval: adjustment.approvalState,
        issuance: adjustment.issuanceState,
      })),
    });
    return {
      executionId: authority.executionId,
      runId: run.runId,
      workspaceId: authority.workspaceId,
      authorityState,
      authorityIdentityHash:
        authorityState === 'officially_reconciled'
          ? authority.authorityIdentityHash
          : null,
      reconciliationEvidenceHash:
        authorityState === 'officially_reconciled' ? authority.receiptHash : null,
      settlementState: run.settlementState,
      // Factura E has no guessed legal expiry in this ledger. Signed feature
      // TTL provides freshness; an explicit adjustment or settlement blocks it.
      invoiceState: 'current',
      hasAdjustment,
      sourceRevision,
    };
  }
}

function featureAuthorityState(
  record: FacturaEAuthorityExecutionRecord
): PrivateFacturaEFeatureSource['authorityState'] {
  if (record.state === 'officially_reconciled') return 'officially_reconciled';
  if (
    record.state === 'ambiguous'
    || record.state === 'recovering'
    || record.state === 'reconciling'
    || record.state === 'reconciliation_ambiguous'
  ) return 'ambiguous';
  if (record.state === 'rejected') return 'revoked';
  return 'unverified';
}

function assertLedgerBinding(
  authority: FacturaEAuthorityExecutionRecord,
  run: FacturaEAgentRunV1
): void {
  if (
    run.runId !== authority.runId
    || run.workspaceId !== authority.workspaceId
    || run.intentHash !== authority.intentHash
  ) throw new Error('FACTURA_E_FEATURE_LEDGER_BINDING_CONFLICT');
  if (!run.intent || run.intentState !== 'frozen') {
    throw new Error('FACTURA_E_FEATURE_FROZEN_INTENT_REQUIRED');
  }
}
