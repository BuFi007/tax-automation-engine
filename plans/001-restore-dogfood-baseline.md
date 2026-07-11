# Plan 001: Restore the dogfood verification baseline and public contract parity

> **Executor instructions**: Follow each step and run every verification. Do
> not add production credentials or call ARCA. Update `plans/README.md` when
> complete.
>
> **Drift check (run first)**:
> `git status --short && git diff --stat cb23cad..HEAD -- apps/api/src/agent-routes.ts apps/api/src/agent-routes.test.ts apps/api/src/reclaim.ts packages/core/src/factura-e-agent.ts providers/reclaim docs/agent-backend.md`
> If any named source file is absent, stop: the uncommitted baseline was not
> transferred into this worktree.

## Status

- **Priority**: P0
- **Effort**: S (hours)
- **Risk**: LOW — contract and characterization-test repair
- **Depends on**: none
- **Category**: bug, tests, docs
- **Planned at**: commit `cb23cad`, 2026-07-11; source baseline was dirty

## Why this matters

The public tool manifest is the agent's source of truth. It currently hides the
adjustment Reclaim purpose and `subjectId`, even though the invocation parser
accepts them. Typechecking fails and the main Path B test aborts on a stale tool
count before the workflow runs. Until parity and an end-to-end adjustment test
exist, the backend cannot honestly be dogfooded or handed to another agent.

## Current state

- `apps/api/src/agent-routes.ts:136-141` advertises only
  `arca_taxpayer_readiness` and `arca_cae_constatement`.
- `apps/api/src/agent-routes.ts:307-313` accepts those purposes plus
  `arca_adjustment_constatement` and optional `subjectId`; spreading the parsed
  object forwards `subjectId: undefined`, which violates the service's exact
  optional type.
- `apps/api/src/agent-routes.test.ts:26` expects 11 tools while runtime exports
  13.
- `apps/api/src/agent-routes.test.ts:155-192` implements a fake gateway with the
  old session and CAE claim shapes: it lacks `subjectId`, `subjectHash`, and the
  three association claims.
- `providers/reclaim/arca-provider-contracts.json:27-48` specifies only document
  type 19, not associated notes 20/21.
- Tests use Bun's `describe/test/expect`, in-memory `TaxProfileStore`, explicit
  trusted-channel requests, and exact event assertions. Match
  `apps/api/src/agent-routes.test.ts:13-100`.

## Commands

| Purpose | Command | Expected |
|---|---|---|
| Typecheck | `bun run typecheck` | exit 0 |
| Focused tests | `bun test packages/core/src/factura-e-agent.test.ts apps/api/src/agent-routes.test.ts apps/api/src/wsfex.test.ts` | all pass |
| Full gate | `bun run check` | typecheck, all tests, and all builds pass |
| Static contracts | `jq empty providers/reclaim/arca-provider-contracts.json && ruby -e "require 'yaml'; YAML.load_file('providers/wsfex/openapi.yaml')"` | exit 0 |

## Scope

**In scope**:

- `apps/api/src/agent-routes.ts`
- `apps/api/src/agent-routes.test.ts`
- `apps/api/src/reclaim.ts`
- `packages/core/src/factura-e-agent.test.ts`
- `providers/reclaim/arca-provider-contracts.json`
- `providers/reclaim/README.md`
- `docs/agent-backend.md`
- `README.md`

**Out of scope**:

- Real Reclaim provider publication or credentials
- WSFEX adjustment submission
- New tax calculations or UI changes
- Weakening human/accountant approval boundaries

## Git workflow

- Branch: `codex/001-agent-contract-parity`
- Use conventional commits, e.g. `test(agent): cover associated credit-note proof`.
- Do not push or open a PR unless the operator explicitly instructs it.

## Steps

### Step 1: Make the manifest and invocation schema identical

Extend the public `tax_ar_reclaim_start` description and JSON schema to include
`arca_adjustment_constatement` plus nullable/optional `subjectId`. Parse into a
local value and pass `subjectId` only when defined, or normalize it to `null`, so
`exactOptionalPropertyTypes` passes. Add a manifest assertion that the exact
advertised schema accepts every supported purpose and requires no undocumented
field.

**Verify**: `bun run --filter @tax-engine/api typecheck` → exit 0.

### Step 2: Update the fake gateway without weakening production verification

Make `FakeReclaimGateway.createRequest` accept `subjectId`. Bind readiness to
null subject values, invoice CAE to the frozen invoice intent/hash, and adjustment
CAE to the selected adjustment/hash. Emit null association fields for document
19 and exact original-document association fields for 20/21. Give
`verifyCallback` the explicit `Promise<VerifiedReclaimProofV1>` return type.

Do not change `ReclaimProtocolGateway.verifyCallback` to accommodate the fake.

**Verify**: `bun run --filter @tax-engine/api typecheck` → exit 0.

### Step 3: Add a complete Path B credit-note dogfood test

Extend the existing Path B test, or add a focused sibling, to run:

1. verified readiness;
2. evidence-deduplicated invoice draft;
3. approval through the trusted user route;
4. invoice CAE proof bound to document 19;
5. prepare document 21 associated to that invoice;
6. assert finance becomes frozen;
7. trusted user approval of the adjustment hash;
8. retrieve the adjustment co-pilot packet and assert it contains the original
   type/POS/number but no taxpayer hash or credentials;
9. start adjustment proof using the publicly advertised `subjectId`;
10. verify a document-21 proof with exact association; and
11. assert only that adjustment becomes `arca_authorized` and financing stays
    frozen.

Also assert wrong subject hash, wrong original invoice number, and proof replay
are rejected without a new revision.

**Verify**: `bun test apps/api/src/agent-routes.test.ts packages/core/src/factura-e-agent.test.ts` → all pass.

### Step 4: Reconcile provider and operator documentation

Update the Reclaim contract to define invoice and adjustment proof outputs
unambiguously. Either use two explicit provider entries sharing the configured
provider environment variable, or one discriminated contract where association
fields are forbidden for type 19 and required for 20/21. Document the new trusted
approval routes and tools. Keep publication and production activation marked
external/unverified.

**Verify**: run the static-contract command from the table → exit 0.

### Step 5: Restore the one-command gate

Run `bun run check`. Record the exact test count in the PR description, not in a
brittle source assertion unless the count itself is a deliberate API invariant.

**Verify**: `bun run check` → exit 0 with no failed tests.

## Test plan

- Manifest/runtime purpose parity.
- Path B invoice then associated credit note.
- Trusted approval token required for the adjustment.
- Wrong adjustment subject and wrong original association rejected.
- Duplicate proof rejected/idempotent at the callback boundary.
- No raw taxpayer identifier, Clave Fiscal, or proof payload in the packet/event.

## Done criteria

- [ ] `bun run check` exits 0.
- [ ] The manifest and invocation parser expose the same Reclaim purposes/fields.
- [ ] At least one HTTP-level document-21 journey reaches verified authority.
- [ ] Tests prove finance remains frozen after a correction.
- [ ] Provider JSON and signer YAML parse successfully.
- [ ] No file outside Scope changed, except `plans/README.md` status.

## STOP conditions

- Any baseline source file is absent from the executor worktree.
- Passing tests requires disabling proof content validation or signature checks.
- The adjustment can only be approved by exposing a trusted token to the agent.
- Provider output cannot distinguish invoice type 19 from notes 20/21.

## Maintenance notes

The tool manifest is a public agent contract; every parser change needs a parity
test. Reviewers should inspect negative binding tests more closely than the happy
path. Real provider acceptance belongs to Plan 005.
