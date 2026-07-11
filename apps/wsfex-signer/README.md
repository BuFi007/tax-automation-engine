# Isolated WSFEX signer

This service is the high-trust Path A provider behind Motora's safe
[`SignerRequest`](../../providers/wsfex/openapi.yaml). It accepts only an opaque
authority-payload reference and the frozen safe document echo; it never accepts
a certificate, private key, Clave Fiscal credential, raw authority payload, or
human approval token from the agent.

## Trust boundaries

The signer calls two separately authenticated HTTPS services:

- `POST /v1/authority-payloads/resolve` on the payload vault returns
  `{ payload, payloadHash }`. The signer recomputes the canonical SHA-256 hash and
  binds subject, intent, request ID, document fields, exact total, and association.
- `POST /v1/wsaa/tickets` on the WSAA broker returns an ephemeral
  `{ token, sign, representedCuit, expiresAt }` for service `wsfex`. The broker,
  not this process, owns the certificate and private key. Its protected `/health`
  reports only delegation/readiness booleans.

The local SQLite store contains request/intent/payload hashes, safe document
coordinates, normalized status, CAE, and timestamps. It does not contain the
opaque payload reference, customer identifiers, token/sign, represented CUIT, or
raw SOAP XML.

## Authority behavior

- Homologation: `https://wswhomo.afip.gov.ar/wsfexv1/service.asmx`
- Production: `https://servicios1.afip.gov.ar/wsfexv1/service.asmx`
- SOAP namespace: `http://ar.gov.afip.dif.fexv1/`
- Request IDs are monotonic N15 decimal strings and invoice numbers are
  sequential N8 decimal strings.
- A timeout/network failure/5xx remains `ambiguous`. Recovery replays the exact
  request and payload hash, then accepts only a matching `FEXGetCMP` document.
- Notes 20/21 must point to one authorized type-19 original and reuse its exact
  currency and quote.

## Run

```bash
bun install
bun run --filter @tax-engine/wsfex-signer typecheck
bun test apps/wsfex-signer/src
bun run --filter @tax-engine/wsfex-signer start
```

Required environment:

```text
PORT=4200
ARCA_ENVIRONMENT=homologacion | production
WSFEX_SIGNER_API_TOKEN
WSFEX_SIGNER_VAULT_URL=https://...
WSFEX_SIGNER_VAULT_TOKEN
WSFEX_WSAA_BROKER_URL=https://...
WSFEX_WSAA_BROKER_TOKEN
WSFEX_SIGNER_DB_PATH=/data/wsfex-signer.sqlite
WSFEX_SIGNER_VERSION=0.1.0
WSFEX_SIGNER_PRODUCTION_APPROVED=false
```

Production startup refuses to run unless `WSFEX_SIGNER_PRODUCTION_APPROVED=true`.
This local flag is necessary but not sufficient: the repository homologation
gate and explicit owner review still have to pass.

Build the container from the repository root:

```bash
docker build -f apps/wsfex-signer/Dockerfile -t motora-wsfex-signer .
```

Official references: [WSFEX 3.1.1](https://www.arca.gob.ar/ws/documentacion/manuales/WSFEX-Manualparaeldesarrollador_V3.1.1_ARCA.pdf), [WSAA](https://arca.gob.ar/ws/documentacion/wsaa.asp), and [certificate/delegation guidance](https://www.arca.gob.ar/ws/documentacion/certificados.asp).
