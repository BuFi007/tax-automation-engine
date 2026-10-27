# ARCA connection: live verification runbook

Nothing in the automated ARCA connection has run live end to end. This
runbook is the order in which it is proven, and what counts as a pass. Steps
are sequential: do not start a step until the previous one passed. Background
and contracts: [arca-setup-executor.md](arca-setup-executor.md).

## 1. Browser Run proof (non-production Cloudflare account)

The proof Worker (`wrangler.proof.jsonc`, `PROOF_ROUTES_ENABLED=true`,
`ARCA_ENVIRONMENT=homologation`) touches no ARCA credentials: it uses its own
fixtures and ARCA's public login page.

```bash
cd apps/arca-setup-executor
npx wrangler whoami                       # must be the NON-production account
# Pass the workers.dev host on the command line; do not edit the tracked
# wrangler.proof.jsonc (if you do, never commit that edit).
npx wrangler deploy -c wrangler.proof.jsonc \
  --var PUBLIC_BASE_URL:https://bufi-arca-setup-proof.<subdomain>.workers.dev
PROOF_TOKEN=$(openssl rand -hex 32)       # >= 32 chars, or /proof/run answers 401
printf %s "$PROOF_TOKEN" | npx wrangler secret put PROOF_TOKEN -c wrangler.proof.jsonc
for s in ARCA_SETUP_ORDER_SECRET ARCA_SETUP_RECEIPT_SECRET ARCA_SETUP_HANDOFF_SECRET ARCA_BOUNDARY_SETUP_EXECUTOR_TOKEN; do
  openssl rand -hex 32 | npx wrangler secret put "$s" -c wrangler.proof.jsonc   # distinct throwaway values
done
# Read-only preview check (token: Browser Rendering Write, this account only).
npx wrangler secret put CF_ACCOUNT_ID -c wrangler.proof.jsonc            # or add it to vars
npx wrangler secret put CF_LIVE_VIEW_API_TOKEN -c wrangler.proof.jsonc
curl -sS -o /tmp/arca-proof.json -w '%{http_code}\n' -X POST \
  -H "authorization: Bearer $PROOF_TOKEN" https://<host>/proof/run   # must print 200
npx wrangler delete -c wrangler.proof.jsonc   # always, pass or fail
unset PROOF_TOKEN
```

Any status other than `200` is a FAIL of the whole run: the body is an error,
not the sections. A failed `openSession` happens before a section's `try`, so
it aborts the run instead of being recorded; this includes the WebMCP
section's `LAB_SESSION_UNAVAILABLE`. A section that threw after its session
opened returns `{ error, session }` instead of its fields; that section is a
FAIL. In every section `session.verifiedGone` must be `true`.

| Field | PASS | FAIL |
| --- | --- | --- |
| `fileTransfer.uploadFromBytes` | `true` (`uploadedHash` = `expectedUploadHash`) | `false` or hashes differ |
| `fileTransfer.downloadGetLink`, `fileTransfer.downloadFormPost` | both `true` (`downloadedHash` = `expectedDownloadHash`) | either `false`; read `downloadGetLinkDetail` / `downloadFormPostDetail` |
| `fileTransfer.aliveAfterDisconnect` | `true` | `false` |
| `fileTransfer.strategies` | record as is (evidence for the chosen retrieval path) | — |
| `arcaReachability.status` | `200` | anything else or `null` |
| `arcaReachability.blockedSignals` | `false` | `true` (captcha or block page) |
| `arcaReachability.loginFormPresent`, `cuitFieldPresent` | `true` | `false`: the login selectors need review |
| `handoff.completionObserved` | `true` | `false` |
| `handoff.handoffIdIssued`, `activeDuring` | `true`; `activeAfter` `false` | otherwise |
| `guardrails.blockedNavigation` | `true` | `false` or `null` |
| `guardrails.blockedReason` | `not-in-allowlist` | any other value |
| `guardrails.pageFetchOutsideAllowlist` | record (`blocked` expected) | — |
| `readonlyLiveView` | `viewerStatus` recorded, no `skipped` | `skipped: CF_LIVE_VIEW_CREDENTIALS_MISSING` |
| `webmcp.cdpTools`, `webmcp.pageTools` | record; expected empty (`[]` / `null`) | — |

Decisions taken from the record:

