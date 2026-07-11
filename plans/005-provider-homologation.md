# Plan 005: Run provider acceptance and ARCA homologation without overstating production readiness

> **Executor instructions**: This is an external-integration acceptance plan,
> not authorization to use production taxpayer credentials. Use only explicitly
> supplied test identities, reviewed providers, and ARCA homologation assets.
> Never paste credentials into issues, plans, logs, fixtures, or commits.
>
> **Drift check (run first)**:
> `git diff --stat cb23cad..HEAD -- providers/reclaim providers/wsfex docs/agent-backend.md apps/api/src/reclaim.ts apps/api/src/wsfex.ts`
> Confirm Plans 001–004 are DONE before proceeding.

## Status

- **Priority**: P1
- **Effort**: L/external coordination
- **Risk**: HIGH — real authority/provider environment
- **Depends on**: Plans 002, 003, and 004
- **Category**: tests, security, docs
- **Planned at**: commit `cb23cad`, 2026-07-11; source baseline was dirty

## Why this matters

Mocked cryptographic and signer boundaries prove application behavior, not that
ARCA pages expose stable reviewed claims or that an authorized signer works in
homologation. Production readiness requires evidence from both external systems
while preserving the no-PIN/no-private-key Motora boundary.

## Current state

- Health reports Reclaim and WSFEX as `configuration_required` when absent.
- `providers/reclaim` defines the proposed safe extracted claims and forbidden
  disclosures but contains no published reviewed provider IDs.
- `providers/wsfex` defines the contract/recovery invariants,
  `apps/wsfex-signer` implements the isolated SOAP provider, and
  `apps/arca-boundary` implements encrypted payload custody plus WSAA CMS/ticket
  brokerage, scoped revocation, and offline transactional key rotation. They
  are not deployed and have no authorized homologation
  certificate, delegated identity, or active FEEWS point of sale.
- `bun run homologation:preflight` now reports missing/unsafe external gates
  without exposing values; `homologation:probe-signer` checks redacted signer
  health; and `homologation:validate` validates the final redacted evidence set.
- `docs/agent-backend.md` correctly lists these as completion boundaries.

## Commands

| Purpose | Command | Expected |
|---|---|---|
| Local gate | `bun run check` | exit 0 before external testing |
| Contract parse | `jq empty providers/reclaim/arca-provider-contracts.json && ruby -e "require 'yaml'; YAML.load_file('providers/wsfex/openapi.yaml')"` | exit 0 |
| Safe preflight | `bun run homologation:preflight` | exit 0 only after explicit external authority/assets; exit 2 while blocked |
| Signer probe | `bun run homologation:probe-signer` | exit 0 with homologation versions and safe receipt hash |
| Evidence validation | `bun run homologation:validate -- /absolute/path/to/redacted-evidence.json` | exit 0 only for complete redacted acceptance evidence |
| Secret scan | `git diff --cached --check && git status --short` | no credential-bearing file staged |

## Scope

**In scope**:

- Provider definitions in the external Reclaim dashboard/repository
- Isolated signer deployment in an approved environment
- Homologation-only run evidence with redacted hashes/receipts
- `providers/reclaim/README.md`
- `providers/wsfex/README.md`
- `docs/agent-backend.md`
- `docs/qa/` only if its policy permits non-secret acceptance reports

**Out of scope**:

- Production issuance
- Personal Clave Fiscal/PIN storage or automation
- Committing provider app secrets, signer tokens, certificates, private keys,
  raw CUIT/TIN, cookies, CAPTCHA data, or unredacted proof payloads
- Enabling TaxScore, factoring, payments, or autonomous filing

## Git workflow

- Branch: `codex/005-arca-homologation-evidence`
- Commit only redacted contracts/runbooks/results, e.g.
  `docs(arca): record homologation acceptance evidence`.
- Do not push, open, or merge a PR without explicit owner approval after the
  credential/PII scan.

## Steps

### Step 1: Obtain explicit external authority and assets

Record owners for Reclaim provider review, test identity, proof vault, isolated
signer, certificate delegation, ARCA homologation, and accountant acceptance.
Use a secrets manager for values. If any asset is missing, keep this plan
BLOCKED and stop.

**Verify**: owners confirm availability out of band; no secret is written here.

### Step 2: Accept the Reclaim providers

For readiness and document constatement, verify exact origin/request discovery,
provider version, required outputs, forbidden disclosure, context/session
binding, ten-minute expiry, replay handling, and optional/required TEE policy.
Test invoice 19 and associated notes 20/21. Retain only vault receipts and hashes
in Motora.

**Verify**: the acceptance matrix in `providers/reclaim/README.md` is completed
with redacted evidence references; all negative cases fail closed.

### Step 3: Accept WSFEX in homologation

Run exact issue and ambiguous-recovery scenarios for 19/20/21 through the
isolated signer. Confirm response echoes, request ID/payload immutability, FEX
reconciliation, certificate isolation, and no credentials in backend logs.

**Verify**: the signer matrix records redacted receipt hashes for accepted,
rejected, timeout/ambiguous, and exact recovery cases.

### Step 4: Run one complete human-gated journey per path

Path B: financial evidence → draft → user approval → ARCA co-pilot → verified
CAE → correction note → verified association → settlement/FX/accountant packet.

Path A: the same intent/approval boundary → isolated signer → deliberately
ambiguous homologation scenario → exact recovery → correction note.

No test may use a real production taxpayer or production issuance endpoint.

**Verify**: append-only case events and redacted authority/proof receipts match
the documented sequence; no state claims more than its evidence supports.

### Step 5: Produce a go/no-go report

List every passed/failed gate, provider/signer version, effective rule version,
rollback condition, and remaining owner approval. A successful homologation run
may change health from `configuration_required` to available in that environment;
it does not authorize production.

**Verify**: owner/accountant/security reviewers explicitly approve or leave the
production gate closed.

## Test plan

- Readiness, invoice 19, notes 20/21, wrong association, replay, expiry, cancel.
- WSFEX accepted/rejected/ambiguous/exact recovery for all document variants.
- No-PIN/no-key/no-raw-ID boundary inspection.
- Complete Path A and B journeys with separate settlement, FX, tax, and finance
  states.

## Done criteria

- [ ] Reviewed provider versions pass the acceptance matrix.
- [ ] Authorized homologation signer passes exact issue/recovery matrix.
- [ ] Raw credentials/proofs/PII are absent from Motora persistence and commits.
- [ ] Both human-gated journeys have redacted auditable evidence.
- [ ] Production remains disabled until explicit owner approval.

## STOP conditions

- No explicit authorization, test identity, provider review, certificate, or
  homologation environment.
- Any step would require storing or exposing a PIN/private key/raw authority
  session in Motora.
- ARCA page/provider output changed from the reviewed contract.
- A negative binding/replay/recovery case does not fail closed.

## Maintenance notes

Repeat acceptance whenever an ARCA page, Reclaim provider version, signer
version, or effective rule changes. Homologation evidence expires operationally;
record version/date rather than a timeless “certified” flag.
