# ARCA homologation acceptance harness

This harness turns the final external gate into safe, repeatable commands. It
does not authorize production, automate Clave Fiscal, or provision provider
credentials. All output is redacted configuration state, versions, and hashes.

## 1. Preflight

Configure secrets only through the approved secret manager, then run:

```bash
bun run homologation:preflight
```

The command exits `0` only when all of these are true:

- explicit homologation authority and an approved test identity are recorded;
- trusted user, accountant, and evidence-ingest channels are configured;
- both Reclaim providers are configured and explicitly marked reviewed;
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

- all three Reclaim purposes, provider versions, TEE policy, custody receipt,
  and negative binding tests;
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
