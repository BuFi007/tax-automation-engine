# Tax Automation Engine

Manual-first, evidence-backed tax readiness for Motora/BUFI. Argentina is the launch wedge; the same deterministic core also supports United States LLC, S-Corp, and C-Corp journeys for local and foreign-domiciled founders.

This repository intentionally separates tax preparation from accountant review, user-approved submission, authority receipt, acceptance, and final satisfaction. Payments and unapproved autonomous authority actions are disabled; delegated WSFEX submission is available only for a frozen, human-approved document through the isolated signer.

## Verified end-to-end workflow

The July 2026 delivery connected BUFI's accounting workspace to this engine with real development data. A provider-synced document moved through Magic Inbox extraction, became an approved payable bill, crossed the consented evidence boundary, and produced a browser-safe Argentine tax snapshot. The verified snapshot reported exactly `1580.9 ARS` of purchase input tax from one document for a `responsable_inscripto` profile.

```mermaid
flowchart LR
  I["Magic Inbox email + attachment"] --> X["OCR and structured invoice extraction"]
  X --> B["Payable bill + source proof"]
  B --> A["Human approval"]
  A --> E["Consent-scoped TaxEvidenceBatchV1"]
  S["Stripe Tax normalized report"] --> R["Jurisdiction routing + idempotent evidence"]
  R --> E
  E --> G["Canonical evidence graph"]
  G --> F["Exact-decimal safe tax facts"]
  F --> W["Tax widget / accountant review"]
```

That run stayed `manual_only`: it did not file a return, pay a tax authority, or infer that evidenced IVA was accountant-confirmed crédito fiscal. The tax-preparation export and widget used the same approved bill and stored tax amount; there was no parallel VAT calculation.

## New: Stripe and reimbursement-aware evidence

### Stripe Tax

The [Stripe Tax adapter](packages/core/src/stripe-tax.ts) turns a normalized Stripe report or webhook projection into the same canonical evidence corridor used by the rest of the engine:

- routes the transaction against a pinned country/product support matrix;
- binds eligible calculation evidence to the exact seller jurisdiction;
- uses decimal money, provider hashes, revisions, deterministic idempotency keys, and explicit supersession for corrections;
- accepts no Stripe secret or raw customer payload; and
- never treats a Stripe document as an ARCA fiscal invoice or Stripe as an Argentine filing authority.

For Argentina, Stripe remains payment evidence only. For supported non-Argentine routes, Stripe Tax can contribute indirect-tax calculation evidence while filing and remittance responsibility remain explicit. See the [routing and batch tests](packages/core/src/stripe-tax.test.ts).

### Workspace reimbursements

The companion BUFI workspace now creates reimbursement requests from five existing sources: transactions, payable bills, Magic Inbox documents, BUFI invoices, and payroll runs. The integration is draft-first and uses one canonical economic identity per source, so an Inbox document promoted to a bill cannot be reimbursed twice. A database uniqueness guard closes the concurrent double-submit race, and proof is retained for bill and Inbox sources.

This repository's boundary is deliberately narrower: reimbursement drafts and payment intent are not tax facts. Only accepted invoice/bill evidence enters the consented graph, and the [evidence resolver](packages/core/src/evidence/resolver.ts) projects accepted, outward `bufi_bill` tax lines into exact `purchase_input_tax` and `purchase_input_tax_document_count` safe facts. Settlement or reimbursement execution remains outside this engine and must provide its own confirmed, idempotent evidence.

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

## How Codex and GPT-5.6 were used

Codex with GPT-5.6 acted as an implementation and verification agent across one long-running task, not as a README-only assistant. The model inspected the worker, API, database, browser contracts, and this deterministic tax core; ran the local services; followed records through development infrastructure; wrote focused regressions; and kept unrelated dirty-worktree changes out of scoped commits.

Concrete work from that task included:

