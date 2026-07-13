# WSFECRED (Factura de Crédito Electrónica MiPyMEs) lifecycle client

This service is the **read-only** acceptance/negotiation lifecycle reader for
**Factura de Crédito Electrónica MiPyMEs** (FCE, Ley 27.440) over ARCA's
`wsfecred` web service. It moves no money and mutates no ARCA state — it resolves
whether an already-emitted FCE is still awaiting acceptance, was accepted
(expressly or tacitly), was rejected, or was cancelled. Like the signers, it
accepts no certificate, private key, or Clave Fiscal credential: it obtains only
an ephemeral WSAA ticket from the shared broker.

## Trust boundary

The client calls one separately authenticated HTTPS service:

- `POST /v1/wsaa/tickets` on the WSAA broker returns an ephemeral
  `{ token, sign, representedCuit, expiresAt }` for ARCA service literal
  **`wsfecred`** (WSFECRED manual v2.0.3 §2.3). The broker — shared with the
  Factura E (`wsfex`) and Factura C (`wsfe`) signers — owns the certificate and
  private key. The single shared edit for this client widened the broker's
  service enum to include `wsfecred`; no authority-payload storage is involved
  (this client stores nothing).

The querying identity (`x-workspace-id` + `x-issuer-profile-ref` request headers)
selects which delegated credential mints the ticket; its represented CUIT is the
party querying ARCA (emisor or receptor).

## ARCA methods (verified against the live production WSDL + manual v2.0.3)

| Method | Purpose | Source |
| --- | --- | --- |
| `consultarCtaCte` | Query one cuenta corriente by `idCtaCte → idFactura` (`CUITEmisor`, `codTipoCmp`, `ptoVta`, `nroCmp`); returns `CuentaCorrienteType` with the embedded `factura` (`ComprobanteType`). This single call yields the whole lifecycle. | WSDL `consultarCtaCte`; manual §2.4.11 |
| `dummy` | Connectivity check. | WSDL `dummy`; manual §2.4.23 |

- Endpoint (homologación): `https://fwshomo.afip.gov.ar/wsfecred/FECredService` (`.gov.ar`)
- Endpoint (producción): `https://serviciosjava.afip.gob.ar/wsfecred/FECredService` (`.gob.ar`)
- SOAP namespace / soapAction: `http://ar.gob.afip.wsfecred/FECredService/` (document/literal; soapAction = namespace + operation)
- Auth block: `<authRequest>{ token, sign, cuitRepresentada }</authRequest>`

Two decode gotchas verified from the WSDL: `estado` is **nested** —
`ComprobanteType.estado` and `CuentaCorrienteType.estadoCtaCte` are
`{ estado, fechaHoraEstado }`, so the enum lives at `estado.estado`; and the
identifier casing is `CUITEmisor` (uppercase) / `ptoVta`, while the comprobante
echoes `ptovta` (lowercase). Business errors (including not-found) arrive in
`arrayErrores` as `codigoDescripcion = { codigo, descripcion }`, not a SOAP Fault.

## State mapping (ARCA tuple → desk lifecycle)

ARCA has **no single lifecycle estado**: acceptance form is a separate `tipoAcep`
field, cancellation lives on the cuenta corriente, and **there is no `cedida`
estado at all** — a cesión is executed outside AFIP; `wsfecred` only reports the
transfer *option* (`opcionTransferencia` ∈ ADC/SCA). This client derives one desk
state, most-terminal first:

| Desk `estado` | Derived from |
| --- | --- |
| `cancelada` | `estadoCtaCte = CanceladaTotal` |
| `rechazada` | comprobante `estado = Rechazado` **or** `estadoCtaCte = Rechazada` |
| `aceptada_expresa` | accepted **and** `tipoAcep = Expresa` |
| `aceptada_tacita` | accepted **and** `tipoAcep = Tacita` |
| `emitida` | `PendienteRecepcion` / `Recepcionado` / cta.cte. `Modificable` |
| `unknown` | accepted without a qualified `tipoAcep`, or any unmapped tuple |
| `cedida` | **reserved, never emitted** — ARCA exposes no cesión status; `opcionTransferencia` is surfaced in `raw` instead |

The raw ARCA strings (`estadoComprobante`, `estadoCtaCte`, `tipoAceptacion`,
`opcionTransferencia`, amounts, dates) are always echoed in `raw` so nothing is lost.

## Acceptance window (tacit acceptance)

Tacit acceptance currently occurs **21 días corridos (calendar days)** after the
FCE is received in the Domicilio Fiscal Electrónico — **Resolución 219/2025
SEPYME** (BO 28/10/2025), in force 2025-11-01 → 2026-10-31, suspending the
15/30-day plazos of **Ley 27.440 art. 8**. Because it is set by a periodically
renewed resolution, it is **config** (`FCE_ACCEPTANCE_WINDOW_DAYS`, default 21),
not a constant. ARCA's own `fchVtoAceptacion` (`fechaVenAcep`) is authoritative
when present; the exported `computeTacitAcceptanceDeadline` /
`daysUntilTacitAcceptance` helpers (from `@tax-engine/wsfecred/contracts`) are the
desk's countdown fallback, anchored on the emission date and TZ-resolved in
Buenos Aires. The `raw.fchVtoAceptacionEstimado` field carries this estimate.

## HTTP surface (pinned contract Motora calls)

- `GET /v1/wsfecred/invoices/{cuitEmisor}/{ptoVta}/{cbteTipo}/{cbteNro}/lifecycle`
  — `Authorization: Bearer <token>`, `x-workspace-id`, `x-issuer-profile-ref`
  headers. Returns:
  `{ estado, fchVtoAceptacion, fchAceptacion, montoAceptado, raw }`
  (plus the echoed coordinates and `schema: "motora-wsfecred-lifecycle-v1"`).
  A comprobante ARCA does not know (business codes 1102/1105/32767) is a `404`.
- `GET /health` → `{ schema: "motora-wsfecred-health-v1", environment:
  "homologacion" | "production", certificateDelegationConfigured, wsaaReady }`.
  Fails closed: production only when `ARCA_ENVIRONMENT === 'production'`.

## Run

```bash
bun install
bun run --filter @tax-engine/wsfecred typecheck
bun test apps/wsfecred/src
bun run --filter @tax-engine/wsfecred start
```

Required environment:

```text
PORT=4400
ARCA_ENVIRONMENT=homologacion | production
WSFECRED_API_TOKEN
WSFECRED_WSAA_BROKER_URL=https://...
WSFECRED_WSAA_BROKER_TOKEN
WSFECRED_CLIENT_VERSION=0.1.0
FCE_ACCEPTANCE_WINDOW_DAYS=21
WSFECRED_PRODUCTION_APPROVED=false
```

Production startup refuses to run unless `WSFECRED_PRODUCTION_APPROVED=true`. This
local flag is necessary but not sufficient: the repository homologation gate and
explicit owner review still have to pass.

Build the container from the repository root:

```bash
docker build -f apps/wsfecred/Dockerfile -t motora-wsfecred .
```

Official references: WSFECRED "Manual para el Desarrollador" v2.0.3
(Factura de Crédito Electrónica MiPyMEs, RG 4367), [WSAA](https://arca.gob.ar/ws/documentacion/wsaa.asp),
Ley 27.440, Resolución 219/2025 SEPYME (BO 28/10/2025).
