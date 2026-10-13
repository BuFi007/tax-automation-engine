import { describe, expect, test } from 'bun:test';

import { hashCanonical } from '@tax-engine/core';

import { payload } from './test-fixtures';
import { HttpAuthorityPayloadVault } from './vault';
import { HttpWsaaTicketBroker } from './wsaa';

describe('signer external trust boundaries', () => {
  test('requires HTTPS and hash-binds a resolved authority payload', async () => {
    expect(() => new HttpAuthorityPayloadVault({ baseUrl: 'http://vault.test', token: 'secret' })).toThrow('SIGNER_VAULT_HTTPS_REQUIRED');
    const authorityPayload = payload();
    const vault = new HttpAuthorityPayloadVault({ baseUrl: 'https://vault.test/', token: 'vault-secret' }, async (input, init) => {
      expect(String(input)).toBe('https://vault.test/v1/authority-payloads/resolve');
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer vault-secret');
      expect(JSON.parse(String(init?.body))).toEqual({ version: 'authority-payload-resolve-v1', reference: 'vault://wsfe/1' });
      return Response.json({ payload: authorityPayload, payloadHash: hashCanonical(authorityPayload) });
    });
    await expect(vault.resolve('vault://wsfe/1')).resolves.toEqual(expect.objectContaining({ payloadHash: hashCanonical(authorityPayload) }));

    const mismatched = new HttpAuthorityPayloadVault({ baseUrl: 'https://vault.test', token: 'secret' }, async () =>
      Response.json({ payload: authorityPayload, payloadHash: hashCanonical('different') }));
    await expect(mismatched.resolve('vault://wsfe/1')).rejects.toThrow('SIGNER_VAULT_PAYLOAD_HASH_MISMATCH');
  });

  test('obtains only an ephemeral wsfe ticket and redacted readiness from the WSAA broker', async () => {
    expect(() => new HttpWsaaTicketBroker({ baseUrl: 'http://wsaa.test', token: 'secret' })).toThrow('WSAA_BROKER_HTTPS_REQUIRED');
    const requests: string[] = [];
    const broker = new HttpWsaaTicketBroker({ baseUrl: 'https://wsaa.test', token: 'broker-secret' }, async (input, init) => {
      requests.push(String(input));
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer broker-secret');
      if (String(input).includes('/tickets')) {
        expect(JSON.parse(String(init?.body))).toEqual({
          version: 'wsaa-ticket-request-v1', service: 'wsfe', environment: 'homologation', workspaceId: 'workspace-1', issuerProfileRef: 'vault://issuer/1',
        });
        return Response.json({ token: 'ephemeral-token', sign: 'ephemeral-sign', representedCuit: '20123456786', representedCuitCommitment: 'a'.repeat(64), expiresAt: '2099-01-01T00:00:00.000Z' });
      }
      return Response.json({
        version: 'wsaa-broker-health-v1', service: 'wsfe', environment: 'homologation', certificateDelegationConfigured: true, wsaaReady: true,
      });
    });
    const ticket = await broker.getTicket({ environment: 'homologation', workspaceId: 'workspace-1', issuerProfileRef: 'vault://issuer/1' });
    expect(ticket).toEqual(expect.objectContaining({ representedCuit: '20123456786', expiresAt: '2099-01-01T00:00:00.000Z' }));
    await expect(broker.health('homologation')).resolves.toEqual({ certificateDelegationConfigured: true, wsaaReady: true });
    expect(requests).toEqual([
      'https://wsaa.test/v1/wsaa/tickets',
      'https://wsaa.test/health?service=wsfe&environment=homologation',
    ]);
  });

  test('rejects an expired or near-expiry WSAA ticket', async () => {
    const broker = new HttpWsaaTicketBroker({ baseUrl: 'https://wsaa.test', token: 'secret' }, async () => Response.json({
      token: 'token', sign: 'sign', representedCuit: '20123456786', representedCuitCommitment: 'a'.repeat(64), expiresAt: '2026-01-01T00:00:00.000Z',
    }));
    await expect(broker.getTicket({ environment: 'homologation', workspaceId: 'workspace-1', issuerProfileRef: 'issuer-1' }))
      .rejects.toThrow('WSAA_TICKET_EXPIRED_OR_TOO_CLOSE');
  });
});