| Area | GPT-5.6/Codex contribution | Verified outcome |
| --- | --- | --- |
| Magic Inbox | Traced a silent status-gate no-op and an invalid BullMQ job identifier, then repaired and re-drove the provider pipeline. | A real attachment was extracted into structured invoice data, promoted to a payable bill, and processed by matching. |
| Tax from accounting | Added the accepted-bill input-VAT projection and traced it through consent, batch ingestion, profile confirmation, snapshot configuration, and browser-safe output. | `1580.9 ARS`, one source document, 17/17 resolver tests, and core typecheck passing. |
| Reimbursements | Audited source mapping, implemented canonical identities and the uniqueness guard, applied the scoped dev migration, and exercised every source type. | All five sources persisted; deliberate duplicate submission failed closed; 53 focused tests passed. |
| Safety | Continuously separated preparation, evidence, approval, authority submission, settlement, and finality. | No tax payment, treasury spend, or autonomous filing occurred during validation. |
| Web performance | Audited the companion BUFI web app's server/client boundaries, LCP path, assets, fonts, CSS, and telemetry before forward-porting the verified slice. | Production build passed 15 static routes and 13 focused PageSpeed gates; no unmeasured score was claimed. |

The user supplied the product requirements, financial invariants, and acceptance decisions. Codex/GPT-5.6 performed root-cause analysis, implementation, testing, migration checks, and browser QA; sensitive credentials and production authority remained outside the model boundary. The work is traceable to Codex task `019f82b3-e1e7-7c33-913d-265e884d8175` and these scoped development commits:

- Tax Automation Engine: `b2d3ac4` (`feat(tax): project approved bill input vat`)
- BUFI workspace: `59c20cce3` (Magic Inbox recovery), `cca8bc69c` (approved-bill IVA projection), and `0d7ea8cbb` (workspace-sourced reimbursements)
- BUFI Web: `52d3e7629` and `73d1593d3` (PageSpeed critical path and development prerequisites)

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
- `POST /v1/accountant-decisions` (dark by default; external accountant workspace only; request-bound `accountant:decision` principal + active scoped mandate and consent)
- `GET /v1/accountant-review-queue` (Bearer API key + short-lived `accountant:review-queue` principal; current browser-safe subjects under active exact-scope mandates)
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

Tenant isolation uses canonical `tax-tenant-principal-v2` assertions in `X-Tax-Tenant-Principal` plus a lowercase HMAC-SHA256 in `X-Tax-Tenant-Signature`. Human authority corridors use request-bound `tax-tenant-principal-v3`. Assertions expire within five minutes and bind workspace, actor, and one route capability (`evidence:publish`, `consent:publish`, `arca:onboard`, `accountant:review-queue`, `accountant:decision`, profile read/confirm, or snapshot configure/project/read). The browser/API gateway, Motora onboarding gateway, external accountant workspace, unattended snapshot projector, Desk evidence publisher, and Desk consent authority use separate HMAC secrets; `snapshot:project` is accepted only under the dedicated projector secret, and external decisions only under the dedicated accountant-decision secret. Workspace IDs accept both current UUIDs and existing safe opaque IDs such as `workspace:1`. There is currently no key identifier or overlap window, so rotate each caller and Tax API atomically during a controlled deployment.

See [external accountant decision boundary](docs/external-accountant-decision-boundary.md) for the signed receipt, mandate/consent, replay and privacy invariants.

The ARCA UI accepts the short-lived `arca:onboard` assertion through the `arcaAuthority` prop on `App`; Motora's authenticated gateway must mint and refresh it. The browser never receives `TAX_ENGINE_API_KEY`, `TAX_ENGINE_USER_APPROVAL_TOKEN`, or `TAX_ENGINE_EVIDENCE_INGEST_TOKEN`. With that authority present, the UI creates or resumes the workspace-scoped run and persists login handoff, service confirmation, point creation, and explicit selection among multiple discovered FEEWS points. Discovery and API verification remain machine-evidence operations. When `TAX_WORKBENCH_INGEST_URL` and `TAX_WORKBENCH_INGEST_SECRET` are both configured, the API publishes a commitment-only operational projection after each durable onboarding revision. This is observability only: Workbench cannot advance the flow, and the projection excludes taxpayer identifiers, point-of-sale values, credentials, browser state, and proof contents.

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
