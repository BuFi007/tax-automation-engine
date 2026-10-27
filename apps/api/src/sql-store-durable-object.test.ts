import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { BunSqlDatabase } from '@tax-engine/sql-store/bun';
import { DurableObjectSqlDatabase } from '@tax-engine/sql-store/durable-object';
import { createFakeDurableObjectStorage } from '@tax-engine/sql-store/testing';

import { ArcaIssuerProfileRegistry } from './arca-issuer-profile-registry';
import { ArcaSetupStore } from './arca-setup-store';
import { FacturaEAuthorityExecutionStore } from './authority-execution';
import {
  assertFacturaEFeatureDatabaseSeparateFromTaxEngine,
  FacturaEFeaturePublicationStore,
  type FacturaEFeaturePublicationDependencies,
} from './factura-e-feature-publication';
import { PersonalWsfeAttemptStore } from './personal-wsfe-attempt';
import { TaxProfileStore } from './store';

function featureDependencies(
  overrides: Partial<FacturaEFeaturePublicationDependencies> = {},
): FacturaEFeaturePublicationDependencies {
  return {
    readSource() { throw new Error('SOURCE_NOT_FOUND'); },
    signer: {} as FacturaEFeaturePublicationDependencies['signer'],
    commitmentSecret: 'test-purpose-secret-that-is-at-least-32-bytes-long',
    policyVersion: 'ar-factura-e-factoring-v1',
    ...overrides,
  };
}

describe('API stores on Durable Object SQLite', () => {
  test('every store opens on one DO database, which refuses the platform PRAGMAs', () => {
    const storage = createFakeDurableObjectStorage();
    try {
      const database = new DurableObjectSqlDatabase(storage);
      new TaxProfileStore(database, 'test-domain-event-secret');
      new ArcaIssuerProfileRegistry(database);
      new ArcaSetupStore(database);
      new FacturaEAuthorityExecutionStore(database, true);
      new PersonalWsfeAttemptStore(database, true);
      new FacturaEFeaturePublicationStore(featureDependencies({ database, requireDurable: true, singleWriter: true }));
      const tables = database.query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE name LIKE '%tax_domain_event_outbox%' AND name NOT LIKE 'sqlite_autoindex_%' ORDER BY name",
      ).all().map(row => row.name);
      expect(tables).toEqual([
        'factura_e_feature_tax_domain_event_outbox',
        'factura_e_feature_tax_domain_event_outbox_pending',
        'tax_domain_event_outbox',
        'tax_domain_event_outbox_pending',
      ]);
    } finally {
      storage.close();
    }
  });

  test('an in-memory injected database is refused where a durable store is required', () => {
    const memory = new BunSqlDatabase(':memory:');
    try {
      expect(() => new PersonalWsfeAttemptStore(memory, true)).toThrow('PERSONAL_WSFE_DURABLE_DB_REQUIRED');
      expect(() => new FacturaEAuthorityExecutionStore(memory, true))
        .toThrow('TAX_AUTHORITY_EXECUTION_DURABLE_STORE_CONFIGURATION_REQUIRED');
      expect(() => new FacturaEFeaturePublicationStore(featureDependencies({ database: memory, requireDurable: true })))
        .toThrow('TAX_FACTURA_E_FEATURE_DURABLE_STORE_REQUIRED');
    } finally {
      memory.close();
    }
  });
});

describe('Factura E feature outbox rename (Bun)', () => {
  test('renames a legacy outbox in the feature store\'s own file and keeps its rows', () => {
    const directory = mkdtempSync(join(tmpdir(), 'factura-e-feature-rename-'));
    try {
      const path = join(directory, 'feature.sqlite');
      const legacy = new BunSqlDatabase(path);
      legacy.exec(`
        CREATE TABLE tax_domain_event_outbox (
          event_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, idempotency_key TEXT NOT NULL,
          event_hash TEXT NOT NULL, event_json TEXT NOT NULL, appended_at TEXT NOT NULL,
          leased_until TEXT, lease_token TEXT, delivery_attempts INTEGER NOT NULL DEFAULT 0,
          delivered_at TEXT, last_error_code TEXT, UNIQUE (workspace_id, idempotency_key)
        );
        CREATE INDEX tax_domain_event_outbox_pending ON tax_domain_event_outbox (delivered_at, leased_until, appended_at);
        INSERT INTO tax_domain_event_outbox (event_id, workspace_id, idempotency_key, event_hash, event_json, appended_at)
        VALUES ('event-1', 'workspace-1', 'key-1', 'hash', '{}', '2026-10-27T00:00:00.000Z');
      `);
      legacy.close();

      const store = new FacturaEFeaturePublicationStore(featureDependencies({ databasePath: path }));
      store.close();

      const reopened = new BunSqlDatabase(path);
      try {
        const names = reopened.query<{ name: string }, []>(
          "SELECT name FROM sqlite_master WHERE name LIKE '%tax_domain_event_outbox%' AND name NOT LIKE 'sqlite_autoindex_%' ORDER BY name",
        ).all().map(row => row.name);
        expect(names).toEqual([
          'factura_e_feature_tax_domain_event_outbox',
          'factura_e_feature_tax_domain_event_outbox_pending',
        ]);
        expect(reopened.query<{ event_id: string }, []>(
          'SELECT event_id FROM factura_e_feature_tax_domain_event_outbox',
        ).all()).toEqual([{ event_id: 'event-1' }]);
      } finally {
        reopened.close();
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test('refuses a feature database that is the tax-engine database', () => {
    const directory = mkdtempSync(join(tmpdir(), 'factura-e-feature-shared-'));
    try {
      const path = join(directory, 'tax-engine.sqlite');
      expect(() => assertFacturaEFeatureDatabaseSeparateFromTaxEngine(path, path))
        .toThrow('FACTURA_E_FEATURE_DB_SHARED_WITH_TAX_ENGINE');
      expect(() => assertFacturaEFeatureDatabaseSeparateFromTaxEngine(join(directory, 'feature.sqlite'), path))
        .not.toThrow();
      expect(() => assertFacturaEFeatureDatabaseSeparateFromTaxEngine(':memory:', ':memory:')).not.toThrow();
      expect(() => new FacturaEFeaturePublicationStore(featureDependencies({ databasePath: path })))
        .not.toThrow();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
