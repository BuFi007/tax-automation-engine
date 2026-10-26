# Automated ARCA connection

The customer says "Connect my ARCA" (to Bu, or from Invoices). BUFI asks once
for a scoped authorization, opens ARCA's own login page inside a hosted
Cloudflare browser that the customer drives directly, and then completes the
services, certificate, delegation and point-of-sale work itself. BUFI reports
**connected** only after the existing WSFEX/WSFE verification and the Reclaim
proof succeed.

The guided manual flow in Invoices stays available. The automated run is the
paid alternative (AI credits; the price is set in Desk).

## Who is who

| Identity | Where it is known | How it is checked |
| --- | --- | --- |
| Login identity (the person typing the Clave Fiscal) | Only on the ARCA page | The executor reads the CUIT/CUIL from the authenticated header and sends it to the boundary, which keeps only a keyed hash |
| Represented taxpayer | `taxpayerReferenceHash` on the onboarding run | The boundary matches the observed candidates against that reference with the same HMAC key Desk uses; only the match is sealed |
| Certificate holder | BUFI (provider delegation) or the taxpayer (customer certificate) | The certificate subject `serialNumber=CUIT …`, validated by the boundary |

These never collapse into one another: a company's administrator logs in with
their own CUIL, acts for the company's CUIT, and BUFI's certificate represents
the company through delegation.

## The two certificate paths

**Provider delegation** (when `ARCA_SETUP_PROVIDER_DELEGATION_ENABLED=true` and
the boundary has a provider template issuer). This is ARCA's "tercerización"
circuit from *Delegación de Webservices con el Administrador de Relaciones*:

1. In the customer's session: Administrador de Relaciones → Nueva Relación →
   ARCA → WebServices → *Factura electrónica de exportación* (`wsfex`) and/or
   *Facturación Electrónica* (`wsfe`) → Representante = BUFI's CUIT →
   Confirmar (F. 3283/E).
2. In **BUFI's own** session, authenticated by a BUFI operator through the same
   hosted-browser handoff: accept the pending designation, then Nueva Relación
   with the customer as represented, the same service, and BUFI's computer
   alias as representative. ARCA shows the customer's relation as *Pendiente*
   until this happens, so it is a provider-authority step, never the
   customer's.
3. The boundary binds the represented CUIT to the stored BUFI certificate, only
   with the provider-acceptance receipt.

**Customer certificate** (no provider template, or the customer wants its own
computer alias):

1. The boundary generates a 2048-bit RSA key and a CSR with
   `serialNumber=CUIT <taxpayer>`. The key never leaves the boundary.
2. The executor fetches only the CSR (executor token + opaque enrollment
   reference), uploads it from memory to *Administración de Certificados
   Digitales* (production) or WSASS (homologation), retrieves the issued
   certificate, and posts it straight to the boundary.
3. The boundary imports it only if it matches the generated key, names the
   attested CUIT, is currently valid, and (in production) chains to a trusted
   ARCA CA (`ARCA_SETUP_TRUSTED_ISSUERS_FILE`).
4. The executor relates the alias to each requested service, then the boundary
   provisions the issuer.

The alias is `bufi-arca` (production) or `bufi-arca-homo` (homologation). If it
already exists, BUFI asks the customer before adding a certificate to it
(`certificate_replacement` decision) unless they allowed it up front.

## Sequence and bootstrap

ARCA web-service discovery needs an issuer and delegation that do not exist yet,
so the run observes the portal first and asks the API last:

1. `authenticate` — hosted login, then identity match through the boundary.
2. `inspect` — services adhered, aliases, relationships, points of sale.
3. `adhere_services` — only what is missing.
4. Point of sale — reuse the single valid *Comprobantes de Exportación -
   Webservices* point (or the domestic web-services point for WSFE); ask when
   several exist; create the lowest free number otherwise (domicile chosen by
   the customer in ARCA when there are several).
5. Certificate and delegation, per the path above.
6. `api_verification` — `FEXGetPARAM_PtoVenta` through the WSFEX signer and
   `FEParamGetPtosVenta` through the WSFE signer, bound to the same issuer
   profile and represented-CUIT commitment. WSFEX success never stands in for
   WSFE. ARCA propagation delays retry with backoff for about a day.
7. `zk_evidence` — the customer completes the Reclaim WITNESS proof on their own
   device. The hosted browser is closed before this step.
8. `connected`.

