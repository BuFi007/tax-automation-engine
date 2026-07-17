# Argentine ERP conformance gate

Contabilium is the first candidate, followed by Colppy and Xubio only if a
mandatory criterion fails. This repository does **not** claim production
Contabilium support until an authorized sandbox/test tenant proves:

- stable organization/tenant binding and revocation;
- paginated ledger accounts and counterparties;
- exact-currency invoices, bills, payments, and revisions;
- authoritative reconciliation/allocation references;
- tax-document and CAE metadata when exposed;
- bounded retries/rate limits and legal terms permitting accountant multi-client use.

The `ContabiliumSandboxProvider` returns `sandbox_required` without fixture-backed
authorized tenant data. Credentials must never appear in fixtures, browser code,
logs, or this document.

`ContabiliumRestSandboxProvider` is the real, server-only REST reader used to run
that gate. It follows Contabilium's documented client-credentials flow, pins the
Argentina API origin, checks the returned account ID + CUIT against a configured
commitment, bounds redirects/timeouts/response size, and normalizes invoice plus
fiscal-document reads without treating an ERP balance as canonical settlement.
It cannot be constructed without an approved-sandbox evidence hash.

The current public Postman contract documents searchable sales invoices and
individual collection lookup, but it does not document an enumerable purchase or
collection feed. Therefore the adapter reports `bills` and `payments` as
`unsupported`, and `counterparties` plus `reconciliation` as `partial`. An
authorized sandbox must prove additional endpoints and allocation semantics before
those states can advance. Provider documentation reviewed 2026-07-16:

- https://ayuda.contabilium.com/hc/es/articles/360013444234-Documentaci%C3%B3n-de-la-API
- https://documenter.getpostman.com/view/17702437/2s93shz9yz
