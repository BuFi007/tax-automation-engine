# Tax C/E development beta

This branch permits fiscal effects only with `ARCA_FISCAL_BETA_ENABLED=true`,
`TAX_DEPLOYMENT_ENVIRONMENT=development`, `ARCA_ENVIRONMENT=homologation`, and
an exact `ARCA_FISCAL_BETA_WORKSPACE_IDS` enrollment list. IDs are a team UUID
or `personal:<user UUID>`, comma-separated. Production cannot authorize or
recover through the environment-built effect gateways, including older agent
routes. The application must continue to point to its development database.

## Runtime configuration

Use protected process environment or a secret manager, without putting secret
values in shell arguments or output. Set durable `TAX_ENGINE_DB_PATH`,
`TAX_WSFE_DB_PATH` (legacy `TAX_PERSONAL_WSFE_DB_PATH` remains supported),
`TAX_AUTHORITY_EXECUTION_DB_PATH`, `ARCA_BOUNDARY_DB_PATH`,
`WSFE_SIGNER_DB_PATH`, and `WSFEX_SIGNER_DB_PATH` in persistent directories.
Each service needs a distinct port: Tax defaults 4100, WSFEX 4200; boundary
and WSFE both previously defaulted 4300, so assign one an explicit different port.

Tax reads `ARCA_WSFE_SIGNER_URL`/`ARCA_WSFE_SIGNER_TOKEN`,
`ARCA_SIGNER_URL`/`ARCA_SIGNER_TOKEN` for WSFEX,
`ARCA_BOUNDARY_URL`/`ARCA_BOUNDARY_STATUS_TOKEN`, and
the same `ARCA_BOUNDARY_URL` with `ARCA_BOUNDARY_PAYLOAD_WRITE_TOKEN`.
Signed C effects use `TAX_ENGINE_DESK_ARCA_ISSUE_PRINCIPAL_HMAC_SECRET` (32+ bytes,
distinct from projection, onboarding and generic user secrets).
E retains separate Motora and Open Agents signed authority principals,
`TAX_ENGINE_MOTORA_AUTHORITY_PRINCIPAL_HMAC_SECRET` and
`TAX_ENGINE_OPEN_AGENTS_APPROVAL_PRINCIPAL_HMAC_SECRET`.
Enable `TAX_ENGINE_ARCA_AUTHORITY_CORRIDOR_ENABLED=true` and
`TAX_ENGINE_ARCA_REMOTE_EFFECTS_ENABLED=true` for E.
Configure the existing private Desk commercial source and issuer registry.
Do not replace approval, accountant review, or readiness evidence with fixtures.

After dependency installation and browser-contracts build, start each process
from the repository root with its protected environment:

```sh
bun --filter @tax-engine/arca-boundary start
bun --filter @tax-engine/wsfe-signer start
bun --filter @tax-engine/wsfex-signer start
bun --filter @tax-engine/api start
```

All production-approved switches stay false. Use direct ARCA provider unless the
issuer explicitly authorized AFIP SDK credential/ticket transfer. Loopback HTTP
is accepted in homologation where adapters explicitly permit it; otherwise TLS
is required.

## Existing authorized issuer and delegated setup

`POST /v1/arca-onboarding/runs/:id/existing-issuer` can import a configured
self-represented homologation issuer; it requires a body-bound onboard principal,
registered workspace/profile binding, current certificate, matching taxpayer
commitment, genuinely configured delegation, and official point/readback checks.
Payload: actorId, idempotencyKey, confirmedExistingSetup=true,
exportPointOfSale, domesticPointOfSale. It cannot infer authorization from a user
claim. A controlled pilot issuer may be scoped in both workspaces if legitimately
provisioned for both. Tax's C active-voucher reservation is global per issuer
commitment/POS to prevent simultaneous Personal/team use of the same voucher.

