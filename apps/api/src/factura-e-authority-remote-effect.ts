import { hashCanonical, type FacturaEAgentRunV1 } from '@tax-engine/core';

import type { AuthorityPayloadWriter } from './authority-payload';
import { buildFacturaEAuthorityPayload } from './factura-e-authority-payload-builder';
import type {
  FacturaEAuthorityPreparationGateway,
} from './factura-e-authority-preparation';
import type {
  FacturaEAuthorityEffectOutcome,
  FacturaEAuthorityEffectPreparation,
  FacturaEAuthorityReconciliationOutcome,
  FacturaEAuthorityRemoteEffect,
} from './authority-execution';
import type { WsfexAuthorityResult, WsfexGateway } from './wsfex';

export type FacturaEAuthorityRunReader = Readonly<{
  getRun(runId: string): FacturaEAgentRunV1;
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
  }>): void;
}>;

/** Production-shaped Tax-owned adapter. Private preparation and payload custody
 * stay behind dedicated server boundaries; only safe hashes enter the corridor. */
export class TaxWsfexAuthorityRemoteEffect implements FacturaEAuthorityRemoteEffect {
  constructor(
    private readonly runs: FacturaEAuthorityRunReader,
    private readonly preparations: FacturaEAuthorityPreparationGateway,
    private readonly payloads: AuthorityPayloadWriter,
    private readonly wsfex: WsfexGateway,
    private readonly environment: 'homologation' | 'production',
    private readonly now: () => Date = () => new Date()
  ) {}

  async prepare(input: Readonly<{
    executionId: string;
    workspaceId: string;
    runId: string;
    intentHash: string;
    idempotencyKey: string;
  }>): Promise<FacturaEAuthorityEffectPreparation> {
    const run = this.boundRun(input);
    const intent = run.intent!;
    const prepared = await this.preparations.prepare({
      executionId: input.executionId,
      workspaceId: input.workspaceId,
      runId: input.runId,
      intentHash: input.intentHash,
      pointOfSale: intent.pointOfSale,
      currency: intent.total.currency,
      taxpayerReferenceHash: intent.taxpayerReferenceHash,
      foreignCustomerReferenceHash: intent.foreignCustomerReferenceHash,
      idempotencyKey: input.idempotencyKey,
    });
    const payload = buildFacturaEAuthorityPayload(run, prepared);
    const receipt = await this.payloads.store({
      workspaceId: input.workspaceId,
      payload,
      expiresAt: prepared.expiresAt,
      idempotencyKey: `${input.idempotencyKey}:payload`,
    });
    if (receipt.payloadHash !== hashCanonical(payload)) {
      throw new Error('TAX_AUTHORITY_PAYLOAD_RECEIPT_HASH_MISMATCH');
    }
    return {
      executionId: input.executionId,
      workspaceId: input.workspaceId,
      runId: input.runId,
      intentHash: input.intentHash,
      requestId: prepared.requestId,
      authorityPayloadRef: receipt.reference,
      authorityPayloadHash: receipt.payloadHash,
    };
  }

  async execute(
    input: FacturaEAuthorityEffectPreparation
  ): Promise<FacturaEAuthorityEffectOutcome> {
    const run = this.boundRun(input);
    const result = await this.wsfex.authorize({
      run,
      requestId: input.requestId,
      authorityPayloadRef: input.authorityPayloadRef,
      authorityPayloadHash: input.authorityPayloadHash,
    });
    return effectOutcome(result, this.environment);
  }

  async recover(
    input: FacturaEAuthorityEffectPreparation
  ): Promise<FacturaEAuthorityEffectOutcome> {
    const run = this.boundRun(input);
    const result = await this.wsfex.recover({
      run,
      requestId: input.requestId,
      authorityPayloadRef: input.authorityPayloadRef,
      authorityPayloadHash: input.authorityPayloadHash,
    });
    return effectOutcome(result, this.environment);
  }

  async reconcile(
    input: FacturaEAuthorityEffectPreparation
  ): Promise<FacturaEAuthorityReconciliationOutcome> {
    const run = this.boundRun(input);
    const result = await this.wsfex.reconcile({
      run,
      requestId: input.requestId,
      authorityPayloadRef: input.authorityPayloadRef,
      authorityPayloadHash: input.authorityPayloadHash,
    });
    assertAuthorityEnvironment(result, this.environment);
    if (result.status === 'ambiguous') {
      return { status: 'ambiguous', receiptHash: result.receiptHash };
    }
    if (result.status === 'rejected') {
      return { status: 'rejected', receiptHash: result.receiptHash };
    }
    if (
      !result.invoiceNumber
      || !result.cae
      || !result.caeExpiry
      || !result.currencyId
      || !result.currencyQuote
      || !result.authorityIdentityHash
      || !result.reconciliationEvidenceHash
      || !run.intent
    ) {
      throw new Error('TAX_AUTHORITY_RECONCILIATION_RECEIPT_INCOMPLETE');
    }
    await this.payloads.markTerminal({
      workspaceId: input.workspaceId,
      reference: input.authorityPayloadRef,
      payloadHash: input.authorityPayloadHash,
      terminalState: 'officially_reconciled',
      authorityIdentityHash: result.authorityIdentityHash,
      terminalEvidenceHash: result.reconciliationEvidenceHash,
    });
    const occurredAt = this.now().toISOString();
    this.runs.recordAuthorityCorridorReconciliation({
      runId: input.runId,
      requestId: input.requestId,
      authorityPayloadRef: input.authorityPayloadRef,
      invoiceNumber: result.invoiceNumber,
      cae: result.cae,
      caeExpiry: result.caeExpiry,
      currencyId: result.currencyId,
      currencyQuote: result.currencyQuote,
      receiptHash: result.reconciliationEvidenceHash,
      reprocessed: result.reprocessed,
      actorId: 'authority:wsfex-reconciliation',
      idempotencyKey: `${input.executionId}:official-reconciliation`,
      occurredAt,
    });
    return {
      status: 'officially_reconciled',
      receiptHash: result.reconciliationEvidenceHash,
      // This signer-derived commitment is authority-scoped. Workspace and intent
      // are deliberately excluded so one ARCA document can lock only once.
      authorityIdentityHash: result.authorityIdentityHash,
    };
  }

  private boundRun(input: Readonly<{
    workspaceId: string;
    runId: string;
    intentHash: string;
  }>): FacturaEAgentRunV1 {
    const run = this.runs.getRun(input.runId);
    if (
      run.workspaceId !== input.workspaceId
      || run.intentHash !== input.intentHash
      || !run.intent
      || run.intentState !== 'frozen'
      || run.issuanceState !== 'ready_for_wsfex'
      || run.issuancePath !== 'wsfex_delegated'
      || hashCanonical(run.intent) !== input.intentHash
    ) throw new Error('TAX_AUTHORITY_REMOTE_EFFECT_RUN_BINDING_CONFLICT');
    return run;
  }
}

function effectOutcome(
  result: WsfexAuthorityResult,
  expectedEnvironment: 'homologation' | 'production'
): FacturaEAuthorityEffectOutcome {
  assertAuthorityEnvironment(result, expectedEnvironment);
  return {
    status:
      result.status === 'accepted'
        ? 'authority_accepted_unverified'
        : result.status,
    receiptHash: result.receiptHash,
  };
}

function assertAuthorityEnvironment(
  result: WsfexAuthorityResult,
  expected: 'homologation' | 'production'
): void {
  if (result.authorityEnvironment !== expected) {
    throw new Error('TAX_AUTHORITY_RESULT_ENVIRONMENT_MISMATCH');
  }
}
