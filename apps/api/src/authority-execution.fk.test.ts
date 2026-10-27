import { describe, expect, test } from 'bun:test';

import type { SqlDatabase } from '@tax-engine/sql-store';
import { BunSqlDatabase } from '@tax-engine/sql-store/bun';
import { DurableObjectSqlDatabase } from '@tax-engine/sql-store/durable-object';
import { createFakeDurableObjectStorage } from '@tax-engine/sql-store/testing';

import {
  FacturaEAuthorityExecutionService,
  FacturaEAuthorityExecutionStore,
  type FacturaEAuthorityRemoteEffect,
} from './authority-execution';

// The store declares FOREIGN KEYs that Bun never enforced (no PRAGMA foreign_keys)
// and DO SQLite always enforces. Every insert path must keep parents first.
const workspaceId = '11111111-1111-4111-8111-111111111111';
const runId = '22222222-2222-4222-8222-222222222222';
const intentHash = 'a'.repeat(64);
const approvalRef = 'human_approval_abcdefghijklmnopqrstuvwx';

const effect: FacturaEAuthorityRemoteEffect = {
  async prepare(input) {
    return {
      executionId: input.executionId,
      workspaceId: input.workspaceId,
      runId: input.runId,
      intentHash: input.intentHash,
      requestId: '41',
      authorityPayloadRef: 'vault://wsfex/33333333-3333-4333-8333-333333333333',
      authorityPayloadHash: 'b'.repeat(64),
    };
  },
  async execute() {
    return { status: 'ambiguous', receiptHash: 'c'.repeat(64) };
  },
  async recover() {
    return { status: 'authority_accepted_unverified', receiptHash: 'd'.repeat(64) };
  },
  async reconcile() {
    return { status: 'officially_reconciled', receiptHash: 'f'.repeat(64), authorityIdentityHash: '1'.repeat(64) };
  },
};

const databases: ReadonlyArray<[string, () => { database: SqlDatabase; close(): void }]> = [
  ['bun with foreign_keys = ON', () => {
    const database = new BunSqlDatabase(':memory:');
    database.configure({ foreignKeys: true });
    return { database, close: () => database.close() };
  }],
  ['durable object (foreign keys always on)', () => {
    const storage = createFakeDurableObjectStorage();
    return { database: new DurableObjectSqlDatabase(storage, 'authority-execution'), close: () => storage.close() };
  }],
];

describe('FacturaEAuthorityExecutionStore under enforced foreign keys', () => {
  for (const [name, open] of databases) {
    test(`create → approve → execute → recover → reconcile, with replays: ${name}`, async () => {
      const { database, close } = open();
      const store = new FacturaEAuthorityExecutionStore(database, false);
      try {
        const service = new FacturaEAuthorityExecutionService(
          store,
          candidate => {
            if (candidate !== runId) throw new Error('AGENT_RUN_NOT_FOUND');
            return { workspaceId, intentHash, issuanceState: 'ready_for_wsfex' };
          },
          effect,
          true,
        );
        const actor = 'motora:authority-corridor';
        const intent = service.createIntent({
          workspaceId, runId, intentHash, actorId: 'user:creator',
          idempotencyKey: 'create-1', occurredAt: '2026-07-15T16:00:00.000Z',
        });
        service.registerApproval({
          executionId: intent.executionId, workspaceId, intentHash, approvalRef,
          actorId: 'oa:approval:run-1', idempotencyKey: 'approve-1', occurredAt: '2026-07-15T16:01:00.000Z',
        });
        const execute = { executionId: intent.executionId, workspaceId, actorId: actor, idempotencyKey: 'execute-1' };
        expect(await service.execute({ ...execute, occurredAt: '2026-07-15T16:02:00.000Z' }))
          .toMatchObject({ state: 'recovery_required' });
        expect(await service.execute({ ...execute, occurredAt: '2026-07-15T16:02:30.000Z' }))
          .toMatchObject({ replayed: true });
        const recover = { executionId: intent.executionId, workspaceId, actorId: actor, idempotencyKey: 'recover-1' };
        expect(await service.recover({ ...recover, occurredAt: '2026-07-15T16:03:00.000Z' }))
          .toMatchObject({ state: 'authority_accepted_unverified' });
        await service.recover({ ...recover, occurredAt: '2026-07-15T16:03:30.000Z' });
        const reconcile = { executionId: intent.executionId, workspaceId, actorId: actor, idempotencyKey: 'reconcile-1' };
        expect(await service.reconcile({ ...reconcile, occurredAt: '2026-07-15T16:04:00.000Z' }))
          .toMatchObject({ state: 'officially_reconciled' });
        await service.reconcile({ ...reconcile, occurredAt: '2026-07-15T16:04:30.000Z' });
        expect(database.query<{ count: number }, []>(
          'SELECT COUNT(*) AS count FROM factura_e_authority_recovery_attempts',
        ).get()?.count).toBe(1);
        expect(database.query<{ count: number }, []>(
          'SELECT COUNT(*) AS count FROM factura_e_authority_reconciliation_attempts',
        ).get()?.count).toBe(1);
        expect(database.query('PRAGMA foreign_key_check').all()).toEqual([]);
      } finally {
        store.close();
        close();
      }
    });
  }

  test('an attempt row for a missing execution is refused, so enforcement is real', () => {
    const { database, close } = databases[0]![1]();
    const store = new FacturaEAuthorityExecutionStore(database, false);
    try {
      expect(() => database.query(`
        INSERT INTO factura_e_authority_recovery_attempts (
          execution_id, idempotency_key, command_hash, state, fence_token, lease_expires_at, revision, created_at, updated_at
        ) VALUES ('missing', 'k', 'h', 'claimed', 'f', 'x', 1, 'x', 'x')
      `).run()).toThrow(/FOREIGN KEY constraint failed/);
    } finally {
      store.close();
      close();
    }
  });
});
