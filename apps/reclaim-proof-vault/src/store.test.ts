import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { hashCanonical } from '@tax-engine/core';

import type { CustodyRequest, RetentionPolicyRequest } from './contracts';
import { ReclaimProofStore } from './store';

const stores: ReclaimProofStore[] = [];
const paths: string[] = [];
afterEach(() => { stores.splice(0).forEach((store) => store.close()); paths.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })); });

describe('encrypted Reclaim proof custody', () => {
  test('independently verifies the proof hash and never persists raw proof JSON', () => {
    const { store, databasePath } = setup();
    store.putPolicy(policy(), NOW);
    const input = request();
    const receipt = store.store(input, NOW);
    expect(receipt.artifactHash).toBe(input.proofHash);
    expect(() => store.resolve('another-workspace', receipt.opaqueReference, minute(1))).toThrow('RECLAIM_PROOF_NOT_FOUND');
    expect(store.resolve(input.workspaceId, receipt.opaqueReference, minute(1)).proofPayload).toEqual(input.proofPayload);
    store.close(); stores.splice(stores.indexOf(store), 1);
    const databaseBytes = readFileSync(databasePath).toString('utf8');
    expect(databaseBytes).not.toContain('raw-secret-marker');
    expect(() => storeForKey(Buffer.alloc(32, 9), databasePath).resolve(input.workspaceId, receipt.opaqueReference, minute(1))).toThrow('ARCA_BOUNDARY_CIPHERTEXT_AUTHENTICATION_FAILED');
  });

  test('rejects hash substitution and binds one immutable artifact to a session', () => {
    const { store } = setup(); store.putPolicy(policy(), NOW);
    const input = request();
    expect(() => store.store({ ...input, proofHash: hashCanonical('wrong') }, NOW)).toThrow('RECLAIM_PROOF_HASH_MISMATCH');
    const first = store.store(input, NOW);
    expect(store.store(input, minute(1))).toEqual(first);
    const changedPayload = [{ raw: 'different' }];
    expect(() => store.store({ ...input, proofPayload: changedPayload, proofHash: hashCanonical(changedPayload) }, minute(1)))
      .toThrow('RECLAIM_PROOF_SESSION_CONFLICT');
  });

  test('normalizes encoded callbacks identically and requires a policy-hash precondition for changes', () => {
    const { store } = setup();
    const first = store.putPolicy(policy(), NOW);
    expect(store.putPolicy(policy(), minute(1))).toEqual(first);
    expect(() => store.putPolicy(policy({ retentionDays: 60 }), minute(1))).toThrow('RETENTION_POLICY_PRECONDITION_FAILED');
    const updated = store.putPolicy(policy({ retentionDays: 60, replacePolicyHash: first.policyHash }), minute(1));
    expect(updated.policyHash).not.toBe(first.policyHash);
    const proofPayload = [{ raw: 'encoded-proof' }];
    const encoded = encodeURIComponent(JSON.stringify(proofPayload));
    expect(store.store(request({ sessionId: 'encoded-session', proofPayload: encoded, proofHash: hashCanonical(proofPayload) }), minute(2)).artifactHash)
      .toBe(hashCanonical(proofPayload));
  });

  test('enforces policy purpose and makes erased or expired evidence undecryptable', () => {
    const { store } = setup(); store.putPolicy(policy({ retentionDays: 1 }), NOW);
    expect(() => store.store({ ...request(), purpose: 'arca_cae_constatement' }, NOW)).toThrow('RETENTION_POLICY_PURPOSE_NOT_ALLOWED');
    const receipt = store.store(request(), NOW);
    expect(() => store.erase('another-workspace', receipt.opaqueReference, minute(1), 'user_request')).toThrow('RECLAIM_PROOF_NOT_FOUND');
    store.erase('workspace-1', receipt.opaqueReference, minute(1), 'user_request');
    expect(() => store.resolve('workspace-1', receipt.opaqueReference, minute(2))).toThrow('RECLAIM_PROOF_NOT_FOUND');
    const second = store.store(request({ sessionId: 'session-2' }), NOW);
    expect(() => store.resolve('workspace-1', second.opaqueReference, '2026-07-13T00:00:00.000Z')).toThrow('RECLAIM_PROOF_EXPIRED');
    expect(() => store.resolve('workspace-1', second.opaqueReference, '2026-07-13T00:01:00.000Z')).toThrow('RECLAIM_PROOF_NOT_FOUND');
  });
});

const NOW = '2026-07-11T12:00:00.000Z';
function minute(value: number): string { return new Date(Date.parse(NOW) + value * 60_000).toISOString(); }
function policy(overrides: Partial<RetentionPolicyRequest> = {}): RetentionPolicyRequest {
  return { version: 'reclaim-retention-policy-v1', policyId: 'tax-evidence-v1', policyVersion: '1', retentionDays: 30,
    allowedPurposes: ['arca_taxpayer_readiness'], deletionMode: 'crypto_erasure', replacePolicyHash: null, ...overrides };
}
function request(overrides: Partial<CustodyRequest> = {}): CustodyRequest {
  const proofPayload = [{ raw: 'raw-secret-marker', claim: 'ready' }];
  return { version: 'reclaim-proof-custody-request-v1', runId: '60000000-0000-4000-8000-000000000001', workspaceId: 'workspace-1',
    sessionId: 'session-1', purpose: 'arca_taxpayer_readiness', providerId: 'provider-1', providerVersion: '1.0.0',
    proofHash: hashCanonical(proofPayload), retentionPolicyId: 'tax-evidence-v1', verifiedAt: minute(0), proofPayload, ...overrides };
}
function setup() { const directory = mkdtempSync(join(tmpdir(), 'proof-vault-')); paths.push(directory); const databasePath = join(directory, 'vault.sqlite'); return { store: storeForKey(Buffer.alloc(32, 7), databasePath), databasePath }; }
function storeForKey(key: Buffer, path: string) { const store = new ReclaimProofStore(key, path); stores.push(store); return store; }
