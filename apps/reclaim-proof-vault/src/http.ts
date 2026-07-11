import { safeTokenEqual } from '@tax-engine/arca-boundary/crypto';

import { custodyRequestSchema, proofEraseRequestSchema, proofPurgeRequestSchema, proofResolveRequestSchema, retentionPolicyRequestSchema } from './contracts';
import type { ReclaimProofStore } from './store';

export type ProofVaultTokens = Readonly<{ writer: string; reviewer: string; admin: string }>;

export function createProofVaultHandler(store: ReclaimProofStore, tokens: ProofVaultTokens, clock: () => Date = () => new Date()) {
  return async (request: Request): Promise<Response> => {
    try {
      const url = new URL(request.url);
      const role = roleFor(request.method, url.pathname);
      if (!role) return json({ error: 'NOT_FOUND' }, 404);
      if (!authorized(request, tokens[role])) return json({ error: 'UNAUTHORIZED' }, 401);
      const occurredAt = clock().toISOString();
      if (request.method === 'GET') return json(store.health());
      const maximumBytes = 64 * 1024 * 1024;
      if (Number(request.headers.get('content-length') ?? 0) > maximumBytes) return json({ error: 'RECLAIM_PROOF_REQUEST_TOO_LARGE' }, 413);
      const raw = await request.text();
      if (Buffer.byteLength(raw) > maximumBytes) return json({ error: 'RECLAIM_PROOF_REQUEST_TOO_LARGE' }, 413);
      const body: unknown = JSON.parse(raw);
      if (url.pathname === '/v1/reclaim-proofs') return json(store.store(custodyRequestSchema.parse(body), occurredAt), 201);
      if (url.pathname === '/v1/reclaim-proofs/resolve') {
        const input = proofResolveRequestSchema.parse(body); return json(store.resolve(input.opaqueReference, occurredAt));
      }
      if (url.pathname === '/v1/reclaim-proofs/erase') {
        const input = proofEraseRequestSchema.parse(body); store.erase(input.workspaceId, input.opaqueReference, occurredAt, input.reason); return json({ erased: true });
      }
      if (url.pathname === '/v1/reclaim-proofs/purge-expired') {
        proofPurgeRequestSchema.parse(body); return json({ erasedCount: store.purgeExpired(occurredAt) });
      }
      if (url.pathname === '/v1/retention-policies') return json(store.putPolicy(retentionPolicyRequestSchema.parse(body), occurredAt), 201);
      return json({ error: 'NOT_FOUND' }, 404);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
      const code = /^[A-Z0-9_]+$/.test(message) ? message : 'INVALID_REQUEST';
      return json({ error: code }, statusFor(code));
    }
  };
}

function roleFor(method: string, path: string): keyof ProofVaultTokens | null {
  if (method === 'GET' && path === '/health') return 'writer';
  if (method !== 'POST') return null;
  if (path === '/v1/reclaim-proofs') return 'writer';
  if (path === '/v1/reclaim-proofs/resolve') return 'reviewer';
  if (path === '/v1/reclaim-proofs/erase' || path === '/v1/reclaim-proofs/purge-expired' || path === '/v1/retention-policies') return 'admin';
  return null;
}
function authorized(request: Request, token: string): boolean { return safeTokenEqual(request.headers.get('authorization')?.replace(/^Bearer\s+/, '') ?? '', token); }
function statusFor(code: string): number {
  if (code.endsWith('_NOT_FOUND')) return 404;
  if (code.includes('CONFLICT') || code.includes('PRECONDITION')) return 409;
  if (code.includes('EXPIRED')) return 410;
  if (code.includes('TOO_LARGE')) return 413;
  return 400;
}
function json(value: unknown, status = 200): Response { return Response.json(value, { status }); }
