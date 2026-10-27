import { Database } from 'bun:sqlite';

import { assertUserVersion, type SqlBinding, type SqlConfiguration, type SqlDatabase, type SqlStatement } from './index';

export function isInMemorySqlitePath(path: string): boolean {
  return path.trim() === ''
    || path === ':memory:'
    || path.startsWith('file::memory:')
    || /[?&]mode=memory(?:&|$)/i.test(path);
}

export class BunSqlDatabase implements SqlDatabase {
  readonly durable: boolean;
  readonly #db: Database;

  constructor(path: string) {
    this.#db = new Database(path, { create: true });
    this.durable = !isInMemorySqlitePath(path);
  }

  get userVersion(): number {
    return this.#db.query<{ user_version: number }, []>('PRAGMA user_version').get()?.user_version ?? 0;
  }

  set userVersion(version: number) {
    assertUserVersion(version);
    this.#db.exec(`PRAGMA user_version = ${version};`);
  }

  query<Row = unknown, Params extends SqlBinding[] = SqlBinding[]>(sql: string): SqlStatement<Row, Params> {
    return this.#db.query<Row, Params>(sql) as unknown as SqlStatement<Row, Params>;
  }

  exec(sql: string): void {
    this.#db.exec(sql);
  }

  transaction<Args extends unknown[], Result>(fn: (...args: Args) => Result): (...args: Args) => Result {
    return this.#db.transaction(fn);
  }

  configure(options: SqlConfiguration): void {
    if (options.busyTimeoutMs !== undefined) {
      if (!Number.isSafeInteger(options.busyTimeoutMs) || options.busyTimeoutMs < 0)
        throw new Error('SQL_STORE_BUSY_TIMEOUT_INVALID');
      this.#db.exec(`PRAGMA busy_timeout = ${options.busyTimeoutMs};`);
    }
    if (options.wal) this.#db.exec('PRAGMA journal_mode = WAL;');
    if (options.foreignKeys !== undefined)
      this.#db.exec(`PRAGMA foreign_keys = ${options.foreignKeys ? 'ON' : 'OFF'};`);
    if (options.secureDelete !== undefined)
      this.#db.exec(`PRAGMA secure_delete = ${options.secureDelete ? 'ON' : 'OFF'};`);
  }

  checkpoint(): void {
    this.#db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  }

  close(): void {
    this.#db.close();
  }
}

/** A path opens a Bun database (today's behaviour); an injected database is used as is. */
export function openSqlDatabase(source: string | SqlDatabase): SqlDatabase {
  return typeof source === 'string' ? new BunSqlDatabase(source) : source;
}
