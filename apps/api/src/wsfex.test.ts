import { describe, expect, test } from 'bun:test';

import { approveFacturaEAdjustment, approveFacturaEAdjustmentByAccountant, createFacturaEAgentRun, hashCanonical, prepareFacturaEAdjustment, type FacturaEAgentRunV1, type FacturaEIntentV1 } from '@tax-engine/core';

import { HttpWsfexGateway } from './wsfex';

describe('HTTP WSFEX signer boundary', () => {
  test('rejects request IDs larger than the WSFEX N15 field before transport', async () => {
    const run = approvedRun();
    const gateway = new HttpWsfexGateway(
      { baseUrl: 'https://signer.test', token: 'secret', environment: 'homologation' },
      async () => { throw new Error('transport must not run'); }
    );
    await expect(gateway.authorize({ run, requestId: '1000000000000000', authorityPayloadRef: 'vault://payload/too-large' }))
      .rejects.toThrow('WSFEX_REQUEST_ID_INVALID');
  });

  test('accepts a CAE only when the signer echoes the exact frozen document', async () => {
    const run = approvedRun();
    const gateway = new HttpWsfexGateway(
      { baseUrl: 'https://signer.test', token: 'secret', environment: 'homologation' },
      async (_input, init) => {
        expect(new Headers(init?.headers).get('idempotency-key')).toBe('1');
        return Response.json({
          requestId: '1',
          status: 'accepted',
          invoiceNumber: '81',
          cae: '12345678901234',
          reprocessed: false,
          authorizedDocument: {
            intentHash: run.intentHash,
            documentType: 19,
            operationType: 2,
            pointOfSale: 4,
            issueDate: run.intent!.issueDate,
            total: run.intent!.total,
          },
          safeErrors: [],
        });
      }
    );
    const result = await gateway.authorize({ run, requestId: '1', authorityPayloadRef: 'vault://payload/1' });
    expect(result).toEqual(expect.objectContaining({ status: 'accepted', invoiceNumber: '81', cae: '12345678901234' }));
  });

  test('rejects a signer response for a different total', async () => {
    const run = approvedRun();
    const gateway = new HttpWsfexGateway(
      { baseUrl: 'https://signer.test', token: 'secret', environment: 'homologation' },
      async () => Response.json({
        requestId: '2', status: 'accepted', invoiceNumber: '82', cae: '12345678901234', reprocessed: false,
        authorizedDocument: {
          intentHash: run.intentHash, documentType: 19, operationType: 2, pointOfSale: 4, issueDate: run.intent!.issueDate,
          total: { decimal: '999.00', currency: 'USD' },
        },
        safeErrors: [],
      })
    );
    expect(gateway.authorize({ run, requestId: '2', authorityPayloadRef: 'vault://payload/2' })).rejects.toThrow('ARCA_SIGNER_AUTHORIZED_DOCUMENT_MISMATCH');
  });

  test('binds an export credit note to its exact original Factura E association', async () => {
    const run = approvedAdjustmentRun();
    const adjustment = run.adjustments[0]!;
    const gateway = new HttpWsfexGateway(
      { baseUrl: 'https://signer.test', token: 'secret', environment: 'homologation' },
      async (_input, init) => {
        const body = JSON.parse(String(init?.body));
        expect(body).toEqual(expect.objectContaining({
          subjectId: adjustment.adjustmentId,
          intentHash: adjustment.intentHash,
          expected: expect.objectContaining({
            documentType: 21,
            associatedDocument: { documentType: 19, pointOfSale: 4, invoiceNumber: '81' },
          }),
        }));
        return Response.json({
          requestId: '3', status: 'accepted', invoiceNumber: '82', cae: '22345678901234', reprocessed: false,
          authorizedDocument: {
            intentHash: adjustment.intentHash,
            documentType: 21,
            operationType: 2,
            pointOfSale: 4,
            issueDate: adjustment.issueDate,
            total: adjustment.amount,
            associatedDocument: adjustment.associatedDocument,
          },
          safeErrors: [],
        });
      }
    );
    await expect(gateway.authorizeAdjustment({ run, adjustmentId: adjustment.adjustmentId, requestId: '3', authorityPayloadRef: 'vault://payload/3' }))
      .resolves.toEqual(expect.objectContaining({ status: 'accepted', invoiceNumber: '82' }));
  });

  test('rejects an adjustment receipt associated to another original invoice', async () => {
    const run = approvedAdjustmentRun();
    const adjustment = run.adjustments[0]!;
    const gateway = new HttpWsfexGateway(
      { baseUrl: 'https://signer.test', token: 'secret', environment: 'homologation' },
      async () => Response.json({
        requestId: '4', status: 'accepted', invoiceNumber: '83', cae: '32345678901234', reprocessed: false,
        authorizedDocument: {
          intentHash: adjustment.intentHash, documentType: 21, operationType: 2, pointOfSale: 4, issueDate: adjustment.issueDate, total: adjustment.amount,
          associatedDocument: { ...adjustment.associatedDocument, invoiceNumber: '999' },
        },
        safeErrors: [],
      })
    );
    expect(gateway.authorizeAdjustment({ run, adjustmentId: adjustment.adjustmentId, requestId: '4', authorityPayloadRef: 'vault://payload/4' }))
      .rejects.toThrow('ARCA_SIGNER_AUTHORIZED_DOCUMENT_MISMATCH');
  });
});

