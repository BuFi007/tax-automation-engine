import { expect, test } from 'bun:test';

import { AfipSdkWsaaLoginClient } from './afipsdk-wsaa';
import { certificateBundle, CUIT, NOW } from './test-fixtures';
import { validateIssuerCredential } from './wsaa';

const { credential } = validateIssuerCredential({
  workspaceId: 'workspace-1',
  issuerProfileRef: 'issuer://workspace-1/primary',
  environment: 'homologation',
  certificateHolderCuit: CUIT,
  representedCuit: CUIT,
  ...certificateBundle(),
  delegationConfirmed: true,
}, NOW);

test('sends only the selected issuer credential to AFIP SDK auth and returns a cacheable ticket', async () => {
  let calls = 0;
  const client = new AfipSdkWsaaLoginClient('provider-token-32-characters-long', async (url, init) => {
    calls++;
    expect(String(url)).toBe('https://app.afipsdk.com/api/v1/afip/auth');
    expect(init?.redirect).toBe('manual');
    const body = JSON.parse(String(init?.body));
    expect(body).toEqual({
      environment: 'dev', tax_id: CUIT, wsid: 'wsfe',
      cert: credential.certificatePem, key: credential.privateKeyPem,
    });
    return Response.json({ token: 'secret-ticket', sign: 'secret-sign',
      expiration: '2026-07-11T12:10:00.000Z' });
  });
  const ticket = await client.login({ credential, service: 'wsfe', now: NOW });
  expect(ticket).toMatchObject({ token: 'secret-ticket', sign: 'secret-sign',
    expiresAt: '2026-07-11T12:10:00.000Z' });
  expect(ticket.safeReceiptHash).toMatch(/^[a-f0-9]{64}$/);
  expect(ticket.safeReceiptHash).not.toContain('secret-');
  expect(calls).toBe(1);
});

test('rejects provider errors without returning its body or accepting an expiring ticket', async () => {
  const denied = new AfipSdkWsaaLoginClient('provider-token-32-characters-long',
    async () => new Response('secret-provider-error', { status: 400 }));
  await expect(denied.login({ credential, service: 'wsfex', now: NOW }))
    .rejects.toThrow('AFIPSDK_AUTH_REJECTED_400');
  const expiring = new AfipSdkWsaaLoginClient('provider-token-32-characters-long',
    async () => Response.json({ token: 'secret-ticket', sign: 'secret-sign',
      expiration: '2026-07-11T12:00:30.000Z' }));
  await expect(expiring.login({ credential, service: 'wsfex', now: NOW }))
    .rejects.toThrow('AFIPSDK_AUTH_TICKET_EXPIRED');
});

test('refuses an AFIP SDK auth redirect as a transport failure', async () => {
  const client = new AfipSdkWsaaLoginClient('provider-token-32-characters-long', async () => new Response(null, { status: 302, headers: { location: 'https://attacker.test/' } }));
  await expect(client.login({ credential, service: 'wsfex', now: NOW })).rejects.toThrow(/^AFIPSDK_AUTH_TRANSPORT_FAILED$/);
});
