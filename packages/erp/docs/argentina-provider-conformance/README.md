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
