import { Database } from 'bun:sqlite';

/** Durable issuer references only. Certificate material stays in the ARCA boundary. */
export class ArcaIssuerProfileRegistry extends Map<string, string> {
  readonly #db: Database;

  constructor(path: string, defaults: ReadonlyMap<string, string> = new Map()) {
    super(defaults);
    this.#db = new Database(path, { create: true });
    this.#db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS arca_issuer_profile_bindings (
        workspace_id TEXT PRIMARY KEY,
        issuer_profile_ref TEXT NOT NULL,
        environment TEXT NOT NULL CHECK (environment = 'homologation'),
        bound_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS arca_issuer_profile_revocations (
        workspace_id TEXT PRIMARY KEY,
        revoked_at TEXT NOT NULL
      );
    `);
    for (const row of this.#db.query<{ workspace_id: string; issuer_profile_ref: string }, []>(
      'SELECT workspace_id, issuer_profile_ref FROM arca_issuer_profile_bindings'
    ).all()) super.set(row.workspace_id, row.issuer_profile_ref);
    for (const row of this.#db.query<{ workspace_id: string }, []>(
      'SELECT workspace_id FROM arca_issuer_profile_revocations'
    ).all()) super.delete(row.workspace_id);
  }

  override get(workspaceId: string): string | undefined {
    // Read the durable row on every authority check so another Tax process can
    // bind or revoke without leaving this process with a stale in-memory grant.
    const row = this.#db.query<{ issuer_profile_ref: string }, [string]>(
      'SELECT issuer_profile_ref FROM arca_issuer_profile_bindings WHERE workspace_id = ?'
    ).get(workspaceId);
    if (row) return row.issuer_profile_ref;
    const revoked = this.#db.query<{ workspace_id: string }, [string]>(
      'SELECT workspace_id FROM arca_issuer_profile_revocations WHERE workspace_id = ?'
    ).get(workspaceId);
    return revoked ? undefined : super.get(workspaceId);
  }

  override has(workspaceId: string): boolean { return this.get(workspaceId) !== undefined; }

  bind(workspaceId: string, issuerProfileRef: string, boundAt: string): void {
    if (!workspaceId || !issuerProfileRef || !Number.isFinite(Date.parse(boundAt)))
      throw new Error('ARCA_ISSUER_BINDING_INVALID');
    const existing = this.get(workspaceId);
    if (existing && existing !== issuerProfileRef)
      throw new Error('ARCA_ISSUER_BINDING_REPLACEMENT_REQUIRES_DISCONNECT');
    this.#db.transaction(() => {
      const written = this.#db.query(`
        INSERT INTO arca_issuer_profile_bindings (workspace_id, issuer_profile_ref, environment, bound_at)
        VALUES (?, ?, 'homologation', ?)
        ON CONFLICT(workspace_id) DO UPDATE SET bound_at = excluded.bound_at
          WHERE issuer_profile_ref = excluded.issuer_profile_ref
      `).run(workspaceId, issuerProfileRef, boundAt);
      if (written.changes !== 1)
        throw new Error('ARCA_ISSUER_BINDING_REPLACEMENT_REQUIRES_DISCONNECT');
      this.#db.query('DELETE FROM arca_issuer_profile_revocations WHERE workspace_id = ?').run(workspaceId);
    })();
    super.set(workspaceId, issuerProfileRef);
  }

  unbind(workspaceId: string, issuerProfileRef: string): void {
    if (this.get(workspaceId) !== issuerProfileRef)
      throw new Error('ARCA_ISSUER_BINDING_MISMATCH');
    this.#db.transaction(() => {
      this.#db.query(`
        INSERT INTO arca_issuer_profile_revocations (workspace_id, revoked_at)
        VALUES (?, ?)
        ON CONFLICT(workspace_id) DO UPDATE SET revoked_at = excluded.revoked_at
      `).run(workspaceId, new Date().toISOString());
      this.#db.query(
        'DELETE FROM arca_issuer_profile_bindings WHERE workspace_id = ? AND issuer_profile_ref = ?'
      ).run(workspaceId, issuerProfileRef);
    })();
    super.delete(workspaceId);
  }

  close(): void { this.#db.close(); }
}
