# Isolated WSFEX signer

This service is the high-trust Path A provider behind Motora's safe
[`SignerRequest`](../../providers/wsfex/openapi.yaml). It accepts only an opaque
authority-payload reference and the frozen safe document echo; it never accepts
a certificate, private key, Clave Fiscal credential, raw authority payload, or
human approval token from the agent.

## Trust boundaries

The signer calls two separately authenticated HTTPS services:

- `POST /v1/authority-payloads/resolve` on the payload vault returns
  `{ payload, payloadHash }`. The signer recomputes the canonical SHA-256 hash and
  binds subject, intent, request ID, document fields, exact total, and association.
- `POST /v1/wsaa/tickets` on the WSAA broker returns an ephemeral
  `{ token, sign, representedCuit, representedCuitCommitment, expiresAt }` for
  service `wsfex`. The signer requires the commitment to equal the one in the
  sealed authority payload before any ARCA read or write. The broker, not this
  process, owns the certificate and private key. Its protected `/health` reports
  only delegation/readiness booleans.

The reference implementation for both endpoints is the separately deployed
[`apps/arca-boundary`](../arca-boundary/README.md). Its payload-resolve and WSAA
tokens are distinct even when both URLs share one HTTPS origin.

The local SQLite store keys each attempt by ARCA environment,
`representedCuitCommitment`, and ARCA's numeric request ID. Workspace, issuer
profile, subject, run, intent, payload, and document coordinates remain immutable
bindings on the row; aliases for the same represented taxpayer cannot allocate the
same `Cmp.Id` twice. The numeric ID is sent unchanged as WSFEX `Cmp.Id`; it is not a
globally unique Motora identifier. The store contains only safe hashes/coordinates,
normalized status, CAE evidence, and timestamps. It does not contain the opaque
payload reference, customer identifiers, token/sign, raw represented CUIT, or raw
SOAP XML.

### Attempt-store rollout gate

The scoped store is schema version 3. A new database is created at v3, and an empty
v1 or v2 table is replaced atomically. A populated older table cannot be migrated
automatically because it cannot prove the represented-CUIT commitment for each
request. Startup therefore fails closed with
`WSFEX_LEGACY_ATTEMPT_RECONCILIATION_REQUIRED` (v1) or
`WSFEX_WORKSPACE_SCOPED_ATTEMPT_RECONCILIATION_REQUIRED` (v2) and leaves every row
untouched. Before deployment, an operator must snapshot the old database, resolve
all pending/ambiguous outcomes against ARCA, retain terminal receipts, and cut over
to a reviewed v3 database. Never discard an unresolved older attempt.

The process binds to `127.0.0.1` by default. Set
`WSFEX_SIGNER_HOST=0.0.0.0` only inside an authenticated container/network
boundary; the supplied container image does this explicitly.

## Authority behavior

- Homologation: `https://wswhomo.afip.gov.ar/wsfexv1/service.asmx`
- Production: `https://servicios1.afip.gov.ar/wsfexv1/service.asmx`
- SOAP namespace: `http://ar.gov.afip.dif.fexv1/`
- Request IDs are monotonic N15 decimal strings within their represented ARCA issuer
  context and invoice numbers are sequential N8 decimal strings. Different tenant
  scopes may therefore persist the same numeric request ID without colliding.
- A timeout/network failure/5xx remains `ambiguous`. Recovery is query-first: it
  calls `FEXGetCMP` before considering an exact replay. A transport-ambiguous read
  never triggers a write, and a replay rejection is followed by one more official
  read before any terminal classification.
- Deterministic sequence/POS/quote/association preflight failures return
  `preflight_rejected` without creating an attempt row, so a corrected fresh
  allocation is not wedged behind a false ambiguous recovery record.
- `FEXGetCMP` reconciliation compares the full frozen document: customer identity,
  destination/operation, currency/payment semantics, dates, total, terms,
  observations, language, items, and association. Accepted reconciliation carries
  a strict attestation binding the represented-CUIT commitment, official document
  identity, payload, raw SOAP response hash, CAE, and observation time.
- Attempt state is monotonic: a stale ambiguous/rejected worker cannot overwrite a
  concurrently accepted official result. Fresh accepted reconciliation evidence may
  strengthen an accepted row without changing its stable official identity.
- Notes 20/21 must point to one authorized type-19 original and reuse its exact
  currency and quote.

## Cotización (Moneda_ctz) surface

The legal value of `Moneda_ctz` is the BNA **tipo de cambio divisa VENDEDOR** at the
close of the día hábil cambiario **anterior** to issuance (RG 5616/2024; WSFEX errors
1600/1601/2053). ARCA's own `FEXGetPARAM_Ctz` is **orientativo** — the ±band guardrail
behind error 1667 (WSFEX manual §2.13) — so it is used here as a sanity band, never
as the legal rate.

