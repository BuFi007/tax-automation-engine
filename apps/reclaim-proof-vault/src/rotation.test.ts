import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { hashCanonical } from '@tax-engine/core';

import { rotateProofVaultMasterKey } from './rotation';
import { ReclaimProofStore } from './store';

let directory = '';
afterEach(() => rmSync(directory, { recursive: true, force: true }));
describe('offline proof-vault key rotation', () => {
  test('validates in dry-run then atomically rewraps active data keys', () => {
    directory = mkdtempSync(join(tmpdir(), 'proof-rotation-')); const path = join(directory, 'vault.sqlite');
    const oldKey = Buffer.alloc(32, 1); const newKey = Buffer.alloc(32, 2); const proofPayload = [{ proof: 'secret' }];
    const oldStore = new ReclaimProofStore(oldKey, path);
    oldStore.putPolicy({ version: 'reclaim-retention-policy-v1', policyId: 'policy-1', policyVersion: '1', retentionDays: 30, allowedPurposes: ['arca_taxpayer_readiness'], deletionMode: 'crypto_erasure', replacePolicyHash: null }, NOW);
    const receipt = oldStore.store({ version: 'reclaim-proof-custody-request-v1', runId: '60000000-0000-4000-8000-000000000001', workspaceId: 'workspace', sessionId: 'session', purpose: 'arca_taxpayer_readiness', providerId: 'provider', providerVersion: '1', proofHash: hashCanonical(proofPayload), retentionPolicyId: 'policy-1', verifiedAt: NOW, proofPayload }, NOW);
    oldStore.close();
    expect(rotateProofVaultMasterKey({ databasePath: path, oldMasterKey: oldKey, newMasterKey: newKey, occurredAt: NOW, dryRun: true })).toEqual({ proofsValidated: 1, rotated: false });
    const afterDryRun = new ReclaimProofStore(oldKey, path);
    expect(afterDryRun.resolve('workspace', receipt.opaqueReference, NOW).proofPayload).toEqual(proofPayload);
    afterDryRun.close();
    expect(rotateProofVaultMasterKey({ databasePath: path, oldMasterKey: oldKey, newMasterKey: newKey, occurredAt: NOW, dryRun: false })).toEqual({ proofsValidated: 1, rotated: true });
    const staleStore = new ReclaimProofStore(oldKey, path);
    expect(() => staleStore.resolve('workspace', receipt.opaqueReference, NOW)).toThrow('ARCA_BOUNDARY_CIPHERTEXT_AUTHENTICATION_FAILED');
    staleStore.close();
    const rotatedStore = new ReclaimProofStore(newKey, path);
    expect(rotatedStore.resolve('workspace', receipt.opaqueReference, NOW).proofPayload).toEqual(proofPayload);
    rotatedStore.close();
  });
});
const NOW = '2026-07-11T12:00:00.000Z';
