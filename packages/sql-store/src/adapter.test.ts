import { describe, expect, test } from 'bun:test';

import { BunSqlDatabase } from './bun';
import { DurableObjectSqlDatabase } from './durable-object';
import { createFakeDurableObjectStorage } from './fake-sql-storage';
import type { SqlDatabase } from './index';

const implementations: ReadonlyArray<[string, () => { db: SqlDatabase; close(): void }]> = [
  ['bun', () => {
    const db = new BunSqlDatabase(':memory:');
    db.configure({ foreignKeys: true });
    return { db, close: () => db.close() };
  }],
  ['durable object', () => {
    const storage = createFakeDurableObjectStorage();
    return { db: new DurableObjectSqlDatabase(storage, 'contract'), close: () => storage.close() };
  }],
];

for (const [name, open] of implementations) {
  describe(`SqlDatabase contract: ${name}`, () => {
    function withDb(run: (db: SqlDatabase) => void): void {
      const opened = open();
      try {
        opened.db.exec(`
          CREATE TABLE parent (id TEXT PRIMARY KEY, n INTEGER NOT NULL DEFAULT 0, data BLOB);
          CREATE TABLE child (id INTEGER PRIMARY KEY, parent_id TEXT NOT NULL REFERENCES parent(id) ON DELETE RESTRICT);
        `);
        run(opened.db);
      } finally {
        opened.close();
      }
    }

    test('get returns null for no row; all returns an array', () => withDb(db => {
      expect(db.query<{ id: string }, [string]>('SELECT id FROM parent WHERE id = ?').get('missing')).toBeNull();
      expect(db.query('SELECT id FROM parent').all()).toEqual([]);
      db.query('INSERT INTO parent (id) VALUES (?)').run('a');
      expect(db.query<{ id: string }, [string]>('SELECT id FROM parent WHERE id = ?').get('a')).toEqual({ id: 'a' });
    }));

    test('run reports changes and lastInsertRowid', () => withDb(db => {
      db.query('INSERT INTO parent (id) VALUES (?), (?)').run('a', 'b');
      expect(db.query('INSERT INTO child (parent_id) VALUES (?)').run('a')).toEqual({ changes: 1, lastInsertRowid: 1 });
      expect(db.query('INSERT INTO child (parent_id) VALUES (?)').run('b')).toEqual({ changes: 1, lastInsertRowid: 2 });
      expect(db.query('UPDATE parent SET n = n + 1').run().changes).toBe(2);
      expect(db.query('UPDATE parent SET n = 0 WHERE id = ?').run('missing').changes).toBe(0);
      expect(db.query(
        'INSERT INTO parent (id, n) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET n = excluded.n WHERE excluded.n > parent.n',
      ).run('a', 0).changes).toBe(0);
    }));

    test('exec runs a multi-statement string', () => withDb(db => {
      db.exec("INSERT INTO parent (id) VALUES ('x'); INSERT INTO parent (id) VALUES ('y');");
      expect(db.query<{ count: number }, []>('SELECT COUNT(*) AS count FROM parent').get()?.count).toBe(2);
    }));

    test('transaction commits, rolls back on throw, and nests with savepoints', () => withDb(db => {
      const insert = db.query<unknown, [string]>('INSERT INTO parent (id) VALUES (?)');
      expect(db.transaction((id: string) => { insert.run(id); return id; })('a')).toBe('a');
      expect(() => db.transaction(() => { insert.run('b'); throw new Error('boom'); })()).toThrow('boom');
      db.transaction(() => {
        insert.run('c');
        expect(() => db.transaction(() => { insert.run('d'); throw new Error('inner'); })()).toThrow('inner');
      })();
      expect(db.query<{ id: string }, []>('SELECT id FROM parent ORDER BY id').all().map(row => row.id)).toEqual(['a', 'c']);
    }));

    test('constraint violations throw', () => withDb(db => {
      db.query('INSERT INTO parent (id) VALUES (?)').run('a');
      expect(() => db.query('INSERT INTO parent (id) VALUES (?)').run('a')).toThrow(/UNIQUE constraint failed/);
      expect(() => db.query('INSERT INTO child (parent_id) VALUES (?)').run('missing')).toThrow(/FOREIGN KEY constraint failed/);
    }));

    test('BLOBs read back as Uint8Array and booleans bind as integers', () => withDb(db => {
      db.query('INSERT INTO parent (id, n, data) VALUES (?, ?, ?)').run('a', true, new Uint8Array([1, 2, 3]));
      const row = db.query<{ n: number; data: Uint8Array }, []>('SELECT n, data FROM parent').get();
      expect(row?.n).toBe(1);
      expect(row?.data).toBeInstanceOf(Uint8Array);
      expect([...row!.data]).toEqual([1, 2, 3]);
    }));

    test('userVersion defaults to 0 and persists', () => withDb(db => {
      expect(db.userVersion).toBe(0);
      db.userVersion = 4;
      expect(db.userVersion).toBe(4);
      expect(() => { db.userVersion = -1; }).toThrow('SQL_STORE_USER_VERSION_INVALID');
    }));

    test('configure and checkpoint accept the store options', () => withDb(db => {
      db.configure({ wal: true, busyTimeoutMs: 5000, secureDelete: true, foreignKeys: true });
      db.checkpoint();
    }));
  });
}