- **Preview embedding.** Record `readonlyLiveView.xFrameOptions` and
  `readonlyLiveView.frameAncestors`. Set `NEXT_PUBLIC_ARCA_PREVIEW_EMBED` only
  if neither forbids framing by the BUFI origin (`x-frame-options` absent, and
  `frame-ancestors` absent or naming the BUFI origin). `DENY`, `SAMEORIGIN` or
  a `frame-ancestors` without BUFI keeps the protected full-screen window.
- **WebMCP.** Empty `cdpTools`/`pageTools` keeps the Playwright locators.
  Non-empty: open a follow-up to drive the matching operation with WebMCP; do
  not switch it in the same change. `webmcpDomainEnabled: false` means the
  check did not run, not that ARCA has no tools. A Lab session that cannot open
  (`LAB_SESSION_UNAVAILABLE`) fails the whole run with no sections; open a
  follow-up so that section degrades to `{ error, session }` instead of
  throwing.

## 2. Evidence

Save the result as
`providers/homologation/evidence/<YYYY-MM-DD>-cloudflare-browser-run-proof.json`,
following `2026-10-26-cloudflare-browser-run-proof.json`: `version`,
`observedAt`, `runtime`, `package`, `worker`, the sections as returned, and
`notes`. Use the section names `/proof/run` returns today
(`arcaReachability`; the 2026-10-26 file predates the rename and says
`arcaLoginReachability`) and add `guardrails`, `readonlyLiveView` and
`webmcp`.

Never commit `PROOF_TOKEN`, Cloudflare tokens, account-scoped secrets or any
Live View URL. `/proof/run` returns only hosts and facts about links; check
the file before committing anyway.

## 3. Homologation end to end

Homologation services and a test taxpayer only. Observe each line before
moving to the next.

1. **Motora (dev):** set `MOTORA_ARCA_AUTOMATION_ENABLED=true`. Observe: the
   automation corridor answers instead of refusing.
2. **Shiva (dev):** set the `TAX_AUTOMATION_ENGINE_*` secrets
   (`TAX_AUTOMATION_ENGINE_URL`, `TAX_AUTOMATION_ENGINE_API_KEY`,
   `TAX_AUTOMATION_ENGINE_AGENT_PRINCIPAL_HMAC_SECRET`) to the homologation
   Tax engine. Observe: Shiva reaches Tax without auth errors.
3. **Start:** in the Desk app ask Bu "Connect ARCA". Observe: the job appears
   under the Treasury island and in Control → Jobs & AI tasks.
4. **Authorize and pay:** approve the scoped authorization and confirm the
   price. Observe: exactly one credit debit, reference
   `arca-automation:<executionId>`; a retry or refresh adds none.
5. **Sign in:** open the private sign-in tab and log in with the test
   Clave Fiscal. Observe: while typing, the job preview shows the private
   sign-in placeholder, never a stream.
6. **Pause:** observe "Pausing…" (`pause_requested`) then Paused
   (`acknowledgedAt` set); no order runs while paused. Resume continues the
   same execution.
7. **Take control / return control:** take control, act in the tab, return
   control. Observe: the interactive link issued before the return stops
   working; an order planned before the human acted is re-inspected
   (`ARCA_CONTROL_RETURNED_REINSPECT`).
8. **Stop:** cancel a second run. Observe: terminal state and
   `verifiedGone: true` for its browser session.
9. **Connected:** let a run complete. Observe: **connected** appears only after
   WSFEX/WSFE verification and the Reclaim proof succeed; no earlier state
   reads as connected.

Record every step's outcome next to the proof evidence.

## 4. Selectors

`ARCA_SELECTOR_SET_VERSION` in `apps/arca-setup-executor/src/arca-portal.ts`
(`arca-portal-2026-10-manual-derived`) is derived from ARCA's manuals, not
from a live portal. During step 3, record each authenticated ARCA page reached
(title and host) and every selector that failed or matched the wrong element.
Fix the selectors and bump the version constant in a follow-up change, citing
that record.

## Do not

- Do not enable any production flag or deploy the production executor until
  steps 1–4 pass.
- Never paste Live View URLs, handoff links or tickets into chat, issues,
  commits or evidence files.
- Keep homologation and production in separate Workers with distinct secrets;
  never reuse a proof or homologation value in production.

## Homologation VM cost

Stop the VM when no one is testing: `deploy/gcp-vm/vm.sh stop` (`start` waits for `/health`, `status` reads it).
The containers and SQLite data come back on boot; the startup script re-runs `docker compose up -d`.
A stopped VM still bills its persistent disk and static IP (~$4/month).
