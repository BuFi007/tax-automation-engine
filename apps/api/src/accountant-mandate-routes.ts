import { z } from 'zod';

import {
  assertActiveAccountantMandate,
  buildAccountantPortfolioProjection,
  type AccountantClientCaseSummaryV1,
  type AccountantMandateScope,
  type AccountantMandateV1,
} from '@tax-engine/core';

import { readBoundedBody } from './bounded-body';
import type { TaxProfileStore } from './store';
import { assertTaxTenantPrincipalScope, type TaxTenantPrincipalV2 } from './tenant-principal';

const scopeSchema = z.enum([
  'review_tax_obligation',
  'approve_invoice_intent',
  'approve_invoice_adjustment',
  'verify_fx_ingress',
  'record_tax_declaration',
  'export_accountant_packet',
]);
const grantSchema = z.object({
  mandateId: z.string().min(1).max(200),
  accountantActorId: z.string().min(1).max(300),
  accountantOrganizationId: z.string().min(1).max(300),
  scopes: z.array(scopeSchema).min(1),
  expiresAt: z.iso.datetime({ offset: true }),
}).strict();

export async function handleAccountantMandateRoute(
  request: Request,
  url: URL,
  store: TaxProfileStore,
  principal: TaxTenantPrincipalV2 | null,
  now = new Date(),
): Promise<Response | null> {
  if (request.method === 'GET' && url.pathname === '/v1/accountant-portfolio') {
    if (!principal) throw new Error('TAX_TENANT_SCOPE_UNAUTHORIZED');
    const accountantOrganizationId = principal.workspaceId;
    const mandates = store.listAccountantMandatesForPortfolio(
      principal.actorId,
      accountantOrganizationId,
    );
    const workspaceIds = [...new Set(mandates.map(mandate => mandate.workspaceId))];
    const clientCases = workspaceIds.flatMap(workspaceId => {
      try {
        const receipt = store.getLatestTaxWidgetSnapshot(workspaceId, now.toISOString());
        if (!receipt) return [];
        const obligations = receipt.snapshot.obligations;
        const summary: AccountantClientCaseSummaryV1 = {
          version: 'accountant-client-case-summary-v1',
          workspaceId,
          nextDueAt: obligations
            .map(obligation => obligation.dueAt)
            .filter((dueAt): dueAt is string => dueAt !== null)
            .sort()[0] ?? null,
          outstandingObligationCount: obligations.filter(
            obligation => !['not_due', 'satisfied'].includes(obligation.satisfactionState),
          ).length,
          professionalReviewCount: obligations.filter(
            obligation => obligation.preparationState === 'under_accountant_review',
          ).length,
          clientApprovalCount: obligations.filter(
            obligation => obligation.preparationState === 'accountant_approved'
              && obligation.submissionState === 'ready_for_submission',
          ).length,
        };
        return [summary];
      } catch {
        return [];
      }
    });
    const projection = buildAccountantPortfolioProjection({
      accountantActorId: principal.actorId,
      accountantOrganizationId,
      at: now.toISOString(),
      mandates,
      clientCases,
    });
    const activeMandates = mandates.filter(mandate => {
      try {
        assertActiveAccountantMandate(mandate, {
          workspaceId: mandate.workspaceId,
          accountantActorId: principal.actorId,
          scope: 'review_tax_obligation',
          at: now.toISOString(),
        });
        return true;
      } catch {
        return false;
      }
    });
    return json({ data: { ...projection, mandates: activeMandates } }, 200, {
      'cache-control': 'private, no-store',
      vary: 'authorization, x-tax-tenant-principal, x-tax-tenant-signature',
    });
  }

  if (request.method === 'POST' && url.pathname === '/v1/accountant-mandates') {
    if (!principal) throw new Error('TAX_TENANT_SCOPE_UNAUTHORIZED');
    const body = grantSchema.parse(JSON.parse(await readBoundedBody(request, 64 * 1024, 'ACCOUNTANT_MANDATE_REQUEST_TOO_LARGE')) as unknown);
    assertTaxTenantPrincipalScope(principal, principal.workspaceId, principal.actorId);
    const expiresAt = Date.parse(body.expiresAt);
    if (expiresAt <= now.getTime() || expiresAt - now.getTime() > 366 * 86_400_000) {
      throw new Error('ACCOUNTANT_MANDATE_EXPIRY_OUT_OF_RANGE');
    }
    const scopes = [...new Set(body.scopes)].sort() as AccountantMandateScope[];
    const mandate: AccountantMandateV1 = {
      version: 'accountant-mandate-v1',
      mandateId: body.mandateId,
      workspaceId: principal.workspaceId,
      accountantActorId: body.accountantActorId,
      accountantOrganizationId: body.accountantOrganizationId,
      scopes,
      grantedByActorId: principal.actorId,
      grantedAt: now.toISOString(),
      expiresAt: body.expiresAt,
      revokedAt: null,
    };
    store.grantAccountantMandate(mandate);
    return json({ data: mandate }, 201);
  }

  if (request.method === 'GET' && url.pathname === '/v1/accountant-mandates') {
    if (!principal) throw new Error('TAX_TENANT_SCOPE_UNAUTHORIZED');
    assertTaxTenantPrincipalScope(principal, principal.workspaceId, principal.actorId);
    return json({ data: store.listAccountantMandates(principal.workspaceId) });
  }

  const revokeMatch = url.pathname.match(/^\/v1\/accountant-mandates\/([^/]+)\/revoke$/);
  if (request.method === 'POST' && revokeMatch) {
    if (!principal) throw new Error('TAX_TENANT_SCOPE_UNAUTHORIZED');
    assertTaxTenantPrincipalScope(principal, principal.workspaceId, principal.actorId);
    const mandate = store.revokeAccountantMandate(decodeURIComponent(revokeMatch[1]!), principal.workspaceId, principal.actorId, now.toISOString());
    return json({ data: mandate });
  }

  return null;
}

function json(value: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}
