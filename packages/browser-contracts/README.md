# `@tax-engine/browser-contracts`

Browser-safe, runtime-validated Tax V1 contracts shared by Tax, Desk, and Open Agents.

Import schemas and inferred types from `@tax-engine/browser-contracts`. Import deterministic fixture values from `@tax-engine/browser-contracts/fixtures`. Consumers must not redefine these shapes or import the Node-backed `@tax-engine/core` snapshot as their browser contract.

Golden fixtures expose `TAX_BROWSER_GOLDEN_FIXTURES_V1_SHA256`, the pinned SHA-256 of their JSON serialization. Cross-repository contract tests should assert that digest before accepting a package upgrade.

This package contains no provider clients, raw evidence, graph records, authority identifiers, credentials, storage paths, or Node runtime dependencies. Money and scores stay serialized as exact decimal strings.

Command replay receipts preserve the original `previousCaseRevision -> caseRevision` edge; `replayed` describes delivery, never a second mutation. Current snapshot receipts enforce `asOf <= generatedAt <= checkedAt < expiresAt` when an expiry is present. Source health is derived from schema-validated source aggregates and their capability states, so failed or stale capabilities cannot be hidden behind a healthy aggregate.

Package `0.2.0` adds optional, fail-closed workflow presentation fields for filing readiness, evidence tasks, accountant packets, planning-only forecasts, and supplemental Tax evidence quality. Their absence means the producer has not projected that capability; it is never permission for a browser consumer to calculate or infer the missing value.

Package `0.3.0` freezes the cross-repository acceptance catalogue at `@tax-engine/browser-contracts/scenarios`. It covers AR Monotributo/RI, US domestic and foreign-owned LLC/C-Corp, provider health, accountant changes, ARCA rejection/ambiguity/reconciliation, every Factura E factoring presentation state, cross-tenant denial, optimistic concurrency, idempotency conflict, and ambiguous authority effects. It also adds a stable command-problem envelope. Fixtures authorize no command; server-projected action IDs and human gates remain authoritative.

Package `0.4.0` adds the durable `FacturaEFactoringProjectionReceiptV1` and its fail-closed read-result envelope. The factoring projection remains separate from the Tax snapshot and carries only browser-safe references, capped score disclosure, and authorized action descriptors.

Package `0.5.0` adds the deterministic ARCA onboarding browser corridor. It projects only user-action state, safe event summaries, bounded next actions, and short-lived Reclaim capability URLs. Internal evidence hashes, represented-CUIT commitments, raw Reclaim configuration, command keys, and authority receipts are intentionally not part of the browser contract.

Package `0.5.1` also publishes the same contract at `@tax-engine/browser-contracts/arca-onboarding`. Consumers with bounded typecheck graphs should prefer that feature entrypoint; it does not change the 0.5.0 wire format.

Package `0.8.0` lets the main Tax snapshot carry an optional, privacy-minimized
ARCA authority-readiness summary. It is deliberately less identifying than the
interactive onboarding contract: it omits the onboarding run ID, point-of-sale
number, Reclaim provider/session references, and proof material so it can be
used by browser and specialist-agent consumers.

Package `0.10.0` adds `AccountantReviewQueueV1`, the only browser-safe source
for an external accountant decision. Tax emits it from the current durable
browser projection and exact active mandate. It contains opaque case/subject
references, one snapshot commitment, closed policy/rule references and closed
outcome/reason choices; it excludes money, taxpayer identifiers, raw returns,
evidence bodies, provider data and free text. Stale or missing client
projections remain unavailable and cannot be approved from aggregate portfolio
counts.

Package `0.11.0` separates the domestic WSFE point of sale from the WSFEX
export point in browser-safe ARCA onboarding runs. It is required even when
only one service has been requested.

Package `0.6.0` adds the consented, non-scoring Tax evidence-quality union. Only
`ready` carries the frozen 0–100 value, band, and five dimensions. Named
no-value states remain fail-closed, while the 0.5.x supplemental shape stays
parseable during the consumer-first rollout. New producers never emit the
legacy shape.

See [COMPATIBILITY.md](./COMPATIBILITY.md) for versioning and rollout rules.