Every mutating operation re-reads ARCA first. A response that the executor
could not confirm comes back `uncertain`, and the next order is always an
inspection, so a retry never submits twice. One lease per
`(workspace, taxpayer, environment)` keeps concurrent jobs apart.

## Hosted authentication policy

`hosted-human-auth-policy-v2` keeps every v1 capture prohibition for the
automation and agent side (no credential DOM inspection, screenshots,
clipboard, cookies, storage, network bodies or traces) and adds the one new
thing: a **private human display**.

- The executor requests `Cloudflare.handoff` after subscribing to
  `Cloudflare.handoffComplete`, and makes no page reads until it completes.
- Sessions are acquired with `recording: false` and guardrails that allow only
  ARCA hosts (`*.afip.gob.ar`, `*.afip.gov.ar`, `*.arca.gob.ar`) plus the
  `common-cdns` set.
- The customer reaches the tab through a two-minute, single-use handoff ticket
  minted by Tax for their own principal. The executor redeems it once and
  redirects that browser to a tab-mode Live View link. Neither the ticket nor
  the link is persisted, logged, returned to an agent, or placed in a tax-domain
  event.
- After completion the executor verifies an authenticated portal and the
  intended taxpayer before doing anything else.

## Cloudflare Browser Run facts this relies on (measured)

Measured in a real Browser Run session from a deployed Worker with
`@cloudflare/playwright@1.3.6`, `compatibility_date 2026-10-20`,
`nodejs_compat`. Evidence:
[`providers/homologation/evidence/2026-10-26-cloudflare-browser-run-proof.json`](../providers/homologation/evidence/2026-10-26-cloudflare-browser-run-proof.json).

| Property | Result |
| --- | --- |
| `setInputFiles` with an in-memory buffer | Uploaded bytes hash-identical |
| `download.createReadStream()` | **Empty (0 bytes)** although the download event fires |
| `context.request.get(href)` | Wrong body (no page session) |
| In-page `fetch(href, { credentials: 'include' })` | Exact bytes — used for GET links |
| In-page replay of a form POST (JSF command links too) | Exact bytes — used for form downloads |
| `route.fetch()` interception of a form-posted attachment | Not captured — not used |
| Structured handoff: Live View (tab), `handoff`, state, completion event | Works; completion observed on timeout |
| `browser.close()` on a connected session | Only disconnects; session stays alive |
| Binding `closeSession(sessionId)` | Ends the session; verified gone via `sessions()` |
| ARCA login page from Browser Run | HTTP 200, login form present, no block signals |

What was **not** measurable without an ARCA account: the authenticated portal
pages, the selectors in `arca-portal.ts` (derived from ARCA's manuals; version
`arca-portal-2026-10-manual-derived`), and whether ARCA challenges an
authenticated automated session. The executor returns
`ARCA_AUTOMATION_BLOCKED` / `ARCA_PAGE_UNRECOGNIZED` as recoverable states
rather than guessing.

## Reclaim and the hosted session

ARCA binds an authenticated session to the client's network context, and the
reviewed Reclaim flow is prover-side (WITNESS). A session that lives in
Cloudflare's network cannot be proven from an attestor or from the customer's
phone. So the hosted session is used for setup only, and the Reclaim proof is
captured on the customer's own device afterwards, exactly as before. If Reclaim
is not configured, the run stays in `waiting_for_proof` with
`RECLAIM_ARCA_ONBOARDING_CONFIGURATION_REQUIRED` and never reports connected.

## Contracts

All between Tax and the executor are in `packages/arca-setup-contract`:

- `arca-setup-order-v1` — Tax → executor, HMAC with `ARCA_SETUP_ORDER_SECRET`,
  bound to execution, onboarding run, workspace, operation, authorization and
  expected revision.
- `arca-setup-receipt-v1` — executor → Tax, HMAC with
  `ARCA_SETUP_RECEIPT_SECRET`. Tax applies it only if it matches the outstanding
  order and revision; receipts are idempotent by id.
- `arca-setup-cancel-v1` / `-receipt-v1` — cancellation and the verified close.
- `arca-setup-handoff-ticket-v1` — HMAC with `ARCA_SETUP_HANDOFF_SECRET`, two
  minutes, single use.

Every secret is distinct and scoped; the startup checks refuse equal values.

## Deploying the executor

