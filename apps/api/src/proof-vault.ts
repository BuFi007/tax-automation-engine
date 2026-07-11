import { type FacturaEAgentRunV1, type ReclaimProofCustodyReceiptV1, type ReclaimSessionReferenceV1, type VerifiedReclaimProofV1 } from '@tax-engine/core';
import { z } from 'zod';

export interface ReclaimProofVault {
  storeVerifiedProof(input: Readonly<{
    run: FacturaEAgentRunV1;
    session: ReclaimSessionReferenceV1;
    proof: VerifiedReclaimProofV1;
    proofPayload: unknown;
  }>): Promise<ReclaimProofCustodyReceiptV1>;
}

type ProofVaultFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const receiptSchema = z.object({
  version: z.literal('reclaim-proof-custody-receipt-v1'),
  opaqueReference: z.string().min(1),
  artifactHash: z.string().regex(/^[a-f0-9]{64}$/),
  encryptionVersion: z.string().min(1),
  retentionPolicyId: z.string().min(1),
  storedAt: z.iso.datetime({ offset: true }),
}).strict();

export class HttpReclaimProofVault implements ReclaimProofVault {
  constructor(
    private readonly config: Readonly<{
      baseUrl: string;
      token: string;
      retentionPolicyId: string;
      environment: 'development' | 'production';
    }>,
    private readonly fetcher: ProofVaultFetch = (input, init) => fetch(input, init)
  ) {
    if (config.environment === 'production' && !config.baseUrl.startsWith('https://')) throw new Error('RECLAIM_PROOF_VAULT_HTTPS_REQUIRED');
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
    const response = await this.fetcher(`${this.config.baseUrl.replace(/\/$/, '')}/v1/reclaim-proofs`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.config.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        version: 'reclaim-proof-custody-request-v1',
        runId: input.run.runId,
        workspaceId: input.run.workspaceId,
        sessionId: input.session.sessionId,
        purpose: input.session.purpose,
        providerId: input.proof.providerId,
        providerVersion: input.proof.providerVersion,
        proofHash: input.proof.proofHash,
        retentionPolicyId: this.config.retentionPolicyId,
        verifiedAt: input.proof.verifiedAt,
        proofPayload: input.proofPayload,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`RECLAIM_PROOF_VAULT_REJECTED_${response.status}`);
    const receipt = receiptSchema.parse(await response.json());
    if (receipt.artifactHash !== input.proof.proofHash) throw new Error('RECLAIM_PROOF_VAULT_HASH_MISMATCH');
    if (receipt.retentionPolicyId !== this.config.retentionPolicyId) throw new Error('RECLAIM_PROOF_VAULT_RETENTION_POLICY_MISMATCH');
    return receipt;
  }
}
