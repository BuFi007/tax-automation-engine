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
| Payload write | `POST /v1/authority-payloads` and `/revoke` | Trusted Motora payload channel |
| Payload resolve | `POST /v1/authority-payloads/resolve` | WSFEX signer only |
| WSAA | `POST /v1/wsaa/tickets` and `GET /health` | WSFEX signer only |
| Certificate admin | `POST /v1/wsaa/issuers` and `/revoke` | Restricted operations console |

The service refuses to start if any two tokens are equal. Payload creation is
idempotent and limited to seven days. Certificate replacement requires the
current certificate fingerprint, and revocation immediately removes cached
tickets.

## Storage and signing

- A 32-byte root secret is loaded from a mounted file (preferred) or base64
  environment value.
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
ARCA_BOUNDARY_DB_PATH=/data/arca-boundary.sqlite
ARCA_BOUNDARY_PRODUCTION_APPROVED=false
```

The process binds to loopback by default. Container images set
`ARCA_BOUNDARY_HOST=0.0.0.0` explicitly so the container runtime can publish the
authenticated service.

Generate the root secret out of band with a cryptographically secure 32-byte
generator and mount its base64 representation as a secret file. Do not commit
the generated value. Back up the database and master key separately; losing the
key makes payloads and issuer credentials unrecoverable.

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
whole rotation.

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
response contains the certificate fingerprint and booleans, never the key or
CUIT.

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
