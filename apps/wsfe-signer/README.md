# Isolated WSFE (Factura C) signer

This service is the high-trust domestic issuance provider behind Motora's safe
`SignerRequest`. It authorizes **Factura C / Nota de Débito C / Nota de Crédito C**
(comprobante types 11 / 12 / 13) for monotributistas over ARCA's WSFEV1 web
service. Like the Factura E signer, it accepts only an opaque authority-payload
reference and the frozen safe document echo — never a certificate, private key,
Clave Fiscal credential, raw authority payload, or human approval token.

## Trust boundaries

The signer calls two separately authenticated HTTPS services:

- `POST /v1/authority-payloads/resolve` on the payload vault returns
  `{ payload, payloadHash }`. The signer recomputes the canonical SHA-256 hash and
  binds subject, intent, request id, document fields, exact total, service period,
  and association.
- `POST /v1/wsaa/tickets` on the WSAA broker returns an ephemeral
  `{ token, sign, representedCuit, expiresAt }` for service **`wsfe`** (the broker
  is shared with the Factura E signer; only the ARCA ticket service literal
  differs). The broker, not this process, owns the certificate and private key.

The local SQLite store contains request/intent/payload hashes, safe document
coordinates, normalized status, and CAE. It never contains the receptor DocNro,
token/sign, represented CUIT, opaque payload reference, or raw SOAP XML.

## Domestic rulebook (field-verified — NOTAS-ARCA)

- **PES only.** `MonId=PES`, `MonCotiz=1`. Class C never discriminates IVA:
  `ImpNeto == ImpTotal`, `ImpIVA = 0`.
- **Dates are ints `aaaammdd`, always explicit** (a null `CbteFch` errors 10016),
  resolved in `America/Argentina/Buenos_Aires` so a UTC host past 21:00 does not
  emit tomorrow.
- **Chronological numbering per point of sale.** The frozen `CbteNro` must equal
  the last authorized + 1; a conflicting sequence fails as
  `WSFE_ARCA_SEQUENCE_CONFLICT` and is never silently renumbered.
- **Retro window** ≤10 days for servicios (concepto 2/3), ≤5 for productos
  (concepto 1).
- **DocTipo** 80 CUIT · 86 CUIL · 96 DNI · 99 Consumidor Final (`DocNro 0`).
  `CondicionIVAReceptorId` ∈ {1,4,5,6,7,8,9,10,13,15,16}.
- **Concepto** 1 productos · 2 servicios · 3 ambos; 2/3 require
  `FchServDesde/FchServHasta/FchVtoPago`.
- **NC/ND C (12/13)** require an exact `CbtesAsoc` to an authorized Factura C 11
  (RG 4540).

## Authority behavior

- Homologation: `https://wswhomo.afip.gov.ar/wsfev1/service.asmx`
- Production: `https://servicios1.afip.gov.ar/wsfev1/service.asmx`
- SOAP namespace: `http://ar.gov.afip.dif.FEV1/`
- Methods: `FECAESolicitar`, `FECompUltimoAutorizado`, `FECompConsultar`,
  `FEParamGetPtosVenta`, `FEDummy`.
- **Exact recovery, no blind retry.** A timeout / network failure / 5xx remains
  `ambiguous`. Recovery re-sends the byte-identical `FECAESolicitar` (ARCA returns
  the same CAE with `Reproceso=S`) and/or reads back `FECompConsultar`. The signer
  accepts only when the echo matches the frozen document field-for-field with
  `Resultado=A` and a CAE — a CAE alone is never trusted.

## HTTP surface (pinned contract Motora calls)

- `POST /v1/wsfev1/invoices` — `Authorization: Bearer <token>`, `Idempotency-Key`
  header. The single idempotent endpoint issues, replays, and re-drives recovery.
  Response echoes the authorized frozen document:
  `{ resultado, cae, caeFchVto, cbteTipo, ptoVta, cbteNro, feCompConsultarEcho }`
  (plus `status`, `authorizedDocument`, `safeErrors`).
- `GET /health` → `{ schema: "motora-wsfe-signer-health-v1", environment:
  "homologacion" | "production", certificateDelegationConfigured, wsaaReady }`.
  Fails closed: production only when `ARCA_ENVIRONMENT === 'production'`.

## Run

```bash
bun install
bun run --filter @tax-engine/wsfe-signer typecheck
bun test apps/wsfe-signer/src
bun run --filter @tax-engine/wsfe-signer start
```

Required environment:

```text
PORT=4300
ARCA_ENVIRONMENT=homologacion | production
WSFE_SIGNER_API_TOKEN
WSFE_SIGNER_VAULT_URL=https://...
WSFE_SIGNER_VAULT_TOKEN
WSFE_WSAA_BROKER_URL=https://...
WSFE_WSAA_BROKER_TOKEN
WSFE_SIGNER_DB_PATH=/data/wsfe-signer.sqlite
WSFE_SIGNER_VERSION=0.1.0
WSFE_SIGNER_PRODUCTION_APPROVED=false
```

Production startup refuses to run unless `WSFE_SIGNER_PRODUCTION_APPROVED=true`.
This local flag is necessary but not sufficient: the repository homologation gate
and explicit owner review still have to pass.

Build the container from the repository root:

```bash
docker build -f apps/wsfe-signer/Dockerfile -t motora-wsfe-signer .
```

Official references: [WSFEV1](https://www.arca.gob.ar/ws/documentacion/manuales/manual-desarrollador-COMPG-v4-0.pdf),
[WSAA](https://arca.gob.ar/ws/documentacion/wsaa.asp).
