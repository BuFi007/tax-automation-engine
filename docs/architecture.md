# Architecture and data flow

```mermaid
flowchart LR
  A["Workspace sources\nBanks · Stripe · Wallets · FX"] --> E["Consent-scoped evidence adapters"]
  B["Accounting\nQuickBooks · Xero · Conta Azul · Contabilium"] --> E
  C["BUFI intelligence\nMagic Inbox · Enrichment · Knowledge Graph · Analytics"] --> E
  E --> G["Canonical Financial Evidence Graph"]
  G --> K["Deterministic Tax Core"]
  P["Confirmed entity and jurisdiction profile"] --> K
  J["Versioned AR / US jurisdiction pack"] --> K
  K --> W["Manual Tax Widget and cockpit"]
  W --> R["Accountant review"]
  R --> U["Explicit user-approved submission"]
  U --> V["Verified authority receipt"]
  V --> S["Accepted and satisfied"]
```

The UI receives a `TaxWidgetSnapshotV1`, never raw evidence. Each conclusion carries source references, freshness, confidence, consent scope hash, evidence hash, accountant review state, rule versions, and limitations.

The system models these lifecycle dimensions independently:

1. preparation state;
2. accountant review state;
3. submission state;
4. authority receipt/acceptance state;
5. obligation satisfaction state.

An accepted authority receipt is required before an obligation can be marked satisfied.
