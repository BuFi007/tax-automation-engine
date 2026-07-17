import { describe, expect, test } from 'bun:test';

import { assertActiveAccountantMandate, buildAccountantPortfolioProjection, type AccountantClientCaseSummaryV1, type AccountantMandateV1 } from './accountant-mandate';

const mandate: AccountantMandateV1 = {
  version: 'accountant-mandate-v1',
  mandateId: 'mandate:1',
  workspaceId: 'workspace:1',
  accountantActorId: 'accountant:1',
  accountantOrganizationId: 'accounting-firm:1',
  scopes: ['approve_invoice_intent'],
  grantedByActorId: 'user:owner',
  grantedAt: '2026-07-01T00:00:00.000Z',
  expiresAt: '2026-08-01T00:00:00.000Z',
  revokedAt: null,
};

describe('accountant mandate', () => {
  test('authorizes only the exact workspace, actor, scope and active window', () => {
    expect(() => assertActiveAccountantMandate(mandate, {
      workspaceId: 'workspace:1',
      accountantActorId: 'accountant:1',
      scope: 'approve_invoice_intent',
      at: '2026-07-15T00:00:00.000Z',
    })).not.toThrow();

    expect(() => assertActiveAccountantMandate(mandate, {
      workspaceId: 'workspace:2', accountantActorId: 'accountant:1', scope: 'approve_invoice_intent', at: '2026-07-15T00:00:00.000Z',
    })).toThrow('ACCOUNTANT_MANDATE_WORKSPACE_UNAUTHORIZED');
    expect(() => assertActiveAccountantMandate(mandate, {
      workspaceId: 'workspace:1', accountantActorId: 'accountant:2', scope: 'approve_invoice_intent', at: '2026-07-15T00:00:00.000Z',
    })).toThrow('ACCOUNTANT_MANDATE_ACTOR_UNAUTHORIZED');
    expect(() => assertActiveAccountantMandate(mandate, {
      workspaceId: 'workspace:1', accountantActorId: 'accountant:1', scope: 'record_tax_declaration', at: '2026-07-15T00:00:00.000Z',
    })).toThrow('ACCOUNTANT_MANDATE_SCOPE_UNAUTHORIZED');
  });

  test('fails closed after expiry or revocation', () => {
    expect(() => assertActiveAccountantMandate(mandate, {
      workspaceId: 'workspace:1', accountantActorId: 'accountant:1', scope: 'approve_invoice_intent', at: mandate.expiresAt,
    })).toThrow('ACCOUNTANT_MANDATE_EXPIRED');
    expect(() => assertActiveAccountantMandate({ ...mandate, revokedAt: '2026-07-10T00:00:00.000Z' }, {
      workspaceId: 'workspace:1', accountantActorId: 'accountant:1', scope: 'approve_invoice_intent', at: '2026-07-15T00:00:00.000Z',
    })).toThrow('ACCOUNTANT_MANDATE_REVOKED');
  });

  test('projects only active, same-firm client cases without financial detail', () => {
    const secondMandate: AccountantMandateV1 = {
      ...mandate,
      mandateId: 'mandate:2',
      workspaceId: 'workspace:2',
      scopes: ['review_tax_obligation'],
    };
    const reviewMandate = { ...mandate, scopes: ['review_tax_obligation'] as const };
    const projection = buildAccountantPortfolioProjection({
      accountantActorId: 'accountant:1',
      accountantOrganizationId: 'accounting-firm:1',
      at: '2026-07-15T00:00:00.000Z',
      mandates: [reviewMandate, secondMandate, { ...secondMandate, mandateId: 'mandate:other-firm', workspaceId: 'workspace:3', accountantOrganizationId: 'firm:other' }],
      clientCases: [clientCase('workspace:1', '2026-07-20T00:00:00.000Z', 2, 1, 0), clientCase('workspace:2', '2026-07-18T00:00:00.000Z', 3, 2, 1), clientCase('workspace:3', '2026-07-17T00:00:00.000Z', 99, 99, 99)],
    });

    expect(projection.clients.map(client => client.workspaceId)).toEqual(['workspace:2', 'workspace:1']);
    expect(projection.totals).toEqual({ authorizedClientCount: 2, outstandingObligationCount: 5, professionalReviewCount: 3, clientApprovalCount: 1 });
    expect(JSON.stringify(projection)).not.toContain('99');
    expect(JSON.stringify(projection)).not.toContain('amount');
  });

  test('omits expired, revoked and non-review mandates from the portfolio', () => {
    const projection = buildAccountantPortfolioProjection({
      accountantActorId: 'accountant:1',
      accountantOrganizationId: 'accounting-firm:1',
      at: '2026-07-15T00:00:00.000Z',
      mandates: [mandate, { ...mandate, mandateId: 'expired', workspaceId: 'workspace:2', scopes: ['review_tax_obligation'], expiresAt: '2026-07-10T00:00:00.000Z' }],
      clientCases: [clientCase('workspace:1', null, 1, 0, 0), clientCase('workspace:2', null, 1, 0, 0)],
    });
    expect(projection.clients).toEqual([]);
  });
});

function clientCase(workspaceId: string, nextDueAt: string | null, outstandingObligationCount: number, professionalReviewCount: number, clientApprovalCount: number): AccountantClientCaseSummaryV1 {
  return { version: 'accountant-client-case-summary-v1', workspaceId, nextDueAt, outstandingObligationCount, professionalReviewCount, clientApprovalCount };
}
