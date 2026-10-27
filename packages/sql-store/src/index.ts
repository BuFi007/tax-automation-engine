/**
 * The subset of `bun:sqlite` the stores use, so the same synchronous store code
 * runs on a file (Bun) or on a Durable Object's `ctx.storage.sql`.
 */
export type SqlBinding = string | number | bigint | boolean | null | Uint8Array;

export type SqlRunResult = Readonly<{ changes: number; lastInsertRowid: number | bigint }>;

export interface SqlStatement<Row = unknown, Params extends SqlBinding[] = SqlBinding[]> {
  /** The first row, or `null` when there is none. */
  get(...params: Params): Row | null;
  all(...params: Params): Row[];
  run(...params: Params): SqlRunResult;
}

/** PRAGMAs a Durable Object refuses. They are applied on Bun and ignored (or asserted) on a DO. */
export type SqlConfiguration = Readonly<{
  wal?: boolean;
  busyTimeoutMs?: number;
  secureDelete?: boolean;
  foreignKeys?: boolean;
}>;

export interface SqlDatabase {
  /** `false` only for an in-memory Bun database. */
  readonly durable: boolean;
  /** `PRAGMA user_version` on Bun; a per-store row in `_sql_store_meta` on a DO. */
  userVersion: number;
  query<Row = unknown, Params extends SqlBinding[] = SqlBinding[]>(sql: string): SqlStatement<Row, Params>;
  /** Runs one or more statements. Takes no bindings: a DO refuses bindings on a multi-statement call. */
  exec(sql: string): void;
  /** Returns a callable that runs `fn` in a transaction; nested calls use savepoints. */
  transaction<Args extends unknown[], Result>(fn: (...args: Args) => Result): (...args: Args) => Result;
  configure(options: SqlConfiguration): void;
  /** `PRAGMA wal_checkpoint(TRUNCATE)` on Bun; a no-op on a DO. */
  checkpoint(): void;
  close(): void;
}

export function assertUserVersion(version: number): void {
  if (!Number.isSafeInteger(version) || version < 0) throw new Error('SQL_STORE_USER_VERSION_INVALID');
}
