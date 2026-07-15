# Encrypted ARCA authority boundary

This service is the high-trust companion to the WSFEX signer. It implements the
two HTTPS contracts the signer consumes without putting raw authority payloads,
delegated certificates, private keys, or WSAA credentials in Motora or agent
context.

It is not a Clave Fiscal login service and never accepts or stores a PIN, ARCA
cookie, CAPTCHA answer, or browser session.

## Scoped interfaces

Four distinct bearer credentials are mandatory:

| Scope | Endpoint | Caller |
|---|---|---|
| Payload write | `POST /v1/authority-payloads`, `/terminal`, and `/revoke` | Trusted Tax payload channel |
| Payload resolve | `POST /v1/authority-payloads/resolve` | WSFEX signer only |
| WSAA | `POST /v1/wsaa/tickets` and `GET /health` | WSFEX signer only |
| Boundary admin | `POST /v1/wsaa/issuers`, issuer `/revoke`, and payload `/retire-eligible` | Restricted operations console |

The service refuses to start if any two tokens are equal. Payload creation is
idempotent. The caller may request at most a seven-day minimum recovery horizon,
but this is not a deletion deadline: unresolved authority payloads remain
recoverable indefinitely. Only an exact `officially_reconciled` terminal command
starts the boundary-owned retention clock; only the admin endpoint may retire
eligible ciphertext. Certificate replacement requires the current certificate
fingerprint, and revocation immediately removes cached tickets.

## Storage and signing

- A 32-byte root encryption secret and a separate stable 32-byte
  represented-CUIT commitment key are loaded from mounted files (preferred) or
  base64 environment values.
- HKDF derives separate payload and issuer-credential keys.
- Every record uses AES-256-GCM with record-specific authenticated data and a
  random 96-bit nonce.
- SQLite stores only encrypted raw payload/key bundles plus safe hashes,
  fingerprints, expiry, state, and append-only audit events.
- The certificate/private-key pair, certificate validity, and subject CUIT are
  checked before provisioning and every WSAA login.
- The certificate-holder CUIT is modeled separately from the represented
  taxpayer CUIT. This permits one isolated BUFI computer certificate to obtain
  WSAA credentials while each WSFEX business call carries the tenant CUIT in
  `Auth.Cuit`; certificate material is never confused with tenant identity.
- Provisioning derives a keyed, domain-separated commitment from the represented
  CUIT. The raw CUIT is never logged or returned in a provisioning receipt. WSAA
  tickets carry the same commitment, and WSFEX refuses a payload/ticket mismatch.
  Ordinary encryption-key rotation deliberately leaves this commitment stable.
- LoginCms TRA XML is signed as an encapsulated CMS/PKCS#7 document with SHA-256.
  The returned token/sign pair is cached only in memory and single-flighted.
- `/health` actively obtains or reuses a real `wsfex` ticket; it returns only
  delegation/readiness booleans.

## Configuration

```text
PORT=4300
ARCA_BOUNDARY_HOST=127.0.0.1
ARCA_ENVIRONMENT=homologacion | production
ARCA_BOUNDARY_PAYLOAD_WRITE_TOKEN
ARCA_BOUNDARY_PAYLOAD_RESOLVE_TOKEN
ARCA_BOUNDARY_WSAA_TOKEN
ARCA_BOUNDARY_ADMIN_TOKEN
ARCA_BOUNDARY_MASTER_KEY_FILE=/run/secrets/arca_boundary_master_key
ARCA_BOUNDARY_CUIT_COMMITMENT_KEY_FILE=/run/secrets/arca_boundary_cuit_commitment_key
ARCA_BOUNDARY_DB_PATH=/data/arca-boundary.sqlite
ARCA_BOUNDARY_PAYLOAD_RETENTION_POLICY_ID=arca-authority-terminal-recovery-v1
ARCA_BOUNDARY_PAYLOAD_TERMINAL_RETENTION_DAYS=30
ARCA_BOUNDARY_PRODUCTION_APPROVED=false
```

The process binds to loopback by default. Container images set
`ARCA_BOUNDARY_HOST=0.0.0.0` explicitly so the container runtime can publish the
authenticated service.

Generate both secrets out of band with a cryptographically secure 32-byte
generator and mount their base64 representations as separate secret files. Do
not commit either value or reuse one as the other. Back up the database and keys
separately; losing the encryption key makes payloads and issuer credentials
unrecoverable, while losing the commitment key prevents safe taxpayer binding.

Master-key rotation is an offline, exclusive, transactional operation. Stop the
service, back up the database, mount the old and new key files, validate every
record, then apply and replace the active secret:

