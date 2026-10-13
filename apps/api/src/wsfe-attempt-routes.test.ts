import { afterAll, expect, test } from 'bun:test';
import { createHash, createHmac } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashCanonical } from '@tax-engine/core';
import type { SignerRequest } from '@tax-engine/wsfe-signer/contracts';
import { PersonalWsfeAttemptStore } from './personal-wsfe-attempt';
import { handleWsfeAttemptRoute } from './wsfe-attempt-routes';
const dir = mkdtempSync(join(tmpdir(), 'tax-wsfe-shared-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const team = '22222222-2222-4222-8222-222222222222';
const actor = '33333333-3333-4333-8333-333333333333';
const invoice = '11111111-1111-4111-8111-111111111111';
const secret = 's'.repeat(40);
const now = new Date('2026-10-13T12:00:00.000Z');
const frozen = { version: 'wsfe-preparation-v1', invoiceId: invoice, connectionId: '77777777-7777-4777-8777-777777777777', invoiceUpdatedAt: now.toISOString(), issuerProfileRef: 'issuer://team', taxpayerReferenceHash: 'a'.repeat(64), representedCuitCommitment: 'b'.repeat(64), pointOfSale: 1, idempotencyKey: '44444444-4444-4444-8444-444444444444', issueDate: '2026-10-13', receptor: { docType: 99, docNumber: '0', condicionIvaId: 5 }, servicePeriod: { from: '2026-10-01', to: '2026-10-13', paymentDueDate: '2026-10-20' }, total: { decimal: '1000.00', currency: 'ARS' }, description: 'Servicios' };
const raw = JSON.stringify({ ...frozen, requestHash: hashCanonical(frozen) });
function signed(path: string, body: string, workspaceId = team, boundBody = body, capability = 'arca:issue') {
  const principal = { version: 'tax-tenant-principal-v3', workspaceId, actorId: actor, capability, method: 'POST', path, bodyHash: createHash('sha256').update(boundBody).digest('hex'), expiresAt: '2026-10-13T12:01:00.000Z' };
  const encoded = Buffer.from(JSON.stringify(principal)).toString('base64url');
  return new Request(`http://tax.test${path}`, { method: 'POST', headers: { 'x-tax-tenant-principal': encoded, 'x-tax-tenant-signature': createHmac('sha256', secret).update(encoded).digest('hex') }, body });
}
test('team C route survives restart, recovers exact authorized voucher and denies scope/body/path replay before effects', async () => {
  let calls = 0;
  const signer = {
    getNextVoucher: async () => { calls++; return { version: 'arca-wsfe-next-voucher-v1' as const, workspaceId: team, issuerProfileReferenceHash: hashCanonical(frozen.issuerProfileRef), environment: 'homologation' as const, representedCuitCommitment: frozen.representedCuitCommitment, documentType: 11 as const, pointOfSale: 1, lastInvoiceNumber: '3', nextInvoiceNumber: '4', observedAt: now.toISOString(), evidenceHash: 'c'.repeat(64) }; },
    issueInvoice: async (r: SignerRequest) => { calls++; return { requestId: r.requestId, status: 'accepted' as const, resultado: 'A' as const, cae: '71234567890123', caeFchVto: '2026-10-23', cbteTipo: 11 as const, ptoVta: 1, cbteNro: '4', reprocessed: true, safeErrors: [], authorizedDocument: { intentHash: r.intentHash, ...r.expected }, feCompConsultarEcho: { documentType: 11 as const, concept: 2 as const, pointOfSale: 1, invoiceNumber: '4', issueDate: frozen.issueDate, receptorDocType: 99 as const, total: r.expected.total, cae: '71234567890123', caeExpiry: '2026-10-23', resultado: 'A' as const, associatedDocument: null } }; },
  };
  let attempts = new PersonalWsfeAttemptStore(join(dir, 'attempts.sqlite'));
  const options = () => ({ principalSecret: secret, beta: { enabled: true, deploymentEnvironment: 'development', authorityEnvironment: 'homologation', workspaceIds: new Set([team]) }, attempts, signer, vault: { store: async (i: { payload: unknown; expiresAt: string }) => ({ version: 'authority-payload-store-receipt-v1' as const, reference: 'vault://wsfe/66666666-6666-4666-8666-666666666666', payloadHash: hashCanonical(i.payload), storedAt: now.toISOString(), expiresAt: i.expiresAt }) }, projection: async () => ({ workspaceId: team, environment: 'homologation' as const, issuerProfileRef: frozen.issuerProfileRef, taxpayerReferenceHash: frozen.taxpayerReferenceHash, representedCuitCommitment: frozen.representedCuitCommitment, wsfe: { status: 'ready' as const, pointOfSale: 1 } }), now });
  const path = '/v1/wsfe/attempts/issue';
  const issued = await handleWsfeAttemptRoute(signed(path, raw), new URL(`http://tax.test${path}`), options());
  expect((await issued!.json()).data).toMatchObject({ status: 'authorized', voucherNumber: '4', cae: '71234567890123' });
  attempts.close(); attempts = new PersonalWsfeAttemptStore(join(dir, 'attempts.sqlite'));
  const recoveryPath = '/v1/wsfe/attempts/recover'; const recovery = JSON.stringify({ invoiceId: invoice });
  const recovered = await handleWsfeAttemptRoute(signed(recoveryPath, recovery), new URL(`http://tax.test${recoveryPath}`), options());
  expect((await recovered!.json()).data.status).toBe('authorized');
  expect(calls).toBe(3);
  await expect(handleWsfeAttemptRoute(signed(path, raw, team, '{}'), new URL(`http://tax.test${path}`), options())).rejects.toThrow('TAX_TENANT_PRINCIPAL_SCOPE_UNAUTHORIZED');
  await expect(handleWsfeAttemptRoute(signed(path, raw, team, raw, 'profile:read'), new URL(`http://tax.test${path}`), options())).rejects.toThrow('TAX_TENANT_PRINCIPAL_CAPABILITY_UNAUTHORIZED');
  const changedPath = signed(path, raw); const replay = new Request(`http://tax.test${recoveryPath}`, { method: 'POST', headers: changedPath.headers, body: raw });
  await expect(handleWsfeAttemptRoute(replay, new URL(replay.url), options())).rejects.toThrow('TAX_TENANT_PRINCIPAL_SCOPE_UNAUTHORIZED');
  await expect(handleWsfeAttemptRoute(signed(recoveryPath, recovery, actor), new URL(`http://tax.test${recoveryPath}`), options())).rejects.toThrow('ARCA_FISCAL_BETA_SCOPE_UNAUTHORIZED');
  await expect(handleWsfeAttemptRoute(signed(path, raw), new URL(`http://tax.test${path}`), { ...options(), beta: { ...options().beta, deploymentEnvironment: 'production' } })).rejects.toThrow('ARCA_FISCAL_BETA_CONFIGURATION_REQUIRED');
  const personalPath = '/v1/personal-wsfe/attempts/issue';
  await expect(handleWsfeAttemptRoute(signed(personalPath, raw), new URL(`http://tax.test${personalPath}`), options())).rejects.toThrow('PERSONAL_WSFE_SCOPE_UNAUTHORIZED');
  expect(calls).toBe(3);
  attempts.close();
});
