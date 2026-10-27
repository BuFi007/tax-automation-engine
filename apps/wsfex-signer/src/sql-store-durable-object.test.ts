import { describe, expect, test } from 'bun:test';

import { DurableObjectSqlDatabase } from '@tax-engine/sql-store/durable-object';
import { createFakeDurableObjectStorage } from '@tax-engine/sql-store/testing';

import { SignerAttemptStore } from './store';

describe('WSFEX attempt store on Durable Object SQLite', () => {
  test('creates the schema, records its version in _sql_store_meta, and reopens', () => {
    const storage = createFakeDurableObjectStorage();
    try {
      const database = new DurableObjectSqlDatabase(storage, 'wsfex-signer');
      new SignerAttemptStore(database).close();
      expect(database.userVersion).toBe(4);
      new SignerAttemptStore(database).close();
      expect(database.userVersion).toBe(4);
    } finally {
      storage.close();
    }
  });
});