describe('DurableObjectSqlDatabase', () => {
  test('is durable, keeps userVersion per store, and refuses to turn foreign keys off', () => {
    const storage = createFakeDurableObjectStorage();
    try {
      const first = new DurableObjectSqlDatabase(storage, 'first');
      const second = new DurableObjectSqlDatabase(storage, 'second');
      expect(first.durable).toBe(true);
      first.userVersion = 3;
      expect(second.userVersion).toBe(0);
      expect(first.userVersion).toBe(3);
      expect(() => first.configure({ foreignKeys: false })).toThrow('SQL_STORE_FOREIGN_KEYS_UNSUPPORTED');
    } finally {
      storage.close();
    }
  });
});

describe('BunSqlDatabase', () => {
  test('is durable only for a file path', () => {
    const memory = new BunSqlDatabase(':memory:');
    expect(memory.durable).toBe(false);
    memory.close();
  });
});

describe('fake DO storage reproduces workerd refusals', () => {
  const refused = [
    'PRAGMA journal_mode = WAL',
    'PRAGMA busy_timeout = 5000',
    'PRAGMA secure_delete = ON',
    'PRAGMA database_list',
    'PRAGMA user_version',
    'PRAGMA user_version = 1',
    'PRAGMA wal_checkpoint(TRUNCATE)',
    'CREATE TABLE t (a TEXT); PRAGMA journal_mode = WAL;',
    'BEGIN TRANSACTION',
    'SAVEPOINT s',
    'COMMIT',
    'ROLLBACK',
  ];
  for (const sql of refused) {
    test(`refuses: ${sql}`, () => {
      const storage = createFakeDurableObjectStorage();
      try {
        expect(() => storage.sql.exec(sql)).toThrow();
      } finally {
        storage.close();
      }
    });
  }

  test('refuses bindings on multi-statement SQL and non-DO binding types', () => {
    const storage = createFakeDurableObjectStorage();
    try {
      storage.sql.exec('CREATE TABLE t (a)');
      expect(() => storage.sql.exec('INSERT INTO t VALUES (?); INSERT INTO t VALUES (?);', 1, 2)).toThrow();
      expect(() => storage.sql.exec('INSERT INTO t VALUES (?)', true as unknown as number)).toThrow();
      expect(storage.sql.exec('PRAGMA foreign_keys').toArray()).toEqual([{ foreign_keys: 1 }]);
    } finally {
      storage.close();
    }
  });
});
