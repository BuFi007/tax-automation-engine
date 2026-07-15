import { ReclaimProofRequest, verifyProof, type Proof } from '@reclaimprotocol/js-sdk';
import {
  hashCanonical,
  type ArcaOnboardingReclaimSessionV1,
  type ArcaOnboardingRunV1,
} from '@tax-engine/core';

export type ArcaOnboardingClaimsV1 = Readonly<{
  pointOfSaleAdministrationActive: true;
  relationshipManagerActive: true;
  exportPointOfSaleActive: true;
  exportPointOfSale: number;
  wsfexDelegated: boolean;
  wsfeDelegated: boolean;
}>;

export type ArcaOnboardingReclaimRequest = Readonly<{
  session: ArcaOnboardingReclaimSessionV1;
  requestUrl: string;
  requestConfig: string;
  statusUrl: string;
}>;

export type VerifiedArcaOnboardingProof = Readonly<{
  sessionId: string;
  providerId: string;
  providerVersion: string;
  proofHash: string;
  claimsHash: string;
  claims: ArcaOnboardingClaimsV1;
  verifiedAt: string;
  teeVerified: boolean;
}>;

export interface ArcaOnboardingReclaimGateway {
  createRequest(run: ArcaOnboardingRunV1, occurredAt: string): Promise<ArcaOnboardingReclaimRequest>;
  verifyCallback(
    run: ArcaOnboardingRunV1,
    session: ArcaOnboardingReclaimSessionV1,
    proofPayload: unknown,
    occurredAt: string,
  ): Promise<VerifiedArcaOnboardingProof>;
}

export class ReclaimArcaOnboardingGateway implements ArcaOnboardingReclaimGateway {
  constructor(private readonly config: Readonly<{
    appId: string;
    appSecret: string;
    callbackBaseUrl: string;
    providerId: string;
    requireTeeAttestation: boolean;
  }>) {}

  static fromEnvironment(): ReclaimArcaOnboardingGateway | null {
    const config = {
      appId: process.env.RECLAIM_APP_ID ?? '',
      appSecret: process.env.RECLAIM_APP_SECRET ?? '',
      callbackBaseUrl: process.env.RECLAIM_CALLBACK_BASE_URL ?? '',
      providerId: process.env.RECLAIM_ARCA_ONBOARDING_PROVIDER_ID ?? '',
      requireTeeAttestation: process.env.RECLAIM_REQUIRE_TEE === 'true',
    };
    return config.appId && config.appSecret && config.callbackBaseUrl && config.providerId
      ? new ReclaimArcaOnboardingGateway(config)
      : null;
  }

  async createRequest(run: ArcaOnboardingRunV1, occurredAt: string): Promise<ArcaOnboardingReclaimRequest> {
    if (run.currentStep !== 'zk_evidence' || run.status !== 'active') throw new Error('ARCA_ONBOARDING_NOT_READY_FOR_ZK_EVIDENCE');
    const request = await ReclaimProofRequest.init(this.config.appId, this.config.appSecret, this.config.providerId, {
      acceptAiProviders: false,
      acceptTeeAttestation: this.config.requireTeeAttestation,
    });
    const context = proofContext(run);
    request.setJsonContext(context);
    request.setAppCallbackUrl(`${this.config.callbackBaseUrl.replace(/\/$/, '')}/v1/reclaim/arca-onboarding/callback`, true);
    const providerVersion = request.getProviderVersion();
    const requestedAt = new Date(occurredAt);
    const expiresAt = new Date(requestedAt.getTime() + 10 * 60 * 1000).toISOString();
    return {
      session: {
        sessionId: request.getSessionId(),
        providerId: providerVersion.providerId,
        providerVersion: providerVersion.providerVersion,
        contextHash: hashCanonical(context),
        requestedAt: occurredAt,
        expiresAt,
        state: 'pending',
      },
      requestUrl: await request.getRequestUrl(),
      requestConfig: request.toJsonString(),
      statusUrl: request.getStatusUrl(),
    };
  }

