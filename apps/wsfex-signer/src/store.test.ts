import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, test } from 'bun:test';

import { hashCanonical } from '@tax-engine/core';

import type { SignerResponse } from './contracts';
import { identityFor, SignerAttemptStore } from './store';
import { request } from './test-fixtures';

const occurredAt = '2026-07-11T12:00:00.000Z';

describe('WSFEX signer attempt store', () => {
  test('keys the numeric ARCA request ID by environment and represented CUIT while retaining workspace/profile as bindings', () => {
    const store = new SignerAttemptStore(':memory:');
    try {
      const representedA = 'a'.repeat(64);
      const representedB = 'b'.repeat(64);
      const first = begin(store, request(), 'vault://issuer/profile-1', representedA);
      const sameAuthorityScope = begin(
        store,
        request({ workspaceId: 'workspace-2', subjectId: 'invoice-2' }),
        'vault://issuer/profile-2',
        representedA
      );
      begin(store, request(), 'vault://issuer/profile-1', representedB);
      begin(
        store,
        request({ environment: 'production' }),
        'vault://issuer/profile-1',
        representedA
      );

      expect(sameAuthorityScope.workspaceIdHash).toBe(first.workspaceIdHash);
      expect(sameAuthorityScope.issuerProfileReferenceHash)
        .toBe(hashCanonical('vault://issuer/profile-1'));
      const sameScopeDifferentSubject = begin(
        store,
        request({ subjectId: 'invoice-2' }),
        'vault://issuer/profile-1',
        representedA
      );
      expect(sameScopeDifferentSubject.subjectIdHash).toBe(hashCanonical('invoice-1'));

      const firstIdentity = identityFor(request(), representedA);
      store.complete(firstIdentity, ambiguousResponse(), '2026-07-11T12:01:00.000Z');
      expect(store.get(firstIdentity)?.state).toBe('ambiguous');
      expect(store.get(identityFor(request(), representedB))?.state).toBe('pending');
      expect(store.get(identityFor(request({ environment: 'production' }), representedA))?.state).toBe('pending');
    } finally {
      store.close();
    }
  });

  test('atomically upgrades an empty global-request-id table to the scoped primary key', () => {
    withDatabasePath(databasePath => {
      createLegacyDatabase(databasePath, false);
      const store = new SignerAttemptStore(databasePath);
      store.close();

      const verified = new Database(databasePath);
      try {
        const primaryKey = verified.query<{ name: string; pk: number }, []>('PRAGMA table_info(wsfex_attempts)')
          .all()
          .filter(column => column.pk > 0)
          .sort((left, right) => left.pk - right.pk)
          .map(column => column.name);
        expect(primaryKey).toEqual([
          'environment',
          'represented_cuit_commitment',
          'request_id',
        ]);
        expect(verified.query<{ user_version: number }, []>('PRAGMA user_version').get()?.user_version).toBe(3);
      } finally {
        verified.close();
      }
    });
  });

  test('fails closed and preserves populated legacy rows that cannot be assigned a tenant scope', () => {
    withDatabasePath(databasePath => {
      createLegacyDatabase(databasePath, true);
      expect(() => new SignerAttemptStore(databasePath)).toThrow('WSFEX_LEGACY_ATTEMPT_RECONCILIATION_REQUIRED');

      const verified = new Database(databasePath);
      try {
        const primaryKey = verified.query<{ name: string; pk: number }, []>('PRAGMA table_info(wsfex_attempts)')
          .all()
          .filter(column => column.pk > 0)
          .map(column => column.name);
        expect(primaryKey).toEqual(['request_id']);
        expect(verified.query<{ count: number }, []>('SELECT COUNT(*) AS count FROM wsfex_attempts').get()?.count).toBe(1);
      } finally {
        verified.close();
      }
    });
  });

  test('serializes authority sequence allocation per environment and represented CUIT with stale reclaim', () => {
    const store = new SignerAttemptStore(':memory:');
    try {
      const identity = identityFor(request(), 'a'.repeat(64));
      const first = store.acquireAuthoritySequenceLease(
        identity,
        new Date('2026-07-11T12:00:00.000Z'),
        30_000
      );
      expect(() => store.acquireAuthoritySequenceLease(
        identity,
        new Date('2026-07-11T12:00:29.999Z'),
        30_000
      )).toThrow('WSFEX_AUTHORITY_SEQUENCE_BUSY');
      const reclaimed = store.acquireAuthoritySequenceLease(
        identity,
        new Date('2026-07-11T12:00:30.000Z'),
        30_000
      );
      expect(reclaimed).not.toBe(first);
      store.releaseAuthoritySequenceLease(identity, first);
      expect(() => store.acquireAuthoritySequenceLease(
        identity,
        new Date('2026-07-11T12:00:30.001Z'),
        30_000
      )).toThrow('WSFEX_AUTHORITY_SEQUENCE_BUSY');
      store.releaseAuthoritySequenceLease(identity, reclaimed);
    } finally {
      store.close();
    }
  });

  test('never lets a stale ambiguous worker downgrade accepted authority evidence', () => {
    const store = new SignerAttemptStore(':memory:');
    try {
      const signerRequest = request();
      const represented = 'a'.repeat(64);
      begin(store, signerRequest, 'vault://issuer/profile-1', represented);
      const identity = identityFor(signerRequest, represented);
      const accepted = acceptedResponse();
      expect(store.complete(identity, accepted, '2026-07-11T12:01:00.000Z').state)
        .toBe('accepted');
      const stale = store.complete(identity, ambiguousResponse(), '2026-07-11T12:02:00.000Z');
      expect(stale.state).toBe('accepted');
      expect(stale.response).toEqual(accepted);
    } finally {
      store.close();
    }
  });
});

