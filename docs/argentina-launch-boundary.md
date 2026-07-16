# Argentina launch boundary

Status: **blocked pending independent professional approval**. This document and
the runtime gate do not replace Argentine legal or accounting advice.

## Product role

The production policy intentionally fixes the following boundary:

- the represented taxpayer is the tax-document issuer;
- BUFI is software that prepares evidence and executes a separately approved,
  immutable authority intent;
- the taxpayer authenticates directly with ARCA and BUFI never accepts or stores
  Clave Fiscal, PIN, OTP, portal cookies, or raw authority credentials;
- foreign-exchange receipts remain at an external authorized bank/payment
  provider; BUFI does not intermediate the exchange operation;
- invoice finance requires a separately approved licensed partner/servicer;
- the Tax Engine does not pay taxes or move advance funds.

Consented `FacturaEFeatureV1` publication is evidence. It is not lending authority
and does not satisfy the gated provider/Aave execution issue.

## Runtime enforcement

Production ARCA authority, remote effects, and Factura E feature publication can
start only when `TAX_ENGINE_ARGENTINA_LAUNCH_POLICY_PATH` points to a bounded,
valid `argentina-launch-policy-v1` artifact. The artifact must contain four
distinct approval receipts:

1. qualified Argentine accountant;
2. qualified Argentine legal counsel;
3. security reviewer;
4. product owner.

The policy has an effective interval and expires closed. Its exact role literals
cannot be broadened by configuration. `/health` exposes only the policy ID,
version, memo hash, dates, boundary, and failed gate IDs. It never exposes reviewer
identity or memo content. Existing ARCA production approvals remain independent
kill switches, so mounting the memo never enables filing by itself.

`TAX_ENGINE_INVOICE_ADVANCE_REMOTE_EFFECTS_ENABLED=true` is rejected in this
process. Funding can be introduced only through the separately reviewed partner
boundary after its gated issues close.

## Decision memo checklist

The signed memo referenced by `decisionMemoHash` must answer, with effective-dated
primary sources:

- Factura E eligibility, fields, CAE, numbering, point-of-sale, adjustment, and
  receipt-retention duties;
- WSFEXV1/WSAA test and production certificate/delegation responsibilities;
- BCRA service-export receipt timing, eligible concepts, foreign-currency and
  stablecoin-to-bank evidence, fees, titularity, and FX treatment;
- whether any proposed collection path makes BUFI a payment intermediary;
- the licensed partner/servicer required before any invoice advance;
- retention/deletion ownership for Reclaim proofs and authority evidence;
- incident owners and the independent live-submission and lending kill switches.

The four receipt hashes are commitments to signed approval evidence held outside
the application database. Do not place names, CUITs, credentials, or memo contents
in the runtime artifact.

## Primary-source registry for review

- `arca-wsfex-3.1.1`: [ARCA WSFEXV1 developer manual 3.1.1](https://www.arca.gob.ar/ws/documentacion/manuales/WSFEX-Manualparaeldesarrollador_V3.1.1_ARCA.pdf)
- `arca-electronic-invoice-webservices`: [ARCA electronic-invoice web services](https://arca.gob.ar/ws/documentacion/ws-factura-electronica.asp)
- `arca-wsaa-architecture`: [ARCA WSAA architecture](https://www.arca.gob.ar/ws/documentacion/arquitectura-general.asp)
- `arca-webservice-delegation`: [ARCA web-service delegation guide](https://www.arca.gob.ar/ws/WSAA/ADMINREL.DelegarWS.pdf)
- `arca-service-export-invoicing`: [ARCA service-export invoicing](https://arca.gob.ar/monotributo/exportacion-servicios/)
- `bcra-a8330`: [BCRA Communication A 8330](https://www.bcra.gob.ar/archivos/Pdfs/comytexord/A8330.pdf)
- `bcra-current-exchange-rules`: [BCRA current exterior-and-exchange rules](https://www.bcra.gob.ar/normativa-de-exterior-y-cambios/)

Professional reviewers must add the current consolidated text and any later
communications in force on the decision date. A source link in this registry is
not an approval.
