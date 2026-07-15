import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { hashCanonical } from '@tax-engine/core';
import { Database } from 'bun:sqlite';

import { deriveDomainKey, openJson, sealJson } from './crypto';
import { ArcaBoundaryStore, issuerAad, PAYLOAD_DOMAIN, payloadAad } from './store';
import { authorityPayload, certificateBundle, CUIT, NOW, wsfeAuthorityPayload, WSFE_RECEPTOR_CUIT } from './test-fixtures';
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

  test('round-trips a domestic WSFE payload under a domain-separated reference without leaking receptor PII', () => {
    const { store, path } = persistentStore();
    const payload = wsfeAuthorityPayload();
    const receipt = store.storePayload({ workspaceId: 'workspace-1', payload, expiresAt: '2026-07-12T12:00:00.000Z', idempotencyKey: 'wsfe-payload-1', occurredAt: NOW.toISOString() });
    expect(receipt.reference).toMatch(/^vault:\/\/wsfe\//);
    expect(store.resolvePayload(receipt.reference, NOW.toISOString())).toEqual({ payload, payloadHash: hashCanonical(payload) });

    const databaseBytes = databaseFiles(path);
    expect(databaseBytes).not.toContain(WSFE_RECEPTOR_CUIT);
    expect(databaseBytes).not.toContain('Sensitive Domestic Client');
  });

  test('keeps WSFEX and WSFE payloads in separate reference namespaces and crypto domains', () => {
    const { store } = persistentStore();
    const wsfexReceipt = store.storePayload({ workspaceId: 'workspace-1', payload: authorityPayload(), expiresAt: '2026-07-12T12:00:00.000Z', idempotencyKey: 'coexist-wsfex', occurredAt: NOW.toISOString() });
    const wsfeReceipt = store.storePayload({ workspaceId: 'workspace-1', payload: wsfeAuthorityPayload(), expiresAt: '2026-07-12T12:00:00.000Z', idempotencyKey: 'coexist-wsfe', occurredAt: NOW.toISOString() });
    expect(wsfexReceipt.reference).toMatch(/^vault:\/\/wsfex\//);
    expect(wsfeReceipt.reference).toMatch(/^vault:\/\/wsfe\//);
    expect(store.resolvePayload(wsfexReceipt.reference, NOW.toISOString()).payload.version).toBe('wsfex-authority-payload-v1');
    expect(store.resolvePayload(wsfeReceipt.reference, NOW.toISOString()).payload.version).toBe('wsfe-authority-payload-v1');

    // A ciphertext sealed under one family's key cannot be opened under the other's.
    const masterKey = Buffer.alloc(32, 7);
    const wsfeKey = deriveDomainKey(masterKey, PAYLOAD_DOMAIN.wsfe);
    const wsfexKey = deriveDomainKey(masterKey, PAYLOAD_DOMAIN.wsfex);
    expect(wsfeKey.equals(wsfexKey)).toBe(false);
    const aad = payloadAad('vault://wsfe/00000000-0000-4000-8000-000000000001', hashCanonical('domestic'));
    const sealed = sealJson(wsfeKey, aad, { secret: 'domestic' });
    expect(openJson(wsfeKey, aad, sealed)).toEqual({ secret: 'domestic' });
    expect(() => openJson(wsfexKey, aad, sealed)).toThrow('ARCA_BOUNDARY_CIPHERTEXT_AUTHENTICATION_FAILED');
  });

  test('fails closed on an unknown payload schema version', () => {
    const { store } = persistentStore();
    const unknown = { ...wsfeAuthorityPayload(), version: 'wsfe-authority-payload-v99' };
    expect(() => store.storePayload({ workspaceId: 'workspace-1', payload: unknown as never, expiresAt: '2026-07-12T12:00:00.000Z', idempotencyKey: 'unknown-schema', occurredAt: NOW.toISOString() }))
      .toThrow();
  });

  test('retains unresolved recovery payloads past nominal expiry and retires only after terminal policy', () => {
    const { store } = persistentStore();
    const input = {
      workspaceId: 'workspace-1', payload: authorityPayload(), expiresAt: '2026-07-11T12:01:00.000Z', idempotencyKey: 'payload-expiry', occurredAt: NOW.toISOString(),
    };
    const receipt = store.storePayload({
      ...input,
    });
    expect(store.resolvePayload(receipt.reference, '2026-07-20T12:01:00.000Z').payloadHash)
      .toBe(receipt.payloadHash);
    expect(() => store.revokePayload('wrong-workspace', receipt.reference, NOW.toISOString())).toThrow('AUTHORITY_PAYLOAD_NOT_FOUND');
    expect(() => store.revokePayload('workspace-1', receipt.reference, NOW.toISOString()))
      .toThrow('AUTHORITY_PAYLOAD_UNRESOLVED_REVOCATION_FORBIDDEN');
    const terminalInput = {
      version: 'authority-payload-terminal-v1',
      workspaceId: 'workspace-1',
      reference: receipt.reference,
      payloadHash: receipt.payloadHash,
      terminalState: 'officially_reconciled',
      authorityIdentityHash: 'a'.repeat(64),
      terminalEvidenceHash: 'b'.repeat(64),
    } as const;
    const terminal = store.markPayloadTerminal(terminalInput, {
      retentionPolicyId: 'test-terminal-retention-v1',
      terminalRetentionMs: 24 * 60 * 60_000,
    }, '2026-07-20T12:02:00.000Z');
    expect(terminal.retireAfter).toBe('2026-07-21T12:02:00.000Z');
    expect(store.markPayloadTerminal({ ...terminalInput, terminalEvidenceHash: 'c'.repeat(64) }, {
      retentionPolicyId: 'new-policy-for-new-payloads-v2',
      terminalRetentionMs: 48 * 60 * 60_000,
    }, '2026-07-20T13:02:00.000Z')).toEqual(terminal);
    expect(() => store.markPayloadTerminal({ ...terminalInput, authorityIdentityHash: 'd'.repeat(64) }, {
      retentionPolicyId: 'test-terminal-retention-v1', terminalRetentionMs: 24 * 60 * 60_000,
    }, '2026-07-20T13:02:00.000Z')).toThrow('AUTHORITY_PAYLOAD_TERMINAL_CONFLICT');
    expect(store.resolvePayload(receipt.reference, '2026-07-21T12:01:59.000Z').payloadHash)
      .toBe(receipt.payloadHash);
    expect(() => store.revokePayload('workspace-1', receipt.reference, '2026-07-21T12:01:59.000Z'))
      .toThrow('AUTHORITY_PAYLOAD_RETENTION_POLICY_ACTIVE');
    expect(store.retireEligiblePayloads('test-terminal-retention-v1', terminal.retireAfter)).toBe(1);
    expect(() => store.resolvePayload(receipt.reference, terminal.retireAfter))
      .toThrow('AUTHORITY_PAYLOAD_NOT_FOUND');
    expect(store.storePayload(input)).toEqual(receipt);
  });

  test('encrypts issuer keys and requires an explicit fingerprint for rotation', () => {
    const { store, path } = persistentStore();
    const bundle = certificateBundle();
    const validated = validateIssuerCredential({
      workspaceId: 'workspace-1', issuerProfileRef: 'issuer://workspace-1/primary', environment: 'homologation', certificateHolderCuit: CUIT, representedCuit: '20999999999',
      ...bundle, delegationConfirmed: true,
    }, NOW);
    const receipt = store.provisionIssuer({ ...validated, replaceCertificateFingerprint: null, occurredAt: NOW.toISOString() });
    const credential = store.getIssuer('workspace-1', receipt.issuerProfileRef, 'homologation');
    expect(credential).toEqual(expect.objectContaining({ certificateHolderCuit: CUIT, representedCuit: '20999999999', certificateFingerprint: receipt.certificateFingerprint, delegationConfirmed: true }));
    expect(() => store.getIssuer('workspace-2', receipt.issuerProfileRef, 'homologation')).toThrow('WSAA_ISSUER_NOT_FOUND');

    const rotated = validateIssuerCredential({
      workspaceId: 'workspace-1', issuerProfileRef: receipt.issuerProfileRef, environment: 'homologation', certificateHolderCuit: CUIT, representedCuit: '20999999999',
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

  test('fails closed on a migrated issuer row without a represented-CUIT commitment', () => {
    const directory = mkdtempSync(join(tmpdir(), 'arca-boundary-legacy-issuer-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'boundary.sqlite');
    const masterKey = Buffer.alloc(32, 14);
    const validated = validateIssuerCredential({
      workspaceId: 'workspace-legacy', issuerProfileRef: 'issuer://workspace-legacy/primary', environment: 'homologation',
      certificateHolderCuit: CUIT, representedCuit: CUIT, ...certificateBundle(), delegationConfirmed: true,
    }, NOW);
    const legacy = new Database(path, { create: true });
    legacy.exec(`
      CREATE TABLE issuer_credentials (
        issuer_profile_ref TEXT PRIMARY KEY,
        workspace_id_hash TEXT NOT NULL,
        environment TEXT NOT NULL,
        represented_cuit_hash TEXT NOT NULL,
        certificate_fingerprint TEXT NOT NULL,
        credential_bundle_hash TEXT NOT NULL,
        encrypted_bundle TEXT NOT NULL,
        delegation_confirmed INTEGER NOT NULL,
        active INTEGER NOT NULL,
        stored_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    const encrypted = sealJson(
      deriveDomainKey(masterKey, 'issuer-credentials'),
      issuerAad(validated.credential.issuerProfileRef, validated.credential.environment, validated.credential.certificateFingerprint),
      validated.credential
    );
    legacy.query(`
      INSERT INTO issuer_credentials (
        issuer_profile_ref, workspace_id_hash, environment, represented_cuit_hash,
        certificate_fingerprint, credential_bundle_hash, encrypted_bundle,
        delegation_confirmed, active, stored_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?)
    `).run(
      validated.credential.issuerProfileRef,
      hashCanonical(validated.credential.workspaceId),
      validated.credential.environment,
      hashCanonical(validated.credential.representedCuit),
      validated.credential.certificateFingerprint,
      validated.credentialBundleHash,
      encrypted,
      NOW.toISOString(),
      NOW.toISOString()
    );
    legacy.close();

    const store = new ArcaBoundaryStore(masterKey, path, Buffer.alloc(32, 15));
    expect(() => store.getIssuer('workspace-legacy', validated.credential.issuerProfileRef, 'homologation'))
      .toThrow('WSAA_ISSUER_REPRESENTED_CUIT_UNBOUND');
    store.close();
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
