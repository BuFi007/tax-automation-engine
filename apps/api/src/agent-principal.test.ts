import { describe, expect, test } from 'bun:test';

import {
  createTaxAgentPrincipalHeaders,
  verifyTaxAgentPrincipal,
} from './agent-principal';

const secret = 'open-agents-tax-principal-secret-at-least-32';
const path = '/v1/agent/tools/tax_ar_factura_e_record_settlement/invoke';
const rawBody = JSON.stringify({
  actorId: 'agent:tax-settlement',
  idempotencyKey: 'invoice-settlement:event-1',
  input: { runId: '10000000-0000-4000-8000-000000000001' },
});

function signedRequest(overrides: Partial<Parameters<typeof createTaxAgentPrincipalHeaders>[0]> = {}) {
  const headers = createTaxAgentPrincipalHeaders({
    secret,
    workspaceId: 'workspace:one',
    actorId: 'agent:tax-settlement',
    toolId: 'tax_ar_factura_e_record_settlement',
    path,
    rawBody,
    idempotencyKey: 'invoice-settlement:event-1',
    expiresAt: '2026-07-15T20:02:00.000Z',
    ...overrides,
  });
  return new Request(`https://tax.example${path}`, {
    method: 'POST',
    headers,
    body: rawBody,
  });
}

describe('Tax agent mutation principal', () => {
  test('binds one workspace actor tool path body and idempotency key', () => {
    const principal = verifyTaxAgentPrincipal({
      request: signedRequest(),
      rawBody,
      toolId: 'tax_ar_factura_e_record_settlement',
      actorId: 'agent:tax-settlement',
      idempotencyKey: 'invoice-settlement:event-1',
      secret,
      now: new Date('2026-07-15T20:00:00.000Z'),
    });
    expect(principal.workspaceId).toBe('workspace:one');
  });

  test('rejects cross-tool, body, actor, idempotency and overlong authority', () => {
    const request = signedRequest();
    const base = {
      request,
      rawBody,
      toolId: 'tax_ar_factura_e_record_settlement',
      actorId: 'agent:tax-settlement',
      idempotencyKey: 'invoice-settlement:event-1',
      secret,
      now: new Date('2026-07-15T20:00:00.000Z'),
    } as const;
    expect(() => verifyTaxAgentPrincipal({ ...base, toolId: 'tax_ar_factura_e_get_case' }))
      .toThrow('TAX_AGENT_PRINCIPAL_SCOPE_UNAUTHORIZED');
    expect(() => verifyTaxAgentPrincipal({ ...base, rawBody: `${rawBody} ` }))
      .toThrow('TAX_AGENT_PRINCIPAL_SCOPE_UNAUTHORIZED');
    expect(() => verifyTaxAgentPrincipal({ ...base, actorId: 'agent:other' }))
      .toThrow('TAX_AGENT_PRINCIPAL_SCOPE_UNAUTHORIZED');
    expect(() => verifyTaxAgentPrincipal({ ...base, idempotencyKey: 'invoice-settlement:event-2' }))
      .toThrow('TAX_AGENT_PRINCIPAL_SCOPE_UNAUTHORIZED');
    const tooLong = signedRequest({ expiresAt: '2026-07-15T20:02:00.001Z' });
    expect(() => verifyTaxAgentPrincipal({ ...base, request: tooLong }))
      .toThrow('TAX_AGENT_PRINCIPAL_UNAUTHORIZED');
  });
});