- **`GET /v1/wsfexv1/params/ctz?monId=DOL`** — Bearer-authed. Returns
  `{ monId, ctz, date, referenceDate, source }`. Fail-closed provenance: with no
  verified machine-readable BNA feed wired, it returns ARCA's `FEXGetPARAM_Ctz`
  value labeled `source: "arca_orientativo"` (never a fabricated legal rate).
  `referenceDate` is the prior business day whose BNA rate is legally required.
  Optional `workspaceId` / `issuerProfileRef` query params override the
  service-level defaults used for the (taxpayer-agnostic) param lookup.
- **Error-1667 band on submit** — before `FEXAuthorize`, a foreign-currency invoice's
  `Moneda_ctz` is checked against `FEXGetPARAM_Ctz` within a fractional tolerance
  (`WSFEX_CTZ_BAND_TOLERANCE`, default 10%); a gross drift is rejected
  (`WSFEX_MONEDA_CTZ_OUT_OF_BAND`) before a wasted submit. Notes 20/21 are exempt —
  they reuse the original's quote. Pesos (`PES`) need no cotización.
- **Applied `Moneda_ctz` echo** — the authorized-document echo carries
  `currencyId` + `currencyQuote` so the desk persists the exact frozen values sent to
  ARCA. `FEXAuthorize` does not echo those fields; only recovery confirms them from
  `FEXGetCMP` before returning.
- **Business-day calendar** — weekends are encoded now; feriados cambiarios are a
  documented TODO with a config escape hatch (`WSFEX_AR_HOLIDAYS`, a comma-separated
  `YYYY-MM-DD` allowlist honored immediately).

## FEEWS point-of-sale discovery

`POST /v1/wsfexv1/params/points-of-sale/discover`
performs a fresh `FEXGetPARAM_PtoVenta` read using the represented taxpayer's WSAA
ticket. It returns only active point numbers, the represented-CUIT commitment,
the raw-response hash, observation time, and a canonical evidence hash. It never
returns the raw CUIT, token/sign, certificate, SOAP body, or Clave Fiscal data.
The workspace and opaque issuer-profile reference travel in a bounded JSON body,
never in a query string; only the reference hash appears in the receipt.
An empty `activePoints` array is authoritative blocked evidence: it must not be
converted into a configured point or a production-ready claim.

## Run

```bash
bun install
bun run --filter @tax-engine/wsfex-signer typecheck
bun test apps/wsfex-signer/src
bun run --cwd apps/wsfex-signer verify:wsdl
bun run --filter @tax-engine/wsfex-signer start
```

Required environment:

```text
PORT=4200
ARCA_ENVIRONMENT=homologacion | production
WSFEX_SIGNER_API_TOKEN
WSFEX_SIGNER_VAULT_URL=https://...
WSFEX_SIGNER_VAULT_TOKEN
WSFEX_WSAA_BROKER_URL=https://...
WSFEX_WSAA_BROKER_TOKEN
WSFEX_SIGNER_DB_PATH=/data/wsfex-signer.sqlite
WSFEX_SIGNER_VERSION=0.1.0
WSFEX_SIGNER_PRODUCTION_APPROVED=false
# Cotización endpoint: service-level issuer profile for the taxpayer-agnostic ctz lookup.
WSFEX_CTZ_WORKSPACE_ID=system
WSFEX_CTZ_ISSUER_PROFILE_REF=vault://issuer/ctz
# Optional: error-1667 band tolerance (fractional, default 0.10) + feriados escape hatch.
WSFEX_CTZ_BAND_TOLERANCE=0.10
WSFEX_AR_HOLIDAYS=
```

Production startup refuses to run unless `WSFEX_SIGNER_PRODUCTION_APPROVED=true`.
It also refuses an in-memory attempt database in production. These local gates are
necessary but not sufficient. The public homologation WSDL contract was reviewed
on 2026-07-15 and is checked by `verify:wsdl`; it exposes every field used by the
exact comparator, including `Cmp_asoc.Cbte_cuit`. An authenticated homologation
run must still authorize and re-read a real document with `FEXGetCMP`, because the
XSD marks several values optional and cannot prove their live empty/null shape.
The repository homologation gate and explicit owner review must also pass.

Build the container from the repository root:

```bash
docker build -f apps/wsfex-signer/Dockerfile -t motora-wsfex-signer .
```

Official references: [WSFEX 3.1.1](https://www.arca.gob.ar/ws/documentacion/manuales/WSFEX-Manualparaeldesarrollador_V3.1.1_ARCA.pdf), [WSAA](https://arca.gob.ar/ws/documentacion/wsaa.asp), and [certificate/delegation guidance](https://www.arca.gob.ar/ws/documentacion/certificados.asp).
