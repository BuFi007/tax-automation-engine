# Tax Automation Engine

Manual-first, evidence-backed tax readiness for Motora/BUFI. Argentina is the launch wedge; the same deterministic core also supports United States LLC, S-Corp, and C-Corp journeys for local and foreign-domiciled founders.

This repository intentionally separates tax preparation from accountant review, user-approved submission, authority receipt, acceptance, and final satisfaction. Payments and unapproved autonomous authority actions are disabled; delegated WSFEX submission is available only for a frozen, human-approved document through the isolated signer.

## What is implemented

- One shared exact-decimal core with versioned Argentina and United States jurisdiction catalogues.
- Argentina flows for Factura E readiness, collection evidence, monthly obligations, recategorization, annual review, MiPyME, and Economía del Conocimiento.
- United States flows for federal, state/franchise, sales-tax nexus, and payroll readiness across LLC, S-Corp, and C-Corp profiles.
- Consent-scoped evidence adapters covering banks, Stripe, wallets/crypto, FX, invoices, bills, payroll, QuickBooks, Xero, Conta Azul, Magic Inbox, transaction enrichment, the knowledge graph, and financial analytics.
- A canonical evidence graph with source checkpoints, immutable hashes, review states, reconciliation gaps, and double-count/allocation guards.
- A fixed Tax Core capability manifest: 22 read capabilities and 4 approval-aware actions.
- A reusable accounting contract, a normalized bridge for the existing QuickBooks/Xero/Conta Azul connectors, and a conformance-first Contabilium adapter for the Argentine ERP wedge.
- SQLite persistence for confirmed profiles, append-only safe evidence records, audit events, and workflow revisions.
- A browser-safe API, compact Tax Widget, and full tax cockpit with jurisdiction/persona selection, evidence coverage, obligations, and execution gates.
- An agent-ready Factura E backend with discoverable tools, append-only case revisions, Reclaim proof sessions, a separate trusted human-approval channel, an encrypted WSAA/payload authority boundary, and an isolated WSFEX signer for documents 19/20/21.

## Safety boundary

- Money is represented as decimal strings and computed with `decimal.js`; binary floating point is not used for tax calculations.
- OAuth tokens, Clave Fiscal PINs, private keys, raw TIN/CUIT values, and raw source documents do not belong in browser snapshots, API logs, or the Motora database. The isolated authority boundary encrypts the minimum WSFEX customer and delegated-certificate material with separate domain keys.
- ARCA/AFIP and IRS credentials stay in their authority/provider boundary. This engine consumes safe, hashed evidence and verified receipt metadata.
- Reclaim proves a fact displayed by ARCA; it never creates a CAE. `arca_authorized` can only be reached through a cryptographically verified CAE proof or a verified WSFEX signer receipt.
- The tax agent API key cannot approve an intent, verify FX ingress, or mark tax declared. Those transitions require separate trusted-channel credentials that are never exposed to the agent runtime.
- Stripe Tax is treated as a calculation/registration signal, not as an IRS filing provider.
- The Contabilium adapter reports `AUTHORIZED_SANDBOX_REQUIRED` until an authorized provider sandbox passes the conformance matrix. No production-support claim is made.

## Run locally

Requires Bun 1.3.10 or later.

```bash
bun install
bun run dev:api
```

In a second terminal:

```bash
bun run dev
```

Open `http://localhost:5173`. The API listens on `http://localhost:4100` by default.

```bash
bun run check
```

The external ARCA acceptance gate is executable without exposing credentials:

```bash
bun run homologation:preflight
bun run homologation:probe-signer
bun run homologation:validate -- /absolute/path/to/redacted-evidence.json
```

See [ARCA homologation acceptance](providers/homologation/README.md). These commands keep production disabled and output only safe gate states, versions, and hashes.

The authority boundary and signer are separate deployments. Start them only
with distinct scoped credentials, an HTTPS ingress/service mesh, and production
gates left closed:

```bash
bun run --filter @tax-engine/arca-boundary start
bun run --filter @tax-engine/wsfex-signer start
```

See [authority boundary operations](apps/arca-boundary/README.md) and
[isolated signer operations](apps/wsfex-signer/README.md).

## API surface

- `GET /health`
- `GET /v1/catalogues`
- `GET /v1/snapshots/demo?jurisdiction=AR|US`
- `GET /v1/profiles/:workspaceId` (Bearer API key + short-lived user tenant principal)
- `POST /v1/profiles/confirm` (Bearer API key + short-lived user tenant principal)
- `POST /v1/evidence/consent-events` (consent-authority token + scoped consent-authority principal)
- `POST /v1/evidence/batches` (evidence-ingest token + scoped evidence-publisher principal; at most 500 records and 5 MiB)
- `PUT /v1/snapshot-configurations/:workspaceId[/:projectionKey]` (Bearer API key + short-lived user tenant principal; omitted key is `default`)
- `POST /v1/snapshots` (Bearer API key + isolated short-lived snapshot-projector principal; optional `projectionKey`, default `default`)
- `POST /v1/snapshot-projections/:workspaceId[/:projectionKey]` (same projector principal; recomputes only the already user-configured scope)
- `GET /v1/snapshots/:workspaceId[/:projectionKey]` (Bearer API key + short-lived user tenant principal; returns the stored snapshot receipt)
- `GET /v1/browser/snapshots/:workspaceId[/:projectionKey]` (same `snapshot:read` principal; returns the HMAC-opaque browser V1 result)
- `GET /v1/providers/argentina-erp?tenantId=...`
- `GET /v1/agent/tools`
- `POST /v1/agent/tools/:toolId/invoke`
- `GET /v1/agent/runs?workspaceId=...`
- `GET /v1/agent/runs/:runId`
- `GET /v1/agent/runs/:runId/events`
- `POST /v1/agent/runs/:runId/user-approval` (trusted user channel)
- `POST /v1/agent/runs/:runId/accountant-approval` (trusted accountant channel, when required)
- `POST /v1/agent/runs/:runId/wsfex-payload` (trusted canonical payload vault + immediate Path A submission)
- `POST /v1/agent/runs/:runId/adjustments/:adjustmentId/user-approval` (trusted user channel)
- `POST /v1/agent/runs/:runId/adjustments/:adjustmentId/accountant-approval` (trusted accountant channel, when required)
- `POST /v1/agent/runs/:runId/adjustments/:adjustmentId/wsfex-payload` (trusted canonical note vault + submission)
- `POST /v1/agent/runs/:runId/reclaim-sessions/:sessionId/cancel` (trusted user channel)
- `POST /v1/agent/runs/:runId/fx-ingress-verification` (trusted accountant channel)
- `POST /v1/agent/runs/:runId/tax-declaration` (trusted accountant channel)
- `POST /v1/reclaim/callback` (public callback; cryptographic proof and session binding required)

