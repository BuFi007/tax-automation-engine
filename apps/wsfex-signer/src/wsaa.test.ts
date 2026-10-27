import { expect, test } from 'bun:test';

import { HttpWsaaTicketBroker } from './wsaa';

test('refuses a WSAA broker redirect for tickets and health', async () => {
  const broker = new HttpWsaaTicketBroker({ baseUrl: 'https://boundary.test', token: 'secret' }, async () => new Response(null, { status: 302, headers: { location: 'https://attacker.test/' } }));
  await expect(broker.getTicket({ environment: 'homologation', workspaceId: 'workspace-1', issuerProfileRef: 'issuer://workspace-1/primary' }))
    .rejects.toThrow(/^HTTP_REDIRECT_REFUSED$/);
  await expect(broker.health('homologation')).rejects.toThrow(/^HTTP_REDIRECT_REFUSED$/);
});
