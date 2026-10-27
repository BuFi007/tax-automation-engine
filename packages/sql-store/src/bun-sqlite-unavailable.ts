/**
 * Stand-in for `bun:sqlite` in Worker bundles (wrangler `alias`). Stores open a
 * path only on Bun; on a Durable Object they are handed a `SqlDatabase`, so
 * reaching this class means a store was given a path where none exists.
 */
export class Database {
  constructor() {
    throw new Error('SQL_STORE_PATH_UNAVAILABLE_ON_WORKERS');
  }
}
