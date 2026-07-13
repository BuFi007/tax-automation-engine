# Isolated WSFE (Factura A / B / C + FCE MiPyME) signer

This service is the high-trust domestic issuance provider behind Motora's safe
`SignerRequest`. It authorizes every WSFEV1 domestic comprobante lane:

- **Class C** (monotributista, no discriminated IVA): Factura 11 · ND 12 · NC 13.
- **Class A** (RI → RI/monotributo, discriminated IVA): Factura 1 · ND 2 · NC 3.
- **Class B** (RI → consumidor final/exento, IVA reported not discriminated):
  Factura 6 · ND 7 · NC 8.
- **FCE MiPyME** (Factura de Crédito Electrónica): FCE A 201/202/203 ·
  FCE B 206/207/208 · FCE C 211/212/213.

Like the Factura E signer, it accepts only an opaque authority-payload reference
and the frozen safe document echo — never a certificate, private key, Clave Fiscal
credential, raw authority payload, or human approval token.

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

## Domestic rulebook (field-verified — ARCA COMPG v4.0)

- **PES only.** `MonId=PES`, `MonCotiz=1` for every class.
- **Money model by class.**
  - Class C (11/12/13, 211/212/213): `ImpNeto == ImpTotal`, `ImpIVA = 0`, no `<Iva>`.
  - Class A/B (1/2/3, 6/7/8, 201/202/203, 206/207/208): discriminated IVA —
    `ImpTotal = ImpNeto + ImpIVA + ImpTrib + ImpOpEx`, with an `<Iva>` array of
    `{ Id, BaseImp, Importe }` lines. Alícuota ids: `3=0% · 4=10.5% · 5=21% ·
    6=27% · 8=5% · 9=2.5%`. Each `Importe = BaseImp × rate` to the cent (HALF_UP);
    any drift, a duplicated alícuota, a base-sum ≠ `ImpNeto`, or a total ≠
    `neto + iva + trib + opEx` is rejected before the wire.
- **Class ↔ receptor ↔ IVA matrix** (`FEParamGetCondicionIvaReceptor`, RG 5616):
  - Class A: receptor **must be a CUIT** (DocTipo 80); `CondicionIVAReceptorId`
    ∈ {1 RI, 6 Monotributo, 13 Mono. Social, 16 Mono. Prom.}. (Monotributo now
    takes a Factura **A**, not B.)
  - Class B: `CondicionIVAReceptorId` ∈ {4 Exento, 5 CF, 7 No Cat., 8/9 Ext.,
    10 L.19640, 15 No Alcanzado}. An RI receptor (1) is **forbidden** — it forces A.
  - Class C: the full set {1,4,5,6,7,8,9,10,13,15,16}.
- **Dates are ints `aaaammdd`, always explicit**, resolved in
  `America/Argentina/Buenos_Aires` so a UTC host past 21:00 does not emit tomorrow.
- **Chronological numbering per point of sale.** The frozen `CbteNro` must equal
  the last authorized + 1; a conflicting sequence fails as
  `WSFE_ARCA_SEQUENCE_CONFLICT` and is never silently renumbered.
- **Retro window** ≤10 days for servicios (concepto 2/3), ≤5 for productos
  (concepto 1). Concepto 2/3 require `FchServDesde/FchServHasta/FchVtoPago`.
- **DocTipo** 80 CUIT · 86 CUIL · 96 DNI · 99 Consumidor Final (`DocNro 0`).
- **NC/ND** require an exact `CbtesAsoc` to an authorized factura of the **same
  class family** (RG 4540): 2/3→1, 7/8→6, 12/13→11, 202/203→201, 207/208→206,
  212/213→211.

### FCE MiPyME emission (verified — ARCA COMPG v4.0 FCE validations)

- **Facturas 201/206/211** must carry `FchVtoPago` (≥ `CbteFch`, err 10163/10164)
  and `<Opcionales>`: `2101` = CBU emisor (22 digits, err 10165/10168), optional
  `2102` = alias (6–20 chars, err 10166), and `27` = transmisión `SCA`
  (Circulación Abierta) or `ADC` (Agente de Depósito Colectivo), required at
  emission (err 10216).
- **NC/ND 202/203/207/208/212/213** carry `22` = código de anulación `S`/`N`
  (err 10173) and a same-family `CbtesAsoc`; CBU/alias/transmisión are forbidden
  (err 10172).
- The **FCE obligation threshold** (`FCE_MIPYME_THRESHOLD_ARS`, default
  ARS 5.549.862 — Res. SPyME 1/2026, eff. 2026-04-14) is validated **desk-side**,
  not by the signer. The signer only enforces that FCE docTypes carry the FCE
  fields and that non-FCE docTypes do not.

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
# Optional: override the FCE MiPyME obligation threshold (desk-side helper only).
FCE_MIPYME_THRESHOLD_ARS=5549862
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
