#!/usr/bin/env bash
# Move the live openGym instance from this Mac to a prepared Lightsail box (docs/AWS.md §2).
# Usage: scripts/migrate-to-aws.sh <server-ip> <ssh-key.pem> [remote-user]
set -euo pipefail

IP="${1:?server ip}"; KEY="${2:?ssh key}"; USER_="${3:-ubuntu}"
SSH="ssh -i $KEY -o StrictHostKeyChecking=accept-new $USER_@$IP"
RSYNC="rsync -az -e \"ssh -i $KEY -o StrictHostKeyChecking=accept-new\""
HERE="$(cd "$(dirname "$0")/.." && pwd)"
TUNNEL_ID="$(awk '/^tunnel:/{print $2}' ~/.cloudflared/config.yml)"

[ -f "$HERE/.env" ] || { echo ".env not found in $HERE"; exit 1; }
[ -d "$HERE/data" ] || { echo "data/ not found in $HERE"; exit 1; }
[ -f ~/.cloudflared/"$TUNNEL_ID".json ] || { echo "tunnel credentials not found"; exit 1; }

echo "→ Checking the server has docker, cloudflared and the repo…"
$SSH 'command -v docker >/dev/null && command -v cloudflared >/dev/null && [ -d ~/openGym ]' \
  || { echo "server not prepared — run docs/AWS.md §2 first"; exit 1; }

echo "→ Stopping the local stack so data/ is quiescent…"
(cd "$HERE" && docker compose down)

echo "→ Copying .env and data/…"
eval $RSYNC "$HERE/.env" "$USER_@$IP:~/openGym/.env"
eval $RSYNC --delete --exclude "db.backup-*" "$HERE/data/" "$USER_@$IP:~/openGym/data/"

echo "→ Copying the Cloudflare tunnel ($TUNNEL_ID)…"
$SSH 'sudo mkdir -p /etc/cloudflared && sudo chown $USER /etc/cloudflared'
eval $RSYNC ~/.cloudflared/config.yml ~/.cloudflared/"$TUNNEL_ID".json "$USER_@$IP:/etc/cloudflared/"
# The Mac config points at the Mac's home dir and port 8081; rewrite for the server.
$SSH "sed -i -e 's#credentials-file: .*#credentials-file: /etc/cloudflared/$TUNNEL_ID.json#' -e 's#http://localhost:[0-9]*#http://localhost:8081#' /etc/cloudflared/config.yml && sudo chown -R root:root /etc/cloudflared && sudo chmod 600 /etc/cloudflared/*.json"

echo "→ Building and starting the stack on the server (API as uid 1000) — the first build takes a few minutes…"
$SSH 'cd ~/openGym && git pull -q && sudo chown -R 1000:1000 data && grep -q COMPOSE_FILE ~/.bashrc || echo "export COMPOSE_FILE=docker-compose.yml:docker-compose.aws.yml" >> ~/.bashrc'
$SSH 'cd ~/openGym && export COMPOSE_FILE=docker-compose.yml:docker-compose.aws.yml && docker compose up -d --build'

echo "→ Installing cloudflared as a service…"
$SSH 'sudo cloudflared --config /etc/cloudflared/config.yml service install 2>/dev/null || true; sudo systemctl enable --now cloudflared; sudo systemctl restart cloudflared'

echo "→ Waiting for the API…"
for i in $(seq 1 30); do
  $SSH 'curl -sf localhost:8081/api/health' >/dev/null 2>&1 && break
  sleep 2
done
$SSH 'curl -s localhost:8081/api/health'; echo
sleep 5
echo "→ Public check:"
curl -s -o /dev/null -w "https://gym.pentaforge.com.mx -> %{http_code}\n" https://gym.pentaforge.com.mx

cat <<MSG

Done. The site is now served from $IP. On this Mac, stop the local tunnel for good:
  launchctl unload ~/Library/LaunchAgents/com.opengym.cloudflared.plist
Sign in from the phone with your passkey to confirm, then enable daily snapshots in Lightsail
if you haven't (docs/AWS.md §1.7).
MSG
