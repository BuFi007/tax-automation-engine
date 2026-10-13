import { expect, test } from 'bun:test';
import { handleFacturaEAuthorityCorridorRoute } from './authority-corridor-routes';
import { createTaxAuthorityPrincipalHeaders } from './authority-principal';
import type { FacturaEAuthorityExecutionService } from './authority-execution';
const owner = '22222222-2222-4222-8222-222222222222';
const scope = `personal:${owner}`;
const secret = 'a'.repeat(40);
const secrets = { motora: secret, openAgentsApproval: 'b'.repeat(40) };
function read(workspaceId: string) {
  const path = `/v1/authority/factura-e/readiness/${encodeURIComponent(workspaceId)}`;
  return new Request(`http://tax.test${path}`, { headers: createTaxAuthorityPrincipalHeaders({ secret, workspaceId, actorId: owner, capability: 'factura-e:readiness', method: 'GET', path, rawBody: '', expiresAt: new Date(Date.now() + 60_000).toISOString() }) });
}
test('E corridor allows encoded Personal and team scope, refuses production/unlisted before any effect', async () => {
  let reads = 0;
  const service = { readiness: () => { reads++; return { state: 'ready' }; } } as unknown as FacturaEAuthorityExecutionService;
  const beta = { enabled: true, deploymentEnvironment: 'development', authorityEnvironment: 'homologation', workspaceIds: new Set([scope, owner]) };
  for (const workspaceId of [scope, owner]) {
    const request = read(workspaceId);
    expect((await handleFacturaEAuthorityCorridorRoute(request, new URL(request.url), service, { corridorEnabled: true, secrets, beta }))?.status).toBe(200);
    expect((await handleFacturaEAuthorityCorridorRoute(request, new URL(request.url), service, { corridorEnabled: true, secrets, beta: { ...beta, authorityEnvironment: 'production' } }))?.status).toBe(503);
    expect((await handleFacturaEAuthorityCorridorRoute(request, new URL(request.url), service, { corridorEnabled: true, secrets, beta: { ...beta, workspaceIds: new Set() } }))?.status).toBe(403);
  }
  expect(reads).toBe(2);
});
