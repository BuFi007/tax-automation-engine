#!/usr/bin/env bash
# Writes /srv/tax/env/{api,boundary}.env from Secret Manager secrets named
# tax-homologation-<service>-env (each one is a whole KEY=value file). Runs on
# the VM with its service account; values never touch the repo or the logs.
set -euo pipefail
mkdir -p /srv/tax/env && chmod 700 /srv/tax/env
for service in api boundary; do
  gcloud secrets versions access latest --secret "tax-homologation-${service}-env" > "/srv/tax/env/${service}.env"
  chmod 600 "/srv/tax/env/${service}.env"
done
