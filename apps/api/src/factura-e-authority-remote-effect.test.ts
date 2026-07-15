import { describe, expect, test } from 'bun:test';

import {
  createFacturaEAgentRun,
  hashCanonical,
  type FacturaEAgentRunV1,
  type FacturaEIntentV1,
} from '@tax-engine/core';

import type { AuthorityPayloadWriter } from './authority-payload';
import type {
  FacturaEAuthorityPreparationGateway,
  FacturaEAuthorityPrivatePreparation,
} from './factura-e-authority-preparation';
import { TaxWsfexAuthorityRemoteEffect } from './factura-e-authority-remote-effect';
import type { WsfexAuthorityResult, WsfexGateway } from './wsfex';

const now = '2026-07-15T12:00:00.000Z';

describe('Tax-owned WSFEX authority remote effect', () => {
  test('prepares privately, hash-binds the vault, and promotes only an independent read', async () => {
    const run = approvedRun();
    const calls = { prepare: 0, store: 0, authorize: 0, recover: 0, reconcile: 0 };
    const preparations: FacturaEAuthorityPreparationGateway = {
      async prepare(input) {
        calls.prepare += 1;
        expect(input).toMatchObject({
          workspaceId: run.workspaceId,
          runId: run.runId,
          intentHash: run.intentHash,
          pointOfSale: 4,
          currency: 'USD',
        });
        return privatePreparation(run, input.executionId, input.idempotencyKey);
      },
    };
    const payloads: AuthorityPayloadWriter = {
      async store(input) {
        calls.store += 1;
        expect(input.payload.customer.name).toBe('Foreign Customer LLC');
        expect(input.payload.intentHash).toBe(run.intentHash!);
        expect(input.expiresAt).toBe('2026-07-15T13:00:00.000Z');
        return {
          version: 'authority-payload-store-receipt-v1',
          reference: 'vault://wsfex/33333333-3333-4333-8333-333333333333',
          payloadHash: hashCanonical(input.payload),
          storedAt: now,
          expiresAt: input.expiresAt,
        };
      },
      async markTerminal(input) {
        return {
          version: 'authority-payload-terminal-receipt-v1',
          referenceHash: hashCanonical(input.reference),
          payloadHash: input.payloadHash,
          authorityIdentityHash: input.authorityIdentityHash,
          terminalState: 'officially_reconciled',
          retentionPolicyId: 'test-retention-v1',
          retireAfter: '2026-08-15T12:00:00.000Z',
          terminalEvidenceHash: input.terminalEvidenceHash,
        };
      },
    };
    const wsfex = fakeWsfex(calls, run);
    const effect = new TaxWsfexAuthorityRemoteEffect(
      { getRun: () => run }, preparations, payloads, wsfex, 'production'
    );
    const prepared = await effect.prepare({
      executionId: '44444444-4444-4444-8444-444444444444',
      workspaceId: run.workspaceId,
      runId: run.runId,
      intentHash: run.intentHash!,
      idempotencyKey: 'execution-4444:prepare',
    });
    expect(prepared.authorityPayloadHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(prepared)).not.toContain('Foreign Customer LLC');
    expect(await effect.execute(prepared)).toMatchObject({
      status: 'authority_accepted_unverified',
    });
    const official = await effect.reconcile(prepared);
    expect(official).toMatchObject({ status: 'officially_reconciled' });
    expect(official.authorityIdentityHash).toMatch(/^[a-f0-9]{64}$/);
    expect(calls).toEqual({ prepare: 1, store: 1, authorize: 1, recover: 0, reconcile: 1 });
  });

  test('never promotes an ambiguous independent read and rejects a rebound run', async () => {
    const run = approvedRun();
    const calls = { prepare: 0, store: 0, authorize: 0, recover: 0, reconcile: 0 };
    const wsfex = fakeWsfex(calls, run, 'ambiguous');
    const effect = new TaxWsfexAuthorityRemoteEffect(
      { getRun: () => run },
      { async prepare(input) { return privatePreparation(run, input.executionId, input.idempotencyKey); } },
      {
        async store(input) {
          return {
            version: 'authority-payload-store-receipt-v1',
            reference: 'vault://wsfex/33333333-3333-4333-8333-333333333333',
            payloadHash: hashCanonical(input.payload),
            storedAt: now,
            expiresAt: input.expiresAt,
          };
        },
        async markTerminal(input) {
          return {
            version: 'authority-payload-terminal-receipt-v1',
            referenceHash: hashCanonical(input.reference),
            payloadHash: input.payloadHash,
            authorityIdentityHash: input.authorityIdentityHash,
            terminalState: 'officially_reconciled',
            retentionPolicyId: 'test-retention-v1',
            retireAfter: '2026-08-15T12:00:00.000Z',
            terminalEvidenceHash: input.terminalEvidenceHash,
          };
        },
      },
      wsfex,
      'production'
    );
    const preparation = {
      executionId: '44444444-4444-4444-8444-444444444444',
      workspaceId: run.workspaceId,
      runId: run.runId,
      intentHash: run.intentHash!,
      requestId: '101',
      authorityPayloadRef: 'vault://wsfex/33333333-3333-4333-8333-333333333333',
      authorityPayloadHash: 'c'.repeat(64),
    };
    await expect(effect.reconcile(preparation)).resolves.toMatchObject({ status: 'ambiguous' });
    await expect(effect.execute({ ...preparation, workspaceId: 'workspace-other' })).rejects
      .toThrow('TAX_AUTHORITY_REMOTE_EFFECT_RUN_BINDING_CONFLICT');
  });
});

