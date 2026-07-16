# Tax browser contract compatibility

The package version and every wire `version` discriminator are independent controls. Producers and consumers pin the package version; stored responses retain their wire discriminator.

The browser receipt uses `tax-browser-snapshot-receipt-v1` intentionally. The Tax core already stores an internal, Node-backed `tax-widget-snapshot-receipt-v1` with a different shape; reusing that discriminator at the browser boundary would be a breaking collision.

## Compatible changes

- Documentation and fixture additions are patch changes.
- A new optional field, enum member, command descriptor, or problem code is a minor change. Because V1 schemas are strict, consumers must deploy the new package before a producer emits the addition.
- A new fixture must not change existing fixture bytes or meaning.

## Breaking changes

Removing or renaming a field, changing a field from optional to required, changing exact-decimal semantics, changing an existing enum member's meaning, widening browser data to restricted evidence, or changing cache/OCC/idempotency identity requires a new major package version and a new wire discriminator.

## Cross-repository rollout

1. Publish the browser-contract package and immutable fixture digest.
2. Upgrade Desk and Open Agents parsers while the producer still emits the old shape.
3. Upgrade Tax's browser adapter to emit the new shape.
4. Remove the old parser only after replay and rollback windows close.

Production must fail closed on an unknown wire version. Fixture/demo fallback is never permitted in production.

## Frozen acceptance catalogue

Package `0.3.0` adds the `./scenarios` entrypoint and command problem envelope.
Consumers must pin both `TAX_BROWSER_GOLDEN_FIXTURES_V1_SHA256` and
`TAX_BROWSER_SCENARIO_FIXTURES_V1_SHA256` during an upgrade. Scenario fixtures
are test inputs only: they are never a production fallback, and their action IDs
do not grant authority. The strengthened Factura E projection rejects partial
scores, contribution-cap drift, unverified scored states, and offer/state
mismatches that earlier prerelease packages could parse.

Package `0.4.0` adds the factoring projection receipt/read-result schemas. This
is an additive endpoint contract: existing Tax snapshot bytes and both frozen
fixture digests remain unchanged.

Package `0.5.0` adds the ARCA onboarding run, mutation, read, history, and
Reclaim-handoff browser contracts. The raw Tax onboarding aggregate and raw
Reclaim request configuration remain internal-only. Consumers must reject an
unknown onboarding wire discriminator rather than falling back to local state.
