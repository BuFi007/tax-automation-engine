# Plan 004: Close Reclaim session lifecycle and proof-custody boundaries

> **Executor instructions**: Implement lifecycle and custody fail-closed. Do not
> weaken cryptographic verification, content validation, context binding, or TEE
> policy. Update the plan index when complete.
>
> **Drift check (run first)**:
> `git diff --stat cb23cad..HEAD -- apps/api/src/reclaim.ts apps/api/src/factura-e-agent.ts apps/api/src/store.ts apps/api/src/agent-routes.ts packages/core/src/factura-e-agent.ts`
> Stop if Plan 001 is not green.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED — public proof callback and sensitive evidence custody
- **Depends on**: Plan 001
- **Category**: security, correctness, tests, architecture
- **Planned at**: commit `cb23cad`, 2026-07-11; source baseline was dirty

## Why this matters

Sessions have a ten-minute expiry and an `expired` state, but an expired callback
currently throws before recording a revision, leaving the case pending forever.
There is no cancel/abandon transition. Verified proofs are reduced to claims and
hashes, which is good, but the external encrypted proof-vault/attestation boundary
is not an explicit interface and therefore cannot be acceptance-tested.

## Current state

- `apps/api/src/reclaim.ts:50-88` creates ten-minute sessions bound to run,
  workspace, purpose, subject ID/hash, provider ID/version, and context hash.
- `apps/api/src/reclaim.ts:99-132` verifies expiry, signatures/content,
  optional TEE, context, and session before normalizing claims.
- `packages/core/src/factura-e-agent.ts:71-82` includes `failed` and `expired`
  states, but no transition function records them.
- `apps/api/src/factura-e-agent.ts:341-353` persists only successful callbacks.
- `apps/api/src/store.ts:280-299` stores Reclaim request URL/config/status URL;
  verified raw proof payloads are not stored.
- Public callback payload size is capped in
  `apps/api/src/agent-routes.ts:170-181`. Preserve the cap.

## Commands

| Purpose | Command | Expected |
|---|---|---|
| API/core tests | `bun test apps/api/src/agent-routes.test.ts packages/core/src/factura-e-agent.test.ts` | all pass |
| Typecheck | `bun run typecheck` | exit 0 |
| Sensitive-data scan | `rg -n "proofPayload|clave.?fiscal|session_cookie|raw_cuit" apps/api packages/core` | only reviewed boundary/forbidden-list references |
| Full gate | `bun run check` | exit 0 |

## Scope

**In scope**:

- `packages/core/src/factura-e-agent.ts`
- `packages/core/src/factura-e-agent.test.ts`
- `apps/api/src/reclaim.ts`
- `apps/api/src/factura-e-agent.ts`
- `apps/api/src/store.ts`
- `apps/api/src/agent-routes.ts`
- `apps/api/src/agent-routes.test.ts`
- `.env.example`
- `docs/agent-backend.md`
- `providers/reclaim/README.md`

**Out of scope**:

- Building a generic secret manager
- Persisting raw proofs in SQLite or logs
- Publishing real providers or adding credentials
- Allowing the agent to approve/cancel as the user
- Disabling Reclaim content validation or signature verification

## Git workflow

- Branch: `codex/004-reclaim-lifecycle-custody`
- Conventional commit example: `feat(reclaim): expire proof sessions audibly`.
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Add deterministic failed/expired/cancelled transitions

Decide whether cancellation is a new state or a safely distinct failed reason.
Add core transitions that update only the target pending session, restore
readiness from `proof_pending` when appropriate, emit append-only safe events,
and produce a retry next action. Store only reason codes, never raw callback
content.

**Verify**: core tests cover expiry at the exact deadline, after deadline,
cancel, wrong session, already-verified session, and idempotent repeated signals.

### Step 2: Persist lifecycle outcomes at the service boundary

When verification reports expiry or a reviewed terminal provider failure, record
the lifecycle transition before returning the safe HTTP status. Add a trusted UI
cancel endpoint or verified provider callback mapping; do not expose cancellation
as an automatic agent authority unless it only abandons the agent's own pending
request and cannot impersonate the user.

**Verify**: callback/route tests assert HTTP 410 for expiry plus a persisted
`expired` session and retryable next action.

### Step 3: Introduce a narrow proof-vault receipt interface

Define an adapter that can receive the already-verified proof artifact at the
custody boundary and return only an opaque reference, artifact hash, encryption
metadata version, and retention policy ID. Persist that receipt with the claim
hash. The default unconfigured adapter must fail closed if durable proof custody
is required by the selected workflow; it must never silently store raw payloads
locally.

Clarify whether custody happens before or after normalization. Prefer passing the
minimum verified artifact necessary for later audit and make the raw object
eligible for immediate garbage collection.

**Verify**: fake-vault tests prove the database/event JSON contains only opaque
reference/hash/metadata and not raw proof fields.

### Step 4: Make attestation policy observable

Record whether TEE was required and verified as safe boolean/version metadata,
not the attestation secret. Surface provider/version, proof hash, custody receipt,
context binding, and TEE result in an accountant/audit packet. Do not call the
packet a legal opinion, TaxScore, or financing eligibility decision.

**Verify**: tests cover TEE required+missing, required+verified, and optional;
only the verified case progresses when required.

### Step 5: Add lifecycle operations to docs and health

Document expiry/retry/cancel UX, custody configuration, retention ownership, and
safe failure modes. Health should distinguish proof generation, proof custody,
and WSFEX availability without claiming filing enabled when any required boundary
is absent.

**Verify**: `bun run check` → exit 0.

## Test plan

- Exact session expiry and persisted terminal state.
- Cancellation/abandonment and safe retry.
- Replay after verified/expired/cancelled session.
- Proof payload size cap remains enforced.
- Raw proof absent from SQLite revisions, events, request artifacts, and logs.
- Opaque vault receipt and TEE policy metadata present in audit projection.

## Done criteria

- [ ] No session can remain `pending` indefinitely after a terminal callback.
- [ ] Expiry/cancel/failure is append-only and retryable.
- [ ] Durable proof custody stores only an opaque receipt in Motora.
- [ ] TEE policy is enforced and observable without secret disclosure.
- [ ] Health/docs describe configuration honestly.
- [ ] `bun run check` exits 0.

## STOP conditions

- The chosen vault requires raw credentials or authority sessions in Motora.
- A provider terminal status cannot be authenticated or safely distinguished
  from an attacker-controlled callback.
- Lifecycle persistence would overwrite earlier revisions/events.
- A compliance retention duration is unknown; expose a policy ID/configuration
  requirement and request owner/legal input instead of guessing.

## Maintenance notes

Provider output and custody receipts are evidence, not authorization. Review all
logs and exception paths when callback shapes change; raw proof retention should
remain outside the Motora database.
