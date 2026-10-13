import { afterAll, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { hashCanonical } from '@tax-engine/core';
import type { SignerRequest, SignerResponse } from '@tax-engine/wsfe-signer/contracts';

import { HttpAuthorityPayloadWriter } from './authority-payload';
import { PersonalWsfeAttemptStore } from './personal-wsfe-attempt';
import { issuePersonalWsfeAttempt, preparePersonalWsfeAttempt, recoverPersonalWsfeAttempt } from './personal-wsfe-preparation';

const directory = mkdtempSync(join(tmpdir(), 'bufi-wsfe-prep-'));
const dbPath = join(directory, 'attempt.sqlite');
afterAll(() => rmSync(directory, { recursive: true, force: true }));

const owner = '22222222-2222-4222-8222-222222222222';
const workspaceId = `personal:${owner}`;
const commitment = 'a'.repeat(64);
const taxpayerHash = 'b'.repeat(64);
const material = {
  version: 'personal-wsfe-preparation-v1' as const,
  invoiceId: '11111111-1111-4111-8111-111111111111',
  connectionId: '77777777-7777-4777-8777-777777777777',
  invoiceUpdatedAt: '2026-09-23T12:00:00.000Z',
  issuerProfileRef: 'issuer://personal/test',
  taxpayerReferenceHash: taxpayerHash,
  representedCuitCommitment: commitment,
  pointOfSale: 1,
  idempotencyKey: '33333333-3333-4333-8333-333333333333',
  issueDate: '2026-09-23',
  receptor: { docType: 80 as const, docNumber: '27300000008', condicionIvaId: 6 as const },
  servicePeriod: { from: '2026-09-01', to: '2026-09-23', paymentDueDate: '2026-09-30' },
  total: { decimal: '15000.00', currency: 'ARS' as const },
  description: 'Servicios creativos',
};
const input = { ...material, requestHash: hashCanonical(material) };
const projection = {
  workspaceId, environment: 'homologation' as const, issuerProfileRef: material.issuerProfileRef,
  taxpayerReferenceHash: taxpayerHash, representedCuitCommitment: commitment,
  wsfe: { status: 'ready' as const, pointOfSale: 1 },
};

 test('prepares one C payload, freezes the number, and reuses it without persisting receptor identity', async () => {
  const attempts = new PersonalWsfeAttemptStore(dbPath);
  let reads = 0;
  let writes = 0;
  const signer = { getNextVoucher: async () => {
    reads++;
    return {
      version: 'arca-wsfe-next-voucher-v1' as const,
      environment: 'homologation' as const, workspaceId,
      issuerProfileReferenceHash: hashCanonical(material.issuerProfileRef),
      representedCuitCommitment: commitment, documentType: 11 as const, pointOfSale: 1,
      lastInvoiceNumber: '5', nextInvoiceNumber: '6', observedAt: material.invoiceUpdatedAt,
      evidenceHash: 'c'.repeat(64),
    };
  } };
  const vault = new HttpAuthorityPayloadWriter({ baseUrl: 'https://boundary.test', token: 'secret', environment: 'homologation' }, async (_url, init) => {
    writes++;
    const body = JSON.parse(String(init?.body));
    expect(body.payload.receptor.docNumber).toBe(material.receptor.docNumber);
    expect(body.payload.invoiceNumber).toBe('6');
    return Response.json({
      version: 'authority-payload-store-receipt-v1',
      reference: 'vault://wsfe/66666666-6666-4666-8666-666666666666',
      payloadHash: hashCanonical(body.payload), storedAt: material.invoiceUpdatedAt,
      expiresAt: body.expiresAt,
    });
  });
  const now = new Date('2026-09-23T12:01:00.000Z');
  const first = await preparePersonalWsfeAttempt(input, workspaceId, projection, attempts, signer, vault, now);
  expect(first.data).toEqual({ invoiceId: material.invoiceId, status: 'prepared', voucherNumber: '6' });
  expect((await preparePersonalWsfeAttempt(input, workspaceId, projection, attempts, signer, vault, now)).data).toEqual(first.data);
  expect([reads, writes]).toEqual([1, 1]);
  await expect(preparePersonalWsfeAttempt({ ...input, total: { decimal: '16000.00', currency: 'ARS' } }, workspaceId, projection, attempts, signer, vault, now))
    .rejects.toThrow('PERSONAL_WSFE_REQUEST_HASH_MISMATCH');
  await expect(preparePersonalWsfeAttempt(input, workspaceId, { ...projection, wsfe: { status: 'reconnect', pointOfSale: null } }, attempts, signer, vault, now))
    .rejects.toThrow('PERSONAL_WSFE_CONNECTION_NOT_READY');
  let officialReadback = false;
  const issuingSigner = { ...signer, issueInvoice: async (request: SignerRequest): Promise<SignerResponse> => {
    expect(request.authorityPayloadRef).toBe('vault://wsfe/66666666-6666-4666-8666-666666666666');
    const echo = {
      pointOfSale: 1, documentType: 11 as const, invoiceNumber: '6', issueDate: material.issueDate,
      concept: 2 as const, receptorDocType: 80 as const, total: material.total,
      cae: '71234567890123', caeExpiry: '2026-10-03', resultado: 'A' as const,
      associatedDocument: null,
    };
    return {
      requestId: request.requestId, status: 'accepted', resultado: 'A', cae: echo.cae,
      caeFchVto: echo.caeExpiry, cbteTipo: 11, ptoVta: 1, cbteNro: '6', reprocessed: false,
      feCompConsultarEcho: officialReadback ? echo : null,
      authorizedDocument: { intentHash: request.intentHash, ...request.expected }, safeErrors: [],
    };
  } };
  expect((await issuePersonalWsfeAttempt(input, workspaceId, projection, attempts, issuingSigner, vault, now)).data.status).toBe('pending');
  officialReadback = true;
  const authorized = await issuePersonalWsfeAttempt(input, workspaceId, projection, attempts, issuingSigner, vault, now);
  expect(authorized.data).toMatchObject({ status: 'authorized', voucherNumber: '6', cae: '71234567890123' });
  expect([reads, writes]).toEqual([1, 1]);
  attempts.close();
  const restored = new PersonalWsfeAttemptStore(dbPath);
  expect((await recoverPersonalWsfeAttempt(material.invoiceId, workspaceId, restored, issuingSigner, now)).data)
    .toMatchObject({ status: 'authorized', voucherNumber: '6', cae: '71234567890123' });
  await expect(recoverPersonalWsfeAttempt(material.invoiceId, `personal:99999999-9999-4999-8999-999999999999`, restored, issuingSigner, now))
    .rejects.toThrow('PERSONAL_WSFE_ATTEMPT_NOT_FOUND');
  restored.close();
  expect(readFileSync(dbPath).toString('utf8')).not.toContain(material.receptor.docNumber);
});

test('returns a rejected C attempt with evidence and no CAE', async () => {
  const attempts = new PersonalWsfeAttemptStore(join(directory, 'rejected.sqlite'));
  const rejectedMaterial = {
    ...material,
    invoiceId: '44444444-4444-4444-8444-444444444444',
  };
  const request = { ...rejectedMaterial, requestHash: hashCanonical(rejectedMaterial) };
  let mismatched = true;
  const signer = {
    getNextVoucher: async () => ({
      version: 'arca-wsfe-next-voucher-v1' as const,
      environment: 'homologation' as const,
      workspaceId,
      issuerProfileReferenceHash: hashCanonical(material.issuerProfileRef),
      representedCuitCommitment: commitment,
      documentType: 11 as const,
      pointOfSale: 1,
      lastInvoiceNumber: '5',
      nextInvoiceNumber: '6',
      observedAt: material.invoiceUpdatedAt,
      evidenceHash: 'c'.repeat(64),
    }),
    issueInvoice: async (signerRequest: SignerRequest): Promise<SignerResponse> => ({
      requestId: signerRequest.requestId,
      status: 'rejected', resultado: 'R', cae: null, caeFchVto: null,
      cbteTipo: 11, ptoVta: 1, cbteNro: mismatched ? '7' : '6', reprocessed: false,
      feCompConsultarEcho: null, authorizedDocument: null,
      safeErrors: [{ code: '10016', message: 'Fecha inválida' }],
    }),
  };
  const vault = new HttpAuthorityPayloadWriter({ baseUrl: 'https://boundary.test', token: 'secret', environment: 'homologation' }, async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    return Response.json({
      version: 'authority-payload-store-receipt-v1',
      reference: 'vault://wsfe/66666666-6666-4666-8666-666666666666',
      payloadHash: hashCanonical(body.payload), storedAt: material.invoiceUpdatedAt,
      expiresAt: body.expiresAt,
    });
  });
  const now = new Date('2026-09-23T12:01:00.000Z');
  await expect(issuePersonalWsfeAttempt(request, workspaceId, projection, attempts, signer, vault, now))
    .rejects.toThrow('PERSONAL_WSFE_REJECTION_MISMATCH');
  expect(attempts.get(request.invoiceId)?.claimState).toBe('active');
  mismatched = false;
  const result = await issuePersonalWsfeAttempt(request, workspaceId, projection, attempts, signer, vault, now);
  expect(result.data).toMatchObject({ invoiceId: request.invoiceId, status: 'rejected', errorCodes: ['10016'] });
  expect(result.data).not.toHaveProperty('cae');
  expect(result.data).toHaveProperty('rejectionEvidenceSha256', expect.stringMatching(/^[a-f0-9]{64}$/));
  expect(attempts.get(request.invoiceId)?.claimState).toBe('rejected');
  attempts.close();
});
