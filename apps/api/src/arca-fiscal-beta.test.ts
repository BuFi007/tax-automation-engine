import { expect, test } from 'bun:test';
import { assertArcaFiscalBeta, assertFiscalHumanActor, type ArcaFiscalBetaConfig } from './arca-fiscal-beta';
const actor = '11111111-1111-4111-8111-111111111111';
const team = '22222222-2222-4222-8222-222222222222';
const beta: ArcaFiscalBetaConfig = { enabled: true, deploymentEnvironment: 'development', authorityEnvironment: 'homologation', workspaceIds: new Set([team, `personal:${actor}`]) };
test('development homologation and exact enrollment are mandatory for both scopes', () => {
  for (const scope of [team, `personal:${actor}`]) {
    expect(() => assertArcaFiscalBeta(scope, beta)).not.toThrow();
    for (const changed of [{ enabled: false }, { deploymentEnvironment: 'production' }, { deploymentEnvironment: '' }, { authorityEnvironment: 'production' }, { authorityEnvironment: '' }])
      expect(() => assertArcaFiscalBeta(scope, { ...beta, ...changed })).toThrow('ARCA_FISCAL_BETA_CONFIGURATION_REQUIRED');
  }
  expect(() => assertArcaFiscalBeta(actor, beta)).toThrow('ARCA_FISCAL_BETA_SCOPE_UNAUTHORIZED');
  expect(() => assertArcaFiscalBeta('*', { ...beta, workspaceIds: new Set(['*']) })).toThrow('ARCA_FISCAL_BETA_SCOPE_UNAUTHORIZED');
});
test('Personal requires its human owner, team requires a human principal delegated by Desk', () => {
  expect(() => assertFiscalHumanActor(`personal:${actor}`, actor)).not.toThrow();
  expect(() => assertFiscalHumanActor(team, actor)).not.toThrow();
  expect(() => assertFiscalHumanActor(`personal:${actor}`, team)).toThrow('ARCA_FISCAL_BETA_ACTOR_UNAUTHORIZED');
  expect(() => assertFiscalHumanActor(team, 'desk:service')).toThrow('ARCA_FISCAL_BETA_ACTOR_UNAUTHORIZED');
});

test('environment-composed gateways deny legacy internal calls before any network dispatch', async () => {
  const { HttpWsfePointOfSaleGateway } = await import('./wsfe');
  const { HttpWsfexGateway } = await import('./wsfex');
  const { signerRequestSchema } = await import('@tax-engine/wsfe-signer/contracts');
  const names = ['ARCA_FISCAL_BETA_ENABLED', 'TAX_DEPLOYMENT_ENVIRONMENT', 'ARCA_ENVIRONMENT', 'ARCA_FISCAL_BETA_WORKSPACE_IDS', 'ARCA_SIGNER_URL', 'ARCA_SIGNER_TOKEN', 'ARCA_WSFE_SIGNER_URL', 'ARCA_WSFE_SIGNER_TOKEN'];
  const saved = names.map(name => process.env[name]);
  try {
    Object.assign(process.env, { ARCA_FISCAL_BETA_ENABLED: 'true', TAX_DEPLOYMENT_ENVIRONMENT: 'production', ARCA_ENVIRONMENT: 'homologation', ARCA_FISCAL_BETA_WORKSPACE_IDS: team, ARCA_SIGNER_URL: 'https://unreachable.test', ARCA_SIGNER_TOKEN: 'test-only', ARCA_WSFE_SIGNER_URL: 'https://unreachable.test', ARCA_WSFE_SIGNER_TOKEN: 'test-only' });
    const wsfe = HttpWsfePointOfSaleGateway.fromEnvironment()!;
    const wsfex = HttpWsfexGateway.fromEnvironment()!;
    const request = signerRequestSchema.parse({ version: 'motora-wsfe-boundary-v1', workspaceId: team, environment: 'homologation', runId: actor, subjectId: actor, requestId: '101', intentHash: 'a'.repeat(64), authorityPayloadRef: 'vault://wsfe/test', expected: { documentType: 11, concept: 2, pointOfSale: 1, issueDate: '2026-10-13', receptorDocType: 99, receptorCondicionIvaId: 5, total: { decimal: '1000.00', currency: 'ARS' }, servicePeriod: { from: '2026-10-01', to: '2026-10-13', paymentDueDate: '2026-10-20' } } });
    await expect(wsfe.issueInvoice(request)).rejects.toThrow('ARCA_FISCAL_BETA_CONFIGURATION_REQUIRED');
    expect(() => wsfe.getNextVoucher({ workspaceId: team, issuerProfileRef: 'issuer://test', documentType: 11, pointOfSale: 1 })).toThrow('ARCA_FISCAL_BETA_CONFIGURATION_REQUIRED');
    const run = { workspaceId: team } as Parameters<typeof wsfex.authorize>[0]['run'];
    for (const action of ['authorize', 'recover', 'reconcile'] as const)
      await expect(wsfex[action]({ run, requestId: '101', authorityPayloadRef: 'vault://wsfex/test', authorityPayloadHash: 'b'.repeat(64) })).rejects.toThrow('ARCA_FISCAL_BETA_CONFIGURATION_REQUIRED');
    await expect(wsfex.reserveSequence({ workspaceId: team, issuerProfileRef: 'issuer://test', runId: actor, intentHash: 'a'.repeat(64), subjectId: actor, pointOfSale: 2, idempotencyKey: actor })).rejects.toThrow('ARCA_FISCAL_BETA_CONFIGURATION_REQUIRED');
    // The guard reads deployment configuration at dispatch, even if the adapter
    // was constructed earlier under an allowed configuration.
    process.env.TAX_DEPLOYMENT_ENVIRONMENT = 'development';
    process.env.ARCA_ENVIRONMENT = 'production';
    await expect(wsfe.issueInvoice(request)).rejects.toThrow('ARCA_FISCAL_BETA_CONFIGURATION_REQUIRED');
  } finally {
    names.forEach((name, i) => { if (saved[i] === undefined) delete process.env[name]; else process.env[name] = saved[i]; });
  }
});
