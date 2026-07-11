# Agent backend for Argentina Factura E

This backend lets a tax agent orchestrate the Factura E journey without giving the model Clave Fiscal, private keys, raw CUIT/TIN values, user-approval credentials, or accountant credentials.

## Honest “one click” contract

One click means one explicit user approval of one frozen intent. The agent may gather evidence, draft, validate, prepare issuance, monitor proof sessions, recover an ambiguous WSFEX outcome, reconcile settlements, and prepare the accounting packet. It cannot approve its own intent or assert that ARCA authorized an invoice.

The three authorities remain separate:

| Layer | Role | Cannot do |
|---|---|---|
| Tax agent | Orchestrates the case and deterministic next actions | Self-approve, invent CAE, infer FX compliance from a token transfer |
| Reclaim | Proves a specific ARCA fact from a user-controlled HTTPS session | Authorize an invoice |
| ARCA/WSFEX | Authorizes or rejects the tax document | Prove customer payment or BCRA ingress |

## Runtime states

Each case stores these dimensions independently:

- ARCA taxpayer readiness proof
- canonical intent and intent hash
- user/accountant approval
- issuance path and authority result
- settlement finality
- FX-ingress evidence
- tax declaration evidence
- financing eligibility
- immutable associated debit/credit notes and their corrected net balance

`financeEligibility` remains `frozen` until the invoice is ARCA-authorized, settlement is final, and FX ingress is separately verified. A reversed or disputed settlement freezes it again.
An open adjustment also freezes financing. An authorized credit note is recorded as dilution and stays frozen for financing review. If a correction is authorized after tax evidence was declared, the state becomes `amendment_required`; it never remains silently clean.

## Agent tools

Fetch `GET /v1/agent/tools` to receive OpenAI-compatible function definitions and execution-policy metadata.

| Tool | Effect | Gate |
|---|---|---|
| `tax_ar_homologation_get_preflight` | Returns redacted missing/unsafe external acceptance gates | Read-only; never exposes values or enables production |
| `tax_ar_factura_e_create_case` | Creates an append-only case | Agent API key |
| `tax_ar_factura_e_get_case` | Reads current state and next actions | Read-only |
| `tax_ar_factura_e_list_cases` | Lists current workspace cases | Read-only |
| `tax_ar_factura_e_draft_intent` | Validates and hashes a safe Factura E intent | Cannot modify after approval |
| `tax_ar_factura_e_propose_from_evidence` | Builds a draft from one accepted workspace economic event | Deduplicates matching connector records; conflicts block |
| `tax_ar_factura_e_get_copilot_packet` | Returns the approved Path B ARCA field packet and next Reclaim step | Read-only after user approval |
| `tax_ar_factura_e_get_accounting_attestation_packet` | Returns authority-backed accounting, settlement, custody, and underwriting evidence | Read-only after verified CAE; never writes or makes a credit decision |
| `tax_ar_reclaim_start` | Creates a Reclaim session for readiness or CAE | User authenticates directly with ARCA |
| `tax_ar_factura_e_request_approval` | Moves a validated intent to approval pending | Does not approve |
| `tax_ar_factura_e_submit_wsfex` | Sends the approved Path A reference to the signer boundary | Prior human approval and configured signer |
| `tax_ar_factura_e_recover_wsfex` | Recovers an ambiguous result | Same request ID and payload reference required |
| `tax_ar_factura_e_prepare_adjustment` | Freezes an associated export note 20/21 and its effective rule versions | Original Factura E must be authorized |
| `tax_ar_factura_e_get_adjustment_copilot_packet` | Returns safe Path B fields and the exact original association | Read-only after adjustment approval |
| `tax_ar_factura_e_submit_adjustment_wsfex` | Sends one approved note to the isolated signer | User and delegated-path accountant approval |
| `tax_ar_factura_e_recover_adjustment_wsfex` | Recovers an ambiguous note result | Same adjustment, request ID, and payload reference |
| `tax_ar_factura_e_record_settlement` | Adds immutable settlement evidence | Does not verify FX/tax state |

All mutations require an idempotency key. The database stores every case revision and event; the same key returns the prior result rather than running the action twice.

The capability response also carries the existing 22-read financial manifest. `propose_from_evidence` reads only accepted records already normalized by the workspace bridge (banks, wallets, QuickBooks/Xero/Conta Azul/Contabilium, Magic Inbox, transaction enrichment, knowledge graph, and financial analytics). Records that represent the same economic event are compared, not summed. Conflicting currency, amount, or counterparty claims block the draft.

### Invocation envelope

```json
{
  "actorId": "agent:tax",
  "idempotencyKey": "workspace-42:create-factura-e:1",
  "input": {
    "runId": "8ae06d3d-1d58-4474-9f2e-cf93857e242e",
    "workspaceId": "workspace-42",
    "issuancePath": "reclaim_copilot"
  }
}
```

