import type { TaxCoreCapabilityManifestV1 } from '../capabilities';
import type { EvidenceMoney, IsoDateTime, JurisdictionCode, Period, TaxConclusionEnvelopeV1, TaxConsentGrant } from '../types';

export type TaxSourceKind =
  | 'bank'
  | 'wallet'
  | 'crypto'
  | 'stripe'
  | 'fx'
  | 'payroll'
  | 'bufi_invoice'
  | 'bufi_bill'
  | 'accounting'
  | 'magic_inbox'
  | 'transaction_enrichment'
  | 'knowledge_graph'
  | 'financial_analytics';

export type TaxSourceCapability =
  | 'transactions'
  | 'ledger_accounts'
  | 'payments'
  | 'payouts'
  | 'fees'
  | 'invoices'
  | 'bills'
  | 'payroll'
  | 'fx_rates'
  | 'counterparties'
  | 'tax_lines'
  | 'tax_documents'
  | 'documents'
  | 'receipts'
  | 'classification'
  | 'reconciliation'
  | 'entity_resolution'
  | 'actuals'
  | 'cash_planning';

export type TaxEvidenceScope =
  | Readonly<{ mode: 'all_connected' }>
  | Readonly<{
      mode: 'selected';
      sourceIds: readonly string[];
      includeKnowledgeGraph: boolean;
    }>;

export type EvidenceReviewState = 'unreviewed' | 'accepted' | 'rejected' | 'disputed';

export type TaxEvidenceRecord = Readonly<{
  evidenceId: string;
  workspaceId: string;
  revision: string;
  sourceId: string;
  sourceKind: TaxSourceKind;
  canonicalProviderId: string | null;
  externalReferenceHash: string;
  sourceEventHash: string;
  artifactHash: string;
  jurisdiction: JurisdictionCode | null;
  period: Period;
  observedAt: IsoDateTime;
  expiresAt: IsoDateTime | null;
  economicEventId: string;
  economicRole: 'invoice' | 'payment' | 'settlement' | 'expense' | 'receipt' | 'accounting_entry' | 'payroll_obligation' | 'payroll_settlement' | 'fee' | 'tax' | 'cash_movement';
  countingDimension: 'revenue' | 'expense' | 'cash' | 'fee' | 'tax' | 'withholding' | 'none';
  direction: 'inflow' | 'outflow' | 'neutral';
  money: EvidenceMoney | null;
  normalizedMoney: EvidenceMoney | null;
  fxReferenceId: string | null;
  partyClaimHash: string | null;
  accountReferenceHash: string | null;
  confidence: Readonly<{
    extraction: string | null;
    classification: string | null;
    matching: string | null;
  }>;
  reviewState: EvidenceReviewState;
  consentVersion: string;
  idempotencyKey: string;
}>;

export type EvidenceNode = Readonly<{
  id: string;
  kind: 'source_artifact' | 'financial_event' | 'party' | 'account' | 'document';
  safeLabel: string;
}>;

export type EvidenceEdge = Readonly<{
  id: string;
  from: string;
  to: string;
  kind: 'represents' | 'settles' | 'supports' | 'recorded_as' | 'same_as' | 'contradicts';
  allocation: EvidenceMoney | null;
  derivation: 'provider_fact' | 'deterministic_rule' | 'human_confirmed' | 'suggested';
  reviewState: EvidenceReviewState;
}>;

export type EvidenceGapKind =
  | 'payout_without_invoice'
  | 'expense_without_receipt'
  | 'factura_e_without_collection_evidence'
  | 'accounting_counterparty_mismatch';

export type EvidenceGap = Readonly<{
  id: string;
  kind: EvidenceGapKind;
  severity: 'info' | 'warning' | 'blocking';
  economicEventId: string;
  safeSourceReferenceIds: readonly string[];
  actionId: string | null;
}>;

export type CanonicalFinancialEvidenceGraph = Readonly<{
  version: 'financial-evidence-graph-v1';
  workspaceId: string;
  revision: string;
  nodes: readonly EvidenceNode[];
  edges: readonly EvidenceEdge[];
  gaps: readonly EvidenceGap[];
}>;

export type TaxEvidenceAdapterContext = Readonly<{
  workspaceId: string;
  actorId: string;
  connectionId: string | null;
  consentGrants: readonly TaxConsentGrant[];
  period: Period;
  displayCurrency: string;
  asOf: IsoDateTime;
  dataScope: TaxEvidenceScope;
}>;

export type TaxEvidenceAdapterCapabilityResult = Readonly<{
  capability: TaxSourceCapability;
  state: 'available' | 'partial' | 'unsupported' | 'failed' | 'stale';
  observedAt: IsoDateTime | null;
  safeErrorCode: string | null;
}>;

export type TaxEvidenceAdapterPage = Readonly<{
  adapterSchemaVersion: string;
  sourceId: string;
  canonicalProviderId: string | null;
  records: readonly TaxEvidenceRecord[];
  capabilities: readonly TaxEvidenceAdapterCapabilityResult[];
  nextCursor: Readonly<{ value: string; version: string }> | null;
  sourceCheckpoint: Readonly<{ revision: string; observedAt: IsoDateTime }>;
}>;

export type TaxEvidenceAdapterResult =
  | Readonly<{ ok: true; page: TaxEvidenceAdapterPage }>
  | Readonly<{
      ok: false;
      retryable: boolean;
      safeErrorCode: string;
      capabilities: readonly TaxEvidenceAdapterCapabilityResult[];
    }>;

export interface TaxEvidenceSourceAdapter {
  readonly adapterId: string;
  readonly sourceKind: TaxSourceKind;
  readonly supportedCapabilities: readonly TaxSourceCapability[];
  readPage(
    context: TaxEvidenceAdapterContext,
    input: Readonly<{ cursor: Readonly<{ value: string; version: string }> | null; pageSize: number }>
  ): Promise<TaxEvidenceAdapterResult>;
}

export type TaxSourceCoverage = Readonly<{
  sourceId: string;
  kind: TaxSourceKind;
  providerId: string | null;
  displayName: string;
  capabilities: readonly TaxEvidenceAdapterCapabilityResult[];
  connectionState: 'connected' | 'degraded' | 'failed' | 'stale' | 'not_connected';
  lastSuccessfulSyncAt: IsoDateTime | null;
  recordsScanned: number;
  acceptedEvidenceCount: number;
  needsReviewCount: number;
  safeErrorCode: string | null;
}>;

export type SafeFact = TaxConclusionEnvelopeV1<Readonly<{
  kind: string;
  safeDisplayValue: string | boolean | null;
  unit: string | null;
}>>;

export type TaxEvidencePresentationProjectionV1 = Readonly<{
  version: 'tax-evidence-presentation-v1';
  upstreamBundleHash: string;
  period: Period;
  resolvedScope: TaxEvidenceScope;
  displayCurrency: string;
  asOf: IsoDateTime;
  capabilityManifest: TaxCoreCapabilityManifestV1;
  sources: readonly TaxSourceCoverage[];
  safeFacts: readonly SafeFact[];
  evidenceCoverage: Readonly<{
    revenue: Readonly<{ invoiced: EvidenceMoney | null; reconciled: EvidenceMoney | null }>;
    expenses: Readonly<{ recorded: EvidenceMoney | null; supported: EvidenceMoney | null }>;
    obligations: Readonly<{ applicable: number; mapped: number }>;
    gaps: readonly EvidenceGap[];
  }>;
  limitations: readonly string[];
}>;
