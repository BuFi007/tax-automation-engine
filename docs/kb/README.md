# ARCA Web-Services Knowledge Base

Convenience markdown copies of the official ARCA (ex-AFIP) web-service developer
manuals used by this tax engine. Retrieved **2026-07-15**.

> **WARNING — the markdown files in this directory are convenience copies only.**
> The official PDFs / pages at the source URLs below are the authoritative
> documents. PDF-to-markdown conversion can drop or reorder table cells, mangle
> field-length columns, and lose formatting that carries meaning. Any
> exact-recovery detail (field names, lengths, enum codes, error codes) and any
> fiscal rule (RG obligations, CAE/CAI rules, tolerances, cotización rules) MUST
> be verified against the official PDF before being implemented or relied upon.

## Files

| File | Service | What it is | Source (authoritative) |
| --- | --- | --- | --- |
| `wsfev1-manual.md` | WSFEV1 | Factura Electrónica nacional (COMPG) — Manual para el desarrollador V.4.5, R.G. N° 4.291. 199-page PDF, Last-Modified 2026-07-03. | <https://www.arca.gob.ar/ws/documentacion/manuales/manual-desarrollador-ARCA-COMPG.pdf> |
| `wsfex-manual.md` | WSFEX | Factura de Exportación — Manual para el desarrollador V.3.1.1, R.G. N° 2.758. 59-page PDF, Last-Modified 2025-08-29. | <https://www.arca.gob.ar/ws/documentacion/manuales/WSFEX-Manualparaeldesarrollador_V3.1.1_ARCA.pdf> |
| `wsfecred-manual.md` | WSFECRED | Factura de Crédito Electrónica MiPyME (FECredService) — Manual para el Desarrollador V 2.0.3. 87-page PDF hosted on the FCE microsite (canonical location; not listed in the arca.gob.ar/ws catalog). Mirror: <https://servicioscf.arca.gob.ar/facturadecreditoelectronica/documentos/Manual-Desarrollador-WSFECRED.pdf>. | <https://servicioscf.afip.gob.ar/facturadecreditoelectronica/documentos/Manual-Desarrollador-WSFECRED.pdf> |
| `wsaa-manual.md` | WSAA | Autenticación y Autorización — official documentation index page (HTML). Links the technical spec `Especificacion_Tecnica_WSAA_1.2.2.pdf` and the dev manual `WSAAmanualDev.pdf`, which are NOT mirrored here — fetch them from the links inside. | <https://www.arca.gob.ar/ws/documentacion/wsaa.asp> |

## How these copies were produced

- `wsaa-manual.md` and `wsfecred-manual.md`: Firecrawl scrape (PDF → markdown for
  WSFECRED; HTML → markdown for WSAA).
- `wsfex-manual.md` and `wsfev1-manual.md`: downloaded the official PDFs and
  extracted locally with `pdftotext -layout` (Firecrawl bills PDF scrapes
  per page; these two total 258 pages, which exceeded the scrape credit budget).
  Layout-mode extraction preserves table alignment as monospaced text, but is
  rougher than the Firecrawl conversion — page boundaries are marked with
  `<!-- page N -->` comments.

## Refresh procedure

1. Re-check the catalog page <https://www.arca.gob.ar/ws/documentacion/ws-factura-electronica.asp>
   for new manual versions (ARCA bumps the version in the PDF filename).
2. Re-download the PDF and regenerate the markdown.
3. Update this README's version numbers, Last-Modified dates and retrieval date.
