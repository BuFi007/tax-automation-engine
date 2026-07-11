# WSFEX signer boundary

The [OpenAPI contract](openapi.yaml) is the only network contract used by the tax-agent backend. The deployable implementation is [`apps/wsfex-signer`](../../apps/wsfex-signer/README.md), a separate high-trust service.

It must:

1. Resolve `authorityPayloadRef` inside a credential/payload vault.
2. Keep the WSAA certificate and private key out of Motora, the browser, logs, and agent context.
3. Verify that the resolved payload hashes to `intentHash` and matches the safe expected document.
4. Use a delegated `wsfex` certificate and a point of sale enabled for FEEWS.
5. Allocate/reconcile N15 `Cmp.Id` and N8 `Cbte_nro` as decimal strings without JavaScript number conversion.
6. On ambiguity, replay the exact request ID/payload and query `FEXGetCMP`, `FEXGetLast_CMP`, and `FEXGetLast_ID`.
7. Return an accepted result only with a CAE and an echoed `authorizedDocument` matching the approved intent or adjustment. Notes 20/21 must echo the original Factura E type 19, point of sale, and invoice number.
8. Never auto-convert an ambiguous 5xx/timeout into a rejection or a new request.
9. Store immutable request/response hashes and safe ARCA errors/events.
10. Run homologation acceptance tests before production credentials are enabled.

The signer must also expose the bearer-protected redacted `/health` contract in
the OpenAPI file. It may return only environment/version/readiness booleans—no
certificate subject, serial, key material, WSAA token, CUIT, or authority payload.
Motora probes it with `bun run homologation:probe-signer`.

The Motora API rejects an accepted response if the request ID, subject ID, intent hash, type, operation, point of sale, issue date, currency, exact total, or associated original document differs. Invoice and adjustment recovery both reuse the exact request ID and opaque payload reference.

The implementation targets the official WSFEX 3.1.1 SOAP endpoints and checks
the current homologation WSDL field names. Its authority payload requires the
country CUIT and every SOAP-required item decimal; for non-PES invoices it also
requires the `CanMisMonExt` decision. Notes 20/21 deliberately support one exact
type-19 association in this product version.

Official references: [WSFEX developer manual](https://www.arca.gob.ar/ws/documentacion/manuales/WSFEX-Manualparaeldesarrollador_V3.1.1_ARCA.pdf), [WSAA](https://arca.gob.ar/ws/documentacion/wsaa.asp), and [ARCA certificates](https://www.arca.gob.ar/ws/documentacion/certificados.asp).
