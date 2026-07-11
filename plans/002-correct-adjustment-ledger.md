# Plan 002: Make export adjustment notes financially and temporally correct
Any future document type must enter the same derived ledger, not add another
mutable total. Review rule-version binding and post-declaration behavior closely.
> **Executor instructions**: Implement a deterministic immutable adjustment
> ledger. Do not encode uncertain tax policy as fact; put effective-dated rule
> decisions behind catalogue IDs and stop when accountant/legal input is needed.
>
> **Drift check (run first)**:
> `git diff --stat cb23cad..HEAD -- packages/core/src/factura-e-agent.ts packages/core/src/factura-e-agent.test.ts packages/core/src/catalogue/argentina.ts apps/api/src/factura-e-agent.ts`
> If the Plan 001 tests are not green, stop and complete Plan 001 first.

## Status

- **Priority**: P1
- **Effort**: M (one to three days)
- **Risk**: MED — changes money/state derivation after corrections
- **Depends on**: `plans/001-restore-dogfood-baseline.md`
- **Category**: correctness, tests, architecture
- **Planned at**: commit `cb23cad`, 2026-07-11; source baseline was dirty

## Why this matters

The current adjustment object proves that a note exists but does not recompute
the invoice's net economic balance, settlement reconciliation, tax readiness, or
accounting evidence. It caps each credit note against the original total but not
the cumulative authorized credits. A sequence of individually valid notes can
therefore represent an impossible net receivable, while existing final
settlement/finance states still refer to the pre-correction amount.

## Current state

- `packages/core/src/factura-e-agent.ts:506-557` prepares notes 20/21 and freezes
  finance.
- `packages/core/src/factura-e-agent.ts:526` checks only the new credit note
  against the original total; prior authorized credit/debit notes are ignored.
- `packages/core/src/factura-e-agent.ts:384-400` authorizes an adjustment but
  changes no settlement or tax-ready state other than freezing finance.
- `packages/core/src/factura-e-agent.ts:645-669` reconciles settlement only to
  `run.intent.total`, not a corrected net total.
- `packages/core/src/factura-e-agent.ts:798-803` uses a regex plus `Date.parse`;
  JavaScript normalizes invalid dates such as February 31 instead of rejecting
  them.
- Exact money uses `decimal.js`; hashes use sorted canonical JSON. Preserve both.

## Commands

| Purpose | Command | Expected |
|---|---|---|
| Core typecheck | `bun run --filter @tax-engine/core typecheck` | exit 0 |
| Core tests | `bun test packages/core/src/factura-e-agent.test.ts` | all pass |
| API tests | `bun test apps/api/src/agent-routes.test.ts` | all pass |
| Full gate | `bun run check` | exit 0 |

## Scope

**In scope**:

- `packages/core/src/factura-e-agent.ts`
- `packages/core/src/factura-e-agent.test.ts`
- `packages/core/src/catalogue/argentina.ts`
- `packages/core/src/index.ts`
- `apps/api/src/factura-e-agent.ts`
- `apps/api/src/agent-routes.test.ts`
- `docs/agent-backend.md`
- `docs/architecture.md`

**Out of scope**:

- WSFEX transport and OpenAPI (Plan 003)
- Reclaim lifecycle/custody (Plan 004)
- Guessing whether a note changes a specific filed return without an effective
  rule decision and accountant evidence
- Mutating or deleting the original invoice/settlement events

## Git workflow

- Branch: `codex/002-correct-adjustment-ledger`
- Conventional commit example: `feat(tax): derive corrected Factura E balance`.
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Add strict calendar-date validation

Replace the rollover-prone date helper with a strict UTC component round-trip or
an existing strict project date primitive. Apply it consistently to invoice,
payment, FX observation, adjustment, and `asOf` dates. Do not introduce local
timezone arithmetic.

**Verify**: add leap-day, February 31, month 13, and five-day-boundary tests;
`bun test packages/core/src/factura-e-agent.test.ts` → all pass.

### Step 2: Define one derived adjustment ledger

Add a pure derived view (do not store a mutable cached total) that returns:

- authorized debit-note total;
- authorized credit-note total;
- pending adjustment total by type;
- net authorized document total = original + debits − credits;
- corrected settlement gap; and
- a boolean indicating whether any adjustment is pending/ambiguous/disputed.

Use `Decimal` for every operation and return normalized decimal strings. Pending
notes must not alter the authorized total but must freeze finance.

**Verify**: table-driven tests for no notes, one debit, one credit, multiple
notes, decimal scale differences, and zero/negative net prevention.

### Step 3: Enforce cumulative credit constraints

Before preparing a credit note, calculate its proposed effect against authorized
and still-open notes. Reject a sequence that would make the corrected net total
negative or otherwise violate the effective-dated rule decision. Keep the
single-open-adjustment guard unless the product explicitly approves parallel
notes.

Add the rule decision ID to the adjustment intent before hashing so human
approval binds the rule version.

**Verify**: a second credit that cumulatively exceeds the allowed balance is
rejected; a debit followed by a valid credit follows the documented rule.

### Step 4: Recompute dependent states without rewriting history

After adjustment authorization, settlement recording, settlement reversal, and
FX verification, derive settlement/tax/finance readiness from the corrected net
total. Preserve all original settlement events. Never mark tax declared
automatically; an authorized adjustment after declaration must create a
deterministic accountant-review-needed state or separate amendment readiness,
not silently leave `declared` as clean.

If existing enums cannot express “declared return needs amendment,” add an
explicit state instead of overloading `not_ready`.

**Verify**: tests cover an invoice that was settled/reviewable, then receives a
credit note; finance freezes and only becomes reviewable again after the
corrected evidence set is complete.

### Step 5: Expose a safe accounting/attestation projection

Expose original invoice, immutable notes, net authorized amount, settlements,
and remaining gap as safe hashes/metadata for downstream QuickBooks, Xero,
Conta Azul, Contabilium, and accountant packets. Do not claim that connector
writes occurred in this plan.

**Verify**: projection tests prove original and note IDs remain present and that
no raw taxpayer/customer identifier appears.

## Test plan

- Strict valid/invalid calendar dates and exact five-day edges.
- Cumulative debit/credit sequences and exact-decimal scale equivalence.
- Pending, authorized, rejected, and ambiguous adjustment effects.
- Corrected settlement gap after partial/final/reversed payments.
- Tax declaration followed by correction requires accountant review.
- Original documents and events remain immutable.

## Done criteria

- [ ] Invalid rollover dates are rejected by core and API tests.
- [ ] Cumulative notes cannot produce an invalid net balance.
- [ ] Settlement and finance states use corrected net amount.
- [ ] Post-declaration correction cannot remain silently “declared/clean.”
- [ ] Safe accounting projection includes immutable associations.
- [ ] `bun run check` exits 0.

## STOP conditions

- Correct behavior depends on an unresolved ARCA/accounting policy question.
  Add the question to docs and request accountant input; do not guess.
- The implementation would edit or delete original invoice/settlement history.
- A floating-point number would enter a money calculation.
- Plan 001's public-contract tests are red.

## Maintenance notes

Any future document type must enter the same derived ledger, not add another
mutable total. Review rule-version binding and post-declaration behavior closely.
