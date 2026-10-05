#!/usr/bin/env bash
# Nightly backup of data/ (accounts, passkeys, histories, session secret, VAPID key).
#   - tar + gzip, encrypted with a passphrase (age-style symmetric via openssl, AES-256, PBKDF2)
#   - keeps the last 14 days in ~/backups
#   - if AWS_BACKUP_BUCKET is set (and the aws CLI is installed and authorised), copies the
#     archive to s3://$AWS_BACKUP_BUCKET/vantixgym/ as the off-host copy (docs/BACKUPS.md)
# Restore: openssl enc -d -aes-256-cbc -pbkdf2 -in FILE.tar.gz.enc -pass file:~/.backup-pass | tar xz -C ~/openGym
set -euo pipefail
# cron runs with a minimal PATH; the AWS CLI v2 installer puts `aws` in /usr/local/bin
export PATH="/usr/local/bin:/usr/bin:/bin:$PATH"
# off-host settings live in ~/.backup-env (AWS_BACKUP_BUCKET=…); sourced here so neither the
# cron line nor a shell has to export anything
[ -f "$HOME/.backup-env" ] && . "$HOME/.backup-env"
export AWS_BACKUP_BUCKET="${AWS_BACKUP_BUCKET:-}"
APP="${APP_DIR:-$HOME/openGym}"
OUT="${BACKUP_DIR:-$HOME/backups}"
PASS="${BACKUP_PASS_FILE:-$HOME/.backup-pass}"
KEEP_DAYS="${KEEP_DAYS:-14}"
mkdir -p "$OUT"; chmod 700 "$OUT"
[ -s "$PASS" ] || { umask 077; openssl rand -base64 48 > "$PASS"; echo "new passphrase written to $PASS — copy it somewhere safe, backups are useless without it"; }
STAMP="$(date -u +%Y%m%d-%H%M%S)"
FILE="$OUT/vantixgym-data-$STAMP.tar.gz.enc"
# consistent copy: the API writes atomically (tmp + rename), so a plain tar of the directory is safe
tar -C "$APP" -czf - data | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass "file:$PASS" -out "$FILE"
chmod 600 "$FILE"
# marker the admin console reads (data/ is inside the archive path, written after the tar so it describes the previous run on the next backup)
MARK="$APP/data/.last-backup"
find "$OUT" -name 'vantixgym-data-*.tar.gz.enc' -mtime +"$KEEP_DAYS" -delete
if [ -n "${AWS_BACKUP_BUCKET:-}" ] && command -v aws >/dev/null; then
  aws s3 cp --only-show-errors --storage-class STANDARD_IA "$FILE" "s3://$AWS_BACKUP_BUCKET/vantixgym/$(basename "$FILE")"
  echo "$(date -u +%FT%TZ) ok $(basename "$FILE") $(du -h "$FILE" | cut -f1) → s3://$AWS_BACKUP_BUCKET"
  printf '{"at":"%s","file":"%s","bytes":%s,"s3":true}\n' "$(date -u +%FT%TZ)" "$(basename "$FILE")" "$(stat -c %s "$FILE")" > "$MARK" 2>/dev/null || true
else
  echo "$(date -u +%FT%TZ) ok $(basename "$FILE") $(du -h "$FILE" | cut -f1) (local only — set AWS_BACKUP_BUCKET for the off-host copy)"
  printf '{"at":"%s","file":"%s","bytes":%s,"s3":false}\n' "$(date -u +%FT%TZ)" "$(basename "$FILE")" "$(stat -c %s "$FILE")" > "$MARK" 2>/dev/null || true
fi
