#!/usr/bin/env bash
# Start, stop or inspect the homologation VM. Stop it when nobody is testing.
# The containers come back on boot: startup.sh is the GCE startup script, which
# runs on every boot and re-runs `docker compose up -d` (restart: unless-stopped).
set -euo pipefail
PROJECT="${PROJECT:-bufi-vertex-ocr}"
ZONE="${ZONE:-us-central1-a}"
VM="${VM:-tax-homologation}"
HEALTH_URL="${HEALTH_URL:-https://tax.104-154-28-207.sslip.io/health}"
WAIT_SECONDS="${WAIT_SECONDS:-180}"
gc() { gcloud compute instances "$@" "$VM" --project="$PROJECT" --zone="$ZONE"; }

case "${1:-}" in
  start)
    gc start
    deadline=$((SECONDS + WAIT_SECONDS))
    while ((SECONDS < deadline)); do
      # Any HTTP status means the app (via Caddy) answered; 000 is a connection error.
      code=$(curl -s -o /dev/null -m 5 -w '%{http_code}' "$HEALTH_URL" || true)
      if [[ "$code" != "000" && -n "$code" ]]; then
        echo "ready: $HEALTH_URL -> HTTP $code"
        exit 0
      fi
      sleep 5
    done
    echo "not ready after ${WAIT_SECONDS}s: $HEALTH_URL" >&2
    exit 1
    ;;
  stop)
    gc stop
    ;;
  status)
    gc describe --format='value(status)'
    ;;
  *)
    echo "usage: $0 start|stop|status" >&2
    exit 2
    ;;
esac