  async verifyCallback(
    run: ArcaOnboardingRunV1,
    session: ArcaOnboardingReclaimSessionV1,
    proofPayload: unknown,
    occurredAt: string,
  ): Promise<VerifiedArcaOnboardingProof> {
    if (Date.parse(occurredAt) > Date.parse(session.expiresAt)) throw new Error('RECLAIM_SESSION_EXPIRED');
    const proofs = normalizeProofs(proofPayload);
    const verification = await verifyProof(proofs, {
      providerId: session.providerId,
      providerVersion: session.providerVersion,
      allowedTags: [],
      ...(this.config.requireTeeAttestation ? { teeAttestation: { appSecret: this.config.appSecret } } : {}),
    });
    if (!verification.isVerified) throw new Error('RECLAIM_PROOF_INVALID');
    if (this.config.requireTeeAttestation && !verification.isTeeAttestationVerified) throw new Error('RECLAIM_TEE_ATTESTATION_REQUIRED');
    const expectedContext = proofContext(run);
    if (hashCanonical(expectedContext) !== session.contextHash) throw new Error('RECLAIM_SESSION_CONTEXT_MISMATCH');
    for (const trusted of verification.data) {
      if (hashCanonical(pickProofContext(trusted.context)) !== session.contextHash) throw new Error('RECLAIM_PROOF_CONTEXT_MISMATCH');
      const reclaimSessionId = trusted.context.reclaimSessionId;
      if (typeof reclaimSessionId === 'string' && reclaimSessionId !== session.sessionId) throw new Error('RECLAIM_PROOF_SESSION_MISMATCH');
    }

    const extracted = Object.assign({}, ...verification.data.map(item => item.extractedParameters));
    const claims = onboardingClaims(extracted, run);
    return {
      sessionId: session.sessionId,
      providerId: session.providerId,
      providerVersion: session.providerVersion,
      proofHash: hashCanonical(proofs),
      claimsHash: hashCanonical(claims),
      claims,
      verifiedAt: occurredAt,
      teeVerified: verification.isTeeAttestationVerified === true,
    };
  }
}

function proofContext(run: ArcaOnboardingRunV1): Readonly<Record<string, unknown>> {
  return {
    version: 'motora-arca-onboarding-proof-context-v1',
    onboardingId: run.onboardingId,
    workspaceId: run.workspaceId,
    taxpayerReferenceHash: run.taxpayerReferenceHash,
    environment: run.environment,
    requestedServices: [...run.requestedServices],
    pointOfSale: run.pointOfSale.number,
  };
}

function pickProofContext(context: Record<string, unknown>): Readonly<Record<string, unknown>> {
  return {
    version: context.version,
    onboardingId: context.onboardingId,
    workspaceId: context.workspaceId,
    taxpayerReferenceHash: context.taxpayerReferenceHash,
    environment: context.environment,
    requestedServices: context.requestedServices,
    pointOfSale: context.pointOfSale,
  };
}

function onboardingClaims(values: Record<string, string>, run: ArcaOnboardingRunV1): ArcaOnboardingClaimsV1 {
  if (values.pointOfSaleAdministrationActive !== 'true') throw new Error('RECLAIM_POINT_OF_SALE_ADMINISTRATION_NOT_ACTIVE');
  if (values.relationshipManagerActive !== 'true') throw new Error('RECLAIM_RELATIONSHIP_MANAGER_NOT_ACTIVE');
  if (values.exportPointOfSaleActive !== 'true') throw new Error('RECLAIM_EXPORT_POINT_OF_SALE_NOT_ACTIVE');
  const exportPointOfSale = positiveInteger(values.exportPointOfSale, 'RECLAIM_EXPORT_POINT_OF_SALE_INVALID');
  if (exportPointOfSale !== run.pointOfSale.number) throw new Error('RECLAIM_EXPORT_POINT_OF_SALE_MISMATCH');
  const wsfexDelegated = values.wsfexDelegated === 'true';
  const wsfeDelegated = values.wsfeDelegated === 'true';
  if (run.requestedServices.includes('wsfex') && !wsfexDelegated) throw new Error('RECLAIM_WSFEX_DELEGATION_NOT_PROVEN');
  if (run.requestedServices.includes('wsfe') && !wsfeDelegated) throw new Error('RECLAIM_WSFE_DELEGATION_NOT_PROVEN');
  return {
    pointOfSaleAdministrationActive: true,
    relationshipManagerActive: true,
    exportPointOfSaleActive: true,
    exportPointOfSale,
    wsfexDelegated,
    wsfeDelegated,
  };
}

function normalizeProofs(payload: unknown): Proof[] {
  const decoded = typeof payload === 'string' ? JSON.parse(decodeURIComponent(payload)) as unknown : payload;
  const candidates = Array.isArray(decoded) ? decoded : [decoded];
  if (!candidates.length || candidates.some(candidate => !candidate || typeof candidate !== 'object' || Array.isArray(candidate))) {
    throw new Error('RECLAIM_PROOF_PAYLOAD_INVALID');
  }
  return candidates as Proof[];
}

function positiveInteger(value: string | undefined, code: string): number {
  if (!value || !/^\d+$/.test(value)) throw new Error(code);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(code);
  return parsed;
}
