import { describe, expect, test } from 'bun:test';

import { approveFacturaEAdjustment, approveFacturaEAdjustmentByAccountant, createFacturaEAgentRun, hashCanonical, prepareFacturaEAdjustment, type FacturaEAgentRunV1, type FacturaEIntentV1 } from '@tax-engine/core';
import {
  hashWsfexAuthorityIdentity,
  hashWsfexReconciliationAttestation,
  pointOfSaleDiscoverySchema,
  signerResponseSchema,
} from '@tax-engine/wsfex-signer/contracts';

import { HttpWsfexGateway } from './wsfex';

describe('HTTP WSFEX signer boundary', () => {
  test('discovers active FEEWS points only from an exactly bound signer receipt', async () => {
    const observedAt = '2026-07-15T12:00:00.000Z';
    const receiptWithoutHash = {
      version: 'arca-wsfex-point-of-sale-discovery-v1' as const,
      environment: 'homologation' as const,
      workspaceId: 'workspace-1',
      issuerProfileReferenceHash: hashCanonical('vault://issuer/profile-1'),
      representedCuitCommitment: 'b'.repeat(64),
      activePoints: [4],
      authorityResponseHash: 'c'.repeat(64),
      observedAt,
    };
    const gateway = new HttpWsfexGateway(
      { baseUrl: 'https://signer.test', token: 'secret', environment: 'homologation' },
      async (target, init) => {
        const url = new URL(String(target));
        expect(url.pathname).toBe('/v1/wsfexv1/params/points-of-sale/discover');
        expect(url.search).toBe('');
        expect(init?.method).toBe('POST');
        expect(JSON.parse(String(init?.body))).toEqual({
          workspaceId: 'workspace-1',
          issuerProfileRef: 'vault://issuer/profile-1',
        });
        return Response.json(pointOfSaleDiscoverySchema.parse({
          ...receiptWithoutHash,
          evidenceHash: hashCanonical(receiptWithoutHash),
        }));
      }
    );
    await expect(gateway.discoverPointsOfSale({
      workspaceId: 'workspace-1',
      issuerProfileRef: 'vault://issuer/profile-1',
    })).resolves.toEqual(expect.objectContaining({ activePoints: [4] }));
  });

  test('reserves a sequence only from an exactly bound and hash-verified signer receipt', async () => {
    const input = {
      workspaceId: 'workspace-1',
      issuerProfileRef: 'vault://issuer/profile-1',
      runId: '10000000-0000-4000-8000-000000000001',
      intentHash: 'a'.repeat(64),
      subjectId: 'invoice-1',
      pointOfSale: 4,
      idempotencyKey: 'reservation:invoice-1',
    };
    const material = {
      version: 'tax-wsfex-sequence-reservation-receipt-v1' as const,
      environment: 'homologation' as const,
      ...input,
      issuerProfileReferenceHash: hashCanonical(input.issuerProfileRef),
      representedCuitCommitment: 'b'.repeat(64),
      documentType: 19 as const,
      requestId: '101',
      invoiceNumber: '6',
      reservedAt: '2026-07-16T12:00:00.000Z',
      expiresAt: '2026-07-16T12:10:00.000Z',
      replayed: false,
    };
    const gateway = new HttpWsfexGateway(
      { baseUrl: 'https://signer.test', token: 'secret', environment: 'homologation' },
      async (target, init) => {
        expect(String(target)).toBe('https://signer.test/v1/wsfexv1/sequence/reservations');
        expect(new Headers(init?.headers).get('idempotency-key')).toBe(input.idempotencyKey);
        expect(JSON.parse(String(init?.body))).toEqual(expect.objectContaining({
          version: 'tax-wsfex-sequence-reservation-request-v1',
          documentType: 19,
          ...input,
        }));
        return Response.json({ ...material, evidenceHash: hashCanonical(material) });
      }
    );
    await expect(gateway.reserveSequence(input)).resolves.toEqual(
      expect.objectContaining({ requestId: '101', invoiceNumber: '6' })
    );
  });

  test('rejects request IDs larger than the WSFEX N15 field before transport', async () => {
    const run = approvedRun();
    const gateway = new HttpWsfexGateway(
      { baseUrl: 'https://signer.test', token: 'secret', environment: 'homologation' },
      async () => { throw new Error('transport must not run'); }
    );
    await expect(gateway.authorize({ run, requestId: '1000000000000000', authorityPayloadRef: 'vault://payload/too-large', authorityPayloadHash: 'a'.repeat(64) }))
      .rejects.toThrow('WSFEX_REQUEST_ID_INVALID');
  });

  test('maps a typed signer preflight denial to deterministic rejection without ambiguity', async () => {
    const run = approvedRun();
    const gateway = new HttpWsfexGateway(
      { baseUrl: 'https://signer.test', token: 'secret', environment: 'homologation' },
      async (target, init) => {
        expect(String(target)).toBe('https://signer.test/v1/wsfex/authorize');
        expect(init?.redirect).toBe('error');
        return Response.json({
          requestId: '1',
          status: 'preflight_rejected',
          invoiceNumber: null,
          cae: null,
          caeExpiry: null,
          reprocessed: null,
          authorizedDocument: null,
          reconciliation: null,
          safeErrors: [{
            code: 'WSFEX_REQUEST_ID_NOT_MONOTONIC',
            message: 'The deterministic WSFEX preflight denied submission.',
          }],
        });
      }
    );
    await expect(gateway.authorize({
      run,
      requestId: '1',
      authorityPayloadRef: 'vault://payload/1',
      authorityPayloadHash: 'a'.repeat(64),
    })).resolves.toMatchObject({
      providerId: 'tax-engine-wsfex-signer-v1',
      status: 'rejected',
      authorityEnvironment: 'homologation',
    });
  });

  test('cancels an unbounded chunked signer response at the byte ceiling', async () => {
    const run = approvedRun();
    let cancelled = false;
    const gateway = new HttpWsfexGateway(
      { baseUrl: 'https://signer.test', token: 'secret', environment: 'homologation' },
      async () => new Response(new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.enqueue(new Uint8Array(140 * 1024));
        },
        cancel() {
          cancelled = true;
        },
      }))
    );
    await expect(gateway.authorize({
      run,
      requestId: '1',
      authorityPayloadRef: 'vault://payload/1',
      authorityPayloadHash: 'a'.repeat(64),
    })).rejects.toThrow('ARCA_SIGNER_RESPONSE_TOO_LARGE');
    expect(cancelled).toBe(true);
  });

  test('accepts a CAE only when the signer echoes the exact frozen document', async () => {
    const run = approvedRun();
    const gateway = new HttpWsfexGateway(
      { baseUrl: 'https://signer.test', token: 'secret', environment: 'homologation' },
      async (_input, init) => {
        expect(new Headers(init?.headers).get('idempotency-key')).toBe('1');
        return Response.json(signerResponseSchema.parse({
          requestId: '1',
          status: 'accepted',
          invoiceNumber: '81',
          cae: '12345678901234',
          caeExpiry: '2026-07-21',
          reprocessed: false,
          authorizedDocument: {
            intentHash: run.intentHash,
            documentType: 19,
            operationType: 2,
            pointOfSale: 4,
            issueDate: run.intent!.issueDate,
            total: run.intent!.total,
            currencyId: 'DOL',
            currencyQuote: '1200.25',
          },
          reconciliation: null,
          safeErrors: [],
        }));
      }
    );
    const result = await gateway.authorize({ run, requestId: '1', authorityPayloadRef: 'vault://payload/1', authorityPayloadHash: 'a'.repeat(64) });
    expect(result).toEqual(expect.objectContaining({
      status: 'accepted',
      invoiceNumber: '81',
      cae: '12345678901234',
      caeExpiry: '2026-07-21',
      currencyId: 'DOL',
      currencyQuote: '1200.25',
    }));
  });

  test('uses the dedicated independent reconciliation endpoint and binds the payload hash', async () => {
    const run = approvedRun();
    let capturedUrl = '';
    const gateway = new HttpWsfexGateway(
      { baseUrl: 'https://signer.test', token: 'secret', environment: 'homologation' },
      async (input, init) => {
        capturedUrl = String(input);
        expect(JSON.parse(String(init?.body))).toMatchObject({
          authorityPayloadHash: 'b'.repeat(64),
          intentHash: run.intentHash,
        });
        const attestationMaterial = {
          version: 'arca-wsfex-reconciliation-attestation-v1' as const,
          source: 'FEXGetCMP' as const,
          environment: 'homologation' as const,
          representedCuitCommitment: 'a'.repeat(64),
          authorityIdentityHash: hashWsfexAuthorityIdentity({
            environment: 'homologation',
            representedCuitCommitment: 'a'.repeat(64),
            documentType: 19,
            pointOfSale: 4,
            invoiceNumber: '81',
          }),
          authorityResponseHash: 'c'.repeat(64),
          payloadHash: 'b'.repeat(64),
          requestId: '1',
          intentHash: run.intentHash!,
          documentType: 19 as const,
          pointOfSale: 4,
          invoiceNumber: '81',
          cae: '12345678901234',
          observedAt: '2026-07-11T12:00:00.000Z',
        };
        return Response.json({
          requestId: '1', status: 'accepted', invoiceNumber: '81', cae: '12345678901234',
          caeExpiry: '2026-07-21', reprocessed: true,
          authorizedDocument: {
            intentHash: run.intentHash, documentType: 19, operationType: 2,
            pointOfSale: 4, issueDate: run.intent!.issueDate, total: run.intent!.total,
            currencyId: 'DOL', currencyQuote: '1200.25',
          },
          reconciliation: {
            ...attestationMaterial,
            evidenceHash: hashWsfexReconciliationAttestation(attestationMaterial),
          },
          safeErrors: [],
        });
      }
    );
    await expect(gateway.reconcile({
      run,
      requestId: '1',
      authorityPayloadRef: 'vault://payload/1',
      authorityPayloadHash: 'b'.repeat(64),
    })).resolves.toMatchObject({ status: 'accepted' });
    expect(capturedUrl).toBe('https://signer.test/v1/wsfex/reconcile');
  });

  test('rejects the former false-green success shape without frozen/confirmed currency and CAE expiry', async () => {
    const run = approvedRun();
    const gateway = new HttpWsfexGateway(
      { baseUrl: 'https://signer.test', token: 'secret', environment: 'homologation' },
      async () => Response.json({
        requestId: '5', status: 'accepted', invoiceNumber: '85', cae: '52345678901234', reprocessed: false,
        authorizedDocument: {
          intentHash: run.intentHash, documentType: 19, operationType: 2, pointOfSale: 4, issueDate: run.intent!.issueDate,
          total: run.intent!.total,
        },
        reconciliation: null,
        safeErrors: [],
      })
    );
    await expect(gateway.authorize({ run, requestId: '5', authorityPayloadRef: 'vault://payload/5', authorityPayloadHash: 'a'.repeat(64) })).rejects.toThrow();
  });

  test('rejects a signer response for a different total', async () => {
    const run = approvedRun();
    const gateway = new HttpWsfexGateway(
      { baseUrl: 'https://signer.test', token: 'secret', environment: 'homologation' },
      async () => Response.json({
        requestId: '2', status: 'accepted', invoiceNumber: '82', cae: '12345678901234', caeExpiry: '2026-07-21', reprocessed: false,
        authorizedDocument: {
          intentHash: run.intentHash, documentType: 19, operationType: 2, pointOfSale: 4, issueDate: run.intent!.issueDate,
          total: { decimal: '999.00', currency: 'USD' },
          currencyId: 'DOL', currencyQuote: '1200.25',
        },
        reconciliation: null,
        safeErrors: [],
      })
    );
    expect(gateway.authorize({ run, requestId: '2', authorityPayloadRef: 'vault://payload/2', authorityPayloadHash: 'a'.repeat(64) })).rejects.toThrow('ARCA_SIGNER_AUTHORIZED_DOCUMENT_MISMATCH');
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
          requestId: '3', status: 'accepted', invoiceNumber: '82', cae: '22345678901234', caeExpiry: '2026-07-21', reprocessed: false,
          authorizedDocument: {
            intentHash: adjustment.intentHash,
            documentType: 21,
            operationType: 2,
            pointOfSale: 4,
            issueDate: adjustment.issueDate,
            total: adjustment.amount,
            currencyId: 'DOL',
            currencyQuote: '1200.25',
            associatedDocument: adjustment.associatedDocument,
          },
          reconciliation: null,
          safeErrors: [],
        });
      }
    );
    await expect(gateway.authorizeAdjustment({ run, adjustmentId: adjustment.adjustmentId, requestId: '3', authorityPayloadRef: 'vault://payload/3', authorityPayloadHash: 'a'.repeat(64) }))
      .resolves.toEqual(expect.objectContaining({ status: 'accepted', invoiceNumber: '82' }));
  });

  test('rejects an adjustment receipt associated to another original invoice', async () => {
    const run = approvedAdjustmentRun();
    const adjustment = run.adjustments[0]!;
    const gateway = new HttpWsfexGateway(
      { baseUrl: 'https://signer.test', token: 'secret', environment: 'homologation' },
      async () => Response.json({
        requestId: '4', status: 'accepted', invoiceNumber: '83', cae: '32345678901234', caeExpiry: '2026-07-21', reprocessed: false,
        authorizedDocument: {
          intentHash: adjustment.intentHash, documentType: 21, operationType: 2, pointOfSale: 4, issueDate: adjustment.issueDate, total: adjustment.amount,
          currencyId: 'DOL', currencyQuote: '1200.25',
          associatedDocument: { ...adjustment.associatedDocument, invoiceNumber: '999' },
        },
        reconciliation: null,
        safeErrors: [],
      })
    );
    expect(gateway.authorizeAdjustment({ run, adjustmentId: adjustment.adjustmentId, requestId: '4', authorityPayloadRef: 'vault://payload/4', authorityPayloadHash: 'a'.repeat(64) }))
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
      caeExpiry: '2026-07-21', currencyId: 'DOL', currencyQuote: '1200.25',
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
