# WSFEX signer boundary

The [OpenAPI contract](openapi.yaml) is the only signer network contract used by the tax-agent backend. The deployable implementation is [`apps/wsfex-signer`](../../apps/wsfex-signer/README.md), backed by the encrypted [`apps/arca-boundary`](../../apps/arca-boundary/README.md).

It must:

1. Resolve `authorityPayloadRef` inside a credential/payload vault and require the
   canonical payload hash to equal `authorityPayloadHash`.
2. Keep the WSAA certificate and private key out of Motora, the browser, logs, and agent context.
3. Recompute the embedded canonical invoice/adjustment hash, require it to equal `intentHash`, and map every approved line/date/amount/quote/association into the authority payload.
4. Use a delegated `wsfex` certificate and a point of sale enabled for FEEWS. Bind
   the WSAA ticket and payload with the same keyed represented-CUIT commitment;
   never log or return the raw CUIT outside the high-trust boundary.
5. Allocate/reconcile N15 `Cmp.Id` and N8 `Cbte_nro` as decimal strings without
   JavaScript number conversion. Serialize preflight and submit with a durable
   lease scoped to environment plus represented-CUIT commitment.
6. On ambiguity, query `FEXGetCMP` first. Replay the exact request ID/payload only
   after a conclusive not-found read; never replay after a transport-ambiguous read,
   and query once more if the replay is rejected.
7. Return an accepted reconciliation only when the entire `FEXGetCMP` document
   equals the frozen payload: customer/destination, operation, currency/payment,
   dates, total, terms, observations, language, every item, and association. Bind
   its raw SOAP hash into a strict reconciliation attestation.
8. Return a direct accepted result only with a CAE, its parsed `Fch_venc_Cae`
   expiry, and an `authorizedDocument` matching the approved intent or adjustment,
   including the exact frozen ARCA currency ID and quote submitted. Because
   `FEXAuthorize` does not echo those currency fields, describe them as submitted
   on the direct path and as ARCA-confirmed only after `FEXGetCMP`. Notes 20/21
   must echo the original Factura E type 19, point of sale, and invoice number.
9. Return deterministic validation failures as `preflight_rejected` without
   creating an attempt; never turn an ambiguous 5xx/timeout into a rejection or a
   new request.
10. Key durable attempts by environment, represented-CUIT commitment, and request
    ID, with workspace/profile/subject/run/payload as immutable bindings. Refuse a
    populated legacy schema that cannot prove that scope.
11. Run homologation acceptance tests before production credentials are enabled,
    and refuse production with an in-memory attempt database.

The signer must also expose the bearer-protected redacted `/health` contract in
the OpenAPI file. It may return only environment/version/readiness booleans—no
certificate subject, serial, key material, WSAA token, CUIT, or authority payload.
Motora probes it with `bun run homologation:probe-signer`.

The Tax API rejects an accepted response if the request ID, subject ID, intent
hash, type, operation, point of sale, issue date, currency, exact total, or
associated original document differs. An independently accepted reconciliation
must also bind the configured environment, payload hash, official identity, and
attestation evidence hash. Invoice and adjustment recovery reuse the exact request
ID and opaque payload reference.

The official document identity is the ARCA environment + WSFEXV1 authority +
represented-CUIT commitment + voucher type + point of sale + voucher number. CAE
is evidence about that document, not part of its identity. This lets Tax enforce a
single permanent identity lock without putting a raw CUIT in its database.

The implementation targets the official WSFEX 3.1.1 SOAP endpoints and checks
the current homologation WSDL field names. Its authority payload requires the
country CUIT and every SOAP-required item decimal; for non-PES invoices it also
requires the `CanMisMonExt` decision. Notes 20/21 deliberately support one exact
type-19 association in this product version.

The public homologation WSDL was reviewed on 2026-07-15 and exposes every field
used by the exact comparator, including the represented taxpayer on
`Cmp_asoc.Cbte_cuit`. Run `bun run --cwd apps/wsfex-signer verify:wsdl` as an
activation drift gate. Before production activation, an authenticated homologation
invoice must still prove how ARCA actually emits every value on `FEXGetCMP`, since
several fields are optional in the XSD. If a live response omits or renames a
required value, reconciliation fails closed; do not weaken the comparator to make
a smoke test pass.

Official references: [WSFEX developer manual](https://www.arca.gob.ar/ws/documentacion/manuales/WSFEX-Manualparaeldesarrollador_V3.1.1_ARCA.pdf), [WSAA](https://arca.gob.ar/ws/documentacion/wsaa.asp), and [ARCA certificates](https://www.arca.gob.ar/ws/documentacion/certificados.asp).
