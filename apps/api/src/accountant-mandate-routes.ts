import { z } from 'zod';

import type { AccountantMandateScope, AccountantMandateV1 } from '@tax-engine/core';

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

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
}
