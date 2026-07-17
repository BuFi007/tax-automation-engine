# Backend V1 release gate (BU-252)

The backend release gate is executable evidence, not a status inferred from
individual merged issues. It pins the browser contract and fixture digests,
the five AR/US/accountant journeys, the complete fault matrix, and the exact
software suites that must pass. It refuses a dirty worktree so every report is
bound to the exact committed revision it names.

Run the software replay without claiming ARCA readiness:

```bash
bun run release:backend:software
```

Run the full backend certification:

```bash
bun run release:backend
```

The full command exits `2` while external authority evidence is incomplete.
Today the checked-in live smoke is correctly blocked because ARCA returned no
active FEEWS point of sale. Creating the point in the represented taxpayer's
portal and rerunning the isolated `FEXGetPARAM_PtoVenta` probe is required. The
gate then also requires the complete redacted `arca-homologation-evidence-v1`
matrix, including reviewed WSFEX 19/20/21, WSFE 11/12/13, ambiguous recovery,
Reclaim custody and independent human reviews. A fixture, portal screenshot,
signer health response, or Linear status cannot substitute for those results.

The report always keeps `productionEnabled: false`. Passing this gate makes the
backend eligible for the human-product gate; it does not approve production or
the later agentic greenlight.