function approvedAdjustmentRun(): FacturaEAgentRunV1 {
  const base = approvedRun();
  let run: FacturaEAgentRunV1 = {
    ...base,
    issuanceState: 'arca_authorized',
    authority: {
      requestId: '1', payloadReferenceHash: hashCanonical('vault://payload/1'), invoiceNumber: '81', cae: '12345678901234',
      authorizedAt: '2026-07-11T12:00:00.000Z', receiptHash: hashCanonical('receipt-1'), reprocessed: false,
    },
  };
  const prepared = prepareFacturaEAdjustment(run, {
    adjustmentId: 'credit-wsfex', documentType: 21, issueDate: '2026-07-11', amount: { decimal: '100.00', currency: 'USD' },
    reason: 'Commercial discount', asOf: '2026-07-11', actorId: 'agent:tax', occurredAt: '2026-07-11T12:01:00.000Z', idempotencyKey: 'prepare-credit-wsfex',
  });
  run = approveFacturaEAdjustment(prepared.run, {
    adjustmentId: prepared.adjustment.adjustmentId, intentHash: prepared.adjustment.intentHash, actorId: 'user:owner',
    occurredAt: '2026-07-11T12:02:00.000Z', idempotencyKey: 'approve-credit-wsfex-user',
  }).run;
  return approveFacturaEAdjustmentByAccountant(run, {
    adjustmentId: prepared.adjustment.adjustmentId, intentHash: prepared.adjustment.intentHash, actorId: 'accountant:1',
    occurredAt: '2026-07-11T12:03:00.000Z', idempotencyKey: 'approve-credit-wsfex-accountant',
  }).run;
}

function approvedRun(): FacturaEAgentRunV1 {
  const intent: FacturaEIntentV1 = {
    version: 'factura-e-intent-v1', intentId: 'intent-wsfex', workspaceId: 'workspace-wsfex',
    taxpayerReferenceHash: hashCanonical('taxpayer'), foreignCustomerReferenceHash: hashCanonical('customer'), foreignCustomerSafeLabel: 'Foreign customer',
    destinationCountry: 'US', destinationCountryArcaCode: 200, documentType: 19, operationType: 2, pointOfSale: 4,
    issueDate: '2026-07-11', paymentDate: '2026-07-11', sameCurrencyPayment: true,
    exchangeRate: { decimal: '1200.25', sourceReferenceId: 'fx:bna', observedForDate: '2026-07-10', authorityRuleDecisionId: 'fx-rule-reviewed' },
    lineItems: [{ description: 'Software services', quantity: '1', unitPrice: '1000.00', total: '1000.00', unitCode: 7 }],
    total: { decimal: '1000.00', currency: 'USD' }, serviceDescription: 'Software services', paymentTerms: 'Due on receipt',
    ruleVersionIds: ['ar-rg-4401-factura-e-v1', 'arca-wsfex-3.1.1', 'bcra-a8330-service-exports-v1'],
  };
  return {
    ...createFacturaEAgentRun({
      runId: '40000000-0000-4000-8000-000000000001', workspaceId: intent.workspaceId, issuancePath: 'wsfex_delegated',
      actorId: 'agent:tax', occurredAt: '2026-07-11T12:00:00.000Z', idempotencyKey: 'create-wsfex-test',
    }).run,
    intent,
    intentHash: hashCanonical(intent),
    intentState: 'frozen',
    approvalState: 'accountant_approved',
    issuanceState: 'ready_for_wsfex',
  };
}
