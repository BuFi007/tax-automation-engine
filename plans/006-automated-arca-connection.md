# 006 — Automated ARCA connection (hosted browser setup)

## Goal

A customer says "Connect my ARCA". BUFI creates or resumes one onboarding run,
the customer authorizes the setup once, authenticates inside a hosted Cloudflare
browser session, and the system completes services, certificate, delegation and
point-of-sale work. BUFI reports `connected` only after the existing WSFEX/WSFE
verification and the Reclaim stage succeed.

The guided manual flow stays available from Invoices. The automated run is an
alternative that the customer pays for with AI credits.

## Authority model (unchanged, made explicit)

| Identity | Where it lives | Who proves it |
| --- | --- | --- |
| Login identity (the human's CUIT/CUIL) | Only on the ARCA page | Executor observation, hashed by the boundary |
| Represented taxpayer | `taxpayerReferenceHash` on the run; raw CUIT sealed in the boundary | Boundary HMAC match of the CUIT the executor observed |
| Certificate holder | BUFI (provider delegation) or the represented taxpayer (customer certificate) | Certificate subject, validated by the boundary |

Two certificate paths:

1. **Provider delegation** (default when the environment has a provider
   template issuer): the customer delegates `wsfex`/`wsfe` to BUFI's CUIT in
   Administrador de Relaciones. BUFI then accepts the designation and binds its
   computer alias for that represented taxpayer. Those two steps run in a
   separate provider-authority session that a BUFI operator authenticates.
   Only then does the boundary bind the represented CUIT to the stored template
   certificate.
2. **Customer certificate** (no provider template, or the customer already uses
   its own computer alias): the boundary generates the key and CSR, the executor
   uploads the CSR and retrieves the certificate, the boundary imports and
   validates it, and the executor relates the alias to each requested service.

## Components

- `packages/core/src/arca-setup-automation.ts`: execution aggregate, scoped
  authorization, lease, receipts and the planner. Pure.
- `packages/core/src/human-auth.ts`: capture policy v2 separates private
  human display (Live View for the authenticated user only) from agent capture.
- `apps/api/src/arca-setup-*.ts`: service, store, executor client, boundary
  setup client, routes and agent tools.
- `apps/arca-boundary`: setup sessions (taxpayer match, enrollment, certificate
  import, provisioning). Private keys never leave it.
- `apps/arca-setup-executor`: Cloudflare Worker + Durable Object using
  `@cloudflare/playwright`. Holds the browser session; reports signed receipts.

## Invariants

- The tax engine is authoritative. The executor only reports observations.
- Every order is bound to execution, onboarding run, workspace, operation,
  authorization and expected revision. A receipt that does not match is refused.
- Passwords, OTPs, cookies, private keys and Live View URLs never enter model
  context, tool results, analytics or tax-domain events.
- Before any mutation the executor re-inspects ARCA; a retry after an uncertain
  response never submits twice.
- Cancellation closes the remote browser session explicitly; disconnecting is
  not closing.
- Connecting ARCA does not re-enable direct issuance tools.
