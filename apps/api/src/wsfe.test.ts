import { describe, expect, test } from 'bun:test';

import { hashCanonical } from '@tax-engine/core';
import { pointOfSaleReadbackSchema, signerRequestSchema } from '@tax-engine/wsfe-signer/contracts';

import { HttpWsfePointOfSaleGateway } from './wsfe';

function wsfeRequest() {
  return signerRequestSchema.parse({
    version: 'motora-wsfe-boundary-v1', environment: 'homologation', workspaceId: 'personal:user-1',
    runId: '10000000-0000-4000-8000-000000000001', requestId: '101', subjectId: 'invoice-1',
    intentHash: hashCanonical('frozen-personal-invoice'), authorityPayloadRef: 'vault://wsfe/payload-1',
    expected: {
      documentType: 11, concept: 2, pointOfSale: 1, issueDate: '2026-07-11',
      receptorDocType: 80, receptorCondicionIvaId: 6,
      total: { decimal: '15000.00', currency: 'ARS' },
      servicePeriod: { from: '2026-07-01', to: '2026-07-11', paymentDueDate: '2026-07-11' },
    },
  });
}

describe('HTTP WSFE onboarding boundary', () => {
  test('accepts only hash-verified homologation C readback for the requested issuer and POS 1', async () => {
    const input = { workspaceId: 'workspace-1', issuerProfileRef: 'vault://issuer/profile-1', pointOfSale: 1 as const };
    const material = {
      version: 'arca-wsfe-point-of-sale-readback-v1' as const,
      environment: 'homologation' as const, workspaceId: input.workspaceId,
      issuerProfileReferenceHash: hashCanonical(input.issuerProfileRef), representedCuitCommitment: 'a'.repeat(64),
      pointOfSale: 1 as const, documentType: 11 as const, invoiceNumber: '1' as const,
      caeHash: 'b'.repeat(64), discoveryResponseHash: 'c'.repeat(64), authorityResponseHash: 'd'.repeat(64),
      observedAt: '2026-07-15T12:00:00.000Z',
    };
    const receipt = pointOfSaleReadbackSchema.parse({ ...material, evidenceHash: hashCanonical(material) });
    const gateway = new HttpWsfePointOfSaleGateway(
      { baseUrl: 'https://wsfe.test', token: 'secret', environment: 'homologation' },
      async (target, init) => {
        expect(String(target)).toBe('https://wsfe.test/v1/wsfev1/params/points-of-sale/verify-readback');
        expect(JSON.parse(String(init?.body))).toEqual(input);
        return Response.json(receipt);
      },
    );
    await expect(gateway.verifyPointOfSaleReadback(input)).resolves.toEqual(receipt);
    const otherIssuer = new HttpWsfePointOfSaleGateway(
      { baseUrl: 'https://wsfe.test', token: 'secret', environment: 'homologation' },
      async () => Response.json({ ...receipt, issuerProfileReferenceHash: 'e'.repeat(64), evidenceHash: hashCanonical({ ...material, issuerProfileReferenceHash: 'e'.repeat(64) }) }),
    );
    await expect(otherIssuer.verifyPointOfSaleReadback(input)).rejects.toThrow('ARCA_WSFE_POS_BINDING_MISMATCH');
  });
});

