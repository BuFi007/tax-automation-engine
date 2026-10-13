import { z } from 'zod';
import { assertArcaFiscalBeta, assertFiscalHumanActor, type ArcaFiscalBetaConfig } from './arca-fiscal-beta';
import { readBoundedBody } from './bounded-body';
import { verifyBoundTaxTenantPrincipalForRawBody, type TaxTenantPrincipalV3 } from './tenant-principal';
import { issuePersonalWsfeAttempt, preparePersonalWsfeAttempt, recoverPersonalWsfeAttempt, type PersonalWsfeReadyProjection } from './personal-wsfe-preparation';
import type { PersonalWsfeAttemptStore } from './personal-wsfe-attempt';
import type { HttpWsfePointOfSaleGateway } from './wsfe';
import type { HttpAuthorityPayloadWriter } from './authority-payload';

export async function handleWsfeAttemptRoute(request: Request, url: URL, options: Readonly<{
  principalSecret: string | null;
  beta: ArcaFiscalBetaConfig;
  attempts: PersonalWsfeAttemptStore | null;
  signer: Pick<HttpWsfePointOfSaleGateway, 'getNextVoucher' | 'issueInvoice'> | null;
  vault: Pick<HttpAuthorityPayloadWriter, 'store'> | null;
  projection(principal: TaxTenantPrincipalV3): Promise<PersonalWsfeReadyProjection>;
  now?: Date;
}>): Promise<Response | null> {
  if (request.method !== 'POST' || !/^\/v1\/(?:personal-wsfe|wsfe)\/attempts(?:\/(?:issue|recover))?$/.test(url.pathname)) return null;
  const raw = await readBoundedBody(request, url.pathname.endsWith('/recover') ? 1024 : 32 * 1024, 'PERSONAL_WSFE_REQUEST_TOO_LARGE');
  const principal = verifyBoundTaxTenantPrincipalForRawBody(request, raw, options.principalSecret, 'arca:issue', options.now);
  assertArcaFiscalBeta(principal.workspaceId, options.beta);
  assertFiscalHumanActor(principal.workspaceId, principal.actorId);
  if (url.pathname.startsWith('/v1/personal-wsfe/') && !principal.workspaceId.startsWith('personal:'))
    throw new Error('PERSONAL_WSFE_SCOPE_UNAUTHORIZED');
  const { attempts, signer, vault } = options;
  if (!attempts || !signer || (!vault && !url.pathname.endsWith('/recover')))
    throw new Error('TAX_PERSONAL_WSFE_CONFIGURATION_REQUIRED');
  const input = JSON.parse(raw) as unknown;
  const result = url.pathname.endsWith('/recover')
    ? await recoverPersonalWsfeAttempt(z.object({ invoiceId: z.uuid() }).strict().parse(input).invoiceId, principal.workspaceId, attempts, signer, options.now)
    : url.pathname.endsWith('/issue')
      ? await issuePersonalWsfeAttempt(input, principal.workspaceId, await options.projection(principal), attempts, signer, vault!, options.now)
      : await preparePersonalWsfeAttempt(input, principal.workspaceId, await options.projection(principal), attempts, signer, vault!, options.now);
  return Response.json({ data: result.data }, { headers: { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' } });
}