Send it to:

```text
POST /v1/agent/tools/tax_ar_factura_e_create_case/invoke
Authorization: Bearer <TAX_ENGINE_API_KEY>
```

## Trusted transitions outside the agent

These routes intentionally are not agent tools:

```text
POST /v1/agent/runs/:runId/user-approval
X-Tax-User-Approval-Token: <workspace trusted-channel token>

POST /v1/agent/runs/:runId/accountant-approval
X-Tax-Accountant-Approval-Token: <accountant trusted-channel token>

POST /v1/agent/runs/:runId/adjustments/:adjustmentId/user-approval
X-Tax-User-Approval-Token: <workspace trusted-channel token>

POST /v1/agent/runs/:runId/adjustments/:adjustmentId/accountant-approval
X-Tax-Accountant-Approval-Token: <accountant trusted-channel token>

POST /v1/agent/runs/:runId/reclaim-sessions/:sessionId/cancel
X-Tax-User-Approval-Token: <workspace trusted-channel token>

POST /v1/agent/runs/:runId/fx-ingress-verification
X-Tax-Accountant-Approval-Token: <accountant trusted-channel token>

POST /v1/agent/runs/:runId/tax-declaration
X-Tax-Accountant-Approval-Token: <accountant trusted-channel token>
```

Path B currently needs the explicit user approval only. Path A is created with `accountantReviewRequired=true`; its accountant endpoint is accepted only after the same intent hash has already received user approval.

The current static server-side tokens are an integration boundary for the existing workspace authentication service. Production must inject them separately from the agent API key. A future workspace identity integration should replace them with short-lived, audience-bound signed assertions.

## Reclaim Path B

The production adapter uses `@reclaimprotocol/js-sdk` 5.8.0.

1. The backend initializes `ReclaimProofRequest` with server-only application credentials.
2. It chooses one reviewed provider ID for taxpayer readiness or CAE constatement.
3. It binds `runId`, `workspaceId`, purpose, and an exact subject ID/hash into the proof context. The subject is null for readiness, the frozen invoice for document 19, or the frozen adjustment for 20/21.
4. It returns a safe request config/URL to the trusted UI.
5. The user signs into ARCA directly. Motora never receives the PIN.
6. Reclaim posts the proof with `X-Reclaim-Session-Id` to `/v1/reclaim/callback`.
7. The backend verifies witness signatures and provider content, checks the exact provider version, session, context, expiry, and replay state, then normalizes only reviewed claims.
8. A readiness proof can unlock approval. An invoice proof must match document type 19, point of sale, currency, and exact total. An adjustment proof must additionally match type 20/21 and the original Factura E association.
9. Expired sessions are persisted as append-only terminal events and can be retried. A user can cancel a pending session through the trusted channel; the agent cannot impersonate that cancellation.
10. When proof custody is configured, the verified raw artifact goes directly to an external encrypted vault. Motora persists only normalized claims, proof hash, TEE policy/result, and an opaque hash-bound custody receipt.