function fakeWsfex(
  calls: Record<'prepare' | 'store' | 'authorize' | 'recover' | 'reconcile', number>,
  run: FacturaEAgentRunV1,
  reconciliation: 'accepted' | 'ambiguous' = 'accepted'
): WsfexGateway {
  const result = (status: 'accepted' | 'ambiguous'): WsfexAuthorityResult => ({
    providerId: 'tax-engine-wsfex-signer-v1',
    requestId: '101',
    status,
    invoiceNumber: status === 'accepted' ? '6' : null,
    cae: status === 'accepted' ? '12345678901234' : null,
    caeExpiry: status === 'accepted' ? '2026-07-25' : null,
    currencyId: status === 'accepted' ? 'DOL' : null,
    currencyQuote: status === 'accepted' ? run.intent!.exchangeRate!.decimal : null,
    reprocessed: status === 'accepted',
    receiptHash: hashCanonical({ status, source: 'test' }),
    authorityIdentityHash: status === 'accepted' ? hashCanonical('official-invoice') : null,
    reconciliationEvidenceHash: status === 'accepted' ? hashCanonical('official-evidence') : null,
    authorityEnvironment: 'production',
  });
  return {
    providerId: 'tax-engine-wsfex-signer-v1',
    async authorize(input) {
      calls.authorize += 1;
      expect(input.authorityPayloadHash).toMatch(/^[a-f0-9]{64}$/);
      return result('accepted');
    },
    async recover() { calls.recover += 1; return result('accepted'); },
    async reconcile() { calls.reconcile += 1; return result(reconciliation); },
    async authorizeAdjustment() { throw new Error('NOT_USED'); },
    async recoverAdjustment() { throw new Error('NOT_USED'); },
  };
}

function privatePreparation(
  run: FacturaEAgentRunV1,
  executionId: string,
  idempotencyKey: string
): FacturaEAuthorityPrivatePreparation {
  return {
    version: 'factura-e-authority-private-preparation-v1',
    executionId,
    workspaceId: run.workspaceId,
    runId: run.runId,
    intentHash: run.intentHash!,
    taxpayerReferenceHash: run.intent!.taxpayerReferenceHash,
    foreignCustomerReferenceHash: run.intent!.foreignCustomerReferenceHash,
    representedCuitCommitment: hashCanonical('represented-cuit:workspace-live'),
    idempotencyKey,
    requestId: '101',
    invoiceNumber: '6',
    issuerProfileRef: 'vault://issuer/workspace/primary',
    customer: {
      name: 'Foreign Customer LLC',
      address: '123 Main St',
      countryCuit: '50000000016',
      foreignTaxId: 'US-TAX-ID',
    },
    currencyArcaId: 'DOL',
    language: 2,
    commercialObservation: null,
    generalObservation: null,
    preparedAt: now,
    expiresAt: '2026-07-15T13:00:00.000Z',
    preparationHash: 'd'.repeat(64),
  };
}

function approvedRun(): FacturaEAgentRunV1 {
  const intent: FacturaEIntentV1 = {
    version: 'factura-e-intent-v1',
    intentId: 'intent-wsfex-live',
    workspaceId: 'workspace-live',
    taxpayerReferenceHash: hashCanonical('taxpayer'),
    foreignCustomerReferenceHash: hashCanonical('customer'),
    foreignCustomerSafeLabel: 'Foreign customer',
    destinationCountry: 'US',
    destinationCountryArcaCode: 200,
    documentType: 19,
    operationType: 2,
    pointOfSale: 4,
    issueDate: '2026-07-15',
    paymentDate: '2026-08-15',
    sameCurrencyPayment: true,
    exchangeRate: {
      decimal: '1200.25',
      sourceReferenceId: 'fx:bna',
      observedForDate: '2026-07-14',
      authorityRuleDecisionId: 'fx-rule-reviewed',
    },
    lineItems: [{
      description: 'Software services', quantity: '1', unitPrice: '1000.00', total: '1000.00', unitCode: 7,
    }],
    total: { decimal: '1000.00', currency: 'USD' },
    serviceDescription: 'Software services',
    paymentTerms: 'Due on receipt',
    ruleVersionIds: ['arca-wsfex-3.1.1'],
  };
  return {
    ...createFacturaEAgentRun({
      runId: '22222222-2222-4222-8222-222222222222',
      workspaceId: intent.workspaceId,
      issuancePath: 'wsfex_delegated',
      actorId: 'agent:tax',
      occurredAt: now,
      idempotencyKey: 'create-wsfex-live',
    }).run,
    intent,
    intentHash: hashCanonical(intent),
    intentState: 'frozen',
    approvalState: 'accountant_approved',
    issuanceState: 'ready_for_wsfex',
  };
}
