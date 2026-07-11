# Plan 003: Complete delegated WSFEX issuance and recovery for notes 20/21

> **Executor instructions**: Extend the existing isolated signer boundary; do
> not place certificates, WSAA credentials, Clave Fiscal, raw CUIT, or private
> keys in this backend. Update the plan index when complete.
>
> **Drift check (run first)**:
> `git diff --stat cb23cad..HEAD -- apps/api/src/wsfex.ts apps/api/src/wsfex.test.ts apps/api/src/factura-e-agent.ts apps/api/src/agent-routes.ts providers/wsfex/openapi.yaml providers/wsfex/README.md`
> Stop if Plan 002's canonical adjustment representation is absent.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: HIGH — authority transport and ambiguous recovery
- **Depends on**: Plans 001 and 002
- **Category**: direction, correctness, security, tests
- **Planned at**: commit `cb23cad`, 2026-07-11; source baseline was dirty

## Why this matters

The state machine advertises `submit_adjustment_to_wsfex` and
`recover_adjustment_wsfex`, but there are no corresponding service methods or
agent tools. The signer OpenAPI fixes `documentType` to 19. A Path A case can
prepare a note and reach `ready_for_wsfex`, then has no executable next step.

## Current state

- `packages/core/src/factura-e-agent.ts:733-734` emits adjustment WSFEX next
  actions.
- `apps/api/src/factura-e-agent.ts:395-437` submits and recovers only the original
  run-level invoice.
- `apps/api/src/agent-routes.ts:145-152` exposes invoice submit/recover tools only.
- `providers/wsfex/openapi.yaml:71-88` constrains expected documents to type 19
  and lacks original-document association fields.
- Existing gateway tests require the signer to echo the exact frozen document
  before a CAE is accepted. Preserve this fail-closed pattern.

## Commands

| Purpose | Command | Expected |
|---|---|---|
| API typecheck | `bun run --filter @tax-engine/api typecheck` | exit 0 |
| Signer tests | `bun test apps/api/src/wsfex.test.ts apps/api/src/agent-routes.test.ts` | all pass |
| YAML parse | `ruby -e "require 'yaml'; YAML.load_file('providers/wsfex/openapi.yaml')"` | exit 0 |
| Full gate | `bun run check` | exit 0 |

## Scope

**In scope**:

- `packages/core/src/factura-e-agent.ts`
- `packages/core/src/factura-e-agent.test.ts`
- `apps/api/src/wsfex.ts`
- `apps/api/src/wsfex.test.ts`
- `apps/api/src/factura-e-agent.ts`
- `apps/api/src/agent-routes.ts`
- `apps/api/src/agent-routes.test.ts`
- `providers/wsfex/openapi.yaml`
- `providers/wsfex/README.md`
- `docs/agent-backend.md`

**Out of scope**:

- Implementing or storing WSAA/private-key material in Motora
- Calling production ARCA
- Reusing a request ID across different invoice/note payloads
- Marking an ambiguous result accepted without exact recovery evidence

## Git workflow

- Branch: `codex/003-wsfex-adjustment-path`
- Conventional commit example: `feat(wsfex): authorize associated export notes`.
- Do not push or create a PR unless instructed.

## Steps

### Step 1: Generalize the signer document contract

Define a discriminated expected document:

- type 19 requires operation type 2 and forbids associations;
- types 20/21 require the canonical adjustment hash and the original type-19
  point-of-sale/invoice-number association;
- every variant requires issue date, currency, and exact total.

The response must echo the same discriminant and association. Keep request and
invoice numbers as decimal strings to avoid JavaScript precision loss.

**Verify**: OpenAPI parses and schema examples cover all three types.

### Step 2: Add adjustment authorize/recover gateway operations

Either introduce explicit `authorizeAdjustment/recoverAdjustment` methods or a
generic document command with a discriminated input. Build the safe expected
document solely from the frozen adjustment and original authority metadata.
Reject accepted responses when type, hash, POS, amount, currency, date, or any
association differs.

**Verify**: signer tests reject each individual mismatch and accept an exact
document-20 and document-21 echo.

### Step 3: Add immutable adjustment authority transitions

Record request ID, payload-reference hash, ambiguous/rejected/accepted state,
document number, CAE, receipt hash, and reprocessed flag on only the selected
adjustment. Enforce one request/payload pair for recovery. Do not change the
original invoice's authority fields.

**Verify**: core tests prove wrong request ID/payload/hash cannot recover and the
original invoice CAE remains unchanged.

### Step 4: Expose discoverable tools

Add submit/recover tools requiring `runId`, `adjustmentId`, request ID, and
opaque vault payload reference. Set the same approval and ambiguity execution
policies used for invoice issuance. Ensure the manifest, parser, service, and
next-action strings have a parity test.

**Verify**: HTTP Path A test runs invoice authorization, prepares a note, obtains
user then accountant approval, observes an ambiguous note submission, and
recovers with the exact same request/payload.

### Step 5: Document homologation ownership

Update the signer runbook with exact replay and FEX query reconciliation for
notes. State that the external signer owns certificates/WSAA and that only Plan
005 may record actual homologation results.

**Verify**: `bun run check` → exit 0.

## Test plan

- Type 20 and 21 exact signer echo happy paths.
- Wrong association/type/hash/date/currency/amount rejected.
- Timeout/5xx creates ambiguous note state.
- Recovery reuses request ID and payload reference.
- User and accountant approvals required for delegated path.
- Original invoice authority remains immutable.

## Done criteria

- [ ] Every WSFEX next action has a discoverable executable tool.
- [ ] Signer boundary handles 19/20/21 with discriminated schemas.
- [ ] Ambiguous adjustment recovery is exact and idempotent.
- [ ] No authority credential enters the Motora process/store/logs.
- [ ] `bun run check` exits 0.

## STOP conditions

- The external signer cannot echo the adjustment hash and association.
- Recovery would require a fresh request ID or reconstructed payload.
- Any raw certificate, key, WSAA token, CUIT, or Clave Fiscal would cross into
  this backend.
- Plan 002's adjustment hash/rule representation changes during execution.

## Maintenance notes

Review every new signer field as an authorization binding, not convenience
metadata. A CAE alone is insufficient without an exact document echo.
