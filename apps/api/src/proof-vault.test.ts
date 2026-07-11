import { describe, expect, test } from 'bun:test';

import { createFacturaEAgentRun, hashCanonical, type ReclaimSessionReferenceV1, type VerifiedReclaimProofV1 } from '@tax-engine/core';

import { HttpReclaimProofVault } from './proof-vault';

describe('Reclaim proof vault boundary', () => {
  test('sends the raw verified artifact only to the external vault and accepts a hash-bound receipt', async () => {
    const proof = readinessProof();
    const gateway = new HttpReclaimProofVault(
      { baseUrl: 'https://proof-vault.test', token: 'vault-token', retentionPolicyId: 'tax-evidence-v1', environment: 'production' },
      async (_url, init) => {
        expect(new Headers(init?.headers).get('authorization')).toBe('Bearer vault-token');
        const body = JSON.parse(String(init?.body));
        expect(body.proofPayload).toEqual({ rawProofMarker: 'external-only' });
        expect(body.proofHash).toBe(proof.proofHash);
        return Response.json({
          version: 'reclaim-proof-custody-receipt-v1',
          opaqueReference: 'vault://reclaim/60000000-0000-4000-8000-000000000001',
          artifactHash: proof.proofHash,
          encryptionVersion: 'aes-256-gcm+hkdf-sha256+wrapped-dek-v1',
          retentionPolicyId: 'tax-evidence-v1',
          storedAt: proof.verifiedAt,
        });
      }
    );
    const receipt = await gateway.storeVerifiedProof({ run: run(), session: session(), proof, proofPayload: { rawProofMarker: 'external-only' } });
    expect(receipt).toEqual(expect.objectContaining({ opaqueReference: 'vault://reclaim/60000000-0000-4000-8000-000000000001', artifactHash: proof.proofHash }));
  });

  test('rejects a custody receipt for a different artifact and requires HTTPS in production', async () => {
    const proof = readinessProof();
    expect(() => new HttpReclaimProofVault({ baseUrl: 'http://proof-vault.test', token: 'token', retentionPolicyId: 'policy', environment: 'production' }))
      .toThrow('RECLAIM_PROOF_VAULT_HTTPS_REQUIRED');
    const gateway = new HttpReclaimProofVault(
      { baseUrl: 'https://proof-vault.test', token: 'token', retentionPolicyId: 'policy', environment: 'production' },
      async () => Response.json({
        version: 'reclaim-proof-custody-receipt-v1', opaqueReference: 'vault://reclaim/60000000-0000-4000-8000-000000000002', artifactHash: hashCanonical('different-proof'),
        encryptionVersion: 'aes-256-gcm+hkdf-sha256+wrapped-dek-v1', retentionPolicyId: 'policy', storedAt: proof.verifiedAt,
      })
    );
    expect(gateway.storeVerifiedProof({ run: run(), session: session(), proof, proofPayload: {} })).rejects.toThrow('RECLAIM_PROOF_VAULT_HASH_MISMATCH');
  });
});

function run() {
  return createFacturaEAgentRun({
    runId: '60000000-0000-4000-8000-000000000001', workspaceId: 'workspace-vault', issuancePath: 'reclaim_copilot',
    actorId: 'agent:tax', occurredAt: '2026-07-11T12:00:00.000Z', idempotencyKey: 'vault-run-create',
  }).run;
}

function session(): ReclaimSessionReferenceV1 {
  return {
    sessionId: 'vault-session', purpose: 'arca_taxpayer_readiness', providerId: 'provider-readiness', providerVersion: '1.0.0',
    contextHash: hashCanonical('context'), subjectId: null, subjectHash: null, requestedAt: '2026-07-11T12:00:00.000Z',
    expiresAt: '2026-07-11T12:10:00.000Z', state: 'pending',
  };
}

function readinessProof(): VerifiedReclaimProofV1 {
  return {
    proofHash: hashCanonical('proof-1'), sessionId: 'vault-session', purpose: 'arca_taxpayer_readiness', providerId: 'provider-readiness', providerVersion: '1.0.0',
    verifiedAt: '2026-07-11T12:01:00.000Z', attestation: { teeRequired: false, teeVerified: false }, custodyReceipt: null,
    claims: { regime: 'monotributo', category: 'H', exportActivityEnabled: true, exportPointOfSaleActive: true, exportPointOfSale: 4 },
  };
}
