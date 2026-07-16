# `@tax-engine/browser-contracts`

Browser-safe, runtime-validated Tax V1 contracts shared by Tax, Desk, and Open Agents.

Import schemas and inferred types from `@tax-engine/browser-contracts`. Import deterministic fixture values from `@tax-engine/browser-contracts/fixtures`. Consumers must not redefine these shapes or import the Node-backed `@tax-engine/core` snapshot as their browser contract.

Golden fixtures expose `TAX_BROWSER_GOLDEN_FIXTURES_V1_SHA256`, the pinned SHA-256 of their JSON serialization. Cross-repository contract tests should assert that digest before accepting a package upgrade.

This package contains no provider clients, raw evidence, graph records, authority identifiers, credentials, storage paths, or Node runtime dependencies. Money and scores stay serialized as exact decimal strings.

Command replay receipts preserve the original `previousCaseRevision -> caseRevision` edge; `replayed` describes delivery, never a second mutation. Current snapshot receipts enforce `asOf <= generatedAt <= checkedAt < expiresAt` when an expiry is present. Source health is derived from schema-validated source aggregates and their capability states, so failed or stale capabilities cannot be hidden behind a healthy aggregate.

Package `0.2.0` adds optional, fail-closed workflow presentation fields for filing readiness, evidence tasks, accountant packets, planning-only forecasts, and supplemental Tax evidence quality. Their absence means the producer has not projected that capability; it is never permission for a browser consumer to calculate or infer the missing value.

Package `0.3.0` freezes the cross-repository acceptance catalogue at `@tax-engine/browser-contracts/scenarios`. It covers AR Monotributo/RI, US domestic and foreign-owned LLC/C-Corp, provider health, accountant changes, ARCA rejection/ambiguity/reconciliation, every Factura E factoring presentation state, cross-tenant denial, optimistic concurrency, idempotency conflict, and ambiguous authority effects. It also adds a stable command-problem envelope. Fixtures authorize no command; server-projected action IDs and human gates remain authoritative.

Package `0.4.0` adds the durable `FacturaEFactoringProjectionReceiptV1` and its fail-closed read-result envelope. The factoring projection remains separate from the Tax snapshot and carries only browser-safe references, capped score disclosure, and authorized action descriptors.

See [COMPATIBILITY.md](./COMPATIBILITY.md) for versioning and rollout rules.
