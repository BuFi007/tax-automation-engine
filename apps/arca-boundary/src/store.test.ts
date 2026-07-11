import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { hashCanonical } from '@tax-engine/core';

import { ArcaBoundaryStore } from './store';
import { authorityPayload, certificateBundle, CUIT, NOW } from './test-fixtures';
import { validateIssuerCredential } from './wsaa';

const temporaryDirectories: string[] = [];
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('encrypted ARCA boundary storage', () => {
  test('stores only ciphertext and makes payload creation idempotent', () => {
    const { store, path } = persistentStore();
    const payload = authorityPayload();
    const input = { workspaceId: 'workspace-1', payload, expiresAt: '2026-07-12T12:00:00.000Z', idempotencyKey: 'store-payload-1', occurredAt: NOW.toISOString() };
    const first = store.storePayload(input);
    const replay = store.storePayload(input);
    expect(replay).toEqual(first);
    expect(first.reference).toMatch(/^vault:\/\/wsfex\//);
    expect(store.resolvePayload(first.reference, NOW.toISOString())).toEqual({ payload, payloadHash: hashCanonical(payload) });
    expect(() => store.storePayload({ ...input, payload: authorityPayload({ total: '1', items: [{ ...payload.items[0]!, total: '1' }] }) }))
      .toThrow('AUTHORITY_PAYLOAD_IDEMPOTENCY_CONFLICT');

    const databaseBytes = databaseFiles(path);
    expect(databaseBytes).not.toContain('FOREIGN-TAX-SECRET');
    expect(databaseBytes).not.toContain('Sensitive Foreign Customer');
    expect(databaseBytes).not.toContain('Secret address 123');
  });

  test('enforces payload expiry, workspace-bound revocation, and authenticated encryption', () => {
    const { store } = persistentStore();
    const receipt = store.storePayload({
      workspaceId: 'workspace-1', payload: authorityPayload(), expiresAt: '2026-07-11T12:01:00.000Z', idempotencyKey: 'payload-expiry', occurredAt: NOW.toISOString(),
    });
    expect(() => store.resolvePayload(receipt.reference, '2026-07-11T12:01:00.000Z')).toThrow('AUTHORITY_PAYLOAD_EXPIRED');
    expect(() => store.revokePayload('wrong-workspace', receipt.reference, NOW.toISOString())).toThrow('AUTHORITY_PAYLOAD_NOT_FOUND');
    store.revokePayload('workspace-1', receipt.reference, NOW.toISOString());
    expect(() => store.resolvePayload(receipt.reference, NOW.toISOString())).toThrow('AUTHORITY_PAYLOAD_NOT_FOUND');
  });

  test('encrypts issuer keys and requires an explicit fingerprint for rotation', () => {
    const { store, path } = persistentStore();
    const bundle = certificateBundle();
    const validated = validateIssuerCredential({
      workspaceId: 'workspace-1', issuerProfileRef: 'issuer://workspace-1/primary', environment: 'homologation', representedCuit: CUIT,
      ...bundle, delegationConfirmed: true,
    }, NOW);
    const receipt = store.provisionIssuer({ ...validated, replaceCertificateFingerprint: null, occurredAt: NOW.toISOString() });
    const credential = store.getIssuer('workspace-1', receipt.issuerProfileRef, 'homologation');
    expect(credential).toEqual(expect.objectContaining({ representedCuit: CUIT, certificateFingerprint: receipt.certificateFingerprint, delegationConfirmed: true }));
    expect(() => store.getIssuer('workspace-2', receipt.issuerProfileRef, 'homologation')).toThrow('WSAA_ISSUER_NOT_FOUND');

    const rotated = validateIssuerCredential({
      workspaceId: 'workspace-1', issuerProfileRef: receipt.issuerProfileRef, environment: 'homologation', representedCuit: CUIT,
      ...certificateBundle(), delegationConfirmed: true,
    }, NOW);
    expect(() => store.provisionIssuer({ ...rotated, replaceCertificateFingerprint: null, occurredAt: NOW.toISOString() }))
      .toThrow('WSAA_ISSUER_ROTATION_PRECONDITION_FAILED');
    const rotatedReceipt = store.provisionIssuer({ ...rotated, replaceCertificateFingerprint: receipt.certificateFingerprint, occurredAt: NOW.toISOString() });
    expect(rotatedReceipt.certificateFingerprint).not.toBe(receipt.certificateFingerprint);

    const databaseBytes = databaseFiles(path);
    expect(databaseBytes).not.toContain('PRIVATE KEY');
    expect(databaseBytes).not.toContain(CUIT);
  });
});

function persistentStore() {
  const directory = mkdtempSync(join(tmpdir(), 'arca-boundary-test-'));
  temporaryDirectories.push(directory);
  const path = join(directory, 'boundary.sqlite');
  return { store: new ArcaBoundaryStore(Buffer.alloc(32, 9), path), path };
}

function databaseFiles(path: string): string {
  const directory = path.slice(0, path.lastIndexOf('/'));
  return readdirSync(directory).map(file => readFileSync(join(directory, file)).toString('utf8')).join('');
}
