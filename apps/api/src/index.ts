import { demoSnapshot, listJurisdictionProviders } from '@tax-engine/core';
import { ContabiliumSandboxProvider } from '@tax-engine/erp';
import { z } from 'zod';

import { applyCors } from './cors';
import { TaxProfileStore } from './store';

const port = Number(process.env.PORT ?? 4100);
const apiKey = process.env.TAX_ENGINE_API_KEY;
if (process.env.NODE_ENV === 'production' && !apiKey) {
  throw new Error('TAX_ENGINE_API_KEY is required in production');
}

const store = new TaxProfileStore();
const argentinaErp = new ContabiliumSandboxProvider(null);
const jurisdictionSchema = z.enum(['AR', 'US']);
const profileSchema = z.object({
  profileId: z.string().min(1),
  workspaceId: z.string().min(1),
  jurisdiction: jurisdictionSchema,
  entityType: z.string().min(1),
  regimeId: z.string().min(1),
  ownerDomicileCountries: z.array(z.string().length(2)),
  ownerTaxResidenceCountries: z.array(z.string().length(2)),
  formationSubdivision: z.string().nullable(),
  operatingSubdivisions: z.array(z.string()),
  answers: z.array(z.object({
    questionId: z.string(),
    value: z.union([z.string(), z.boolean(), z.number(), z.array(z.string())]),
    confirmationState: z.enum(['user_confirmed', 'accountant_confirmed']),
  })),
  catalogueVersion: z.string(),
  version: z.string(),
  confirmationState: z.enum(['user_confirmed', 'accountant_confirmed']),
}).strict();

export const server = Bun.serve({
  port,
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return applyCors(new Response(null, { status: 204 }), request);
    if (!authorized(request)) return applyCors(json({ error: 'UNAUTHORIZED' }, 401), request);

    try {
      if (request.method === 'GET' && url.pathname === '/health') {
        return applyCors(json({ status: 'ok', execution: 'manual_only', filingEnabled: false }), request);
      }
      if (request.method === 'GET' && url.pathname === '/v1/catalogues') {
        return applyCors(json({ data: listJurisdictionProviders().map(provider => provider.catalogue) }), request);
      }
      if (request.method === 'GET' && url.pathname === '/v1/snapshots/demo') {
        const jurisdiction = jurisdictionSchema.parse(url.searchParams.get('jurisdiction') ?? 'AR');
        return applyCors(json({ data: await demoSnapshot(jurisdiction) }), request);
      }
      if (request.method === 'GET' && url.pathname === '/v1/providers/argentina-erp') {
        const tenantId = url.searchParams.get('tenantId') ?? 'unconfigured';
        return applyCors(json({
          data: {
            providerId: argentinaErp.providerId,
            capabilities: await argentinaErp.getImportCapabilities(tenantId),
            productionClaim: false,
            safeErrorCode: 'AUTHORIZED_SANDBOX_REQUIRED',
          },
        }), request);
      }
      if (request.method === 'GET' && url.pathname.startsWith('/v1/profiles/')) {
        const workspaceId = decodeURIComponent(url.pathname.slice('/v1/profiles/'.length));
        const profile = store.get(workspaceId);
        return applyCors(profile ? json({ data: profile }) : json({ error: 'NOT_FOUND' }, 404), request);
      }
      if (request.method === 'POST' && url.pathname === '/v1/profiles/confirm') {
        const body = z.object({
          actorId: z.string().min(1),
          expectedVersion: z.string().nullable(),
          profile: profileSchema,
        }).strict().parse(await request.json());
        const profile = store.confirm({ ...body, occurredAt: new Date().toISOString() });
        return applyCors(json({ data: profile }), request);
      }
      if (request.method === 'POST' && url.pathname === '/v1/snapshots') {
        const body = z.object({ workspaceId: z.string().min(1), jurisdiction: jurisdictionSchema }).strict().parse(await request.json());
        const persisted = store.get(body.workspaceId);
        const expectedJurisdiction = persisted?.jurisdiction ?? body.jurisdiction;
        const snapshot = await demoSnapshot(expectedJurisdiction);
        return applyCors(json({
          data: persisted ? { ...snapshot, workspaceId: body.workspaceId, profile: persisted } : snapshot,
          limitations: persisted ? ['Demo evidence adapters are active; connect production adapters before relying on calculations.'] : ['No confirmed profile exists; demo profile and evidence are shown.'],
        }), request);
      }
      return applyCors(json({ error: 'NOT_FOUND' }, 404), request);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
      const status = message === 'PROFILE_VERSION_CONFLICT' ? 409 : 400;
      return applyCors(json({ error: message }, status), request);
    }
  },
});

function authorized(request: Request): boolean {
  if (!apiKey) return true;
  return request.headers.get('authorization') === `Bearer ${apiKey}`;
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status });
}

if (import.meta.main) {
  console.info(`Tax Automation Engine API listening on http://localhost:${server.port}`);
  console.info('Execution mode: manual_only; filing and payments disabled');
}