```bash
cd apps/arca-setup-executor
# Homologation (top-level config). Set the real URLs in wrangler.jsonc vars first.
npx wrangler secret put ARCA_SETUP_ORDER_SECRET
npx wrangler secret put ARCA_SETUP_RECEIPT_SECRET
npx wrangler secret put ARCA_SETUP_HANDOFF_SECRET
npx wrangler secret put ARCA_BOUNDARY_SETUP_EXECUTOR_TOKEN
npx wrangler deploy
# Production
npx wrangler secret put ARCA_SETUP_ORDER_SECRET --env production   # …same four
npx wrangler deploy --env production
```

Vars (`wrangler.jsonc`): `ARCA_ENVIRONMENT`, `PUBLIC_BASE_URL` (the executor's
own HTTPS origin, used in handoff links), `TAX_RECEIPT_URL`
(`https://<tax>/v1/arca-setup/receipts`), `ARCA_BOUNDARY_URL`,
`ARCA_PROVIDER_CUIT` and `ARCA_PROVIDER_ALIAS` (public; provider delegation),
optional `ARCA_PORTAL_URLS_JSON` (ARCA hosts only). Keep homologation and
production in separate Workers with separate secrets.

To re-run the Browser Run proof in a non-production account:

```bash
cp wrangler.proof.jsonc /tmp/ && edit PUBLIC_BASE_URL to your workers.dev host
npx wrangler deploy -c wrangler.proof.jsonc
printf %s "$(openssl rand -hex 32)" | npx wrangler secret put PROOF_TOKEN -c wrangler.proof.jsonc
# plus the four executor secrets (any distinct 32+ byte values)
curl -X POST -H "authorization: Bearer $PROOF_TOKEN" https://<host>/proof/run
npx wrangler delete -c wrangler.proof.jsonc
```

## Configuration on the other services

Tax API (`apps/api`):

```text
TAX_ARCA_SETUP_ENABLED=true
TAX_ARCA_SETUP_DB_PATH=/data/arca-setup.sqlite        # durable volume
ARCA_SETUP_EXECUTOR_URL=https://arca-setup.example
ARCA_SETUP_ORDER_SECRET=…                             # shared with the executor
ARCA_SETUP_RECEIPT_SECRET=…                           # shared with the executor
ARCA_SETUP_HANDOFF_SECRET=…                           # shared with the executor
ARCA_BOUNDARY_URL=https://arca-boundary.example
ARCA_BOUNDARY_SETUP_TOKEN=…                           # boundary setup scope
TAX_ENGINE_ARCA_PROVIDER_OPERATOR_TOKEN=…             # BUFI operations console
ARCA_SETUP_PROVIDER_DELEGATION_ENABLED=true|false
TAX_ARCA_SETUP_TICK_MS=30000
```

ARCA boundary (`apps/arca-boundary`):

```text
ARCA_BOUNDARY_SETUP_TOKEN=…                # Tax only
ARCA_BOUNDARY_SETUP_EXECUTOR_TOKEN=…       # executor only; cannot provision or read keys
ARCA_SETUP_PROVIDER_TEMPLATE_WORKSPACE_ID=…  # BUFI's own issuer (provider delegation)
ARCA_SETUP_PROVIDER_TEMPLATE_PROFILE_REF=…
ARCA_SETUP_TRUSTED_ISSUERS_FILE=/run/secrets/arca-ca-chain.pem  # required in production
```

## Operating provider acceptance

`GET /v1/arca-setup/provider/queue` (operator token) lists executions waiting
for BUFI. `POST /v1/arca-setup/provider/:executionId/accept` dispatches the
provider-side order; `POST /v1/arca-setup/provider/:executionId/handoff-link`
returns the hosted tab for the operator to sign in with BUFI's Clave Fiscal.
The executor accepts only the designation whose CUIT matches the run's
taxpayer reference, binds BUFI's alias, and reports.

## Cancellation and recovery

- Cancel (customer or agent) marks the execution terminal, then the executor
  calls `closeSession` and verifies the session is gone. If the executor cannot
  be reached, Tax retries on every tick until it confirms.
- Closing the app changes nothing: state is in durable revisions and the
  executor's Durable Object. Status and the handoff link can be fetched again.
- A gone or expired browser session is `recoverable_action_required`; retrying
  reopens authentication and the run re-inspects ARCA before continuing.
- Connecting ARCA does not re-enable direct issuance: the Factura E submit and
  recover tools still answer `TAX_AUTHORITY_CORRIDOR_REQUIRED`.
