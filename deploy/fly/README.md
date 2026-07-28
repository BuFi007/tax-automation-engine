# ARCA homologation stack on Fly.io

This topology deploys the Tax API, encrypted ARCA authority boundary, encrypted
Reclaim proof vault, and isolated WSFEX/WSFE signers as five independently
authenticated HTTPS services in São Paulo (`gru`). It is a homologation-only
starting point: every authority/remote-effect/production approval remains
disabled.

Fly app names are deliberately absent from the TOML files. Choose them at
provisioning time and pass `--app`; do not commit account or tenant identifiers.
The stack exposes each service through Fly's managed TLS because every Tax client
fails closed on a non-HTTPS URL. Bearer credentials remain mandatory even behind
TLS.

## Before provisioning

The owner must explicitly approve Fly.io and São Paulo as the host/data region.
Run `fly auth login` only as a user handoff because it creates persistent account
access on the workstation. Never enter a CUIT, Clave Fiscal, point-of-sale value,
certificate, private key, browser cookie, or proof body in a Fly app name, TOML
file, command history, or Desk variable.

Choose five globally unique app names and one existing Fly organization:

```bash
export TAX_FLY_ORG="approved-org"
export TAX_API_APP="approved-tax-api-app"
export ARCA_BOUNDARY_APP="approved-arca-boundary-app"
export RECLAIM_VAULT_APP="approved-reclaim-vault-app"
export WSFEX_SIGNER_APP="approved-wsfex-signer-app"
export WSFE_SIGNER_APP="approved-wsfe-signer-app"
```

## Create apps and durable volumes

```bash
fly apps create "$TAX_API_APP" --org "$TAX_FLY_ORG"
fly apps create "$ARCA_BOUNDARY_APP" --org "$TAX_FLY_ORG"
fly apps create "$RECLAIM_VAULT_APP" --org "$TAX_FLY_ORG"
fly apps create "$WSFEX_SIGNER_APP" --org "$TAX_FLY_ORG"
fly apps create "$WSFE_SIGNER_APP" --org "$TAX_FLY_ORG"

fly volumes create tax_engine_data --app "$TAX_API_APP" --region gru --size 1
fly volumes create arca_boundary_data --app "$ARCA_BOUNDARY_APP" --region gru --size 1
fly volumes create reclaim_proof_vault_data --app "$RECLAIM_VAULT_APP" --region gru --size 1
fly volumes create wsfex_signer_data --app "$WSFEX_SIGNER_APP" --region gru --size 1
fly volumes create wsfe_signer_data --app "$WSFE_SIGNER_APP" --region gru --size 1
```

Do not add replicas while these services use local SQLite. A Fly volume attaches
to one Machine and does not make SQLite multi-writer safe.

## Configure secrets

Generate every value independently with a cryptographically secure generator.
The boundary and vault processes expect each mounted key file to contain the
base64 text representation of exactly 32 random bytes. Fly decodes a
`[[files]].secret_name` value once before writing the file, so these file-backed
secrets require two representation layers:

1. generate 32 random bytes and base64-encode them for the service; then
2. base64-encode that resulting text when storing it as the Fly secret.

After Fly's one decode, the mounted file contains the first-layer base64 text
that the service expects. Do not double-encode ordinary bearer/HMAC variables;
those are injected directly as environment strings rather than mounted files.
All bearer and HMAC credentials must be at least 32 random bytes and must not be
reused. Use `fly secrets import --app APP` from a temporary, access-controlled
input stream so values do not enter shell history.

The boundary app needs:

- `ARCA_BOUNDARY_MASTER_KEY`
- `ARCA_BOUNDARY_CUIT_COMMITMENT_KEY`
- `ARCA_BOUNDARY_PAYLOAD_WRITE_TOKEN`
- `ARCA_BOUNDARY_PAYLOAD_RESOLVE_TOKEN`
- `ARCA_BOUNDARY_WSAA_TOKEN`
- `ARCA_BOUNDARY_ADMIN_TOKEN`

The proof-vault app needs:

- `RECLAIM_PROOF_VAULT_MASTER_KEY`
- `RECLAIM_PROOF_VAULT_TOKEN`
- `RECLAIM_PROOF_VAULT_REVIEW_TOKEN`
- `RECLAIM_PROOF_VAULT_ADMIN_TOKEN`

The WSFEX signer needs:

- `WSFEX_SIGNER_API_TOKEN`
- `WSFEX_SIGNER_VAULT_URL`
- `WSFEX_SIGNER_VAULT_TOKEN`
- `WSFEX_WSAA_BROKER_URL`
- `WSFEX_WSAA_BROKER_TOKEN`
- `WSFEX_CTZ_WORKSPACE_ID`
- `WSFEX_CTZ_ISSUER_PROFILE_REF`

Both signer URLs above point to the boundary app's public HTTPS origin. The
resolve and WSAA tokens must be different. The WSFE signer has the equivalent
`WSFE_SIGNER_*` and `WSFE_WSAA_BROKER_*` variables and independently scoped
tokens.

The Tax API needs the complete server-only list in `.env.example`. In particular:

- all approval, evidence, consent, projector, payload, and API bearer channels;
- all tenant/principal/browser-reference HMAC credentials, each distinct;
- Reclaim app credentials, reviewed provider IDs, HTTPS callback origin, vault
  writer URL/token, and retention-policy ID;
- the two signer HTTPS URLs/tokens and boundary HTTPS URL/writer token; and
- approved homologation workspace/issuer references and explicit homologation
  attestations.

Do not configure the proof-vault reviewer/admin credentials, boundary
resolve/WSAA/admin credentials, or delegated certificate/key in the Tax API.

## Deploy in dependency order

```bash
fly deploy --app "$ARCA_BOUNDARY_APP" --config deploy/fly/arca-boundary.toml
fly deploy --app "$RECLAIM_VAULT_APP" --config deploy/fly/reclaim-proof-vault.toml
fly deploy --app "$WSFEX_SIGNER_APP" --config deploy/fly/wsfex-signer.toml
fly deploy --app "$WSFE_SIGNER_APP" --config deploy/fly/wsfe-signer.toml
fly deploy --app "$TAX_API_APP" --config deploy/fly/tax-api.toml
```

Provision the proof-retention policy through its restricted admin channel.
Provision delegated test certificates only through the boundary's restricted
admin endpoint, never through Desk or the Tax API. Then run:

```bash
bun run homologation:preflight
bun run homologation:probe-signer
bun run homologation:probe-wsfe-signer
bun run homologation:probe-proof-vault
bun --filter @tax-engine/api homologation:probe-points-of-sale
```

Only redacted booleans, counts, versions, and hashes belong in homologation
evidence. Successful homologation still does not authorize production.