```bash
ARCA_BOUNDARY_NEW_MASTER_KEY_FILE=/run/secrets/arca_boundary_new_master_key \
  bun run --filter @tax-engine/arca-boundary rotate-key -- --dry-run
ARCA_BOUNDARY_NEW_MASTER_KEY_FILE=/run/secrets/arca_boundary_new_master_key \
  bun run --filter @tax-engine/arca-boundary rotate-key
```

The command opens an exclusive SQLite transaction, authenticates every payload
and issuer bundle with the old domain key, re-encrypts both domains with the new
key, and appends a safe rotation audit event. A failed record rolls back the
whole rotation. Keep `ARCA_BOUNDARY_CUIT_COMMITMENT_KEY_FILE` unchanged during
this operation. Changing it is an identity migration and requires reprovisioning
and reconciling all bound issuer/payload/attempt state.

Provisioning `POST /v1/wsaa/issuers` requires:

```json
{
  "version": "wsaa-issuer-provision-v1",
  "workspaceId": "workspace reference",
  "issuerProfileRef": "opaque issuer reference",
  "environment": "homologation",
  "certificateHolderCuit": "CUIT from the certificate subject",
  "representedCuit": "11 digits",
  "certificatePem": "secret certificate PEM",
  "privateKeyPem": "secret unencrypted PKCS#8/PKCS#1 PEM",
  "delegationConfirmed": true,
  "replaceCertificateFingerprint": null
}
```

Send this body only from the restricted administrator channel over HTTPS. The
response contains the certificate fingerprint, delegation boolean, and
`representedCuitCommitment`, never the key or raw CUIT. The private Tax preparation
service must persist that exact receipt and use its commitment when constructing
each sealed authority payload. A synthetic hash or a commitment derived under a
different key will fail closed at the signer. Existing issuer rows created before
this field existed are intentionally unbound and must be reprovisioned; ticket
issuance returns `WSAA_ISSUER_REPRESENTED_CUIT_UNBOUND` rather than guessing.

## Payload recovery and retirement

`expiresAt` on `POST /v1/authority-payloads` is the caller's requested minimum
recovery horizon. The boundary ignores it as a deletion deadline while the
authority effect is unresolved. After Tax independently reconciles the exact
official document, it sends the signer attestation's authority identity and
evidence hashes to `POST /v1/authority-payloads/terminal`. Terminal identity is
the payload hash plus official authority identity, not one observation timestamp:
a later exact reconciliation observation may carry a new evidence hash and still
receives the first terminal receipt. Changing the payload or official identity is
a conflict. The receipt echoes both stable hashes so Tax can verify that replay.

The terminal receipt returns the active policy and `retireAfter`. Until that time
the payload remains resolvable for crash recovery. At or after it, restricted
operations invokes `POST /v1/authority-payloads/retire-eligible` with the admin
token. The transaction writes a safe hash-only tombstone, securely deletes the
ciphertext row, and checkpoints/truncates the SQLite WAL. The tombstone preserves
store idempotency without recreating the private payload. Unresolved payloads
cannot be revoked or retired.

For WSASS homologation, the certificate holder and represented CUIT may be the
same identity. For third-party production issuance they are normally different.
ARCA's published delegation circuit requires all of these steps before
`delegationConfirmed` may be set:

1. The taxpayer delegates the exact `wsfex` service to BUFI through
   Administrador de Relaciones.
2. BUFI accepts that designation.
3. BUFI binds its approved computer/certificate alias to `wsfex` for that
   represented taxpayer.
4. Motora obtains a WSAA ticket and a tenant-scoped WSFEX call does not return
   error `1001`; `FEXGetPARAM_PtoVenta` must show the selected FEEWS point of
   sale as active.

The boolean is an operations attestation, not a substitute for those receipts.
The Clave Fiscal is used only by the human on ARCA's portal and is never an API
credential.

## Run and build

```bash
bun run --filter @tax-engine/arca-boundary typecheck
bun test apps/arca-boundary/src
bun run --filter @tax-engine/arca-boundary start
docker build -f apps/arca-boundary/Dockerfile -t motora-arca-boundary .
```

Both this service and the signer expose plain HTTP inside their containers; an
approved TLS ingress or service mesh is required. All clients reject non-HTTPS
URLs. Production startup additionally requires
`ARCA_BOUNDARY_PRODUCTION_APPROVED=true`, which does not replace the repository
homologation and owner-approval gates.

Official references: [WSAA](https://arca.gob.ar/ws/documentacion/wsaa.asp),
[certificate/delegation guidance](https://www.arca.gob.ar/ws/documentacion/certificados.asp),
and [WSFEX 3.1.1](https://www.arca.gob.ar/ws/documentacion/manuales/WSFEX-Manualparaeldesarrollador_V3.1.1_ARCA.pdf).
