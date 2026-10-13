/** Operator-only homologation handoff after BUFI accepts the relation in ARCA. */
import { isValidCuit } from '@tax-engine/wsfex-signer/contracts';
import { z } from 'zod';
import { assertArcaFiscalBeta } from './arca-fiscal-beta';

const inputSchema = z.object({
  onboardingId: z.uuid(),
  workspaceId: z.string().min(1).max(200),
  representedCuit: z.string().regex(/^\d{11}$/).refine(isValidCuit),
}).strict();

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
}

function origin(name: string): URL {
  const url = new URL(required(name));
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && loopback && url.protocol === 'http:'))
    || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname))
    throw new Error(`${name}_INVALID`);
  return url;
}

async function post(url: URL, token: string, body: unknown): Promise<unknown> {
  const response = await fetch(url, {
    method: 'POST', redirect: 'error',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`ACTIVATION_STEP_FAILED_${response.status}`);
  }
  return response.json();
}

async function main(): Promise<void> {
  const raw = await Bun.stdin.text();
  if (raw.length > 2048) throw new Error('ACTIVATION_INPUT_TOO_LARGE');
  const input = inputSchema.parse(JSON.parse(raw) as unknown);
  assertArcaFiscalBeta(input.workspaceId);
  const issuerProfileRef = `issuer://homologation/${input.onboardingId}`;
  const boundary = origin('ARCA_BOUNDARY_URL');
  const tax = origin('TAX_ENGINE_OPERATOR_URL');
  await post(new URL('/v1/wsaa/issuers/delegations', boundary), required('ARCA_BOUNDARY_ADMIN_TOKEN'), {
    version: 'wsaa-issuer-delegation-v1',
    templateWorkspaceId: required('ARCA_BUFI_TEMPLATE_WORKSPACE_ID'),
    templateIssuerProfileRef: required('ARCA_BUFI_TEMPLATE_PROFILE_REF'),
    workspaceId: input.workspaceId, issuerProfileRef,
    environment: 'homologation', representedCuit: input.representedCuit,
  });
  await post(new URL('/v1/arca-onboarding/issuer-bindings', tax), required('TAX_ARCA_ISSUER_BINDING_ADMIN_TOKEN'), {
    onboardingId: input.onboardingId, issuerProfileRef,
  });
  console.info(JSON.stringify({ bound: true, onboardingId: input.onboardingId, issuerProfileRef }));
}

if (import.meta.main) main().catch(error => {
  const message = error instanceof Error ? error.message : 'ACTIVATION_FAILED';
  console.error(/^[A-Z0-9_]+$/.test(message) ? message : 'ACTIVATION_FAILED');
  process.exitCode = 1;
});