function begin(
  store: SignerAttemptStore,
  signerRequest: ReturnType<typeof request>,
  issuerProfileRef: string,
  representedCuitCommitment: string
) {
  return store.begin({
    request: signerRequest,
    issuerProfileRef,
    representedCuitCommitment,
    payloadReferenceHash: hashCanonical(signerRequest.authorityPayloadRef),
    payloadHash: hashCanonical({ requestId: signerRequest.requestId, issuerProfileRef, subjectId: signerRequest.subjectId }),
    invoiceNumber: '6',
    occurredAt,
  });
}

function ambiguousResponse(): SignerResponse {
  return {
    requestId: '101',
    status: 'ambiguous',
    invoiceNumber: null,
    cae: null,
    caeExpiry: null,
    reprocessed: null,
    authorizedDocument: null,
    reconciliation: null,
    safeErrors: [{ code: 'WSFEX_TRANSPORT_AMBIGUOUS', message: 'Ambiguous.' }],
  };
}

function acceptedResponse(): SignerResponse {
  const signerRequest = request();
  return {
    requestId: signerRequest.requestId,
    status: 'accepted',
    invoiceNumber: '6',
    cae: '12345678901234',
    caeExpiry: '2026-07-21',
    reprocessed: false,
    authorizedDocument: {
      intentHash: signerRequest.intentHash,
      ...signerRequest.expected,
      currencyId: 'DOL',
      currencyQuote: '1200.25',
    },
    reconciliation: null,
    safeErrors: [],
  };
}

function withDatabasePath(run: (databasePath: string) => void): void {
  const directory = mkdtempSync(join(tmpdir(), 'wsfex-attempt-store-'));
  try {
    run(join(directory, 'attempts.sqlite'));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function createLegacyDatabase(databasePath: string, populated: boolean): void {
  const database = new Database(databasePath, { create: true });
  database.exec(`
    CREATE TABLE wsfex_attempts (
      request_id TEXT PRIMARY KEY,
      intent_hash TEXT NOT NULL,
      payload_reference_hash TEXT NOT NULL,
      payload_hash TEXT NOT NULL,
      document_type INTEGER NOT NULL,
      point_of_sale INTEGER NOT NULL,
      invoice_number TEXT NOT NULL,
      state TEXT NOT NULL,
      response_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  if (populated) {
    database.query(`
      INSERT INTO wsfex_attempts (
        request_id, intent_hash, payload_reference_hash, payload_hash, document_type, point_of_sale,
        invoice_number, state, response_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 19, 4, '6', 'ambiguous', NULL, ?, ?)
    `).run('101', hashCanonical('intent'), hashCanonical('payload-reference'), hashCanonical('payload'), occurredAt, occurredAt);
  }
  database.close();
}
