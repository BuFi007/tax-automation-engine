# Tax Automation Engine

Manual-first, evidence-backed tax readiness for Motora/BUFI. Argentina is the launch wedge; the same deterministic core also supports United States LLC, S-Corp, and C-Corp journeys for local and foreign-domiciled founders.

This repository intentionally separates tax preparation from accountant review, user-approved submission, authority receipt, acceptance, and final satisfaction. Filing, payments, autonomous authority actions, and storage of authority credentials are disabled.

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
- An agent-ready Factura E backend with discoverable tools, append-only case revisions, Reclaim proof sessions, a separate trusted human-approval channel, and an isolated WSFEX signer boundary.

## Safety boundary

- Money is represented as decimal strings and computed with `decimal.js`; binary floating point is not used for tax calculations.
- OAuth tokens, Clave Fiscal PINs, private keys, raw TIN/CUIT values, and raw source documents do not belong in browser snapshots, API logs, or this database contract.
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

## API surface

- `GET /health`
- `GET /v1/catalogues`
- `GET /v1/snapshots/demo?jurisdiction=AR|US`
- `GET /v1/profiles/:workspaceId`
- `POST /v1/profiles/confirm`
- `POST /v1/snapshots`
- `GET /v1/providers/argentina-erp?tenantId=...`
- `GET /v1/agent/tools`
- `POST /v1/agent/tools/:toolId/invoke`
- `GET /v1/agent/runs?workspaceId=...`
- `GET /v1/agent/runs/:runId`
- `GET /v1/agent/runs/:runId/events`
- `POST /v1/agent/runs/:runId/user-approval` (trusted user channel)
- `POST /v1/agent/runs/:runId/accountant-approval` (trusted accountant channel, when required)
- `POST /v1/agent/runs/:runId/adjustments/:adjustmentId/user-approval` (trusted user channel)
- `POST /v1/agent/runs/:runId/adjustments/:adjustmentId/accountant-approval` (trusted accountant channel, when required)
- `POST /v1/agent/runs/:runId/reclaim-sessions/:sessionId/cancel` (trusted user channel)
- `POST /v1/agent/runs/:runId/fx-ingress-verification` (trusted accountant channel)
- `POST /v1/agent/runs/:runId/tax-declaration` (trusted accountant channel)
- `POST /v1/reclaim/callback` (public callback; cryptographic proof and session binding required)
- `POST /v1/evidence/append` (trusted connector/workspace harness; separate ingest token)

See [Agent backend for Argentina Factura E](docs/agent-backend.md) for the state machine, tool contract, Reclaim provider requirements, Path A/Path B behavior, and recovery invariants.

Set `TAX_ENGINE_API_KEY` to require bearer authentication. Production startup refuses to run without it. CORS defaults to `http://localhost:5173` and can be overridden with `CORS_ORIGIN`.

## Repository map

```text
apps/api       Safe HTTP boundary and append-only SQLite stores
apps/web       Manual Tax Widget and full cockpit
packages/core  Money, consent, evidence graph, jurisdiction packs, workflow
packages/erp   Accounting import contract and provider bridges
docs           Architecture, delivery traceability, and execution gates
```

## Deferred by design

Production activation of Reclaim ARCA providers, live WSFEX certificates/signing, IRS e-file integration, tax payment execution, TaxScore, factoring, and BullMQ orchestration require provider credentials, their respective security/product milestones, and explicit owner approval. The agent orchestration and signer boundary are implemented but fail closed while those providers are unconfigured.