The former `POST /v1/evidence/append` route is not a production ingestion path. It is disabled by default and can only be enabled outside production with `TAX_ENGINE_LEGACY_EVIDENCE_APPEND_ENABLED=true` for migration tests.

See [Agent backend for Argentina Factura E](docs/agent-backend.md) for the state machine, tool contract, Reclaim provider requirements, Path A/Path B behavior, and recovery invariants.

Set `TAX_ENGINE_API_KEY` to require bearer authentication. Production startup refuses to run without it. CORS defaults to `http://localhost:5173` and can be overridden with `CORS_ORIGIN`.

Production also requires `TAX_ENGINE_DB_PATH` to point to SQLite on a durable mounted volume, for example `/data/tax-engine.sqlite`. The API refuses to start with a missing, blank, or in-memory SQLite path in production. This preserves Factura E case revisions and settlement idempotency across restarts; do not run multiple API replicas against one SQLite file.

Tenant isolation uses canonical `tax-tenant-principal-v2` assertions in `X-Tax-Tenant-Principal` plus a lowercase HMAC-SHA256 in `X-Tax-Tenant-Signature`. Assertions expire within five minutes and bind workspace, actor, and one route capability (`evidence:publish`, `consent:publish`, `arca:onboard`, profile read/confirm, or snapshot configure/project/read). The browser/API gateway, unattended snapshot projector, Desk evidence publisher, and Desk consent authority use four separate HMAC secrets; `snapshot:project` is accepted only under the dedicated projector secret, never the user gateway secret. Workspace IDs accept both current UUIDs and existing safe opaque IDs such as `workspace:1`. There is currently no key identifier or overlap window, so rotate each caller and Tax API atomically during a controlled deployment.

The ARCA UI accepts the short-lived `arca:onboard` assertion through the `arcaAuthority` prop on `App`; Motora's authenticated gateway must mint and refresh it. The browser never receives `TAX_ENGINE_API_KEY`, `TAX_ENGINE_USER_APPROVAL_TOKEN`, or `TAX_ENGINE_EVIDENCE_INGEST_TOKEN`. With that authority present, the UI creates or resumes the workspace-scoped run and persists login handoff, service confirmation, point creation, and explicit selection among multiple discovered FEEWS points. Discovery and API verification remain machine-evidence operations.

The rollback-safe browser read path is `GET /v1/browser/snapshots/:workspaceId/:projectionKey?`; legacy `/v1/snapshots` remains unchanged. This endpoint returns the canonical `TaxSnapshotReadResultV1` envelope and uses the existing `snapshot:read` tenant principal. Production additionally requires a dedicated, distinct, server-only `TAX_ENGINE_BROWSER_REFERENCE_HMAC_SECRET` of at least 32 bytes. Tax uses it to scope every browser reference and revision to purpose, workspace, and projection; raw core IDs and hashes are never returned.

## Repository map

```text
apps/api       Safe HTTP boundary and append-only SQLite stores
apps/web       Manual Tax Widget and full cockpit
apps/arca-boundary  Encrypted WSFEX payload custody and WSAA CMS/ticket broker
apps/wsfex-signer  Isolated WSFEX SOAP transport, exact replay, and safe receipt store
packages/core  Money, consent, evidence graph, jurisdiction packs, workflow
packages/erp   Accounting import contract and provider bridges
docs           Architecture, delivery traceability, and execution gates
```

## Deferred by design

Production activation of Reclaim ARCA providers, real WSFEX certificate delegation, IRS e-file integration, tax payment execution, TaxScore, factoring capital, and BullMQ orchestration require provider credentials, their respective security/product milestones, and explicit owner approval. The Factura E factoring path now includes a Tax-owned independently reconciled authority state, dedicated consent, a minimized signed eligibility feature, immediate settlement/adjustment withdrawal, a restricted CRE live-head read, a durable event outbox, and a durable one-use reserve/consume/complete/release fence around settlement and adjustment mutations. A consumed fence never expires; only an authenticated, commitment-backed proof of a deterministic pre-submit no-effect decision may release it. It remains dark until its isolated principals, pinned Ed25519 KMS/HSM signer public key, single-writer durable store, Desk ingress, homologation evidence, and owner approval are configured. The agent orchestration, encrypted authority boundary, and signer service fail closed while those external assets are unconfigured.
