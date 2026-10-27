import { describe, expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';

import { DurableObjectSqlDatabase } from '@tax-engine/sql-store/durable-object';
import { createFakeDurableObjectStorage } from '@tax-engine/sql-store/testing';

import { ArcaSetupBoundary } from './setup';
import { ArcaBoundaryStore } from './store';

describe('boundary stores on Durable Object SQLite', () => {
  test('both stores open on one DO database, which refuses the platform PRAGMAs', () => {
    const storage = createFakeDurableObjectStorage();
    try {
      const database = new DurableObjectSqlDatabase(storage);
      const commitmentKey = randomBytes(32);
      const issuers = new ArcaBoundaryStore(randomBytes(32), database, commitmentKey);
      const setup = new ArcaSetupBoundary({
        databasePath: database,
        sealKey: randomBytes(32),
        commitmentKey,
        taxpayerReferenceKey: randomBytes(32),
        issuers,
        environment: 'homologation',
        providerTemplate: null,
        trustedIssuers: [],
      });
      expect(issuers.retireEligiblePayloads('retention-policy-1', '2026-10-27T00:00:00.000Z')).toBe(0);
      setup.close();
      issuers.close();
    } finally {
      storage.close();
    }
  });
});
