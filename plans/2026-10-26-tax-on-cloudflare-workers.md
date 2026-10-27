# Tax API, ARCA boundary and issuance signers on Cloudflare Workers (zero fixed cost)

Status: Phase 0, 0b, 1, 2 and 3 DONE (gates passed, one crypto fallback chosen; see
"Spike results") · next: Phase 4.
Written 2026-10-26 against branch `feat/arca-automated-connection`.
Revised 2026-10-26 after an adversarial review (see "Review notes" at the end).
Revised 2026-10-27 with the Phase 0 spike results and a second code review.
Owner of execution: an implementing agent. Read the whole plan and obey the STOP
conditions before starting.

## Goal

Move `apps/api` (Tax API), `apps/arca-boundary` and the two issuance signers
`apps/wsfe-signer` (Factura C) and `apps/wsfex-signer` (Factura E) onto
Cloudflare Workers in account `67f97ad58ab9673c26f9f5a2c27c99da`. The API and
the boundary run today on the GCE VM (`bufi-vertex-ocr` / `tax-homologation` /
`us-central1-a`, e2-small, static IP 104.154.28.207). The signers are not on the
VM, but they must reach the boundary's `/v1/authority-payloads/resolve` and
`/v1/wsaa/tickets`, which will have no public surface after this change, so they
move too.

After this change nothing BUFI runs for Tax has a fixed monthly cost. The account
already pays the fixed $5/month Workers Paid fee (shared with Shiva and the
executor); this plan adds **$0 marginal**, provided usage stays inside the
included allowances, which are shared account-wide (see "Cost").

Until cutover, the VM stays stopped when nobody is testing:
`deploy/gcp-vm/vm.sh stop|start|status` (already in the repo). While stopped it
costs about $4/month for the disk and the static IP.

## Decision

**Each stateful service runs inside one SQLite-backed Durable Object (DO), and the
existing synchronous stores run unchanged against `ctx.storage.sql` through a thin
adapter.**

- **Tax API Worker** (`bufi-tax-api-homologation`): the Worker's `fetch` forwards
  every request to a single `TaxState` DO instance (`idFromName('primary')`). That
  DO builds the existing composition root, with every store on its own SQLite
  database, and calls the existing fetch handler. The three `setInterval` loops
  become one **work-driven** DO alarm: it is scheduled only while some loop has
  pending work, and deleted otherwise (see Phase 3).
- **ARCA boundary Worker** (`bufi-arca-boundary-homologation`): the same shape,
  with a `BoundaryState` DO that runs `createBoundaryHandler`. It has
  `workers_dev: false`, `preview_urls: false` and no routes, so it has **no
  public surface at all**. It is reachable only through Service Bindings, each to
  a filtered entrypoint (the filter matches on `new URL(request.url).pathname`,
  which is what `http.ts:56-136` routes on):
  - the default entrypoint, bound by the Tax API, serves every boundary route;
  - `ExecutorEntrypoint`, bound by `arca-setup-executor`, forwards only POST
    `/v1/setup/executor/*`, and 404s everything else;
  - `SignerEntrypoint`, bound by both signers, forwards only POST
    `/v1/authority-payloads/resolve`, POST `/v1/wsaa/tickets` and GET `/health`
    (the signers' `wsaa.ts` `health()` calls it), and 404s everything else;
  - `AdminEntrypoint`, bound by the Tax API, forwards only the admin routes POST
    `/v1/wsaa/issuers`, `/v1/wsaa/issuers/delegations`,
    `/v1/wsaa/issuers/revoke` and `/v1/authority-payloads/retire-eligible`. The
    Tax API exposes it to operators only behind a dedicated operator-proxy token
    (Phase 3).

  This reproduces today's Caddy split (private ranges get all routes, the public
  internet gets only the executor routes) without exposing anything to the
  internet.
- **WSFE and WSFEX signer Workers** (`bufi-wsfe-signer-homologation`,
  `bufi-wsfex-signer-homologation`): the same shape, with `WsfeSignerState` /
  `WsfexSignerState` DOs over their existing `bun:sqlite` attempt stores. Both
  are `workers_dev: false`, `preview_urls: false`, no routes. They are reached
  only by the Tax API through Service Bindings (`WSFE_SIGNER`, `WSFEX_SIGNER`),
  which replace the global `fetch` to `ARCA_WSFE_SIGNER_URL` / `ARCA_SIGNER_URL`.
  They reach the boundary only through `SignerEntrypoint`. Signers have no
  background loop, so their DOs never set an alarm.
- **Private keys stay in the boundary.** The MASTER_KEY, CUIT commitment key and
  taxpayer-reference key are `wrangler secret`s on the boundary Worker only. The
  Tax API and the signers never hold them. Every caller keeps its bearer token to
  the boundary as defence in depth; the boundary still checks each one.

### Binding graph

```
Desk ──https──▶ Tax API (workers.dev)
Tax API ──▶ boundary (default)          Tax API ──▶ boundary AdminEntrypoint (operator proxy only)
Tax API ──▶ wsfe-signer, wsfex-signer   Tax API ──▶ arca-setup-executor
signers ──▶ boundary SignerEntrypoint
executor ──▶ boundary ExecutorEntrypoint, executor ──▶ Tax API (receipts)
```

API and executor bind each other. A binding to a Worker that does not exist yet
fails to deploy, so the first deploy is two-pass (Phase 5).

### Why this shape, and why it is the smallest correct change

1. **It keeps the store code synchronous.** A DO's `sql.exec()` and
   `transactionSync()` are synchronous and roll back on throw, which is the same
   contract as `bun:sqlite`'s `db.transaction(() => ...)()`. Of the 52
   read-check-write transactions in the API and boundary stores (plus 4 in
   `wsfex-signer/src/store.ts`), none needs to be redesigned. Of the 94
   `TaxProfileStore` call sites and the `ArcaIssuerProfileRegistry extends Map`
   contract, none gets an `await`.
2. **Running the whole handler inside the DO keeps today's single-process
   semantics.** If the handler ran in the stateless Worker, every store call would
   become an RPC and therefore async, which is the same await cascade D1 would
   force. Inside one DO there is exactly one writer, so:
   - `assertFacturaEFeatureSingleWriterConfiguration` stays true;
   - the in-process `#restrictedHeadLocks` mutex stays valid;
   - the re-entrancy booleans on the ticks stay valid.

   This matches the VM exactly, where one Bun process owns the files. While the
   handler awaits an outbound fetch, the DO interleaves other requests, just as
   the Bun event loop does today.
3. **The cost is $0 marginal if the alarm is work-driven.** See "Cost". A
   permanently rescheduled alarm would not be: it keeps the DO resident and bills
   duration all month.
4. **The repo already uses this pattern.** `apps/arca-setup-executor` runs an
   SQLite-class DO with alarms and an injectable `Fetcher` for the boundary
   (`boundary-client.ts:33`). The new configs copy its `wrangler.jsonc` shape.

### Cost

Workers Paid includes, per month and **shared by every Worker in the account**
(Shiva, the executor, these five): 10M Worker requests; 1M DO requests
(then $0.15/M); 400,000 GB-s of DO duration (then $12.50/M GB-s); 25B rows
read; 50M rows written; 5 GB-month SQLite storage. A DO bills 128 MB
(0.125 GB) of duration for the wall-clock time it is active. Service bindings
cost nothing beyond the request. The executor's Browser Rendering is
usage-billed and is already in place, so it does not affect this goal.

Duration billing of an idle-but-not-yet-evicted DO is the one number to confirm
in Phase 0 (spike 5). The table uses a pessimistic **140 s of billed residency
per wake**.

| Design | DO requests / month | DO duration / month |
|---|---|---|
| Rejected: one alarm at the shortest loop interval (5 s), rescheduled forever | 518,400 (52% of the shared 1M) | 2,592,000 s × 0.125 GB = **324,000 GB-s (81% of the shared 400k)**, even with zero traffic |
| Chosen, idle month | 720 (hourly watchdog cron) | ≤ 720 × 140 s × 0.125 = **12,600 GB-s** |
| Chosen, busy homologation month (assumed: 20 setup runs × 15 min open, 2,000 outbox events, 50k API requests, 20k boundary/signer requests) | ≈ 600 setup alarms + ≈ 4,000 outbox alarms + 70k requests ≈ **75k** | setup runs 20 × 900 s × 0.125 = 2,250; event wakes ≤ 2,000 × 140 s × 0.125 = 35,000; request-driven residency across 4 DOs ≤ ~20,000 → **≤ ~60,000 GB-s (15%)** |

Rows written stay well under 1M/month and storage is in MB. So the marginal cost
is $0 as long as the account-wide totals, including Shiva and the executor, stay
inside the allowances. Phase 5 records the actual figures from the account's
GraphQL analytics after the E2E.

### Alternatives rejected