describe('HTTP WSFE issuance boundary', () => {
  test('binds the next C number to the requested issuer and point', async () => {
    const input = { workspaceId: 'personal:user-1', issuerProfileRef: 'vault://issuer/profile-1', documentType: 11 as const, pointOfSale: 1 };
    const material = {
      version: 'arca-wsfe-next-voucher-v1' as const, environment: 'homologation' as const,
      workspaceId: input.workspaceId, issuerProfileReferenceHash: hashCanonical(input.issuerProfileRef),
      representedCuitCommitment: 'a'.repeat(64), documentType: 11 as const, pointOfSale: 1,
      lastInvoiceNumber: '1', nextInvoiceNumber: '2', observedAt: '2026-07-15T12:00:00.000Z',
    };
    const gateway = new HttpWsfePointOfSaleGateway(
      { baseUrl: 'https://wsfe.test', token: 'secret', environment: 'homologation' },
      async (target, init) => {
        expect(String(target)).toBe('https://wsfe.test/v1/wsfev1/params/next-voucher');
        expect(JSON.parse(String(init?.body))).toEqual(input);
        return Response.json({ ...material, evidenceHash: hashCanonical(material) });
      },
    );
    expect((await gateway.getNextVoucher(input)).nextInvoiceNumber).toBe('2');
  });

  test('carries the exact request ID and waits for official readback without resubmitting', async () => {
    const request = wsfeRequest();
    const accepted = {
      requestId: request.requestId, status: 'accepted', resultado: 'A', cae: '71234567890123',
      caeFchVto: '2026-07-21', cbteTipo: 11, ptoVta: 1, cbteNro: '6', reprocessed: false,
      feCompConsultarEcho: null, authorizedDocument: { intentHash: request.intentHash, ...request.expected }, safeErrors: [],
    };
    let calls = 0;
    const gateway = new HttpWsfePointOfSaleGateway(
      { baseUrl: 'https://wsfe.test', token: 'secret', environment: 'homologation' },
      async (target, init) => {
        calls += 1;
        expect(String(target)).toBe('https://wsfe.test/v1/wsfev1/invoices');
        expect(init?.headers).toEqual(expect.objectContaining({ 'idempotency-key': request.requestId }));
        expect(JSON.parse(String(init?.body))).toEqual(request);
        return Response.json(calls === 1 ? accepted : {
          ...accepted,
          feCompConsultarEcho: {
            pointOfSale: 1, documentType: 11, invoiceNumber: '6', issueDate: request.expected.issueDate,
            concept: request.expected.concept, receptorDocType: request.expected.receptorDocType,
            total: request.expected.total, cae: accepted.cae, caeExpiry: accepted.caeFchVto,
            resultado: 'A', associatedDocument: null,
          },
        });
      },
    );
    expect((await gateway.issueInvoice(request)).feCompConsultarEcho).toBeNull();
    expect((await gateway.issueInvoice(request)).feCompConsultarEcho?.cae).toBe(accepted.cae);
    expect(calls).toBe(2);
  });

  test('rejects a readback bound to another total', async () => {
    const request = wsfeRequest();
    const gateway = new HttpWsfePointOfSaleGateway(
      { baseUrl: 'https://wsfe.test', token: 'secret', environment: 'homologation' },
      async () => Response.json({
        requestId: request.requestId, status: 'accepted', resultado: 'A', cae: '71234567890123',
        caeFchVto: '2026-07-21', cbteTipo: 11, ptoVta: 1, cbteNro: '6', reprocessed: false,
        authorizedDocument: { intentHash: request.intentHash, ...request.expected }, safeErrors: [],
        feCompConsultarEcho: {
          pointOfSale: 1, documentType: 11, invoiceNumber: '6', issueDate: request.expected.issueDate,
          concept: request.expected.concept, receptorDocType: request.expected.receptorDocType,
          total: { decimal: '1.00', currency: 'ARS' }, cae: '71234567890123',
          caeExpiry: '2026-07-21', resultado: 'A', associatedDocument: null,
        },
      }),
    );
    await expect(gateway.issueInvoice(request)).rejects.toThrow('ARCA_WSFE_ISSUE_BINDING_MISMATCH');
  });
});

test('refuses a signer redirect as an unknown issue outcome', async () => {
  const gateway = new HttpWsfePointOfSaleGateway({ baseUrl: 'https://wsfe.test', token: 'secret', environment: 'homologation' }, async () => new Response(null, { status: 302, headers: { location: 'https://attacker.test/' } }));
  await expect(gateway.issueInvoice(wsfeRequest())).rejects.toThrow(/^ARCA_WSFE_ISSUE_OUTCOME_UNKNOWN$/);
});
