# External accountant decision boundary

An accountant decision is made outside the Tax Agent. Tax Engine only accepts
the resulting machine event after it verifies the exact accountant workspace,
actor, request body, mandate, consent, and event ordering.

```mermaid
sequenceDiagram
  participant A as Authorized accountant workspace
  participant T as Tax Engine ingress
  participant D as Canonical Tax store
  participant O as TaxDomainEventV1 outbox
  participant E as Open Agents / Eve inbox
  A->>T: POST /v1/accountant-decisions + bound principal
  T->>T: Verify signature, actor, workspace, path, body, expiry
  T->>D: Verify active scoped mandate + processing consent
  D->>D: Append minimized decision (transaction)
  D->>O: Append accountant.decision_recorded (same transaction)
  O->>E: Signed delivery; inbox persists before wake-up
  E-->>A: Explain recorded/rejected/blocked state only
```

## Contract

`ExternalAccountantDecisionV1` contains only:

- opaque workspace, case, mandate, subject, actor and idempotency references;
- one closed subject kind and outcome;
- closed reason codes;
- evidence commitments and rule/policy version references;
- the external decision timestamp.

It rejects free text, extra fields, tax identifiers, money, raw returns and raw
provider evidence. Rejected and `needs_information` decisions emit `rejected`
and `blocked` event states respectively; only an explicit approved decision
emits `recorded`, which still does not mean filed, accepted, paid or satisfied.

## Authentication and deployment

The ingress is dark unless `TAX_ENGINE_ACCOUNTANT_DECISION_INGRESS_ENABLED=true`.
When enabled, the accountant backend signs `tax-tenant-principal-v3` with the dedicated
`TAX_ENGINE_ACCOUNTANT_DECISION_PRINCIPAL_HMAC_SECRET`. The assertion expires
within five minutes and binds its actor, workspace, `accountant:decision`
capability, method, path and SHA-256 body hash. This secret is distinct from
user, Motora, snapshot, evidence, consent, Open Agents, browser-reference and
event-delivery secrets and never enters a browser or model runtime.

Tax Engine reads the body once, verifies the principal against those exact
bytes, and stores only a hash of the verified authentication proof. The
decision and its privacy-minimized outbox event commit atomically. Exact
redelivery returns the original receipt; conflicting, stale, cross-tenant,
expired, revoked or differently scoped delivery fails without mutation.

This is the supported external-accountant integration path for U.S. review.
It is not an IRS e-file integration and does not claim filing-provider or IRS
acceptance.