| Option | Why rejected |
|---|---|
| D1 | It is async everywhere and has no interactive transactions (`batch()` cannot branch on values it read). We would have to rewrite 52+ transactions and add awaits to about 125 call sites. `ArcaIssuerProfileRegistry`'s synchronous `Map.get` would break, and the feature store's single-writer mutex would need distributed locking. That is several days of risky rewriting for no cost benefit. |
| Hyperdrive + Postgres (incl. reusing BUFI Supabase) | It brings a fixed-cost external database back, the full async rewrite, and ARCA tax state in the Desk database. It defeats the goal. |
| Store-per-DO with the handler in the Worker | Every store call becomes an async RPC, which is the D1 cascade again. |
| Cloud Run with SQLite on GCS FUSE / Litestream | It scales to zero, but SQLite on network storage with several writers is unsafe, and it is new infrastructure. |
| Keep the VM, stopped when idle | That is the current interim state (about $4/month). It is not zero, and someone has to remember to start the VM. |
| Leave the signers wherever they run and give the boundary a public signer route | It re-exposes payload resolution and WSAA tickets to the internet behind a single bearer each. The binding is cheaper and private. |

## What stays off Workers

**Nothing in scope.** Phase 0 passed every gate it ran; the one failing API
(`X509Certificate.checkPrivateKey`) has an in-process replacement. The table
keeps each fallback with its status, so a later failure (e.g. a host not yet
probed) still has a decided home at $0.

| If this fails | Fallback | Status after Phase 0 |
|---|---|---|
| Workers outbound TLS to `wsaahomo.afip.gov.ar` / `wsaa.afip.gov.ar` / `awshomo.arca.gob.ar` / the WSFE and WSFEX hosts | A stateless egress relay on **Cloud Run with min-instances=0** that forwards the already-signed SOAP body to ARCA. It holds no keys and no state: the boundary still signs the CMS, and the relay only pipes bytes. Only the SOAP base URLs change. ($0 inside the Cloud Run free tier.) | **Not needed** for `wsaahomo.afip.gov.ar` and `wswhomo.afip.gov.ar` (TLS OK from Cloudflare egress). `awshomo.arca.gob.ar` (padrón, `padron.ts:6`): TLS OK (Phase 0b). Production hosts `wsaa.afip.gov.ar` / `servicios1.afip.gov.ar` not probed: Phase 7. |
| `@reclaimprotocol/js-sdk` 5.8.0 does not bundle or run in workerd, or exceeds startup CPU | Move `verifyProof` / `ReclaimProofRequest` behind the same kind of scale-to-zero Cloud Run endpoint, or behind the existing `reclaim-proof-vault` if it already runs elsewhere. ($0.) | **Not needed.** 5.8.0 bundles (+~1,380 KiB raw / +~297 KiB gzip) and evaluates at module scope; startup 38 ms. |
| `generateKeyPairSync('rsa')` is missing or differs in workerd | Use node-forge's **synchronous** `pki.rsa.generateKeyPair({ bits: 2048 })` and `pki.privateKeyToPem` (wrapped to pkcs8). forge is already used by `createCsr` in `setup.ts`. Do **not** use `crypto.subtle.generateKey`: it is async, and `createEnrollment` (`setup.ts:280`) and its callers are synchronous. | **Not needed.** `generateKeyPairSync('rsa')` works in workerd (78–107 ms CPU); signatures byte-identical to Bun/Node. |
| `X509Certificate` fields differ in workerd (subject, `fingerprint256`, `validFrom`/`validTo`) | Parse with node-forge and compute the fingerprint from the DER, producing the exact Bun/Node formats. | **Not needed.** subject, `fingerprint256`, `validFrom`/`validTo` + `Date.parse`, `checkIssued`, `verify` all identical. |
| `X509Certificate.checkPrivateKey` (`setup.ts:340`) | Compare SPKI DER: `createPublicKey(createPrivateKey(pem)).export({type:'spki',format:'der'})` vs `certificate.publicKey.export({type:'spki',format:'der'})`. Same `node:crypto`, still synchronous, works on Bun too, so one code path. Chosen over node-forge (smaller). | **FAILED in workerd** (returns `false` for the matching key; `KeyObject.equals` also `false`). **Fallback applied** in Phase 1. |

Out of scope: `wsfecred` and `reclaim-proof-vault`. Neither is on the VM. Note
that `wsfecred`'s `wsaa.ts` also calls the boundary's `/v1/wsaa/tickets`; after
cutover it **cannot** reach the boundary from outside Cloudflare. That is
accepted because `wsfecred` is not wired into the Tax API today (no
`WSFECRED_*` read in `apps/api/src`). Moving it later is the same recipe as the
signers.

## Data migration decision

**Discard the homologation data on the VM. Copy nothing.**

- The VM is homologation-only (`ARCA_ENVIRONMENT: homologation`). There is no
  production data anywhere.
- Discarding means no data import endpoint, no plaintext dump, and no copying of
  sealed ARCA private keys between machines. A new homologation MASTER_KEY is
  generated for the boundary Worker.
- Re-provisioning the homologation issuer through the automated setup flow is the
  acceptance test of the new stack (Phase 5). Delegated mode
  (`ARCA_SETUP_PROVIDER_TEMPLATE_*`, `index.ts:62-67`) is **kept**: the template
  credential is re-imported and delegations re-activated through the operator
  proxy to `AdminEntrypoint` (Phase 3, Phase 5).
- **STOP:** if, before Phase 6, the owner says a homologation issuer credential on
  the VM is hard to re-create, do not build an import path ad hoc. Write a
  separate plan for an admin-gated, chunked, one-off import that keeps MASTER_KEY
  unchanged so the ciphertext moves byte for byte.

## Phases

The estimates assume one focused implementer. **Total: about 6 days**, including
spikes (Phase 0 done: about 5.25 days remain, Phase 0b included). The first draft said 3 days; the signers, the work-driven alarm, the
admin path, the durable-guard conversions and the longer spike list add about 3.

### Phase 0: Spikes (gate) · 1 day · DONE 2026-10-26

Results are in "Spike results". Gates 1–4 passed (2 with one fallback); gates 5
and 6 and a few items of gate 1 and 3 were not exercised and move to Phase 0b,
Phase 3 and Phase 5 as noted there. The text below is the original brief, kept
for reference.

Build a throwaway Worker in a scratch directory **outside the repo** (copy the
`apps/arca-setup-executor/wrangler.jsonc` shape). Deploy it as
`tax-spike-homologation` and delete it afterwards. Prove each of the following,
recording only pass/fail and versions, never secret values:

1. **DO SQLite feature parity.** Inside a DO, check that these work through
   `ctx.storage.sql`: `PRAGMA table_info(x)`, `PRAGMA user_version` read and
   write (used by `wsfex-signer/src/store.ts:363,368,461`), `ALTER TABLE ADD
   COLUMN`, partial unique indexes, `ON CONFLICT DO UPDATE ... WHERE`, `FOREIGN
   KEY ... ON DELETE RESTRICT` enforcement, `SELECT changes()` /
   `cursor.rowsWritten`, and `exec` of a **multi-statement** string. Confirm which
   PRAGMAs are rejected (expected: `journal_mode`, `busy_timeout`,
   `secure_delete`, `database_list`, `wal_checkpoint`). Check that a throw inside
   `transactionSync` rolls back, and that **nested** `transactionSync` behaves
   (bun nests via savepoints). If `user_version` is rejected, the adapter keeps it
   in a one-row `_sql_store_meta` table.
2. **Crypto in workerd (nodejs_compat).** Run the same fixtures under Bun and in
   the Worker and compare outputs byte for byte:
   - `generateKeyPairSync('rsa', {modulusLength:2048})` with a pkcs8 export, and
     its CPU ms;
   - `new X509Certificate(pem)`: `.subject` string format (the boundary's
     `serialNumber=CUIT` regex depends on it), `.fingerprint256` formatting
     (`setup.ts:329`), and `Date.parse(validFrom/validTo)` results
     (`setup.ts:335,343`);
   - `createPrivateKey` + `checkPrivateKey` (`setup.ts:340`), `checkIssued` /
     `verify(publicKey)` (`setup.ts:436`);
   - `createCipheriv` / `createDecipheriv` aes-256-gcm with AAD and `hkdfSync`
     (`crypto.ts:1`).

   Any format difference becomes a silent rejection or an expiry failure, so a
   mismatch is a fail even if nothing throws.
3. **Outbound TLS.** Run a real `LoginCms` POST to `wsaahomo.afip.gov.ar`, a
   GET/POST to `awshomo.arca.gob.ar/sr-padron`, and a WSFE and a WSFEX `Dummy`
   call from the deployed Worker. Any HTTP status passes; a TLS or handshake
   error fails.
4. **Bundling and startup.** `wrangler deploy --dry-run` of the API, boundary and
   both signer entries (importing `@reclaimprotocol/js-sdk`, node-forge,
   fast-xml-parser, zod, decimal.js). Check the **compressed** size is under the
   Workers Paid limit of **10 MB** (as wrangler prints it). Deploy the API entry
   once and confirm it passes the Worker **startup CPU limit**: Reclaim SDK
   (`reclaim.ts:10`, `arca-onboarding-reclaim.ts:1`), node-forge and zod all
   evaluate at module scope. Check that `verifyProof` can be imported and called
   with a malformed proof.
