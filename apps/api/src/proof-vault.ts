import { hashCanonical, type ArcaOnboardingReclaimSessionV1, type ArcaOnboardingRunV1, type FacturaEAgentRunV1, type ReclaimProofCustodyReceiptV1, type ReclaimSessionReferenceV1, type VerifiedReclaimProofV1 } from '@tax-engine/core';
import { z } from 'zod';

import type { VerifiedArcaOnboardingProof } from './arca-onboarding-reclaim';
import { readBoundedBody, refuseRedirect } from './bounded-body';

export interface ReclaimProofVault {
  storeVerifiedProof(input: Readonly<{
    run: FacturaEAgentRunV1;
    session: ReclaimSessionReferenceV1;
    proof: VerifiedReclaimProofV1;
    proofPayload: unknown;
  }>): Promise<ReclaimProofCustodyReceiptV1>;
  storeVerifiedArcaOnboardingProof?(input: Readonly<{
    run: ArcaOnboardingRunV1;
    session: ArcaOnboardingReclaimSessionV1;
    proof: VerifiedArcaOnboardingProof;
    proofPayload: unknown;
  }>): Promise<ReclaimProofCustodyReceiptV1>;
}

type ProofVaultFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const receiptSchema = z.object({
  version: z.literal('reclaim-proof-custody-receipt-v1'),
  opaqueReference: z.string().regex(/^vault:\/\/reclaim\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
  artifactHash: z.string().regex(/^[a-f0-9]{64}$/),
  encryptionVersion: z.literal('aes-256-gcm+hkdf-sha256+wrapped-dek-v1'),
  retentionPolicyId: z.string().min(1),
  storedAt: z.iso.datetime({ offset: true }),
}).strict();

export class HttpReclaimProofVault implements ReclaimProofVault {
  private readonly endpoint: URL;

  constructor(
    private readonly config: Readonly<{
      baseUrl: string;
      token: string;
      retentionPolicyId: string;
      environment: 'development' | 'production';
    }>,
    private readonly fetcher: ProofVaultFetch = (input, init) => fetch(input, init)
  ) {
    let baseUrl: URL;
    try {
      baseUrl = new URL(config.baseUrl);
    } catch {
      throw new Error('RECLAIM_PROOF_VAULT_URL_INVALID');
    }
    if (baseUrl.protocol !== 'https:') throw new Error('RECLAIM_PROOF_VAULT_HTTPS_REQUIRED');
    if (baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash) {
      throw new Error('RECLAIM_PROOF_VAULT_URL_INVALID');
    }
    const basePath = baseUrl.pathname.replace(/\/$/, '');
    baseUrl.pathname = `${basePath}/v1/reclaim-proofs`;
    this.endpoint = baseUrl;
  }

  static fromEnvironment(): HttpReclaimProofVault | null {
    const baseUrl = process.env.RECLAIM_PROOF_VAULT_URL ?? '';
    const token = process.env.RECLAIM_PROOF_VAULT_TOKEN ?? '';
    const retentionPolicyId = process.env.RECLAIM_PROOF_RETENTION_POLICY_ID ?? '';
    if (!baseUrl || !token || !retentionPolicyId) return null;
    return new HttpReclaimProofVault({
      baseUrl,
      token,
      retentionPolicyId,
      environment: process.env.NODE_ENV === 'production' ? 'production' : 'development',
    });
  }

  async storeVerifiedProof(input: Readonly<{
    run: FacturaEAgentRunV1;
    session: ReclaimSessionReferenceV1;
    proof: VerifiedReclaimProofV1;
    proofPayload: unknown;
  }>): Promise<ReclaimProofCustodyReceiptV1> {
    return this.store({
      runId: input.run.runId,
      workspaceId: input.run.workspaceId,
      sessionId: input.session.sessionId,
      purpose: input.session.purpose,
      providerId: input.proof.providerId,
      providerVersion: input.proof.providerVersion,
      proofHash: input.proof.proofHash,
      verifiedAt: input.proof.verifiedAt,
      proofPayload: input.proofPayload,
    });
  }

  async storeVerifiedArcaOnboardingProof(input: Readonly<{
    run: ArcaOnboardingRunV1;
    session: ArcaOnboardingReclaimSessionV1;
    proof: VerifiedArcaOnboardingProof;
    proofPayload: unknown;
  }>): Promise<ReclaimProofCustodyReceiptV1> {
    return this.store({
      runId: input.run.onboardingId,
      workspaceId: input.run.workspaceId,
      sessionId: input.session.sessionId,
      purpose: 'arca_onboarding_readiness',
      providerId: input.proof.providerId,
      providerVersion: input.proof.providerVersion,
      proofHash: input.proof.proofHash,
      verifiedAt: input.proof.verifiedAt,
      proofPayload: input.proofPayload,
    });
  }

  private async store(input: Readonly<{
    runId: string;
    workspaceId: string;
    sessionId: string;
    purpose: string;
    providerId: string;
    providerVersion: string;
    proofHash: string;
    verifiedAt: string;
    proofPayload: unknown;
  }>): Promise<ReclaimProofCustodyReceiptV1> {
    let response: Response;
    try {
      response = await this.fetcher(this.endpoint, {
        method: 'POST',
        redirect: 'manual',
        headers: {
          authorization: `Bearer ${this.config.token}`,
          'content-type': 'application/json',
          'idempotency-key': hashCanonical({ workspaceId: input.workspaceId, sessionId: input.sessionId, purpose: input.purpose }),
        },
        body: JSON.stringify({
        version: 'reclaim-proof-custody-request-v1',
        runId: input.runId,
        workspaceId: input.workspaceId,
        sessionId: input.sessionId,
        purpose: input.purpose,
        providerId: input.providerId,
        providerVersion: input.providerVersion,
        proofHash: input.proofHash,
        retentionPolicyId: this.config.retentionPolicyId,
        verifiedAt: input.verifiedAt,
        proofPayload: input.proofPayload,
        }),
        signal: AbortSignal.timeout(30_000),
      }).then(refuseRedirect);
    } catch {
      throw new Error('RECLAIM_PROOF_VAULT_TRANSPORT_FAILED');
    }
    if (response.redirected) throw new Error('RECLAIM_PROOF_VAULT_REDIRECT_REJECTED');
    if (response.url) {
      let responseUrl: URL;
      try {
        responseUrl = new URL(response.url);
      } catch {
        throw new Error('RECLAIM_PROOF_VAULT_RESPONSE_ORIGIN_INVALID');
      }
      if (responseUrl.origin !== this.endpoint.origin) {
        throw new Error('RECLAIM_PROOF_VAULT_RESPONSE_ORIGIN_INVALID');
      }
    }
    if (!response.ok) throw new Error(`RECLAIM_PROOF_VAULT_REJECTED_${response.status}`);
    const raw = await readBoundedBody(response, 65_536, 'RECLAIM_PROOF_VAULT_RESPONSE_TOO_LARGE');
    let payload: unknown;
    try {
      payload = JSON.parse(raw) as unknown;
    } catch {
      throw new Error('RECLAIM_PROOF_VAULT_RESPONSE_INVALID');
    }
    const receipt = receiptSchema.parse(payload);
    if (receipt.artifactHash !== input.proofHash) throw new Error('RECLAIM_PROOF_VAULT_HASH_MISMATCH');
    if (receipt.retentionPolicyId !== this.config.retentionPolicyId) throw new Error('RECLAIM_PROOF_VAULT_RETENTION_POLICY_MISMATCH');
    return receipt;
  }
}
