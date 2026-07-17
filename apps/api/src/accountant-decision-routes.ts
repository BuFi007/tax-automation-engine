import { createHash } from 'node:crypto';

import { assertExternalAccountantDecisionV1 } from '@tax-engine/core';

import { readBoundedBody } from './bounded-body';
import { TaxProfileStore } from './store';
import {
  assertTaxTenantPrincipalScope,
  type TaxTenantPrincipalV3,
} from './tenant-principal';

export async function handleExternalAccountantDecisionRoute(
  request: Request,
  url: URL,
  store: TaxProfileStore,
  principal: TaxTenantPrincipalV3 | null,
  now: Date = new Date(),
  rawBodyInput?: string,
): Promise<Response | null> {
  if (request.method !== 'POST' || url.pathname !== '/v1/accountant-decisions') {
    return null;
  }
  const rawBody = rawBodyInput ?? await readBoundedBody(
    request,
    32 * 1024,
    'ACCOUNTANT_DECISION_REQUEST_TOO_LARGE',
  );
  const decision = assertExternalAccountantDecisionV1(JSON.parse(rawBody) as unknown);
  assertTaxTenantPrincipalScope(
    principal,
    decision.workspaceId,
    decision.accountantActorId,
  );
  const encodedPrincipal = request.headers.get('x-tax-tenant-principal') ?? '';
  const principalSignature = request.headers.get('x-tax-tenant-signature') ?? '';
  if (!encodedPrincipal || !/^[a-f0-9]{64}$/.test(principalSignature)) {
    throw new Error('ACCOUNTANT_DECISION_AUTHENTICATION_PROOF_INVALID');
  }
  const authenticationProofHash = createHash('sha256')
    .update(encodedPrincipal, 'utf8')
    .update('\0', 'utf8')
    .update(principalSignature, 'utf8')
    .digest('hex');
  const receipt = store.recordExternalAccountantDecision(
    decision,
    now.toISOString(),
    authenticationProofHash,
  );
  return Response.json(
    { data: receipt },
    {
      status: receipt.replayed ? 200 : 201,
      headers: {
        'cache-control': 'private, no-store',
        vary: 'authorization, x-tax-tenant-principal, x-tax-tenant-signature',
      },
    },
  );
}