Existing `homologation:activate-delegation` is operator-only and now enforces the
same development beta enrollment. Its stdin JSON contains onboardingId,
workspaceId and representedCuit, and it clones sealed BUFI template credentials
inside the boundary after genuine portal acceptance/computer association.
It requires `ARCA_BUFI_TEMPLATE_WORKSPACE_ID`, `ARCA_BUFI_TEMPLATE_PROFILE_REF`,
`ARCA_BOUNDARY_ADMIN_TOKEN`, `TAX_ENGINE_OPERATOR_URL`, and
`TAX_ARCA_ISSUER_BINDING_ADMIN_TOKEN`. Never print certificate/key files or tokens.

## Contracts and product scope

Shared C: `POST /v1/wsfe/attempts`, `/issue`, `/recover`. Existing
`/v1/personal-wsfe/attempts*` aliases accept Personal only. Preparation version
`wsfe-preparation-v1` and prior `personal-wsfe-preparation-v1` share the exact frozen
body contract. Scope/actor/capability/method/path/body hash are signed in v3
`x-tax-tenant-principal` and `x-tax-tenant-signature`; Personal actor must be owner,
team actor a human UUID whose invoice permission Desk checked. Recovery body is
only `{invoiceId}`. Successful replay retains the same voucher, signer request,
connection and intent. CAE remains pending until exact official readback.

E uses existing `/v1/authority/factura-e` case, preparation, approval, execution,
recovery and reconciliation contracts with the same enrolled beta perimeter.
No raw generic API token authorizes these effects.

Current C is type 11, concept 2 (services), ARS. Current E is USD export services
with reviewed manual homologation quote. This is not general retail A/B or goods
support. PDF and QR are produced by Desk only after official persistence; mock
unit receipts do not establish a completed live ARCA end-to-end test.

The isolated signer runtime may provide `WSFE_HOMOLOGATION_POS_PROOFS_JSON`
and `WSFEX_HOMOLOGATION_POS_PROOFS_JSON` arrays for explicitly scoped aliases
of an already controlled homologation issuer. Each entry has the same fields
as the existing singular proof config. Exactly one workspace/profile entry must
match; duplicate or mixed aliases fail closed, and production forbids the array.
These are only coordinates for fresh independent official readback, never proof
that a new voucher was authorized. Keep represented CUIT and known CAE values in
protected process configuration.

## Genuine accountant approval for the beta

Personal has one owner, so it cannot satisfy authority self-approval protection by
acting as both creator and final reviewer. In beta, persist the owner's genuinely
approved frozen intent first, including manual-quote cases still awaiting the
accountant. The receipt says `request_accountant_authority_approval`; readiness
reports `delegated_accountant_required`. Persistence alone never dispatches ARCA.

The existing review queue includes `creatorActorId` only when an actual recorded
human approval actor matches the durable authority creator, plus nullable exact
`authorityExecutionId`/`authorityApprovalState`, `approvalState`, and
`mandateConfirmed` from a live mandate. No reviewer is inferred or created.

A separate authenticated accountant submits
`POST /v1/accountant-invoice-authority-approvals` with a v3 body-bound
`accountant:decision` principal from the dedicated ingress secret. Its body is:

```json
{
  "version": "factura-e-accountant-authority-approval-v1",
  "workspaceId": "exact enrolled client scope",
  "runId": "UUID",
  "authorityExecutionId": "UUID",
  "intentHash": "SHA256",
  "mandateId": "live mandate reference",
  "idempotencyKey": "exact review decision key"
}
```

Tax verifies the real human actor and firm, the live client mandate, exact frozen
invoice/run/authority tuple, and distinct actual owner/creator. It persists the
reviewer's semantic approval and an unexposed server-held one-use authority
reference. The safe response contains `authorityReceipt` and correlated IDs;
the owner then executes with the existing signed execute endpoint. Same-body
replay cannot create another effect; revoked/expired mandates and self-approval
fail closed. No generic API key, fabricated `oa:owner` actor, or browser-supplied
approval reference can grant this path. Legacy OA remains separate.

Local Tax binds to loopback by default; set `TAX_ENGINE_HOST` explicitly for an
approved deployment. The isolated live setup uses a task-local loopback TLS
proxy for signer→boundary traffic and trusts its CA only in child processes.
