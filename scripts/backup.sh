#!/usr/bin/env bash
# Nightly backup of data/ (accounts, passkeys, histories, session secret, VAPID key).
#   - tar + gzip, encrypted with a passphrase (age-style symmetric via openssl, AES-256, PBKDF2)
#   - keeps the last 14 days in ~/backups
#   - if AWS_BACKUP_BUCKET is set (and the aws CLI is installed and authorised), copies the
#     archive to s3://$AWS_BACKUP_BUCKET/vantixgym/ as the off-host copy (docs/BACKUPS.md)
# Restore: openssl enc -d -aes-256-cbc -pbkdf2 -in FILE.tar.gz.enc -pass file:~/.backup-pass | tar xz -C ~/openGym
set -euo pipefail
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
find "$OUT" -name 'vantixgym-data-*.tar.gz.enc' -mtime +"$KEEP_DAYS" -delete
if [ -n "${AWS_BACKUP_BUCKET:-}" ] && command -v aws >/dev/null; then
  aws s3 cp --only-show-errors --storage-class STANDARD_IA "$FILE" "s3://$AWS_BACKUP_BUCKET/vantixgym/$(basename "$FILE")"
  echo "$(date -u +%FT%TZ) ok $(basename "$FILE") $(du -h "$FILE" | cut -f1) → s3://$AWS_BACKUP_BUCKET"
else
  echo "$(date -u +%FT%TZ) ok $(basename "$FILE") $(du -h "$FILE" | cut -f1) (local only — set AWS_BACKUP_BUCKET for the off-host copy)"
fi
