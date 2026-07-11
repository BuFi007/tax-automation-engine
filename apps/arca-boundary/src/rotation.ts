import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';

import { hashCanonical } from '@tax-engine/core';
import { Database } from 'bun:sqlite';

import { deriveDomainKey, openJson, sealJson } from './crypto';
import { issuerAad, payloadAad } from './store';

export function rotateBoundaryMasterKey(input: Readonly<{
  databasePath: string;
  oldMasterKey: Buffer;
  newMasterKey: Buffer;
  occurredAt: string;
  dryRun: boolean;
}>): Readonly<{ payloadsValidated: number; issuersValidated: number; rotated: boolean }> {
  if (input.oldMasterKey.length !== 32 || input.newMasterKey.length !== 32) throw new Error('ARCA_BOUNDARY_MASTER_KEY_INVALID');
  if (input.oldMasterKey.equals(input.newMasterKey)) throw new Error('ARCA_BOUNDARY_ROTATION_KEY_UNCHANGED');
  if (!existsSync(input.databasePath)) throw new Error('ARCA_BOUNDARY_DATABASE_NOT_FOUND');
  const database = new Database(input.databasePath, { create: true });
  const oldPayloadKey = deriveDomainKey(input.oldMasterKey, 'authority-payloads');
  const newPayloadKey = deriveDomainKey(input.newMasterKey, 'authority-payloads');
  const oldIssuerKey = deriveDomainKey(input.oldMasterKey, 'issuer-credentials');
  const newIssuerKey = deriveDomainKey(input.newMasterKey, 'issuer-credentials');
  let committed = false;
  try {
    database.exec('PRAGMA secure_delete = ON');
    database.exec('BEGIN EXCLUSIVE');
    const payloads = database.query<{ reference: string; payload_hash: string; encrypted_payload: string }, []>(
      'SELECT reference, payload_hash, encrypted_payload FROM authority_payloads'
    ).all();
    const issuers = database.query<{ issuer_profile_ref: string; environment: string; certificate_fingerprint: string; encrypted_bundle: string }, []>(
      'SELECT issuer_profile_ref, environment, certificate_fingerprint, encrypted_bundle FROM issuer_credentials'
    ).all();
    const rotatedPayloads = payloads.map(row => {
      const aad = payloadAad(row.reference, row.payload_hash);
      const value = openJson(oldPayloadKey, aad, row.encrypted_payload);
      return { reference: row.reference, encrypted: sealJson(newPayloadKey, aad, value) };
    });
    const rotatedIssuers = issuers.map(row => {
      if (row.environment !== 'homologation' && row.environment !== 'production') throw new Error('WSAA_ISSUER_ENVIRONMENT_INVALID');
      const aad = issuerAad(row.issuer_profile_ref, row.environment, row.certificate_fingerprint);
      const value = openJson(oldIssuerKey, aad, row.encrypted_bundle);
      return { issuerProfileRef: row.issuer_profile_ref, encrypted: sealJson(newIssuerKey, aad, value) };
    });
    if (input.dryRun) {
      database.exec('ROLLBACK');
      return { payloadsValidated: payloads.length, issuersValidated: issuers.length, rotated: false };
    }
    const updatePayload = database.query('UPDATE authority_payloads SET encrypted_payload = ? WHERE reference = ?');
    for (const row of rotatedPayloads) updatePayload.run(row.encrypted, row.reference);
    const updateIssuer = database.query('UPDATE issuer_credentials SET encrypted_bundle = ? WHERE issuer_profile_ref = ?');
    for (const row of rotatedIssuers) updateIssuer.run(row.encrypted, row.issuerProfileRef);
    database.query('INSERT INTO boundary_events (event_id, action, subject_hash, artifact_hash, occurred_at) VALUES (?, ?, ?, ?, ?)').run(
      randomUUID(), 'boundary_master_key_rotated', hashCanonical('arca-boundary-master-key'),
      hashCanonical({ payloadCount: payloads.length, issuerCount: issuers.length, occurredAt: input.occurredAt }), input.occurredAt
    );
    database.exec('COMMIT');
    committed = true;
    database.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    return { payloadsValidated: payloads.length, issuersValidated: issuers.length, rotated: true };
  } catch (error) {
    if (!committed) try { database.exec('ROLLBACK'); } catch {}
    throw error;
  } finally {
    database.close();
  }
}
