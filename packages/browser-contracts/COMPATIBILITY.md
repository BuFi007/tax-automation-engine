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
