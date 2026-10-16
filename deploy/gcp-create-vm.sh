#!/usr/bin/env bash
# Create the TenderOS demo VM on Google Cloud and install the app. Run in Cloud Shell (or any
# machine with gcloud signed in to the project):
#
#   PROJECT=my-project ADMIN_EMAIL=you@company.com bash deploy/gcp-create-vm.sh
#
# Environment:
#   PROJECT       GCP project id (required)
#   ADMIN_EMAIL   administrator login for the app (required)
#   ZONE          default asia-south1-a (Mumbai)
#   NAME          default tenderos-demo
#   MACHINE       default e2-standard-4 (4 vCPU, 16 GB: sizing a tender takes about a minute)
#   WEB_SOURCES   who may open the site on 443, comma-separated CIDRs (default 0.0.0.0/0;
#                 the app needs a login either way). Port 80 stays open to all so Let's
#                 Encrypt can issue the certificate; Caddy only redirects it to HTTPS.
#   SSH_SOURCES   who may SSH, default 35.235.240.0/20 (IAP: `gcloud compute ssh` from Cloud Shell)
#   SITE_ADDRESS  your domain (its A record must point at the static IP); default <ip>.sslip.io
#   BRANCH        git branch to deploy, default main
#   ANTHROPIC_API_KEY  passed to the VM's .env when set (enables model reading)
set -euo pipefail
: "${PROJECT:?set PROJECT}"
: "${ADMIN_EMAIL:?set ADMIN_EMAIL}"
ZONE="${ZONE:-asia-south1-a}"
REGION="${ZONE%-*}"
NAME="${NAME:-tenderos-demo}"
MACHINE="${MACHINE:-e2-standard-4}"
WEB_SOURCES="${WEB_SOURCES:-0.0.0.0/0}"
SSH_SOURCES="${SSH_SOURCES:-35.235.240.0/20}"
BRANCH="${BRANCH:-main}"
G="gcloud --project $PROJECT --quiet"

$G services enable compute.googleapis.com

echo "==> Static IP"
$G compute addresses describe "$NAME-ip" --region "$REGION" >/dev/null 2>&1 \
  || $G compute addresses create "$NAME-ip" --region "$REGION"
IP="$($G compute addresses describe "$NAME-ip" --region "$REGION" --format='value(address)')"
echo "    $IP"

echo "==> Firewall"
rule() { # name ports sources
  if $G compute firewall-rules describe "$1" >/dev/null 2>&1; then
    $G compute firewall-rules update "$1" --allow "$2" --source-ranges "$3"
  else
    $G compute firewall-rules create "$1" --network default --direction INGRESS \
      --allow "$2" --source-ranges "$3" --target-tags "$NAME"
  fi
}
rule "$NAME-http" tcp:80 0.0.0.0/0
rule "$NAME-https" tcp:443,udp:443 "$WEB_SOURCES"
rule "$NAME-ssh" tcp:22 "$SSH_SOURCES"

echo "==> VM"
if ! $G compute instances describe "$NAME" --zone "$ZONE" >/dev/null 2>&1; then
  $G compute instances create "$NAME" --zone "$ZONE" --machine-type "$MACHINE" \
    --image-family ubuntu-2404-lts-amd64 --image-project ubuntu-os-cloud \
    --boot-disk-size 50GB --boot-disk-type pd-balanced \
    --address "$IP" --tags "$NAME"
  echo "    waiting for SSH"
  for _ in $(seq 1 30); do
    $G compute ssh "$NAME" --zone "$ZONE" --tunnel-through-iap --command true >/dev/null 2>&1 && break
    sleep 10
  done
fi

echo "==> Installing TenderOS"
SITE="${SITE_ADDRESS:-${IP//./-}.sslip.io}"
REMOTE_ENV="ADMIN_EMAIL='$ADMIN_EMAIL' SITE_ADDRESS='$SITE' BRANCH='$BRANCH'"
[ -n "${ANTHROPIC_API_KEY:-}" ] && REMOTE_ENV="$REMOTE_ENV ANTHROPIC_API_KEY='$ANTHROPIC_API_KEY'"
$G compute ssh "$NAME" --zone "$ZONE" --tunnel-through-iap --command \
  "curl -fsSL https://raw.githubusercontent.com/Ergplan/tenderos/$BRANCH/deploy/bootstrap.sh -o /tmp/bootstrap.sh && sudo $REMOTE_ENV bash /tmp/bootstrap.sh"
