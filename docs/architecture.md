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

## Factura E agent backend

```mermaid
flowchart LR
  A["Tax agent\nAPI-key scoped"] --> C["Factura E case\nappend-only revisions"]
  C --> D["Canonical safe intent\nexact decimals + rule versions"]
  D --> H["Trusted user approval\nseparate credential"]
  H --> B["Path B\nARCA copilot"]
  H --> W["Path A\nWSFEX signer boundary"]
  H --> P["Trusted payload channel\ncanonical hash rechecked"]
  P --> Q["Encrypted ARCA boundary\nraw payload + delegated key"]
  Q --> W
  W --> Q
  W --> ARA["ARCA WSFEX 3.1.1\n19 · 20 · 21"]
  B --> R["Reclaim CAE proof"]
  R --> Z["Encrypted proof vault\nhash verification · retention · crypto-erasure"]
  W --> V["Verified signer receipt"]
  R --> X["arca_authorized"]
  V --> X
  X --> E["Settlement evidence"]
  E --> F["Trusted FX/accountant verification"]
  F --> T["tax_declared"]
```

The agent never receives the user-approval or accountant-channel tokens. Reclaim requests are created server-side with the application secret, proofs are bound to the initiated session and case context, and accepted session IDs are persisted to prevent replay. WSFEX ambiguous recovery is pinned to the original request ID and hashed authority-payload reference.

For delegated WSFEX, the signing identity and taxpayer identity are separate:
the encrypted boundary validates the certificate against its holder CUIT, while
the ephemeral ticket returned to the signer is paired with the workspace's
represented CUIT for `Auth.Cuit`. In third-party production issuance, ARCA's
two-sided relationship flow (taxpayer delegation, provider acceptance, then
computer-certificate binding) must be complete before the tenant can be marked
active. A successful WSAA login alone does not prove representation; the signer
also checks the tenant's WSFEX point of sale through the business service.

Associated export notes 20/21 retain independent approval, authority, CAE, request-recovery, and original-document association inside the same immutable case. A derived exact-decimal ledger recomputes the authorized net balance without rewriting the invoice or settlement history. Raw verified Reclaim artifacts can cross only into the external encrypted proof-vault boundary; Motora stores normalized claims, attestation policy/results, and the opaque custody receipt.

The UI receives a stored `TaxWidgetSnapshotReceiptV1` containing its `TaxWidgetSnapshotV1`, never raw evidence. The receipt binds the named projection (defaulting to `default`) to the stored snapshot, input, and configuration hashes, evidence generation, generation/as-of/expiry timestamps, and current-read validity. Each conclusion carries source references, freshness, confidence, consent scope hash, evidence hash, accountant review state, rule versions, and limitations.

The system models these lifecycle dimensions independently:

1. preparation state;
2. accountant review state;
3. submission state;
4. authority receipt/acceptance state;
5. obligation satisfaction state.

An accepted authority receipt is required before an obligation can be marked satisfied.
