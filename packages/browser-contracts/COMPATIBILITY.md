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

Package `0.5.1` adds the bounded `./arca-onboarding` package entrypoint. It is a
type-graph and packaging improvement only: every 0.5.0 ARCA onboarding wire
discriminator and projection remains byte-compatible.

Package `0.6.0` adds the consented Tax evidence-quality discriminated union and
retains the 0.5.x supplemental quality schema as a read-only compatibility
branch. Consumers upgrade first; Tax emits only the new `ready` or named
numeric-free states after Desk and Open Agents accept the package. The signal
is explicitly separate from Payment Score and Factura E factoring.

Package `0.7.0` adds optional closed obligation kinds and opaque rule-version
references for jurisdiction specialist consumers. Free-form catalogue titles
remain presentation-only and must not enter model context. Consumers accept
the optional fields before the Tax producer emits them; missing fields mean
that specialist conclusions are unavailable, never that an obligation is not
applicable.

Package `0.8.0` adds an optional, closed `authorityReadiness` summary to the
Tax snapshot. The first supported kind is Argentina Factura E onboarding. It
contains only bounded step/service states, timestamps, limitation codes, and a
safe action reference. It deliberately excludes onboarding IDs, taxpayer IDs,
point-of-sale numbers, provider/session references, proof material, and raw
authority evidence. Consumers must accept the optional field before Tax begins
emitting it; absence means authority readiness was not projected.
