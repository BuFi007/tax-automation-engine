import { hashCanonical, type ArcaOnboardingRunV1 } from '@tax-engine/core';
import { z } from 'zod';

import { readBoundedBody } from './bounded-body';
import { assertTaxTenantPrincipalScope, type TaxTenantPrincipalV3 } from './tenant-principal';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const reference = z.string().regex(/^[A-Za-z0-9._:/-]{1,500}$/);
const boundaryStatusSchema = z.object({
  version: z.literal('wsaa-issuer-status-v1'),
  workspaceId: z.string().min(1),
  issuerProfileRef: reference,
  environment: z.literal('homologation'),
  configured: z.boolean(),
  active: z.boolean(),
  delegationConfirmed: z.boolean(),
  certificateFingerprint: hash.nullable(),
  representedCuitCommitment: hash.nullable(),
  taxpayerReferenceHash: hash.nullable(),
  representedCuitLast4: z.string().regex(/^\d{4}$/).nullable(),
  certificate: z.object({
    validFrom: z.iso.datetime({ offset: true }).nullable(),
    validUntil: z.iso.datetime({ offset: true }).nullable(),
    current: z.boolean(),
  }),
}).passthrough();

type BoundaryStatus = z.infer<typeof boundaryStatusSchema>;
type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export class HttpArcaBoundaryStatusReader {
  readonly #origin: string;

  constructor(
    private readonly token: string,
    baseUrl: string,
    private readonly fetcher: Fetcher = (input, init) => fetch(input, init),
  ) {
    const endpoint = new URL(baseUrl);
    const loopback = ['localhost', '127.0.0.1', '::1'].includes(endpoint.hostname);
    if ((endpoint.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && loopback && endpoint.protocol === 'http:'))
      || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || !['', '/'].includes(endpoint.pathname))
      throw new Error('ARCA_BOUNDARY_STATUS_URL_INVALID');
    this.#origin = endpoint.origin;
  }

  static fromEnvironment(): HttpArcaBoundaryStatusReader | null {
    const baseUrl = process.env.ARCA_BOUNDARY_URL;
    const token = process.env.ARCA_BOUNDARY_STATUS_TOKEN;
    return baseUrl && token ? new HttpArcaBoundaryStatusReader(token, baseUrl) : null;
  }

  async read(workspaceId: string, issuerProfileRef: string): Promise<BoundaryStatus> {
    const url = new URL('/v1/wsaa/issuers/status', this.#origin);
    url.search = new URLSearchParams({ workspaceId, issuerProfileRef, environment: 'homologation' }).toString();
    let response: Response;
    try {
      response = await this.fetcher(url, {
        method: 'GET', redirect: 'error', headers: { authorization: `Bearer ${this.token}` }, signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new Error('ARCA_BOUNDARY_STATUS_TRANSPORT_FAILED');
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(response.status >= 500 ? 'ARCA_BOUNDARY_STATUS_UPSTREAM_UNAVAILABLE' : 'ARCA_BOUNDARY_STATUS_REJECTED');
    }
    return boundaryStatusSchema.parse(JSON.parse(await readBoundedBody(response, 32 * 1024, 'ARCA_BOUNDARY_STATUS_RESPONSE_TOO_LARGE')) as unknown);
  }

  async revoke(issuerProfileRef: string, certificateFingerprint: string, adminToken: string): Promise<void> {
    if (adminToken.length < 32) throw new Error('ARCA_BOUNDARY_ISSUER_REVOKE_CONFIGURATION_REQUIRED');
    let response: Response;
    try {
      response = await this.fetcher(new URL('/v1/wsaa/issuers/revoke', this.#origin), {
        method: 'POST', redirect: 'error',
        headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ version: 'wsaa-issuer-revoke-v1', issuerProfileRef, certificateFingerprint }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new Error('ARCA_BOUNDARY_ISSUER_REVOKE_TRANSPORT_FAILED');
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error('ARCA_BOUNDARY_ISSUER_REVOKE_REJECTED');
    }
    z.object({ revoked: z.literal(true) }).strict().parse(
      JSON.parse(await readBoundedBody(response, 1024, 'ARCA_BOUNDARY_ISSUER_REVOKE_RESPONSE_TOO_LARGE')) as unknown,
    );
  }
}

export async function revokeArcaConnectionForPrincipal(
  principal: TaxTenantPrincipalV3,
  expected: Readonly<{ issuerProfileRef: string; certificateFingerprint: string }>,
  profiles: ReadonlyMap<string, string> | null,
  reader: HttpArcaBoundaryStatusReader | null,
  adminToken: string | null,
) {
  if (principal.capability !== 'arca:onboard') throw new Error('TAX_TENANT_PRINCIPAL_CAPABILITY_UNAUTHORIZED');
  const issuerProfileRef = profiles?.get(principal.workspaceId);
  if (!issuerProfileRef || issuerProfileRef !== expected.issuerProfileRef)
    throw new Error('ARCA_CONNECTION_PROJECTION_ISSUER_CONFIGURATION_REQUIRED');
  reference.parse(issuerProfileRef);
  if (!reader) throw new Error('ARCA_BOUNDARY_STATUS_CONFIGURATION_REQUIRED');
  const boundary = await reader.read(principal.workspaceId, issuerProfileRef);
  if (boundary.workspaceId !== principal.workspaceId || boundary.issuerProfileRef !== issuerProfileRef
    || boundary.environment !== 'homologation'
    || boundary.certificateFingerprint !== expected.certificateFingerprint)
    throw new Error('ARCA_CONNECTION_PROJECTION_BOUNDARY_MISMATCH');
  if (boundary.active) {
    if (!boundary.certificateFingerprint || !adminToken)
      throw new Error('ARCA_BOUNDARY_ISSUER_REVOKE_CONFIGURATION_REQUIRED');
    await reader.revoke(issuerProfileRef, boundary.certificateFingerprint, adminToken);
  }
  return { revoked: true as const };
}

/** Operator acceptance is distinct from service verification and never enables issuance. */
export async function issuerAcceptanceForPrincipal(
  principal: TaxTenantPrincipalV3,
  onboardingId: string,
  runs: Readonly<{ getRun(id: string): ArcaOnboardingRunV1 }>,
  profiles: ReadonlyMap<string, string>,
  reader: HttpArcaBoundaryStatusReader | null,
) {
  if (principal.capability !== 'arca:onboard') throw new Error('TAX_TENANT_PRINCIPAL_CAPABILITY_UNAUTHORIZED');
  const run = runs.getRun(onboardingId);
  assertTaxTenantPrincipalScope(principal, run.workspaceId);
  if (run.environment !== 'homologation') throw new Error('ARCA_CONNECTION_PROJECTION_HOMOLOGATION_ONLY');
  const ref = profiles.get(run.workspaceId);
  if (!ref) return { data: { operatorAccepted: false } };
  if (!reader) throw new Error('ARCA_BOUNDARY_STATUS_CONFIGURATION_REQUIRED');
  const boundary = await reader.read(run.workspaceId, ref);
  return { data: { operatorAccepted: boundary.workspaceId === run.workspaceId
    && boundary.issuerProfileRef === ref && boundary.environment === 'homologation'
    && boundary.active && boundary.delegationConfirmed && boundary.certificate.current
    && boundary.taxpayerReferenceHash === run.taxpayerReferenceHash } };
}

export async function privateArcaConnectionProjection(
  request: Request,
  url: URL,
  principal: TaxTenantPrincipalV3,
  runs: Readonly<{ getRun(id: string): ArcaOnboardingRunV1 }>,
  profiles: ReadonlyMap<string, string> | null,
  reader: HttpArcaBoundaryStatusReader | null,
  now: Date = new Date(),
) {
  const match = url.pathname.match(/^\/v1\/arca-onboarding\/runs\/([^/]+)\/private-connection-projection$/);
  if (request.method !== 'GET' || !match) throw new Error('ARCA_CONNECTION_PROJECTION_NOT_FOUND');
  if (url.searchParams.size !== 1) throw new Error('ARCA_CONNECTION_PROJECTION_INVALID_REQUEST');
  const issuerProfileRef = reference.parse(url.searchParams.get('issuerProfileRef'));
  const run = runs.getRun(decodeURIComponent(match[1]!));
  return projectRun(principal, run, issuerProfileRef, profiles, reader, now);
}

export async function latestPrivateArcaConnectionProjection(
  request: Request,
  url: URL,
  principal: TaxTenantPrincipalV3,
  runs: Readonly<{ listRuns(workspaceId: string): readonly ArcaOnboardingRunV1[] }>,
  profiles: ReadonlyMap<string, string> | null,
  reader: HttpArcaBoundaryStatusReader | null,
  now: Date = new Date(),
) {
  if (request.method !== 'GET' || url.pathname !== '/v1/arca-onboarding/private-connection-projection'
    || url.search) throw new Error('ARCA_CONNECTION_PROJECTION_INVALID_REQUEST');
  return latestArcaConnectionProjectionForPrincipal(principal, runs, profiles, reader, now);
}

/** Reuse the live certificate/delegation/POS decision at the issuing boundary. */
export async function latestArcaConnectionProjectionForPrincipal(
  principal: TaxTenantPrincipalV3,
  runs: Readonly<{ listRuns(workspaceId: string): readonly ArcaOnboardingRunV1[] }>,
  profiles: ReadonlyMap<string, string> | null,
  reader: HttpArcaBoundaryStatusReader | null,
  now: Date = new Date(),
) {
  const issuerProfileRef = profiles?.get(principal.workspaceId);
  if (!issuerProfileRef) throw new Error('ARCA_CONNECTION_PROJECTION_ISSUER_CONFIGURATION_REQUIRED');
  reference.parse(issuerProfileRef);
  const bindingHash = hashCanonical(issuerProfileRef);
  const run = runs.listRuns(principal.workspaceId)
    .filter(candidate => candidate.environment === 'homologation'
      && candidate.authorityBinding?.issuerProfileReferenceHash === bindingHash)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.onboardingId.localeCompare(left.onboardingId))[0];
  if (!run) throw new Error('ARCA_CONNECTION_PROJECTION_NOT_FOUND');
  return projectRun(principal, run, issuerProfileRef, profiles, reader, now);
}

async function projectRun(
  principal: TaxTenantPrincipalV3,
  run: ArcaOnboardingRunV1,
  issuerProfileRef: string,
  profiles: ReadonlyMap<string, string> | null,
  reader: HttpArcaBoundaryStatusReader | null,
  now: Date,
) {
  if (principal.capability !== 'arca:onboard' && principal.capability !== 'arca:issue')
    throw new Error('TAX_TENANT_PRINCIPAL_CAPABILITY_UNAUTHORIZED');
  assertTaxTenantPrincipalScope(principal, run.workspaceId);
  if (run.environment !== 'homologation') throw new Error('ARCA_CONNECTION_PROJECTION_HOMOLOGATION_ONLY');
  if (!profiles || profiles.get(run.workspaceId) !== issuerProfileRef)
    throw new Error('ARCA_CONNECTION_PROJECTION_ISSUER_MISMATCH');
  if (run.authorityBinding?.issuerProfileReferenceHash !== hashCanonical(issuerProfileRef)
    || !run.authorityBinding.representedCuitCommitment)
    throw new Error('ARCA_CONNECTION_PROJECTION_AUTHORITY_MISMATCH');
  if (!reader) throw new Error('ARCA_BOUNDARY_STATUS_CONFIGURATION_REQUIRED');
  const boundary = await reader.read(run.workspaceId, issuerProfileRef);
  if (boundary.workspaceId !== run.workspaceId || boundary.issuerProfileRef !== issuerProfileRef
    || boundary.environment !== run.environment
    || boundary.representedCuitCommitment !== run.authorityBinding.representedCuitCommitment)
    throw new Error('ARCA_CONNECTION_PROJECTION_BOUNDARY_MISMATCH');
  if (boundary.taxpayerReferenceHash !== run.taxpayerReferenceHash)
    throw new Error('ARCA_CONNECTION_PROJECTION_TAXPAYER_MISMATCH');
  if (!boundary.configured || !boundary.certificateFingerprint || !boundary.representedCuitLast4
    || !boundary.certificate.validUntil || !boundary.certificate.validFrom)
    throw new Error('ARCA_CONNECTION_PROJECTION_BOUNDARY_UNCONFIGURED');

  const delegationStep = run.steps.find(step => step.step === 'ws_delegation');
  const certificateBound = delegationStep?.safeMetadata.source !== 'live_certificate_boundary'
    || (!!boundary.certificateFingerprint && delegationStep.evidenceHashes[1] === hashCanonical(boundary.certificateFingerprint));
  const authorityCurrent = certificateBound && boundary.active && boundary.delegationConfirmed && boundary.certificate.current
    && Date.parse(boundary.certificate.validFrom) <= now.getTime()
    && Date.parse(boundary.certificate.validUntil) > now.getTime() + 60_000;
  const service = (name: 'wsfe' | 'wsfex') => {
    const requested = run.requestedServices.includes(name);
    const point = name === 'wsfe' ? run.domesticPointOfSale : run.pointOfSale;
    const receipt = run.apiVerificationReceipts?.[name] ?? null;
    const observedAt = run.apiVerification.observedAt;
    const hasEvidence = requested && run.status !== 'failed' && run.delegation[name]
      && run.apiVerification[name] && point?.active && Number.isInteger(point.number)
      && (point.number ?? 0) > 0 && (point.number ?? 0) < 99_999
      && !!receipt && hash.safeParse(receipt).success
      && !!observedAt && Number.isFinite(Date.parse(observedAt))
      && Date.parse(observedAt) <= now.getTime();
    return {
      status: !requested ? 'requires_action' as const : !authorityCurrent ? 'reconnect' as const : hasEvidence ? 'ready' as const : 'requires_action' as const,
      pointOfSale: hasEvidence && authorityCurrent ? point!.number : null,
      verifiedAt: hasEvidence && authorityCurrent ? observedAt : null,
      evidenceHash: hasEvidence && authorityCurrent ? receipt : null,
    };
  };
  return {
    data: {
      version: 'arca-private-connection-projection-v1' as const,
      workspaceId: run.workspaceId,
      onboardingId: run.onboardingId,
      environment: 'homologation' as const,
      issuerProfileRef,
      representedCuitCommitment: boundary.representedCuitCommitment,
      taxpayerReferenceHash: boundary.taxpayerReferenceHash,
      representedCuitLast4: boundary.representedCuitLast4,
      certificateFingerprint: boundary.certificateFingerprint,
      certificateExpiresAt: boundary.certificate.validUntil,
      wsfe: service('wsfe'),
      wsfex: service('wsfex'),
    },
  };
}
