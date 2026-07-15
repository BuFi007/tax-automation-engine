# `@tax-engine/browser-contracts`

Browser-safe, runtime-validated Tax V1 contracts shared by Tax, Desk, and Open Agents.

Import schemas and inferred types from `@tax-engine/browser-contracts`. Import deterministic fixture values from `@tax-engine/browser-contracts/fixtures`. Consumers must not redefine these shapes or import the Node-backed `@tax-engine/core` snapshot as their browser contract.

Golden fixtures expose `TAX_BROWSER_GOLDEN_FIXTURES_V1_SHA256`, the pinned SHA-256 of their JSON serialization. Cross-repository contract tests should assert that digest before accepting a package upgrade.

This package contains no provider clients, raw evidence, graph records, authority identifiers, credentials, storage paths, or Node runtime dependencies. Money and scores stay serialized as exact decimal strings.

Command replay receipts preserve the original `previousCaseRevision -> caseRevision` edge; `replayed` describes delivery, never a second mutation. Current snapshot receipts enforce `asOf <= generatedAt <= checkedAt < expiresAt` when an expiry is present. Source health is derived from schema-validated source aggregates and their capability states, so failed or stale capabilities cannot be hidden behind a healthy aggregate.

See [COMPATIBILITY.md](./COMPATIBILITY.md) for versioning and rollout rules.
