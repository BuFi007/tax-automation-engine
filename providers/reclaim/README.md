# Reclaim ARCA provider deployment

The backend is wired to two provider IDs, but provider capture and publication must happen through a user-controlled ARCA browser session. Private ARCA endpoints must not be guessed or documented from memory.

Use the official [Reclaim agent workflow](https://docs.reclaimprotocol.org/agents/usage): authenticate to the Reclaim dashboard, attach to the browser, let the user sign in to ARCA, capture the relevant request, propose the minimum redactions/matches, replay it, run a proof, and only then publish a provider version.

The normative output contract is [arca-provider-contracts.json](arca-provider-contracts.json).

## Acceptance matrix

Before setting either provider ID in production:

1. A successful proof exposes only the named extracted parameters.
2. Clave Fiscal, session cookies, raw CUIT, CAPTCHA solution, and unrelated page content are absent from the proof and callback logs.
3. A changed regime, point of sale, invoice number, CAE, total, or currency changes the extracted proof value.
4. A proof from another Reclaim application, provider ID/version, session, case context, or expired ten-minute window is rejected by Motora.
5. Replaying the same proof is idempotent; submitting a different proof for an already accepted session is rejected.
6. The CAE provider proves the actual constatement result and cannot succeed from the blank form alone. Document 19 must expose no associated document; documents 20/21 must expose the exact original Factura E type, point of sale, and invoice number.
7. The provider version has no AI tag. Motora configures `allowedTags: []`.
8. If TEE enforcement is enabled, both providers produce a TEE attestation accepted by SDK 5.8.0 before `RECLAIM_REQUIRE_TEE=true` is set.
9. A browser regression run is captured after every material ARCA DOM/request change.
10. Provider IDs and Reclaim application credentials are stored only in the server secret manager.

The public CAE constatement surface currently resolves through the legacy AFIP service host. Keep the origin and certificate behavior monitored; do not silently switch to an unreviewed hostname.

Before interactive provider acceptance, `bun run homologation:preflight` requires
both provider IDs and their separate explicit reviewed flags. After the browser
runs, include only provider-ID hashes, provider versions, proof hashes, custody
receipt hashes, TEE results, and negative-binding outcomes in the redacted
homologation report. Validate it with `bun run homologation:validate -- <file>`.
