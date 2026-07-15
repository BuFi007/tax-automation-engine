import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { AnyAuthorityPayload } from './contracts';
import { rotateBoundaryMasterKey } from './rotation';
import { ArcaBoundaryStore } from './store';
import { authorityPayload, certificateBundle, CUIT, NOW } from './test-fixtures';
import { validateIssuerCredential } from './wsaa';

function wsfexForeignTaxId(payload: AnyAuthorityPayload): string | null {
  if (payload.version !== 'wsfex-authority-payload-v1') throw new Error('EXPECTED_WSFEX_PAYLOAD');
  return payload.customer.foreignTaxId;
}

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('ARCA boundary master-key rotation', () => {
  test('validates in dry-run mode and atomically re-encrypts both security domains', () => {
    const directory = mkdtempSync(join(tmpdir(), 'arca-rotation-test-'));
    directories.push(directory);
    const databasePath = join(directory, 'boundary.sqlite');
    const oldKey = Buffer.alloc(32, 1);
    const newKey = Buffer.alloc(32, 2);
    const commitmentKey = Buffer.alloc(32, 3);
    const oldStore = new ArcaBoundaryStore(oldKey, databasePath, commitmentKey);
    const payloadReceipt = oldStore.storePayload({
      workspaceId: 'workspace-1', payload: authorityPayload(), expiresAt: '2026-07-12T12:00:00.000Z', idempotencyKey: 'rotation-payload-1', occurredAt: NOW.toISOString(),
    });
    const issuer = validateIssuerCredential({
      workspaceId: 'workspace-1', issuerProfileRef: 'issuer://workspace-1/primary', environment: 'homologation', certificateHolderCuit: CUIT, representedCuit: CUIT,
      ...certificateBundle(), delegationConfirmed: true,
    }, NOW);
    oldStore.provisionIssuer({ ...issuer, replaceCertificateFingerprint: null, occurredAt: NOW.toISOString() });
    oldStore.close();

    expect(rotateBoundaryMasterKey({ databasePath, oldMasterKey: oldKey, newMasterKey: newKey, occurredAt: NOW.toISOString(), dryRun: true }))
      .toEqual({ payloadsValidated: 1, issuersValidated: 1, rotated: false });
    const afterDryRun = new ArcaBoundaryStore(oldKey, databasePath, commitmentKey);
    expect(wsfexForeignTaxId(afterDryRun.resolvePayload(payloadReceipt.reference, NOW.toISOString()).payload)).toBe('FOREIGN-TAX-SECRET');
    afterDryRun.close();

    expect(rotateBoundaryMasterKey({ databasePath, oldMasterKey: oldKey, newMasterKey: newKey, occurredAt: NOW.toISOString(), dryRun: false }))
      .toEqual({ payloadsValidated: 1, issuersValidated: 1, rotated: true });
    const rotatedStore = new ArcaBoundaryStore(newKey, databasePath, commitmentKey);
    expect(wsfexForeignTaxId(rotatedStore.resolvePayload(payloadReceipt.reference, NOW.toISOString()).payload)).toBe('FOREIGN-TAX-SECRET');
    expect(rotatedStore.getIssuer('workspace-1', 'issuer://workspace-1/primary', 'homologation').representedCuit).toBe(CUIT);
    rotatedStore.close();

    const staleStore = new ArcaBoundaryStore(oldKey, databasePath, commitmentKey);
    expect(() => staleStore.resolvePayload(payloadReceipt.reference, NOW.toISOString())).toThrow('ARCA_BOUNDARY_CIPHERTEXT_AUTHENTICATION_FAILED');
    staleStore.close();
  });

  test('refuses a no-op key rotation', () => {
    const key = Buffer.alloc(32, 1);
    expect(() => rotateBoundaryMasterKey({ databasePath: '/does/not/matter', oldMasterKey: key, newMasterKey: key, occurredAt: NOW.toISOString(), dryRun: true }))
      .toThrow('ARCA_BOUNDARY_ROTATION_KEY_UNCHANGED');
  });
});
