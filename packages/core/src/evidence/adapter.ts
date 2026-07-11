import { createHash } from 'node:crypto';

import { assertActiveConsent } from '../consent';
import type { TaxEvidenceAdapterContext, TaxEvidenceAdapterResult, TaxEvidenceRecord, TaxEvidenceSourceAdapter, TaxSourceCapability, TaxSourceKind } from './types';

export type StaticAdapterInput = Readonly<{
  adapterId: string;
  sourceKind: TaxSourceKind;
  canonicalProviderId: string | null;
  displaySourceId: string;
  capabilities: readonly TaxSourceCapability[];
  records: readonly Omit<TaxEvidenceRecord, 'workspaceId' | 'consentVersion' | 'idempotencyKey'>[];
}>;

/** Fixture and import-boundary adapter. Production providers implement the same paginated contract. */
export class StaticEvidenceAdapter implements TaxEvidenceSourceAdapter {
  readonly adapterId: string;
  readonly sourceKind: TaxSourceKind;
  readonly supportedCapabilities: readonly TaxSourceCapability[];
  readonly #input: StaticAdapterInput;

  constructor(input: StaticAdapterInput) {
    this.adapterId = input.adapterId;
    this.sourceKind = input.sourceKind;
    this.supportedCapabilities = input.capabilities;
    this.#input = input;
  }

  async readPage(context: TaxEvidenceAdapterContext, input: { cursor: { value: string; version: string } | null; pageSize: number }): Promise<TaxEvidenceAdapterResult> {
    if (input.pageSize < 1 || input.pageSize > 500) {
      return { ok: false, retryable: false, safeErrorCode: 'INVALID_PAGE_SIZE', capabilities: [] };
    }
    const consent = assertActiveConsent(context.consentGrants, 'tax_workspace_processing', [this.#input.displaySourceId]);
    const offset = input.cursor ? Number.parseInt(input.cursor.value, 10) : 0;
    if (!Number.isInteger(offset) || offset < 0) {
      return { ok: false, retryable: false, safeErrorCode: 'INVALID_CURSOR', capabilities: [] };
    }
    const records = this.#input.records.slice(offset, offset + input.pageSize).map(record => ({
      ...record,
      workspaceId: context.workspaceId,
      consentVersion: consent.version,
      idempotencyKey: createHash('sha256')
        .update([context.workspaceId, this.#input.displaySourceId, record.externalReferenceHash, record.revision, record.artifactHash].join(':'))
        .digest('hex'),
    }));
    const nextOffset = offset + records.length;
    return {
      ok: true,
      page: {
        adapterSchemaVersion: 'tax-evidence-adapter-v1',
        sourceId: this.#input.displaySourceId,
        canonicalProviderId: this.#input.canonicalProviderId,
        records,
        capabilities: this.#input.capabilities.map(capability => ({ capability, state: 'available', observedAt: context.asOf, safeErrorCode: null })),
        nextCursor: nextOffset < this.#input.records.length ? { value: String(nextOffset), version: 'v1' } : null,
        sourceCheckpoint: { revision: String(this.#input.records.length), observedAt: context.asOf },
      },
    };
  }
}