5. **Billing and env behaviour.** Confirm that `process.env` is populated from
   bindings and secrets at module scope with `compatibility_date: 2026-10-20` +
   `nodejs_compat`. Measure the billed DO duration of one wake followed by
   silence (account GraphQL `durableObjectsPeriodicGroups`), to replace the
   140 s assumption in "Cost". Check whether `fetch` from a Worker to a public
   host in the same account (Shiva's custom domain, any `*.workers.dev`) works;
   if not, any such Tax API outbound URL (`TAX_DOMAIN_EVENT_OPEN_AGENTS_URL`,
   `TAX_FACTURA_E_FEATURE_EVENT_URL`, etc.) also becomes a service binding.
6. **Secret sizes.** Workers vars and secrets are capped at about 5 KB each.
   Measure the launch-policy JSON (code cap 64 KiB,
   `argentina-launch-policy.ts:10`) and the ARCA trusted-issuer PEM bundle. Any
   value over 5 KB ships as a bundled module asset (a `.txt` / `.json` import),
   not a secret. Neither is secret, so that is acceptable.

**Done:** all six results are written into this plan under "Spike results".
**STOP:** if 1 fails, the adapter approach is dead; re-plan. If 2–4 fail, apply
the matching fallback from "What stays off Workers" and continue. If 5 shows
idle duration is billed for much longer than 140 s, re-check the "Cost" table
before continuing.

### Phase 0b: Residual checks · 0.25 day · DONE 2026-10-27

Same throwaway recipe as Phase 0 (scratch dir outside the repo, deploy, delete,
record pass/fail only, never secret values). Each item names its fallback, so
none of them blocks the plan:

1. DO SQLite, the statements Phase 0 did not run: `ALTER TABLE ... ADD COLUMN`,
   a partial unique index (`CREATE UNIQUE INDEX ... WHERE`), `INSERT ... ON
   CONFLICT(...) DO UPDATE SET ... WHERE`, and `SELECT changes()` /
   `SELECT last_insert_rowid()` issued as a **separate** `exec` right after an
   INSERT/UPDATE (proves the adapter's `run()` result; `cursor.rowsWritten` is
   not usable, it counts index writes). Fallback if `changes()` is wrong: add
   `RETURNING 1` in the adapter's `run()` for DML and count rows.
2. `awshomo.arca.gob.ar` TLS: GET `.../personaServiceA5?WSDL`. Any HTTP status
   passes. Fallback: Cloud Run relay for that host only.
3. `process.env` at module scope with `compatibility_date: 2026-10-20` +
   `nodejs_compat`: a var and a secret are both visible at module evaluation and
   inside `fetch`. Fallback: the composition roots already take `env`; set
   `process.env` from `env` at the top of each DO constructor before
   `create*()` runs. That is sufficient because every module-scope
   `process.env` read is in an `index.ts`, which stays the Bun entry; the other
   ~120 reads run at call time (grepped 2026-10-27).
4. Outbound `fetch` from a Worker to a `*.workers.dev` URL of another Worker in
   the same account. Only matters if an owner-set Tax API outbound URL
   (`TAX_DOMAIN_EVENT_OPEN_AGENTS_URL`, `TAX_FACTURA_E_FEATURE_EVENT_URL`,
   `TAX_FACTURA_E_FEATURE_SIGNER_URL`, `TAX_ENGINE_ARCA_PREPARATION_URL`,
   `TAX_DESK_FACTURA_E_PRIVATE_DATA_URL`, `RECLAIM_PROOF_VAULT_URL`) points at
   one. None of them is set on the VM today (`deploy/gcp-vm/*` has no hit), so
   record the result and move on. Fallback: a service binding for that target.

Deferred, not spikes: billed idle DO duration is measured in Phase 5 from the
real deploy; secret sizes are moot (see Phase 2: the trusted-issuer bundle and
any launch policy ship as bundled text modules, not secrets).

**Done:** four results appended to "Spike results".

### Phase 1: SQL adapter, stores take a database · 1.25 days · DONE 2026-10-27

The adapter is the only new abstraction. Stores keep accepting a path, which keeps
Bun, tests and the VM unchanged, and can also accept an injected database.

New files:
- `packages/sql-store/package.json` (`@tax-engine/sql-store`, picked up by the
  `packages/*` workspace glob).
- `packages/sql-store/src/index.ts` contains the `SqlDatabase` interface. Derive
  the exact subset by grepping `this.#db.` across the ten store files (the eight
  API/boundary stores plus `apps/wsfe-signer/src/store.ts` and
  `apps/wsfex-signer/src/store.ts`); do not guess it. The contract must pin:
  - `query(sql).get(...)` returns **`null`** when there is no row (bun's
    behaviour). The DO impl must not use `cursor.one()` (throws) or
    `toArray()[0]` (undefined) without mapping to `null`.
  - `query(sql).all(...)` returns an array; `run(...)` returns
    `{ changes, lastInsertRowid }`.
  - `prepare` / `query` caching: DO `sql.exec` has no prepared statements, so the
    DO impl returns a statement object that re-executes the SQL on each call.
  - `exec(sql)` takes **no parameters** and accepts multi-statement strings
    (the migration blocks in `store.ts`). DO SQL refuses bindings on a
    multi-statement call (spike 1g); the interface makes that unrepresentable.
  - BLOB values: DO returns `ArrayBuffer`, bun returns `Uint8Array`. The DO impl
    maps `ArrayBuffer` → `Uint8Array` on read. (No store declares a BLOB column
    today; the mapping is there so a future one cannot diverge silently.)
  - `run()` gets `changes` from `SELECT changes()`, **never** from
    `cursor.rowsWritten` (spike 1a: it counts index writes). Phase 0b item 1
    confirms `changes()`.
  - Constraint errors: DO throws a plain `Error` with no `.code`; the message
    carries `SQLITE_CONSTRAINT_*`. No store branches on `.code` /
    `SQLiteError` today (grepped), so nothing changes; the contract test only
    asserts that a UNIQUE violation throws on both impls.
  - `transaction(fn)` returns a callable, nestable. DO `transactionSync`
    nests with savepoint semantics (spike 1b/1c), identical to bun. Raw
    `BEGIN`/`SAVEPOINT`/`COMMIT` are refused in DO; the only raw use is
    `arca-boundary/src/rotation.ts:36-85`, which stays a Bun-only CLI.
  - `configure({ wal?, busyTimeoutMs?, secureDelete?, foreignKeys? })`,
    `checkpoint()`, `userVersion` get/set, and a `durable: boolean` flag.
- `packages/sql-store/src/bun.ts` wraps `bun:sqlite`. `configure` issues the
  PRAGMAs as today.
- `packages/sql-store/src/durable-object.ts` wraps `SqlStorage` plus
  `transactionSync`. `configure`'s `wal`, `busyTimeoutMs` and `secureDelete` are
  no-ops (spike 1f: those PRAGMAs are `SQLITE_AUTH`-rejected); `foreignKeys` is
  asserted on (spike 1e: on by default). `checkpoint()` is a no-op.
  `lastInsertRowid` comes from `SELECT last_insert_rowid()`. `userVersion` is
  stored in a table `_sql_store_meta(store TEXT PRIMARY KEY, user_version
  INTEGER NOT NULL)`, keyed by a store name passed at construction, because
  `PRAGMA user_version` is rejected (spike 1f) and several stores may share one
  database.
- `packages/sql-store/src/adapter.test.ts` holds one contract suite, run against
  the Bun impl and against the DO impl driven by a fake `SqlStorage` that is
  itself backed by `bun:sqlite` **with `PRAGMA foreign_keys = ON`**. The fake
  must reproduce what spike 1 found, or the Bun suite will pass on code that
  fails in workerd: reject `journal_mode`, `busy_timeout`, `secure_delete`,
  `database_list`, `user_version` and `wal_checkpoint` PRAGMAs, raw
  `BEGIN`/`SAVEPOINT`/`COMMIT`/`ROLLBACK`, and multi-statement SQL with
  bindings; return BLOBs as `ArrayBuffer`. The fake
  proves the translation logic; the real workerd behaviour is covered by Phase 0
  and the Phase 5 smoke.

Edited files. The constructor accepts `string | SqlDatabase`; **every** PRAGMA
the DO rejects (`journal_mode`, `busy_timeout`, `secure_delete`,
`database_list`, `wal_checkpoint`, `user_version`) moves behind
`configure(...)`, `checkpoint()`, `userVersion` or `durable`. Several of these
PRAGMAs sit **inside** a multi-statement `exec` that also creates tables
(`store.ts:139`, `arca-setup-store.ts:46-47`, `personal-wsfe-attempt.ts:43`,
`arca-issuer-profile-registry.ts:11`, boundary `store.ts:73-75`,
`setup.ts:162-163`, `factura-e-feature-publication.ts:233`, and
`PRAGMA user_version = ...` at the end of the migration string in
`wsfex-signer/src/store.ts` near `:461`); one rejected PRAGMA fails the whole
call in DO, so each must be cut out of the string, not just guarded.
`PRAGMA table_info` and `PRAGMA foreign_keys` are allowed and stay. No method
body otherwise changes:
- `apps/api/src/store.ts`
- `apps/api/src/arca-setup-store.ts`
- `apps/api/src/personal-wsfe-attempt.ts`
- `apps/api/src/arca-issuer-profile-registry.ts`
- `apps/api/src/authority-execution.ts`: it declares `FOREIGN KEY` at `:211` and
  `:225` but only sets WAL (`:154`), so Bun does not enforce them today and DO
  SQLite will. Add `authority-execution.fk.test.ts` that opens the store with
  foreign keys **on** and runs every insert/delete path (create, attach, delete
  in each order the code uses), asserting none throws `FOREIGN KEY constraint
  failed`. Fix any ordering it finds before Phase 3.
- `apps/api/src/factura-e-feature-publication.ts`:
  - **Rename its private `tax_domain_event_outbox` to
    `factura_e_feature_tax_domain_event_outbox` and its index
    `tax_domain_event_outbox_pending` to
    `factura_e_feature_tax_domain_event_outbox_pending`.** Both names are
    identical in `store.ts:239,253` and here (`:313,327`). On one DO database,
    `CREATE ... IF NOT EXISTS` would silently reuse the other store's objects,
    merging the two outboxes, and `drainTaxDomainEventOutbox` iterates
    `[store, facturaEFeatures]` (`index.ts:1026`), so every event would be
    delivered twice.
  - Grep for every literal use of both names in that file and its tests.
  - Keep a Bun-only startup step that renames the old table and index **only
    when this store's database is a different file from `store.ts`'s**. Today
    `ArcaSetupStore` falls back to `TAX_ENGINE_DB_PATH`
    (`arca-setup-store.ts:43`); check every `*_DB_PATH` fallback so that no
    configuration lets the feature store resolve to the tax-engine file. If the
    two paths are equal, refuse to start (`FACTURA_E_FEATURE_DB_SHARED_WITH_TAX_ENGINE`)
    rather than rename `store.ts`'s live table. `store.ts:462` migrates columns
    on `tax_domain_event_outbox`, so this step must run before
    `TaxProfileStore` is constructed on the VM until the rename has landed.
  - Replace `assertDurableDatabasePath` (`:2116`) and
    `assertDurableDatabaseBacking`'s `realpathSync` + `PRAGMA database_list`
    (`:2129`) with `db.durable === true` when an adapter is injected, keeping
    the path checks for the path form.
- `apps/arca-boundary/src/store.ts`, `apps/arca-boundary/src/setup.ts`:
  `wal_checkpoint(TRUNCATE)` (`store.ts:211,301`) goes behind
  `db.checkpoint()`; the PRAGMA blocks (`store.ts:73-75`, `setup.ts:162-163`)
  go behind `configure`.
- `apps/wsfe-signer/src/store.ts`, `apps/wsfex-signer/src/store.ts`: the same,
  plus `user_version` through the adapter (`wsfex` reads it at `:363` and writes
  it at `:368` and in the migration string near `:461`).
- `apps/arca-boundary/src/setup.ts:340` (crypto fallback from spike 2c): replace
  `certificate.checkPrivateKey(createPrivateKey(pem))` with a local
  `certificateMatchesPrivateKey(certificate, pem)` that compares
  `createPublicKey(createPrivateKey(pem)).export({ type: 'spki', format: 'der' })`
  with `certificate.publicKey.export({ type: 'spki', format: 'der' })` by bytes.
  Keep the error `ARCA_SETUP_CERTIFICATE_KEY_MISMATCH`. Add a test (Bun) with a
  matching key → accepted and a different key → that error. Nothing else in the
  X.509 path changes: `fingerprint256` is lowercased and stripped of colons
  (`:329`), so its case is irrelevant; `serialNumber` is not read outside test
  fixtures; `validFromDate` is not used; `checkIssued` is only used in a boolean
  `&&` (`:436`), where bun's PEM-string return and workerd's `true` agree; the
  GCM tamper message differs but no code matches on it.

**Verify:**
```
cd /Users/criptopoeta/coding-dojo/BUFI/.codex-worktrees/tax-arca-connect
bun run typecheck
bun test
bun test packages/sql-store
```
**Done:** all existing store tests pass unmodified, apart from the renamed table
and index in the feature-store tests. The adapter contract suite passes on both
implementations, and the authority-execution FK test passes.

### Phase 2: Split the composition roots from `Bun.serve` · 1 day · DONE 2026-10-27

As built: `createTaxApi` returns `{ fetch, tick, loops, executionMode }`;
`tick()` runs the three loop bodies once and `loops` drives the Bun
`setInterval`s. `nextWakeAt` and the per-loop `nextDueAt` are Phase 3 work, as
that phase specifies them.

Env handling: about 120 `process.env` reads live outside `index.ts` (e.g.
`arca-setup-store.ts:43`, `authority-execution.ts:147`, `wsfe-signer/src/contracts.ts:279`).
Rewriting them all is not the smallest change. Instead, rely on `nodejs_compat`
populating `process.env` from vars and secrets (confirmed in spike 5), and pass
`env` explicitly only through the new composition roots. Consequence, recorded
here deliberately: **every secret bound to a Worker is visible to every module
in that DO isolate.** That is why the boundary keys live only on the boundary
Worker.

- `apps/api/src/app.ts` (new). Move the wiring in `index.ts:104-552` and the
  handler at `:554+` into `createTaxApi({ env, openDatabase(name), fetchers })`.
  It returns `{ fetch(request), tick(now), nextWakeAt(now) }` (see Phase 3).
  - `openDatabase` receives the logical names `tax-engine` (shared by
    `TaxProfileStore` **and** `ArcaIssuerProfileRegistry`, which is opened on
    `resolveTaxEngineDatabasePath()` at `index.ts:390-392`), `arca-setup`,
    `authority-execution`, `factura-e-feature` and `personal-wsfe`.
  - On Bun, the names map to the existing `*_DB_PATH` env vars and keep today's
    fallbacks.
  - On the DO, every name returns the same `SqlDatabase`. The table and index
    names are disjoint after the Phase 1 rename. Verify with a test that opens
    every store on one database and checks there are no duplicate `CREATE
    TABLE` / `CREATE INDEX` names.
  - `fetchers` carries optional `Fetcher`s for the boundary, the boundary admin
    entrypoint, both signers and the executor. **Thread them through the
    existing `fromEnvironment()` factories** by adding an optional `fetcher`
    argument: `HttpArcaBoundaryStatusReader` (`arca-connection-projection.ts:48`),
    `HttpAuthorityPayloadWriter` (`authority-payload.ts:84`),
    `HttpArcaSetupBoundaryGateway` (`arca-setup-clients.ts:167`),
    `HttpArcaSetupExecutorGateway` (`arca-setup-clients.ts:67`),
    `HttpWsfexGateway` (`wsfex.ts:100`) and `HttpWsfePointOfSaleGateway`
    (`wsfe.ts:29`). The constructors already accept a fetcher; only the
    factories drop it today. On Bun nothing is passed, so behaviour is unchanged.
  - Convert every durable-store guard that inspects env paths to
    `database.durable`, not just the two named earlier:
    `index.ts:516-518` (`TAX_ARCA_SETUP_DURABLE_STORE_REQUIRED` under
    `NODE_ENV=production` once `*_DB_PATH` is dropped), `store.ts:75-80`
    (`TAX_ENGINE_DB_PATH_REQUIRED_IN_PRODUCTION` / `_BETA`), and the factura
    checks from Phase 1. On the DO they pass because `durable === true`; on Bun
    they keep the path checks.
- `apps/api/src/index.ts` becomes the Bun entry: `Bun.serve` + `createTaxApi` +
  the existing three `setInterval`s calling the three loop functions. VM
  behaviour is unchanged.
- `apps/api/src/argentina-launch-policy.ts`: also accept the policy JSON as a
  string argument from the composition root (capped at the same 64 KiB), with
  the path form `TAX_ENGINE_ARGENTINA_LAUNCH_POLICY_PATH` (`:16`) kept on Bun.
  The VM never set a policy, so the homologation Worker passes none. If the
  owner later supplies one, it ships as a bundled text module (wrangler
  `rules: [{ type: "Text", globs: ["**/*.json.txt"] }]`), not a var or secret,
  which sidesteps the ~5 KB var limit without measuring.
- `apps/arca-boundary/src/app.ts` (new): move `index.ts:14-84,116-128` into
  `createBoundary({ env, database })`.
  - Keys load from the base64 env values only. The `*_FILE` forms stay on the Bun
    path.
  - Trusted issuers come from a `trustedIssuersPem` string argument (on the
    Worker, an optional bundled text module, same mechanism as the launch
    policy), with `ARCA_SETUP_TRUSTED_ISSUERS_FILE` kept on Bun. They are only
    **required** in production (`setup.ts:155-156`, `:348`); homologation
    reports `chainVerified: false` and proceeds, exactly as on the VM today.
  - The `:memory:` refusal becomes `database.durable === true`.
- `apps/arca-boundary/src/index.ts` becomes the Bun entry.
- `apps/wsfe-signer/src/app.ts`, `apps/wsfex-signer/src/app.ts` (new): move each
  `index.ts` module-scope wiring and the `Bun.serve` handler into
  `createWsfeSigner({ env, database, boundaryFetcher })` /
  `createWsfexSigner(...)`, returning `{ fetch }`. `HttpAuthorityPayloadVault`
  and `HttpWsaaTicketBroker` already accept a fetcher (`vault.ts:20`,
  `wsaa.ts:40-41`); pass `boundaryFetcher` through. The
  `*_SIGNER_DURABLE_DB_REQUIRED` `:memory:` refusals become
  `database.durable === true`. Each `index.ts` becomes the Bun entry.

**Verify:** `bun run typecheck && bun test`. Then run the four Bun entries
locally with the dev env and check that `/health` answers on each.
**Done:** images built from this commit behave exactly as before. The existing
tests pass.

### Phase 3: Tax API Worker · 1 day · DONE 2026-10-27

As built, where it differs from the text below:
- `bun:sqlite` is in the bundle graph (stores import the Bun adapter for the
  path form), so `wrangler.jsonc` aliases it to
  `packages/sql-store/src/bun-sqlite-unavailable.ts`, which throws if a store
  is ever handed a path on Workers. Phases 4 and 4b need the same alias.
- `nextWakeAt(now)` is a separate method; `tick()` still returns nothing, and
  the DO calls `reschedule()` after it. Each loop's work and wake:
  - Factura E: work is a projection candidate (`projectionCandidates(1)`: an
    active consent or head; expiry and source changes are only observed by
    projecting) or a `pending`/`inflight` outbox row → `now + poll interval`.
    The text below lists only the outbox; without the candidates a consent
    would never expire or re-project on Workers. Consequence: while any
    consent is active the DO wakes every 1–10 s. The feature is off unless
    `TAX_FACTURA_E_FEATURE_PUBLICATION_ENABLED=true`; revisit before enabling
    it on Workers (e.g. wake at the earliest consent expiry instead).
  - Tax-domain outboxes: the earliest undelivered `leased_until` (now if
    unleased), always floored at `now + poll interval` so a failing publisher
    cannot spin the alarm.
  - ARCA setup: an open session **or** a `cleanup_pending` row → `now + tick`.
- The operator proxy returns 404 (proxy off) when `TAX_OPERATOR_PROXY_TOKEN`
  is missing, shorter than 32 chars or equal to any other env value; 401 for a
  missing/wrong header; 404 for any path/method outside the allowlist. It drops
  the query string and the proxy header before forwarding.
- `wrangler dev --local` needs `--var NODE_ENV:development` (the config's
  `NODE_ENV=production` requires every production credential).
- Measured: dry-run bundle 3,438 KiB / **660 KiB gzip**; local `wrangler dev`
  `/health` → 200; idle `nextWakeAt` → `null` (unit test on the real
  `createTaxApi` over the fake DO storage).

- `apps/api/wrangler.jsonc` (new), copying the executor's shape:
  - `name: bufi-tax-api-homologation`, `main: src/worker.ts`,
    `compatibility_date: 2026-10-20`, `compatibility_flags: ["nodejs_compat"]`,
    `observability.enabled: true`, `workers_dev: true`, `preview_urls: false`.
  - DO binding `TAX_STATE` / class `TaxState` with migration
    `new_sqlite_classes: ["TaxState"]`. Optionally a `locationHint` (e.g.
    `enam`) when first creating the stub; DO placement otherwise follows the
    first request and is not guaranteed.
  - `services`:
    - `{ binding: "ARCA_BOUNDARY", service: "bufi-arca-boundary-homologation" }`
    - `{ binding: "ARCA_BOUNDARY_ADMIN", service: "bufi-arca-boundary-homologation", entrypoint: "AdminEntrypoint" }`
    - `{ binding: "WSFE_SIGNER", service: "bufi-wsfe-signer-homologation" }`
    - `{ binding: "WSFEX_SIGNER", service: "bufi-wsfex-signer-homologation" }`
    - `{ binding: "ARCA_SETUP_EXECUTOR", service: "bufi-arca-setup-executor-homologation" }`
      (name verified in the executor's `wrangler.jsonc:4`; this one is added in
      the **second** deploy pass, Phase 5).
  - `triggers.crons: ["0 * * * *"]`: an hourly watchdog only. DO alarms are
    durable and retried, so the cron only covers a lost reschedule.
  - `vars`: `ARCA_ENVIRONMENT=homologation`, `NODE_ENV=production`, and
    synthetic https origins that are never resolved, so `httpsOrigin()` still
    passes: `ARCA_BOUNDARY_URL=https://arca-boundary.internal`,
    `ARCA_SIGNER_URL=https://wsfex-signer.internal`,
    `ARCA_WSFE_SIGNER_URL=https://wsfe-signer.internal`,
    `ARCA_SETUP_EXECUTOR_URL=https://arca-setup-executor.internal`.
  - `env.production` gets its own `name: bufi-tax-api`, its own bindings to the
    production names, its own DO binding, and `ARCA_ENVIRONMENT=production`.
    **Do not deploy the production env in this plan.**
- **Work-driven alarm.** In `app.ts`, each loop gains a cheap, indexed
  `nextDueAt(now): number | null`, returning `null` when its enable flag is off
  **or** it has no pending work:
  - Factura E feature loop: a claimable `factura_e_feature_outbox` row (state and
    `next_attempt_at`, already indexed by `factura_e_feature_outbox_claim_idx`)
    or a held lease that needs renewal → `max(now, earliest due)` but no later
    than `now + facturaEFeaturePollIntervalMs`.
  - Tax-domain outbox: any undelivered row in either outbox
    (`delivered_at IS NULL`; respect `leased_until`) → due at the earliest
    `leased_until` or now, floored at `now + taxDomainEventPollIntervalMs` after a
    failed attempt.
  - ARCA setup: any open setup session → `now + TAX_ARCA_SETUP_TICK_MS` (30 s).
  `nextWakeAt(now)` is the minimum, or `null`. `tick(now)` runs the three
  existing loop bodies (same enable flags and re-entrancy guards) and returns
  `nextWakeAt(now)`. The existing poll intervals stay as validated (Factura E
  1–10 s, tax-domain 1–60 s); they now apply only while work exists.
- `apps/api/src/worker.ts` (new):
  - `export default { fetch, scheduled }`. `fetch` handles the operator proxy
    (below) itself, and forwards everything else to
    `env.TAX_STATE.get(env.TAX_STATE.idFromName('primary')).fetch(req)`.
    `scheduled` calls `stub.reschedule()`.
  - `export class TaxState extends DurableObject`. It calls `createTaxApi({ env,
    openDatabase: () => doDatabase(ctx.storage), fetchers: { boundary:
    env.ARCA_BOUNDARY, wsfe: env.WSFE_SIGNER, wsfex: env.WSFEX_SIGNER, executor:
    env.ARCA_SETUP_EXECUTOR } })` lazily on first use.
  - `fetch` delegates to the app, then calls `reschedule()` (a request can
    enqueue outbox rows or open a setup session).
  - `alarm()` runs `app.tick(now)` and then `reschedule()`.
  - `reschedule()`: `t = app.nextWakeAt(now)`. If `t === null`,
    `deleteAlarm()`. Otherwise set the alarm to `t` when no alarm is pending or
    the pending one is later. **The alarm is never set unconditionally.**
- **Operator proxy (replaces the VM's private-network admin access).** In the
  stateless `fetch`, a request whose pathname starts with
  `/v1/operator/arca-boundary/` is accepted only if header
  `x-bufi-operator-token` equals secret `TAX_OPERATOR_PROXY_TOKEN` (timing-safe,
  ≥32 chars, distinct from every other token). The prefix is stripped and the
  request is forwarded to `env.ARCA_BOUNDARY_ADMIN`, which serves only the four
  admin routes; the boundary still checks `ARCA_BOUNDARY_ADMIN_TOKEN` in
  `Authorization`. Likewise `/v1/operator/wsfe-signer/health` and
  `/v1/operator/wsfex-signer/health` forward a GET `/health` to the signer
  bindings (the signer still checks its API token). Nothing else is proxied.
  Script changes:
  - `activate-delegated-issuer.ts`: build boundary URLs relative to a base that
    may carry a path (`new URL('v1/wsaa/issuers/delegations', base + '/')`),
    and send `x-bufi-operator-token` from env when set.
  - `homologation.ts` `probeWsfexHomologationSigner` /
    `probeWsfeHomologationSigner`: accept optional extra headers;
    `homologation-cli.ts` passes `x-bufi-operator-token` when
    `TAX_OPERATOR_PROXY_TOKEN` is set.
  - The issuer import (`/v1/wsaa/issuers`) and `retire-eligible` callers, if
    scripted, get the same change.
- `apps/api/src/worker.test.ts` (Bun): unit-test `reschedule()` against a fake
  storage (no pending work → `deleteAlarm`, pending → earliest time, never
  unconditional), and the operator-proxy filter (missing/wrong token → 401,
  non-admin path → 404, encoded dot segments such as `%2e%2e` cannot escape
  the prefix).
- `apps/api/package.json`: add `wrangler` (same version as the executor,
  4.151.3), `@cloudflare/workers-types`, and the scripts
  `"worker:dev": "wrangler dev"`, `"worker:deploy": "wrangler deploy"`,
  `"worker:build": "wrangler deploy --dry-run --outdir dist-worker"`.
- `apps/api/tsconfig.json`: make sure `worker.ts` type-checks with workers-types
  without breaking the Bun types. Use a separate `tsconfig.worker.json` if the two
  type sets clash, and add it to the package's `typecheck`.

**Verify:**
```
cd apps/api && bun run typecheck && bun test src && bunx wrangler deploy --dry-run --outdir dist-worker
bunx wrangler dev --local   # then: curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8787/health
```
**Done:** the dry-run bundle builds and wrangler's printed **gzip** size is
under 10 MB (expected: low single-digit MB; the Reclaim SDK alone is ~297 KiB
gzip), local `wrangler dev` answers `/health`, and
with no pending work no alarm is set (`getAlarm()` returns `null`). Every
existing api test still passes under Bun.

### Phase 4: Boundary Worker · 0.5 day

- `apps/arca-boundary/wrangler.jsonc` (new): `name:
  bufi-arca-boundary-homologation`, **`workers_dev: false`, `preview_urls:
  false`, no `routes`**, DO `BOUNDARY_STATE` / `BoundaryState` with
  `new_sqlite_classes`, `nodejs_compat`, observability on, `vars: {
  ARCA_ENVIRONMENT: homologation, NODE_ENV: production }`, and an
  `env.production` block with `name: bufi-arca-boundary`. **Never use `wrangler
  versions upload` for the boundary or the signers**: version and preview URLs
  can expose them. Deploy only with `wrangler deploy`.
- `apps/arca-boundary/src/worker.ts` (new):
  - `export class BoundaryState extends DurableObject` builds `createBoundary({
    env, database: doDatabase(ctx.storage) })` and serves `fetch`. No alarm.
  - The default export forwards everything to `idFromName('primary')`. The Tax
    API uses it.
  - `ExecutorEntrypoint`, `SignerEntrypoint` and `AdminEntrypoint` extend
    `WorkerEntrypoint`. Each calls a pure exported
    `allowedFor(entrypoint, method, pathname)` on `new URL(request.url).pathname`
    and either forwards to the DO or answers 404.
- `apps/arca-boundary/src/worker.test.ts` (new) tests `allowedFor`:
  - executor: only POST `/v1/setup/executor/{taxpayer-match,csr,certificate}`;
  - signer: only POST `/v1/authority-payloads/resolve`, POST `/v1/wsaa/tickets`,
    GET `/health`;
  - admin: only the four admin routes;
  - for each, admin/payload/WSAA/status/setup paths outside the list return 404,
    and URLs with encoded dot segments (`/v1/setup/executor/%2e%2e/wsaa/tickets`,
    `%2E%2E`, `..%2f`) are judged on the normalised pathname, exactly as
    `http.ts` would route them.
- `apps/arca-boundary/package.json`: the same wrangler, types and scripts as
  Phase 3.
- Key rotation (`rotation.ts` / `rotate-key.ts`) stays a Bun CLI for VM/local
  stores. On Workers in homologation, rotating means a new deployment, a fresh
  MASTER_KEY and re-provisioning. **This is a production blocker** (see Phase 7).

**Verify:**
```
cd apps/arca-boundary && bun run typecheck && bun test src && bunx wrangler deploy --dry-run --outdir dist-worker
```
**Done:** the dry-run builds, and the entrypoint filter tests pass.

### Phase 4b: Signer Workers · 0.5 day

For each of `apps/wsfe-signer` and `apps/wsfex-signer`:
- `wrangler.jsonc` (new): `name: bufi-wsfe-signer-homologation` /
  `bufi-wsfex-signer-homologation`, `main: src/worker.ts`, `nodejs_compat`,
  `workers_dev: false`, `preview_urls: false`, no routes, observability on, DO
  `SIGNER_STATE` / `WsfeSignerState` / `WsfexSignerState` with
  `new_sqlite_classes`, `services: [{ binding: "ARCA_BOUNDARY", service:
  "bufi-arca-boundary-homologation", entrypoint: "SignerEntrypoint" }]`, vars
  `ARCA_ENVIRONMENT=homologation`, synthetic `*_SIGNER_VAULT_URL` /
  `*_WSAA_BROKER_URL=https://arca-boundary.internal`, and an `env.production`
  block with its own names. Production is not deployed.
- `src/worker.ts` (new): default export forwards to `idFromName('primary')`; the
  DO builds the Phase 2 `create*Signer({ env, database:
  doDatabase(ctx.storage), boundaryFetcher: env.ARCA_BOUNDARY })` lazily. No
  alarm.
- `package.json`: the same wrangler, types and scripts as Phase 3.

**Verify:** `bun run typecheck && bun test src && bunx wrangler deploy --dry-run --outdir dist-worker` in each.
**Done:** both dry-runs build.

### Phase 5: Wire the executor, deploy homologation, end-to-end · 1 day

- `apps/arca-setup-executor/wrangler.jsonc`:
  - add `services: [{ binding: "ARCA_BOUNDARY", service: "bufi-arca-boundary-homologation", entrypoint: "ExecutorEntrypoint" }, { binding: "TAX", service: "bufi-tax-api-homologation" }]`;
  - set the vars `ARCA_BOUNDARY_URL` and `TAX_RECEIPT_URL` to synthetic https
    origins;
  - give the production env its own bindings to the production names.
- `apps/arca-setup-executor/src/index.ts` / `session.ts`: inject
  `env.ARCA_BOUNDARY.fetch` into the boundary client, and make the receipt POST
  at `session.ts:420` (today `fetch(this.env.TAX_RECEIPT_URL, ...)`) go through
  `this.env.TAX.fetch(...)`, keeping the URL only as the request URL.
- `apps/arca-setup-executor/src/env.ts`: add the two `Fetcher` bindings to the
  type.
- Secrets. Values never touch the terminal or disk. For each Worker, pipe Secret
  Manager into `wrangler secret bulk` on stdin through a small `bun -e` that turns
  `KEY=VALUE` lines into JSON:
  - boundary from `tax-homologation-boundary-env`, but **generate a fresh**
    `ARCA_BOUNDARY_MASTER_KEY` (because the data is discarded);
  - API from `tax-homologation-api-env`, plus a freshly generated
    `TAX_OPERATOR_PROXY_TOKEN`;
  - signers: no VM source exists. Reuse a Secret Manager entry if one exists;
    otherwise generate. Linked pairs must hold one value each:
    `ARCA_SIGNER_TOKEN` (API) = `WSFEX_SIGNER_API_TOKEN`,
    `ARCA_WSFE_SIGNER_TOKEN` (API) = `WSFE_SIGNER_API_TOKEN`,
    `WSF{E,EX}_SIGNER_VAULT_TOKEN` = boundary `ARCA_BOUNDARY_PAYLOAD_RESOLVE_TOKEN`,
    `WSF{E,EX}_WSAA_BROKER_TOKEN` = boundary `ARCA_BOUNDARY_WSAA_TOKEN`.
  - Drop these keys: `*_DB_PATH`, `*_FILE`, `PORT`, `*_HOST`, and every URL var
    now set as a synthetic origin in `vars`.
  - Trusted issuers: the VM never set `ARCA_SETUP_TRUSTED_ISSUERS_FILE` (no hit in
    `deploy/gcp-vm/*`), so today's list is empty and `verifyChain` returns false
    (`setup.ts:432-440`). That is allowed in homologation (only production
    requires a chain, `setup.ts:155-156,348`), so the Worker ships **no** bundle,
    matching the VM. Adding the official ARCA homologation CA is optional and a
    production prerequisite (Phase 7). Likewise the VM never set
    `TAX_ENGINE_ARGENTINA_LAUNCH_POLICY_PATH`; the Worker passes no policy
    unless the owner supplies one.
  - Before applying, list key names only (`wrangler secret list`) and diff them
    against the env-name list the code reads.
  - Write the converter to the session scratchpad, not the repo.
- **Deploy order (two-pass first deploy)**, each followed by its check:
  1. boundary: `wrangler deploy`. Confirm no `workers.dev` and no preview URL: a
     `curl` to `https://bufi-arca-boundary-homologation.<sub>.workers.dev/health`
     must fail to resolve or return a non-boundary response.
  2. wsfe-signer and wsfex-signer: `wrangler deploy` each, same check.
  3. API, **pass 1**: `wrangler deploy` with the `ARCA_SETUP_EXECUTOR` binding
     omitted (the executor may not exist yet), then `curl /health` on its
     workers.dev URL.
  4. executor: `wrangler deploy` (binds the API and the boundary).
  5. API, **pass 2**: add the `ARCA_SETUP_EXECUTOR` binding and `wrangler deploy`
     again.
- Re-provision delegated mode through the operator proxy: import the provider
  template credential (`/v1/wsaa/issuers`), then run
  `homologation:activate-delegation` with `ARCA_BOUNDARY_URL` set to
  `https://<tax-api>/v1/operator/arca-boundary` and `TAX_OPERATOR_PROXY_TOKEN`
  in the shell env (never printed).
- Point the Desk dev/erp-beta Tax URL at the new API URL only after the E2E below
  passes. Use the env var name Desk reads; record the name, not the value.

**Verify (E2E, homologation):**
```
TAX=https://bufi-tax-api-homologation.<sub>.workers.dev
curl -s -o /dev/null -w '%{http_code}\n' "$TAX/health"
bun run homologation:probe-signer       # ARCA_SIGNER_URL=$TAX/v1/operator/wsfex-signer
bun run homologation:probe-wsfe-signer  # ARCA_WSFE_SIGNER_URL=$TAX/v1/operator/wsfe-signer
```
(`homologation:validate` is not a URL check: `validate-report` reads an evidence
file and `preflight` reads only the local env, `homologation-cli.ts:6-14`.)

Then run one full automated "Connect my ARCA" setup run on homologation. It must
reach `connected`, which proves boundary enrollment, CSR, certificate import, the
WSAA ticket, the executor routes over the binding, receipts over the binding, and
the alarm-driven setup ticks. Then issue one homologation Factura C (WSFE) and
one Factura E (WSFEX) through the Tax API, which proves API → signer → boundary
`SignerEntrypoint` → ARCA.

**Done:** the setup run reaches `connected` and both invoices get a CAE with the
VM **stopped**. `wrangler tail` on all five Workers shows no unhandled errors.
The `TaxState` alarm fires at the loop interval only while setup or outbox work
is open, and `getAlarm()` is `null` within one interval after the work drains.
The account's DO request and duration totals for the test day, and the billed
duration of one idle wake (GraphQL `durableObjectsPeriodicGroups`; this replaces
the 140 s assumption, which Phase 0 did not measure), are recorded under "Spike
results" next to the "Cost" estimate. **STOP** if one idle wake bills far more
than 140 s: re-check "Cost" before Phase 6.

### Phase 6: Cutover and decommission · 0.25 day plus a 7-day soak

- Soak 7 days on Workers with the VM stopped (`deploy/gcp-vm/vm.sh stop`).
  During the soak, check DO duration in account analytics against "Cost".
- Then delete the VM, its persistent disk and the static IP 104.154.28.207. The
  data was already discarded, so take no snapshot.
- Leave the Secret Manager secrets in place, since they still cost cents. Once the
  Workers secrets are the source of truth, mark them deprecated in a note.
- Move `deploy/gcp-vm/` to `deploy/archive/gcp-vm/` with a README line saying it
  was retired and on which date. Do not delete it, because it is the rollback
  recipe.

**Done:** `gcloud compute instances list --project=bufi-vertex-ocr`,
`gcloud compute disks list` and `gcloud compute addresses list` show no Tax
resources. The fixed monthly cost for Tax is $0.

### Phase 7: Production prerequisites (not needed for the cost goal)

These must land before `env.production` is deployed. Track each in its own plan:
- MASTER_KEY rotation as an admin-token-gated, chunked `BoundaryState` method,
  re-sealing within CPU limits.
- `ArcaIssuerProfileRegistry`'s `CHECK (environment = 'homologation')`
  (`arca-issuer-profile-registry.ts:15`, and the literal at `:55`) blocks
  production rows. Decide the production schema and migration.
- A decision on whether the loss of `secure_delete` scrubbing in DO storage is
  acceptable for deleted ciphertext. The rows are sealed, so the residue is
  ciphertext, not plaintext. Record the decision.
- Blast radius: any Worker in account `67f97ad5…` can bind the boundary's default
  entrypoint, and anyone with Workers Scripts:Edit on that shared account can
  deploy code that reads `MASTER_KEY`. That is wider than the VM's Secret Manager
  IAM. Decide whether production needs a dedicated account or scoped API tokens.
- Custom domains (`tax.bu.finance` for the API only). The boundary and signers
  never get one.
- DO point-in-time recovery (30 days, included) accepted as the backup story.
- TLS probe from a Worker to the production ARCA hosts (`wsaa.afip.gov.ar`,
  `servicios1.afip.gov.ar`, and the production padrón host); only homologation
  hosts were probed.
- The official ARCA production CA bundle as a bundled text module
  (`setup.ts:155-156` refuses to start production without it).

## Verification command summary

```
cd /Users/criptopoeta/coding-dojo/BUFI/.codex-worktrees/tax-arca-connect
bun run typecheck
bun test
(cd apps/api && bunx wrangler deploy --dry-run --outdir dist-worker)
(cd apps/arca-boundary && bunx wrangler deploy --dry-run --outdir dist-worker)
(cd apps/wsfe-signer && bunx wrangler deploy --dry-run --outdir dist-worker)
(cd apps/wsfex-signer && bunx wrangler deploy --dry-run --outdir dist-worker)
(cd apps/arca-setup-executor && bun run build)
curl -s -o /dev/null -w '%{http_code}\n' "$TAX/health"
bun run homologation:probe-signer && bun run homologation:probe-wsfe-signer
```

## Done criteria (whole plan)

1. Every existing test passes under Bun, and the VM image still works from the same
   commit.
2. The homologation Tax API, boundary and both signers run as Workers plus SQLite
   DOs. The boundary and signers have no public URL; the executor reaches the
   boundary only through `ExecutorEntrypoint`, the signers only through
   `SignerEntrypoint`, and operators only through the token-gated proxy to
   `AdminEntrypoint`.
3. One automated ARCA setup reaches `connected`, and one Factura C and one
   Factura E get a CAE, with the VM stopped.
4. The `TaxState` alarm is unset whenever no work is pending.
5. The VM, disk and static IP are deleted after the soak. The Tax fixed cost is $0.
6. The homologation and production configs are separate Workers, DO namespaces and
   secrets. Production is not deployed.

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| ARCA hosts refuse Workers TLS (legacy DH/ciphers) | Low (wsaahomo/wswhomo/awshomo proven) | Production hosts in Phase 7. Fallback is the scale-to-zero Cloud Run stateless relay. |
| workerd `X509Certificate` differs, so CUIT matching or expiry checks silently fail | Retired | Spike 2b: identical. The one broken method (`checkPrivateKey`) is replaced by an SPKI DER compare in Phase 1. |
| A rejected PRAGMA hidden inside a migration `exec` string fails a store constructor in workerd only | Medium | Phase 1 cuts every rejected PRAGMA out of the strings; the fake `SqlStorage` rejects them, so the Bun contract suite catches a missed one. |
| Nested `transactionSync` / `user_version` unsupported | Retired | Spike 1c: nesting works. `user_version` is rejected, so it lives in `_sql_store_meta`. |
| Foreign keys now enforced break an insert/delete order in authority-execution | Medium | Phase 1 FK test under enforcement. |
| Alarm rescheduled unconditionally keeps the DO resident and eats the shared duration allowance | High if done naively | Work-driven `reschedule()`, unit-tested; Phase 5 checks `getAlarm()` returns null after drain. |
| One global DO is a throughput bottleneck | Low at homologation volume (soft limit about 1k req/s) | Shard by workspace later; not now. |
| DO placement is decided by the first request, not guaranteed | Certain | Use `locationHint` if latency matters; at homologation it does not. |
| Pure-JS RSA (forge CMS/CSR) plus RSA keygen CPU, and module-scope startup CPU | Low | Measured: forge keygen 151–170 ms CPU, CMS 71–95 ms, node RSA keygen 78–107 ms, startup 38 ms with Reclaim. WSAA tickets are cached in `wsaa_tickets`. |
| A missing secret throws at isolate start | Low | The same secrets list is checked before deploy. A failure surfaces as a 500 on the first request; watch `wrangler tail`. |
| Reclaim SDK pulls Node-only deps | Retired | Spike 5: bundles and evaluates. `verifyProof` with a malformed proof not yet called: covered by the first Reclaim path in the Phase 5 E2E. |
| Operator proxy exposes admin routes on the public API host | Low | Two independent tokens (proxy + boundary admin), strict path allowlist, encoded-dot test. |
| A secret value is leaked during migration | Low | Use stdin pipes only, scratchpad converter, and print key names only. |

## Rollback

- **Before Phase 6**, the VM still exists, stopped, with its disk and IP. To roll
  back:
  1. `deploy/gcp-vm/vm.sh start`.
  2. Point Desk's Tax URL back to `https://tax.104-154-28-207.sslip.io`.
  3. Revert the executor's `wrangler.jsonc` vars to the VM boundary/tax URLs and
     run `wrangler deploy`. Use `wrangler rollback` if only the binding change
     must be undone.
  4. Signers: they were not on the VM before, so rolling back leaves issuance
     where it was before this plan.

  The Workers can stay deployed and idle, which costs $0 once no alarm is set.
  The Phase 1–2 refactor is behaviour-preserving on Bun, so the VM image needs no
  rebuild.
- **After Phase 6**, rebuild from `deploy/archive/gcp-vm/` (startup.sh,
  compose.yaml, Caddyfile, fetch-secrets.sh). Homologation data starts empty,
  which is the same position as the Workers start.

## Spike results

Phase 0 ran 2026-10-26 on a throwaway Worker `tax-workers-spike-tmp` (wrangler
4.97.0, `nodejs_compat`), deployed to account `67f97ad5…` and deleted
afterwards (workers.dev 404, DO namespace gone, no tail left running). Only
throwaway keys/certs were used; no secret values were printed; the repo was not
modified. CPU figures are `wrangler tail` `cpuTime` (in-Worker timers do not
advance during synchronous CPU, so they read 0).

| Gate | Result | Evidence → consequence |
|---|---|---|
| 1a SQL exec basics | PASS | `exec`/`toArray`/`one`/`RETURNING` work. `rowsWritten` = 2 for one INSERT on a TEXT PK table (counts index writes) → adapter uses `SELECT changes()`. BLOB returns `ArrayBuffer` → adapter maps to `Uint8Array`. |
| 1b `transactionSync` rollback | PASS | Returns the callback value; a throw rolls back and rethrows the original error. |
| 1c nested `transactionSync` | PASS | Savepoint semantics: inner failure caught by outer rolls back inner only; outer failure rolls back all. Same as bun. |
| 1d constraint error shape | PASS (shape differs) | Plain `Error`, no `.code`; message `UNIQUE constraint failed: ...: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_PRIMARYKEY)`. No store reads `.code` → no change. |
| 1e foreign keys | PASS | On by default; `foreign_keys`, `defer_foreign_keys`, `foreign_key_check`, `table_info` allowed → the Phase 1 authority-execution FK test is required. |
| 1f rejected PRAGMAs | PASS (as expected, plus one) | `SQLITE_AUTH` for `journal_mode`, `busy_timeout`, `secure_delete`, `database_list`, **`user_version` (read and write)** → `_sql_store_meta`. `wal_checkpoint` not run; it is behind `checkpoint()` regardless. |
| 1g multi-statement / raw txn | PASS (with limit) | Multi-statement without params works (returns last rows). With bindings: refused. Raw `BEGIN TRANSACTION` / `SAVEPOINT` refused → `exec` takes no params; `rotation.ts` stays Bun-only. |
| 1 not run | → Phase 0b | `ALTER TABLE ADD COLUMN`, partial unique index, `ON CONFLICT DO UPDATE WHERE`, `changes()` / `last_insert_rowid()`. |
| 2a RSA keygen + RSA-SHA256 | PASS | 78–107 ms CPU; fixture signature sha256 identical Worker/bun/node. |
| 2b `X509Certificate` fields | PASS | subject (newline-separated, `serialNumber=CUIT ...`), `fingerprint256` (upper colon hex), `validFrom` + `Date.parse`, `checkIssued`, `verify` identical. Diffs that no code depends on: `serialNumber` case (bun lower), `validFromDate` undefined in workerd, bun's `checkIssued` returns a string. |
| 2c `checkPrivateKey` | **FAIL** | `false` for the matching key in workerd (`KeyObject.equals` also `false`). SPKI DER compare verified (match true, other key false) → **fallback applied in Phase 1** (`setup.ts:340`). |
| 2d aes-256-gcm + `hkdfSync` | PASS | Ciphertext, tag and HKDF output identical; tampered tag throws (message differs, not matched by code). |
| 3a forge RSA keygen | PASS | 151–170 ms CPU in workerd. |
| 3b forge PKCS#7 (WSAA TRA CMS) | PASS | sha256 + signed attrs; 1653-byte DER, same size across runtimes, reparses; 71–95 ms CPU. |
| 4 outbound TLS | PASS (partial) | GET WSDLs 200: `wsaahomo` LoginCms (43 ms), `wswhomo` wsfev1 (60 ms) and wsfexv1 (59 ms). No TLS error → no relay. `awshomo.arca.gob.ar` → Phase 0b. A real `LoginCms` POST is proven by the Phase 5 E2E. |
| 5 bundle Reclaim SDK 5.8.0 | PASS | 1,978 KiB / 409 KiB gzip total (SDK ≈ +1,380 / +297); startup 38 ms (15 ms without); `ReclaimProofRequest` evaluated. Real app bundles are checked in the Phase 3/4 dry-runs. |
| Original spike 5 (env, idle billing, same-account fetch) | NOT RUN | env + same-account fetch → Phase 0b; idle billed duration → measured in Phase 5. |
| Original spike 6 (secret sizes) | MOOT | Trusted issuers and launch policy ship as bundled text modules (Phase 2), and neither is set in homologation. |

Phase 0b ran 2026-10-27 on a throwaway Worker `tax-workers-spike0b-tmp`
(wrangler 4.151.3, `compatibility_date: 2026-10-20`, `nodejs_compat`), built in
the session scratchpad outside the repo, deployed to account `67f97ad5…` and
deleted afterwards (workers.dev 404, `deployments list` → code 10007 "does not
exist"). The secret was a dummy string; only booleans/counts were returned.

| Item | Result | Evidence → consequence |
|---|---|---|
| 1a `ALTER TABLE ... ADD COLUMN` | PASS | `ADD COLUMN note TEXT NOT NULL DEFAULT ''`; `PRAGMA table_info` then lists it. |
| 1b partial unique index | PASS | `CREATE UNIQUE INDEX ... ON t(ws) WHERE state = 'active'`: two `retired` rows for one `ws` accepted, a second `active` row refused (`UNIQUE constraint failed: t.ws: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_UNIQUE)`). |
| 1c `ON CONFLICT(id) DO UPDATE SET ... WHERE` | PASS | With bindings: `WHERE excluded.n > t.n` false → value kept (5), `changes()` 0; true → updated (9), `changes()` 1. |
| 1d `changes()` / `last_insert_rowid()` as a separate `exec` | PASS | After INSERT: `changes()` 1, `last_insert_rowid()` 1 then 2; UPDATE of 2 rows → 2, of 0 rows → 0; DELETE of 2 → 2; inside `transactionSync` → 1 and the new rowid (4). `rowsWritten` again 2 for one INSERT. → adapter's `run()` uses `SELECT changes(), last_insert_rowid()`; the `RETURNING 1` fallback is **not needed**. |
| 2 `awshomo.arca.gob.ar` TLS | PASS | GET `/sr-padron/webservices/personaServiceA5?WSDL` → 200, `PersonaServiceA5` WSDL, 98 ms. → no relay for padrón. |
| 3 `process.env` | PASS | At module evaluation and inside `fetch`, both global `process.env` and `import process from 'node:process'` see the var and the secret; `process.env.X === env.X` for the secret. → the DO-constructor `process.env` fallback is **not needed**. |
| 4 Worker → another Worker's `*.workers.dev` | **FAIL by default** | GET the executor's `/health` on workers.dev from the spike → 404 `error code: 1042` (the same URL from outside → 200). With the extra flag `global_fetch_strictly_public` it → 200 (executor JSON). → No owner-set Tax API outbound URL may point at a same-account `*.workers.dev`; the plan's fallback (a service binding for that target) stands. None is set today, so nothing changes now. |

Phase 5 measurements: (fill in: DO requests and GB-s for the E2E day, billed
duration of one idle wake.)

## Review notes

Applied from the 2026-10-26 adversarial review, each checked against the code:

- Correction 1 is right about the cost (5 s loops → 518k requests, 324k GB-s)
  but its first remedy does not work for Factura E: its interval is validated to
  **1–10 s** (`factura-e-feature-worker-config.ts:2-3`), so it cannot be set to
  30 s, and 10 s alone still keeps the DO resident. The plan uses the second
  remedy only: a work-driven alarm.
- Correction 3: the signers call a **third** boundary path besides the two named,
  GET `/health?service=…&environment=…` (`wsfe-signer/src/wsaa.ts:59`,
  `wsfex-signer/src/wsaa.ts:67-71`), used by their own health. `SignerEntrypoint`
  therefore allows three routes, not two.
- Correction 7: the trusted-issuer gap is real on the VM today, not only after
  the move: with `ARCA_SETUP_TRUSTED_ISSUERS_FILE` unset, `verifyChain` returns
  false, so certificate import on the VM cannot have passed a chain check.
  Confirm before blaming the Workers path for a Phase 5 import failure.
- Correction 16 is applied as a decision (rely on `nodejs_compat`'s
  `process.env`), with its consequence recorded in Phase 2 and verified in spike 5.
- Correction 19: the count is 52 transactions in the eight API/boundary stores,
  confirmed; the signers add 4.
- All other corrections (2, 4, 5, 6, 8–15, 17, 18) were confirmed against the
  cited lines and applied as written.

Second review, 2026-10-27, after the spike results:

- Several rejected PRAGMAs sit inside table-creating `exec` strings, and
  `wsfex-signer/src/store.ts` sets `user_version` inside its migration string.
  "Guard the PRAGMA" was not enough; Phase 1 now says to cut them out.
- The fake `SqlStorage` must reproduce workerd's refusals, or the Bun contract
  suite proves nothing about them. Added to Phase 1.
- Trusted issuers are required only in production (`setup.ts:155-156,348`).
  The earlier Phase 5 step to source the official homologation CA chain was an
  unnecessary blocker; homologation matches the VM (no bundle) and the CA moves
  to Phase 7.
- Spike 6 (secret sizes) is dropped: both large values become bundled text
  modules, not vars.
- The Tax API has more owner-set outbound URLs than the two named before
  (`TAX_FACTURA_E_FEATURE_SIGNER_URL`, `TAX_ENGINE_ARCA_PREPARATION_URL`,
  `TAX_DESK_FACTURA_E_PRIVATE_DATA_URL`, `RECLAIM_PROOF_VAULT_URL`); none is
  set on the VM. Listed in Phase 0b item 4.
- Phase 0's throwaway Worker was named `tax-workers-spike-tmp`, not
  `tax-spike-homologation`, and used wrangler 4.97.0, not the executor's pinned
  4.151.3. The phases pin 4.151.3.
