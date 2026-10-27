#!/usr/bin/env bash
# GCE startup script: Docker + the tax homologation stack. Idempotent; runs on every boot.
set -euo pipefail
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh
fi
md() { curl -fsH 'Metadata-Flavor: Google' "http://metadata.google.internal/computeMetadata/v1/instance/attributes/$1"; }
mkdir -p /srv/tax/stack /srv/tax/data/api /srv/tax/data/boundary /srv/tax/caddy
chown -R 1000:1000 /srv/tax/data
md compose > /srv/tax/stack/compose.yaml
md caddyfile > /srv/tax/stack/Caddyfile
md fetch-secrets > /srv/tax/stack/fetch-secrets.sh && chmod +x /srv/tax/stack/fetch-secrets.sh
/srv/tax/stack/fetch-secrets.sh
cat > /srv/tax/stack/.env <<ENV
REGISTRY=$(md registry)
TAG=$(md tag)
TAX_HOST=$(md tax-host)
BOUNDARY_HOST=$(md boundary-host)
ENV
gcloud auth configure-docker "$(md registry | cut -d/ -f1)" --quiet
cd /srv/tax/stack && docker compose pull && docker compose up -d
