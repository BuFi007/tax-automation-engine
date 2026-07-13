import { describe, expect, test } from 'bun:test';

import { HttpWsaaTicketBroker } from './wsaa';

describe('wsfecred WSAA trust boundary', () => {
  test('requires HTTPS for the broker base URL', () => {
    expect(() => new HttpWsaaTicketBroker({ baseUrl: 'http://wsaa.test', token: 'secret' })).toThrow('WSAA_BROKER_HTTPS_REQUIRED');
  });

  test('requests an ephemeral wsfecred ticket and reads redacted readiness', async () => {
    const requests: string[] = [];
    const broker = new HttpWsaaTicketBroker({ baseUrl: 'https://wsaa.test', token: 'broker-secret' }, async (input, init) => {
      requests.push(String(input));
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer broker-secret');
      if (String(input).includes('/tickets')) {
        // The one shared edit widened the broker service enum to accept 'wsfecred'.
        expect(JSON.parse(String(init?.body))).toEqual({
          version: 'wsaa-ticket-request-v1', service: 'wsfecred', environment: 'homologation', workspaceId: 'workspace-1', issuerProfileRef: 'issuer://workspace-1/primary',
        });
        return Response.json({ token: 'ephemeral-token', sign: 'ephemeral-sign', representedCuit: '20123456786', expiresAt: '2099-01-01T00:00:00.000Z' });
      }
      return Response.json({ version: 'wsaa-broker-health-v1', service: 'wsfecred', environment: 'homologation', certificateDelegationConfigured: true, wsaaReady: true });
    });

    const ticket = await broker.getTicket({ environment: 'homologation', workspaceId: 'workspace-1', issuerProfileRef: 'issuer://workspace-1/primary' });
    expect(ticket).toEqual(expect.objectContaining({ representedCuit: '20123456786', expiresAt: '2099-01-01T00:00:00.000Z' }));
    await expect(broker.health('homologation')).resolves.toEqual({ certificateDelegationConfigured: true, wsaaReady: true });
    expect(requests).toEqual([
      'https://wsaa.test/v1/wsaa/tickets',
      'https://wsaa.test/health?service=wsfecred&environment=homologation',
    ]);
  });

  test('rejects an expired or near-expiry ticket', async () => {
    const broker = new HttpWsaaTicketBroker({ baseUrl: 'https://wsaa.test', token: 'secret' }, async () => Response.json({
      token: 'token', sign: 'sign', representedCuit: '20123456786', expiresAt: '2026-01-01T00:00:00.000Z',
    }));
    await expect(broker.getTicket({ environment: 'homologation', workspaceId: 'workspace-1', issuerProfileRef: 'issuer-1' }))
      .rejects.toThrow('WSAA_TICKET_EXPIRED_OR_TOO_CLOSE');
  });

  test('rejects a broker health environment mismatch', async () => {
    const broker = new HttpWsaaTicketBroker({ baseUrl: 'https://wsaa.test', token: 'secret' }, async () => Response.json({
      version: 'wsaa-broker-health-v1', service: 'wsfecred', environment: 'production', certificateDelegationConfigured: true, wsaaReady: true,
    }));
    await expect(broker.health('homologation')).rejects.toThrow('WSAA_BROKER_ENVIRONMENT_MISMATCH');
  });
});
