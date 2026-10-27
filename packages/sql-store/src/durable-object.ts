import { assertUserVersion, type SqlBinding, type SqlConfiguration, type SqlDatabase, type SqlRunResult, type SqlStatement } from './index';

type DurableObjectSqlValue = string | number | null | ArrayBuffer;

/** The part of Cloudflare's `DurableObjectStorage` this adapter uses (`ctx.storage`). */
export interface DurableObjectSqlStorageLike {
  readonly sql: {
    exec(query: string, ...bindings: DurableObjectSqlValue[]): { toArray(): Record<string, unknown>[] };
  };
  transactionSync<T>(closure: () => T): T;
}

function toDurableObjectValue(value: SqlBinding): DurableObjectSqlValue {
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'bigint') {
    if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER))
      throw new Error('SQL_STORE_BIGINT_UNSAFE');
    return Number(value);
  }
  if (value instanceof Uint8Array) return value.slice().buffer;
  return value;
}

function fromDurableObjectRow(row: Record<string, unknown>): Record<string, unknown> {
  for (const [key, value] of Object.entries(row))
    if (value instanceof ArrayBuffer) row[key] = new Uint8Array(value);
  return row;
}

/**
 * `SqlDatabase` over `ctx.storage.sql`. `store` names this store's row in
 * `_sql_store_meta`, because a DO refuses `PRAGMA user_version` and several
 * stores may share one database.
 */
export class DurableObjectSqlDatabase implements SqlDatabase {
  readonly durable = true;
  readonly #storage: DurableObjectSqlStorageLike;
  readonly #store: string;

  constructor(storage: DurableObjectSqlStorageLike, store = 'default') {
    this.#storage = storage;
    this.#store = store;
  }

  get userVersion(): number {
    this.#ensureMeta();
    const row = this.#rows('SELECT user_version FROM _sql_store_meta WHERE store = ?', [this.#store])[0];
    return typeof row?.user_version === 'number' ? row.user_version : 0;
  }

  set userVersion(version: number) {
    assertUserVersion(version);
    this.#ensureMeta();
    this.#rows(
      `INSERT INTO _sql_store_meta (store, user_version) VALUES (?, ?)
       ON CONFLICT(store) DO UPDATE SET user_version = excluded.user_version`,
      [this.#store, version],
    );
  }

  query<Row = unknown, Params extends SqlBinding[] = SqlBinding[]>(sql: string): SqlStatement<Row, Params> {
    return {
      get: (...params) => (this.#rows(sql, params)[0] as Row | undefined) ?? null,
      all: (...params) => this.#rows(sql, params) as Row[],
      run: (...params): SqlRunResult => {
        this.#rows(sql, params);
        const row = this.#rows('SELECT changes() AS changes, last_insert_rowid() AS last_insert_rowid', [])[0];
        return { changes: Number(row?.changes ?? 0), lastInsertRowid: Number(row?.last_insert_rowid ?? 0) };
      },
    };
  }

  exec(sql: string): void {
    this.#storage.sql.exec(sql).toArray();
  }

  transaction<Args extends unknown[], Result>(fn: (...args: Args) => Result): (...args: Args) => Result {
    return (...args) => this.#storage.transactionSync(() => fn(...args));
  }

  configure(options: SqlConfiguration): void {
    // journal_mode, busy_timeout and secure_delete are refused (SQLITE_AUTH) and
    // managed by the platform. Foreign keys are on and cannot be turned off.
    if (options.foreignKeys === undefined) return;
    const row = this.#rows('PRAGMA foreign_keys', [])[0];
    if (Boolean(row?.foreign_keys) !== options.foreignKeys) throw new Error('SQL_STORE_FOREIGN_KEYS_UNSUPPORTED');
  }

  checkpoint(): void {}

  close(): void {}

  #rows(sql: string, params: readonly SqlBinding[]): Record<string, unknown>[] {
    return this.#storage.sql.exec(sql, ...params.map(toDurableObjectValue)).toArray().map(fromDurableObjectRow);
  }

  #ensureMeta(): void {
    this.exec('CREATE TABLE IF NOT EXISTS _sql_store_meta (store TEXT PRIMARY KEY, user_version INTEGER NOT NULL)');
  }
}
