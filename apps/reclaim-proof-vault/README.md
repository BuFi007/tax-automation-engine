# Reclaim proof vault

This isolated service is the raw zkTLS evidence boundary for Motora's Reclaim copilot path. Motora sends a verified callback artifact once, then retains only normalized claims and a hash-bound opaque receipt. The tax agent has no read or administrative credential.

## Security contract

- Independently normalizes the callback artifact and recomputes the canonical proof hash before accepting it.
- Binds one immutable artifact to `workspaceId + sessionId + purpose`; conflicting replay fails closed.
- Encrypts each raw proof with a random data-encryption key (DEK), then wraps that DEK with an HKDF-derived AES-256-GCM key.
- Keeps writer, human-reviewer, and retention-administrator bearer tokens distinct.
- Enforces a versioned purpose allowlist and retention duration before custody.
- Implements deletion and expiry as cryptographic erasure by deleting the wrapped DEK.
- Keeps only hashed workspace, run, session binding, reference, and artifact identifiers in its audit trail.
- Supports offline, exclusive-transaction master-key rotation by rewrapping DEKs.

## Runtime

Required variables:

```text
RECLAIM_PROOF_VAULT_MASTER_KEY_FILE=/run/secrets/reclaim_proof_vault_master_key
RECLAIM_PROOF_VAULT_DB_PATH=/data/reclaim-proof-vault.sqlite
RECLAIM_PROOF_VAULT_TOKEN=<Motora writer token, at least 32 characters>
RECLAIM_PROOF_VAULT_REVIEW_TOKEN=<authorized reviewer token, at least 32 characters>
RECLAIM_PROOF_VAULT_ADMIN_TOKEN=<retention admin token, at least 32 characters>
RECLAIM_PROOF_VAULT_PRODUCTION_APPROVED=false
```

The key file is a base64-encoded 32-byte key mounted from a secret manager. Do not put it in environment manifests or source control. Put TLS and network identity in front of this process; Motora refuses non-HTTPS vault URLs.

Provision a policy through `POST /v1/retention-policies` with the admin token before accepting proofs. Health is authenticated at `GET /health` and reports only encryption readiness and the active policy count.

## Offline key rotation

Stop writers/readers and mount both old and new key files only into the rotation job:

```text
RECLAIM_PROOF_VAULT_DB_PATH=/data/reclaim-proof-vault.sqlite
RECLAIM_PROOF_VAULT_MASTER_KEY_FILE=/run/secrets/old_key
RECLAIM_PROOF_VAULT_NEW_MASTER_KEY_FILE=/run/secrets/new_key
```

Run `bun --filter @tax-engine/reclaim-proof-vault rotate-key --dry-run`, verify the count, then rerun without `--dry-run`. The operation validates every live proof and atomically rewraps its DEK; erased evidence stays erased.
