# Moving the live instance to AWS (Lightsail)

Decision (2026-09-29): the production instance leaves the Mac and runs on an AWS Lightsail
box before any billing work starts. Reasons: the site must not depend on a laptop being
awake, Stripe webhooks need a server that is always reachable, daily snapshots replace the
missing backup, and progress photos (ROADMAP phase 4) will land in S3 in the same account.

The stack does not change: same `docker-compose.yml`, same `.env`, same Cloudflare Tunnel and
therefore the same hostname. Because `RP_ID` stays `gym.pentaforge.com.mx`, every existing
passkey keeps working. Nothing is exposed on a public port; all traffic enters through the tunnel.

## 1. Create the instance (10 minutes, AWS console)

1. Lightsail → Create instance → Linux/Unix → **Ubuntu 24.04 LTS** (OS only).
2. Region **us-east-1 (N. Virginia)** or **us-west-2 (Oregon)**. There is no Mexico region;
   both give ~60-90 ms from Mexico City.
3. Plan **2 GB RAM / 2 vCPU / 60 GB SSD** (about US$12/month). The 1 GB plan runs the app but
   the Docker build of the web image can run out of memory — pick 2 GB and stop thinking about it.
4. Name it `opengym`. Create.
5. Networking tab → **Attach a static IP** (free while attached).
6. Networking tab → Firewall: leave only **SSH (22)**. Do **not** open 80/443/8081 — the
   tunnel brings traffic in, nothing listens publicly.
7. Snapshots tab → **Enable automatic snapshots** (daily). This is the backup of `data/`.

## 2. Prepare the box (10 minutes, one SSH session)

Download the default SSH key from the Lightsail account page, then:

```bash
chmod 600 ~/Downloads/LightsailDefaultKey-us-east-1.pem
ssh -i ~/Downloads/LightsailDefaultKey-us-east-1.pem ubuntu@<STATIC_IP>
```

On the server, paste the whole block:

```bash
sudo apt-get update && sudo apt-get -y upgrade
# Docker (official repo, includes compose v2)
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
sudo apt-get update && sudo apt-get -y install docker-ce docker-ce-cli containerd.io docker-compose-plugin git
sudo usermod -aG docker ubuntu
# cloudflared
sudo mkdir -p --mode=0755 /usr/share/keyrings
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main" | sudo tee /etc/apt/sources.list.d/cloudflared.list
sudo apt-get update && sudo apt-get -y install cloudflared
# unattended security updates
sudo apt-get -y install unattended-upgrades && sudo dpkg-reconfigure -plow unattended-upgrades
git clone https://github.com/mrsircrow93/openGym.git ~/openGym
exit
```

Log back in (so the `docker` group applies) and continue with step 3.

## 3. Move the data and the tunnel (from the Mac)

`scripts/migrate-to-aws.sh` does this in one go. It stops the containers on the Mac so no
write can land in `data/` mid-copy, rsyncs `.env`, `data/` and the tunnel credentials, and
starts the stack on the server.

```bash
scripts/migrate-to-aws.sh <STATIC_IP> ~/Downloads/LightsailDefaultKey-us-east-1.pem
```

What it copies:

| From (Mac)                                   | To (server)                          | Why |
|----------------------------------------------|--------------------------------------|-----|
| `~/openGym/.env`                             | `~/openGym/.env`                     | keys, caps, `RP_ID`, `ORIGIN` |
| `~/openGym/data/`                            | `~/openGym/data/`                    | accounts, passkeys, histories, session secret |
| `~/.cloudflared/config.yml` + tunnel `.json` | `/etc/cloudflared/`                  | the same tunnel, so DNS and the hostname don't change |

Then on the server it runs `docker compose up -d --build`, installs
cloudflared as a systemd service (`cloudflared service install`) and checks `/api/health`.

The media folder (`media/img`, `media/gif`, ~140 MB) is **not** copied — the `media` service
in compose downloads it on first start.

## 4. Verify, then switch off the Mac copy

```bash
curl -s https://gym.pentaforge.com.mx/api/health      # {"ok":true} — now served from AWS
```

Open the app on the phone and sign in with the passkey. If that works the migration is done.

On the Mac:

```bash
launchctl unload ~/Library/LaunchAgents/com.opengym.cloudflared.plist   # stop the local tunnel for good
cd ~/openGym && docker compose down                                       # the script already did this
```

Keep `~/openGym` on the Mac as the development checkout; it just stops serving.

## 5. Run the API without root (Linux only)

On Docker Desktop the API container had to stay root (see `api/Dockerfile`). On the Linux
box it doesn't. The migration script applies `docker-compose.aws.yml`, which adds
`user: "1000:1000"` to the API service and matches the ownership of `data/`:

```bash
sudo chown -R 1000:1000 ~/openGym/data
docker compose -f docker-compose.yml -f docker-compose.aws.yml up -d
```

Use both `-f` flags for every future `up`/`pull` on the server (or export
`COMPOSE_FILE=docker-compose.yml:docker-compose.aws.yml` in `~/.bashrc`, which the script does).

## 6. Updating the server later

```bash
ssh ubuntu@<STATIC_IP>
cd ~/openGym && git pull && docker compose up -d --build
```

Or, to avoid building on the small box, build the images here and push them to GHCR (the
compose file already names `ghcr.io/duartesantos8/opengym-*:latest`), then `docker compose pull
&& docker compose up -d` on the server.

## 7. Cost

| Item | Monthly |
|------|--------:|
| Lightsail 2 GB instance | US$12 |
| Static IP (attached) | 0 |
| Automatic snapshots (~60 GB × US$0.05/GB, incremental so usually much less) | ≤ 3 |
| Cloudflare Tunnel | 0 |
| Data transfer (2 TB included) | 0 |

Roughly US$15/month, fixed. It can be moved to a reserved EC2 instance later if it ever
matters; nothing in the setup ties it to Lightsail.

## 8. What comes next (why this unblocks the backlog)

- **Backups**: daily snapshots cover `data/`. `docs/SELF_HOSTING.md` §5 still applies for an
  off-account copy (a nightly `tar` of `data/` to S3 is a five-line cron; add it before billing).
- **Billing** (BACKLOG #7-9): Stripe webhooks need a stable, always-on HTTPS endpoint. That is
  now `https://gym.pentaforge.com.mx/api/billing/webhook` behind the tunnel.
- **Transactional email** (BACKLOG #6): Resend or SES. SES is in the same account and cheaper;
  either way the DNS records go in the Cloudflare zone.
- **Progress photos** (ROADMAP phase 4): S3 bucket in the same region with an IAM user scoped
  to that bucket; the API signs uploads.
