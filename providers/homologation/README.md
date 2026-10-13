# ARCA homologation acceptance harness

This harness turns the final external gate into safe, repeatable commands. It
does not authorize production, automate Clave Fiscal, or provision provider
credentials. All output is redacted configuration state, versions, and hashes.

## 1. Preflight

Configure secrets only through the approved secret manager, then run:

```bash
bun run homologation:preflight
```

The checked-in live smoke can be evaluated separately:

```bash
bun --filter @tax-engine/api homologation:validate-live-smoke -- \
  ../../providers/homologation/evidence/2026-07-14-wsfex-live-smoke.json
```

The July smoke is **blocked**: `FEXGetPARAM_PtoVenta` returned zero active FEEWS
points. A later, explicitly authorized one-time diagnostic in homologation
accepted E 2/1 despite that empty list; see the [registration and CAE evidence](evidence/2026-09-22-arca-self-issuer-pos-registration.json).
The [following read-only probe](evidence/2026-09-23-arca-self-issuer-readonly.json)
still reports voucher 1 through both last-number APIs while point discovery
remains empty. An isolated recheck confirmed exact authorized readback of C 1/1
and E 2/1 without creating vouchers. A scoped connection through BUFI is still
required before the app can claim readiness. Production remains disabled.

## Delegated BUFI issuer pilot

BUFI's representative CUIT and its own homologation computer certificate must
first be provisioned as an active, self-represented template in the encrypted
ARCA boundary. Set `BUFI_ARCA_REPRESENTATIVE_CUIT` in Desk so the user sees the
correct CUIT in Invoices. Optional issuer Padrón suggestions additionally need
the boundary's distinct `ARCA_BOUNDARY_PADRON_TOKEN`, the template workspace
and profile references, and authorization for
`ws_sr_constancia_inscripcion`. Without these, Desk asks for manual fiscal data.

After the taxpayer delegates WSFE and/or WSFEX in ARCA and clicks “Ya delegué”,
the user remains pending. A BUFI operator must accept the designation and
associate the BUFI computer in ARCA. Only then, with the operator tokens in a
protected shell, feed the following JSON to the admin command via stdin:

```bash
bun --filter @tax-engine/api homologation:activate-delegation < /secure/path/activation.json
```

The file contains `onboardingId`, `workspaceId`, and `representedCuit`. The
command clones the sealed BUFI credential within the boundary and persists a
Tax reference; neither certificate nor private key crosses into Desk or Tax.
It prints only the run and profile references. Tax checks the boundary's CUIT
commitment against the onboarding run. The user then enters the C/E points in
Invoices and runs “Verificar emisor existente”; only the existing exact official
point/voucher reads can mark a service ready. An operator receipt or a user's
notice alone never enables issuance. No production path uses this command.

The repository-wide preflight also checks the older Reclaim acceptance path;
its missing Reclaim gates do not by themselves block this direct delegated
issuer path. The direct pilot still needs running Desk, Motora, Tax, boundary,
WSFE and WSFEX services and authorized certificates.

After any change to point registration, rerun discovery through the isolated
signer:

```bash
bun --filter @tax-engine/api homologation:probe-points-of-sale
```

The command reads `ARCA_HOMOLOGATION_WORKSPACE_ID` and
`ARCA_HOMOLOGATION_ISSUER_PROFILE_REF` from the server environment, calls
`FEXGetPARAM_PtoVenta`, and outputs only active point numbers and receipt hashes.
It exits `2` for an empty list and refuses to run when `ARCA_ENVIRONMENT=production`.
An empty list is investigated with the signer's exact accepted-voucher readback
for the configured homologation issuer; it is not a generic bypass. That
receipt is the evidence used by the deterministic onboarding endpoint
`POST /v1/arca-onboarding/runs/:id/api-verification/wsfex`, after delegation.
The endpoint requires the active point selected during the earlier portal step
to appear in ARCA's result or in that exact issuer-bound readback, and binds the
receipt to the issuer-profile hash and represented-CUIT commitment recorded during delegation. Reclaim may support
the earlier portal discovery, but it cannot satisfy this API-verification step.

The command exits `0` only when all of these are true:

- explicit homologation authority and an approved test identity are recorded;
- trusted user, accountant, and evidence-ingest channels are configured;
- all three Reclaim provider IDs are configured and explicitly marked reviewed;
- HTTPS callback, proof vault, and signer boundaries are configured;
- a retention policy and WSFEX certificate delegation are confirmed; and
- the authority environment is homologation with production disabled.

It never outputs environment variable names' values. Missing or unsafe gates
exit `2` and remain safe for CI logs.

## 2. Probe the isolated signer

The signer must implement the redacted `/health` response in
[`../wsfex/openapi.yaml`](../wsfex/openapi.yaml).

The reference signer and encrypted authority-boundary containers are in
[`apps/wsfex-signer`](../../apps/wsfex-signer/README.md) and
[`apps/arca-boundary`](../../apps/arca-boundary/README.md). They still require
an approved deployment, delegated homologation certificate/test identity, and
active FEEWS point of sale before this gate can pass.

Run:

```bash
bun run homologation:probe-signer
```

The probe accepts only HTTPS and a signer that reports `homologation`, delegated
certificate configuration, and WSAA readiness. Its output contains versions and
a hash of the safe health response—not certificate material or WSAA tokens.

## 3. Run interactive/provider acceptance

Use the reviewed Reclaim browser workflow and the WSFEX signer matrix. Capture
only proof/receipt/custody/event-sequence hashes. The user authenticates directly
with ARCA; no PIN, cookie, CAPTCHA answer, raw CUIT, certificate, or private key
belongs in the evidence report.

The redacted evidence JSON must satisfy `homologationEvidenceSchema` in
`apps/api/src/homologation.ts`. It covers:

- all four Reclaim evidence purposes—onboarding readiness, taxpayer readiness,
  CAE constatement, and adjustment constatement—across the three reviewed
  provider IDs, including provider versions, TEE policy, custody receipt, and
  negative binding tests. Every provider-ID hash must match the currently
  configured provider ID whose separate reviewed flag is true;
- WSFEX document types 19/20/21, accepted result, deliberate ambiguity, exact
  recovery, mismatched-echo/canonical-payload rejection, encrypted payload
  inspection, and WSAA private-key isolation;
- complete Path A and Path B event/packet hashes with separate settlement, FX,
  and tax states; and
- accountant, security, and owner acceptance for production review.

Validate it with:

```bash
bun run homologation:validate -- /absolute/path/to/redacted-evidence.json
```

Exit `0` means only “the redacted report is structurally complete for independent
human production review,” not that its claims were independently verified and
not that production is enabled. Reviewers must inspect every referenced evidence
artifact. A failed evidence gate exits `3`. Schema-invalid input fails without
being copied to output.

## Production boundary

Production remains disabled after successful homologation. Enabling it requires
separate explicit owner approval and a reviewed deployment change. Never reuse a
homologation evidence report as a timeless certification; repeat acceptance when
ARCA pages, provider versions, signer versions, or effective rules change.
