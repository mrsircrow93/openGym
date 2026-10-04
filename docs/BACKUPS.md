# Backups

Two layers, both automatic once set up:

| Layer | What | Where | Restores |
|---|---|---|---|
| Lightsail snapshots | whole disk, daily | AWS, same account | a new instance from the snapshot (10 min) |
| `scripts/backup.sh` | `data/` only, nightly 03:15 UTC, encrypted | `~/backups` on the server (14 days) **and** S3 when `AWS_BACKUP_BUCKET` is set | one command, see below |

`data/` is everything that matters: `db.json` (accounts, passkeys, tokens, subscriptions), one
`state-<uid>.json` per user, `secret` (signs sessions) and `vapid.json` (push). Media and images
are re-downloaded; code is in git.

## Server side (done 2026-10-01)

- Cron: `15 3 * * * [ -f $HOME/.backup-env ] && . $HOME/.backup-env; $HOME/openGym/scripts/backup.sh >> $HOME/backups/backup.log 2>&1`
  (the `[ -f … ] &&` guard matters: in cron's `sh`, sourcing a missing file aborts the whole line,
  which silently skipped every nightly backup from Oct 2 to Oct 4 2026)
- Passphrase: `~/.backup-pass` on the server, generated on first run. **Keep a copy off the
  server** (password manager). Without it the archives cannot be opened.
- Env lives in `~/.backup-env` (`export AWS_BACKUP_BUCKET=…`); `backup.sh` sources it itself. Off-host copies verified 2026-10-04 (bucket `vantixgym-backups-2026`, us-east-2, versioned, 90-day expiry, IAM user `vantixgym-backup` with PutObject/ListBucket only).

## Off-host copy (S3) — 5 minutes in the AWS console

1. S3 → Create bucket → name `vantixgym-backups-<something unique>`, region us-east-2, Block all
   public access ON (default), Bucket Versioning ON. Create.
2. Lifecycle rule on the bucket: expire objects after 90 days (keeps the bill at cents).
3. IAM → Users → Create user `vantixgym-backup`, no console access → Attach policy inline:
   ```json
   { "Version": "2012-10-17", "Statement": [ { "Effect": "Allow", "Action": ["s3:PutObject", "s3:ListBucket"],
     "Resource": ["arn:aws:s3:::BUCKET", "arn:aws:s3:::BUCKET/*"] } ] }
   ```
   (PutObject only: a stolen key can add backups but not read or delete them.)
4. Security credentials → Create access key (CLI) → copy the two values.
5. On the server:
   ```bash
   # AWS CLI v2 (Ubuntu 24.04+ has no apt package):
   curl -sS https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip -o /tmp/awscliv2.zip && sudo apt-get -y install unzip && unzip -q -o /tmp/awscliv2.zip -d /tmp && sudo /tmp/aws/install
   aws configure   # paste key id + secret, region us-east-2, output json
   echo 'export AWS_BACKUP_BUCKET=BUCKET' > ~/.backup-env   # backup.sh sources this file itself
   ~/openGym/scripts/backup.sh   # first upload, check the log line ends with → s3://…
   ```

## Restore

```bash
# on the server (or any machine with the passphrase)
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in vantixgym-data-YYYYMMDD-HHMMSS.tar.gz.enc -pass file:~/.backup-pass | tar xz -C /tmp/restore
# stop the api, replace data/, start the api
cd ~/openGym && docker compose stop api && rsync -a --delete /tmp/restore/data/ data/ && sudo chown -R 1000:1000 data && docker compose start api
```

Test the restore once a quarter: decrypt the latest archive and check `db.json` parses.
