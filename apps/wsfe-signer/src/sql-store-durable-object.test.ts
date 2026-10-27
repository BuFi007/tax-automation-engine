import { describe, test } from 'bun:test';

import { DurableObjectSqlDatabase } from '@tax-engine/sql-store/durable-object';
import { createFakeDurableObjectStorage } from '@tax-engine/sql-store/testing';

import { SignerAttemptStore } from './store';

describe('WSFE attempt store on Durable Object SQLite', () => {
  test('opens on a DO database, which refuses the platform PRAGMAs', () => {
    const storage = createFakeDurableObjectStorage();
    try {
      new SignerAttemptStore(new DurableObjectSqlDatabase(storage, 'wsfe-signer'));
    } finally {
      storage.close();
    }
  });
});
