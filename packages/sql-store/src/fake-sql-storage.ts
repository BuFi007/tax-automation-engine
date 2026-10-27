import { Database } from 'bun:sqlite';

import type { DurableObjectSqlStorageLike } from './durable-object';

const REFUSED_PRAGMA = /\bPRAGMA\s+(?:\w+\.)?(?:journal_mode|busy_timeout|secure_delete|database_list|user_version|wal_checkpoint)\b/i;
const RAW_TRANSACTION = /^(?:BEGIN|SAVEPOINT|COMMIT|END|ROLLBACK|RELEASE)\b/i;

/** Splits on `;` outside string literals and comments; returns non-empty statements. */
function statements(sql: string): string[] {
  const parts: string[] = [];
  let current = '';
  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index]!;
    if (char === "'" || char === '"') {
      const end = sql.indexOf(char, index + 1);
      const stop = end === -1 ? sql.length : end;
      current += sql.slice(index, stop + 1);
      index = stop;
    } else if (char === '-' && sql[index + 1] === '-') {
      const end = sql.indexOf('\n', index);
      index = end === -1 ? sql.length : end;
    } else if (char === ';') {
      parts.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  parts.push(current);
  return parts.map(part => part.trim()).filter(part => part.length > 0);
}

export type FakeDurableObjectStorage = DurableObjectSqlStorageLike & { close(): void };

/**
 * A `ctx.storage` stand-in backed by `bun:sqlite` that reproduces what the
 * Phase 0 spikes found in workerd: foreign keys on, the platform PRAGMAs and
 * raw transaction statements refused, no bindings on multi-statement SQL, only
 * string/number/null/ArrayBuffer bindings, and BLOBs read back as `ArrayBuffer`.
 */
export function createFakeDurableObjectStorage(): FakeDurableObjectStorage {
  const db = new Database(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  return {
    sql: {
      exec(query, ...bindings) {
        if (REFUSED_PRAGMA.test(query)) throw new Error(`not authorized: SQLITE_AUTH`);
        const parsed = statements(query);
        if (parsed.some(statement => RAW_TRANSACTION.test(statement)))
          throw new Error('To execute a transaction, please use the state.storage.transaction() API instead');
        for (const binding of bindings) {
          if (!(binding === null || typeof binding === 'string' || typeof binding === 'number' || binding instanceof ArrayBuffer))
            throw new TypeError('SQL binding must be string, number, null or ArrayBuffer');
        }
        if (parsed.length > 1) {
          if (bindings.length > 0) throw new Error('A prepared SQL statement must contain only one statement.');
          db.exec(query);
          return { toArray: () => [] };
        }
        const values = bindings.map(binding => (binding instanceof ArrayBuffer ? new Uint8Array(binding) : binding));
        const rows = db.query<Record<string, unknown>, typeof values>(query).all(...values);
        for (const row of rows)
          for (const [key, value] of Object.entries(row))
            if (value instanceof Uint8Array) row[key] = value.slice().buffer;
        return { toArray: () => rows };
      },
    },
    transactionSync: closure => db.transaction(closure)(),
    close: () => db.close(),
  };
}