Reclaim recommends server-side request generation so the app secret stays off the client and recommends treating sessions without a proof/cancel callback after ten minutes as abandoned. See the [Reclaim backend integration](https://docs.reclaimprotocol.org/browser-extension/web-integration/setup) and [troubleshooting guidance](https://docs.reclaimprotocol.org/troubleshooting).

Two custom providers must expose these normalized extracted parameters:

### Taxpayer readiness provider

```text
taxRegime = monotributo | responsable_inscripto
taxCategory = safe category label (optional)
exportActivityEnabled = true
exportPointOfSaleActive = true
exportPointOfSale = positive integer
```

### CAE constatement provider

```text
documentType = 19 | 20 | 21
pointOfSale = positive integer
invoiceNumber = positive integer
cae = 10–20 digits
issuedAt = YYYY-MM-DD
total = exact decimal string
currency = ARCA currency code
associatedDocumentType = empty for 19; 19 for 20/21
associatedPointOfSale = empty for 19; original export point of sale for 20/21
associatedInvoiceNumber = empty for 19; original invoice number for 20/21
```

Provider definitions are external Reclaim assets and must be reviewed against the current ARCA pages before their IDs are enabled. AI-provider patches are rejected by this backend. Optional Reclaim TEE attestation enforcement can be enabled with `RECLAIM_REQUIRE_TEE=true` only for providers configured to produce it.

The repository includes the deployable output contract and acceptance runbook under [`providers/reclaim`](../providers/reclaim/README.md).

## Delegated WSFEX Path A

The API never stores a private key or raw WSFEX authentication fields. It calls an isolated signer/provider service for invoices 19 and associated notes 20/21 with:

- workspace and case IDs
- immutable request ID
- frozen intent hash
- a vault reference to the authority payload
- safe expected fields: document type, operation type 2, point of sale, issue date, and total; notes also include the exact original type-19 association

The isolated signer resolves the authority payload, obtains an ephemeral `wsfex` access ticket from a separate WSAA/certificate broker, performs the official SOAP calls, validates the CAE echo, and normalizes a safe response. Private keys and certificates never enter Motora or the signer process.

After the frozen intent has independent user and accountant approval, the
trusted `POST /v1/agent/runs/:runId/wsfex-payload` channel reconstructs the
authority payload from that canonical document, sends it directly to the
encrypted authority boundary, and immediately submits only the returned opaque
reference to the signer. The adjustment endpoint does the same for notes 20/21.
The signer recomputes the canonical intent/adjustment hash and maps every
approved line, amount, date, quote, and association before calling ARCA; it does
not trust an `intentHash` field supplied by the vault.

An accepted signer response must echo an `authorizedDocument` containing the frozen invoice/adjustment hash, document/operation types, point of sale, issue date, currency, and exact total. Notes must echo their original Factura E association. Motora rejects the CAE if any field differs.

The signer contract is specified in [`providers/wsfex/openapi.yaml`](../providers/wsfex/openapi.yaml), with operational invariants in [`providers/wsfex/README.md`](../providers/wsfex/README.md) and a deployable implementation in [`apps/wsfex-signer`](../apps/wsfex-signer/README.md).

On network timeout or a 5xx response, the API records `ambiguous` and does not guess a retry. Recovery is allowed only with the same request ID and authority-payload reference. The signer must implement exact WSFEX replay plus `FEXGetCMP`, `FEXGetLast_CMP`, and `FEXGetLast_ID` reconciliation.

## Required environment

```text
TAX_ENGINE_API_KEY
TAX_ENGINE_USER_APPROVAL_TOKEN
TAX_ENGINE_ACCOUNTANT_APPROVAL_TOKEN
TAX_ENGINE_EVIDENCE_INGEST_TOKEN
TAX_ENGINE_AUTHORITY_PAYLOAD_TOKEN

RECLAIM_APP_ID
RECLAIM_APP_SECRET
RECLAIM_CALLBACK_BASE_URL
RECLAIM_ARCA_TAXPAYER_PROVIDER_ID
RECLAIM_ARCA_CAE_PROVIDER_ID
RECLAIM_REQUIRE_TEE=false
RECLAIM_PROOF_CUSTODY_REQUIRED=false
RECLAIM_PROOF_VAULT_URL
RECLAIM_PROOF_VAULT_TOKEN
RECLAIM_PROOF_RETENTION_POLICY_ID

ARCA_SIGNER_URL
ARCA_SIGNER_TOKEN
ARCA_BOUNDARY_URL
ARCA_BOUNDARY_PAYLOAD_WRITE_TOKEN
ARCA_ENVIRONMENT=homologacion | production
```

Missing Reclaim or signer configuration is reported as `configuration_required`; the backend fails closed.

The deployable [`apps/reclaim-proof-vault`](../apps/reclaim-proof-vault/README.md) service implements this custody boundary. It independently verifies the callback artifact hash, stores the raw proof under a per-artifact wrapped key, enforces a versioned purpose/retention policy, and supports scoped human review plus cryptographic erasure. Motora receives only the opaque receipt. Run `bun run homologation:probe-proof-vault` to verify HTTPS health and an active policy without disclosing custody contents.

The shared workspace harness appends normalized connector evidence through `POST /v1/evidence/append` using `X-Tax-Evidence-Ingest-Token`. This credential is also excluded from the agent runtime, so an agent cannot manufacture its own “accepted” transaction history.

## Completion boundary

The code implements the agent orchestration, proof verification adapter, human gates, immutable audit trail, and signer contract. Live ARCA behavior still requires:

1. reviewed Reclaim provider definitions and credentials;
2. an authorized WSFEX homologation certificate, delegated test identity, and active FEEWS point of sale provisioned into the implemented encrypted authority boundary;
3. an approved encrypted proof-vault retention policy when durable proof custody is required;
4. workspace identity replacing the bootstrap trusted-channel tokens;
5. authorized end-to-end homologation and production smoke tests.

Until those external assets are configured and verified, the health endpoint reports the corresponding provider as `configuration_required`, and no production-compliance claim is made.

Run `bun run homologation:preflight`, `bun run homologation:probe-proof-vault`, `bun run homologation:probe-signer`, and `bun run homologation:validate -- <redacted-evidence.json>` to execute the external acceptance gate. The command contract and safe evidence requirements are documented under [`providers/homologation`](../providers/homologation/README.md).
