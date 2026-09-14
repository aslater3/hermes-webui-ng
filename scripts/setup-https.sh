#!/usr/bin/env bash
# Generate an operator-owned private CA and server certificate; never touch Hermes config.
set -euo pipefail
umask 077
address="${1:?Usage: bash scripts/setup-https.sh HOST [PORT=8788] [WEBUI_ENV=.env]}"
port="${2:-8788}"; envfile="${3:-.env}"
command -v openssl >/dev/null || { echo 'OpenSSL is required on the host; no runtime image installation is needed.' >&2; exit 1; }
[[ "$address" =~ ^[A-Za-z0-9][A-Za-z0-9.:-]*$ || "$address" == ::1 ]] || { echo 'Use a bare IP or DNS hostname, without scheme/path.' >&2; exit 1; }
[[ "$port" =~ ^[0-9]{1,5}$ ]] && ((10#$port >= 1024 && 10#$port <= 65535)) || { echo 'Use a port between 1024 and 65535.' >&2; exit 1; }
[[ ! -L "$envfile" && (! -e "$envfile" || -f "$envfile") ]] || { echo 'Refusing a symlink or non-file environment target.' >&2; exit 1; }
root="$PWD/.local/tls"; mkdir -p "$root/ca" "$root/server"
mkdir "$root/.lock" 2>/dev/null || { echo 'Certificate generation is already locked.' >&2; exit 1; }
tmp="$(mktemp -d "$root/.generate.XXXXXX")"
trap 'rm -rf "$tmp"; rmdir "$root/.lock"' EXIT
if [[ ! -f "$root/ca/ca.crt" && ! -f "$root/ca/ca.key" ]]; then
  openssl req -x509 -newkey rsa:3072 -nodes -sha256 -days 3650 -keyout "$tmp/ca.key" -out "$tmp/ca.crt" \
    -subj '/CN=HermesUI NG local CA' -addext 'basicConstraints=critical,CA:TRUE,pathlen:0' \
    -addext 'keyUsage=critical,keyCertSign,cRLSign' >/dev/null 2>&1
  install -m 600 "$tmp/ca.key" "$root/ca/ca.key"
  install -m 644 "$tmp/ca.crt" "$root/ca/ca.crt"
fi
[[ -f "$root/ca/ca.key" && -f "$root/ca/ca.crt" ]] || { echo 'Incomplete CA; restore the missing file rather than replacing device trust.' >&2; exit 1; }
openssl x509 -in "$root/ca/ca.crt" -checkend 31622400 -noout >/dev/null || { echo 'CA expires within a year; rotate trust deliberately.' >&2; exit 1; }
if [[ "$address" == *:* || "$address" =~ ^[0-9.]+$ ]]; then san="IP:$address"; else san="DNS:$address"; fi
cat > "$tmp/extensions" <<EXT
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=$san,DNS:localhost,IP:127.0.0.1,IP:::1
EXT
openssl req -new -newkey rsa:2048 -nodes -sha256 -keyout "$tmp/server.key" -out "$tmp/server.csr" -subj '/CN=HermesUI NG' >/dev/null 2>&1
openssl x509 -req -in "$tmp/server.csr" -CA "$root/ca/ca.crt" -CAkey "$root/ca/ca.key" \
  -set_serial "0x$(openssl rand -hex 16)" -days 365 -sha256 -extfile "$tmp/extensions" -out "$tmp/server.crt" >/dev/null 2>&1
openssl verify -CAfile "$root/ca/ca.crt" "$tmp/server.crt" >/dev/null
install -m 600 "$tmp/server.key" "$root/server/server.key"
install -m 644 "$tmp/server.crt" "$root/server/server.crt"
install -m 644 "$root/ca/ca.crt" "$root/server/ca.crt"
uid="$(id -u)"; gid="$(id -g)"
if [[ "$uid" == 0 ]]; then uid=10001; gid=10001; chown -R "$uid:$gid" "$root/server"; fi
# Preserve every existing setting (including the upstream token); do not source or print .env.
if [[ -f "$envfile" ]]; then
  install -m 600 "$envfile" "$root/env-backup.$(date +%s).$$"
  awk '!/^(PUBLIC_ORIGIN|WEBUI_PORT|WEBUI_HOST|WEBUI_UID|WEBUI_GID|WEBUI_TLS_DIR)=/' "$envfile" > "$tmp/env"
else : > "$tmp/env"; fi
urlhost="$address"; [[ "$address" != *:* ]] || urlhost="[$address]"
printf '\nPUBLIC_ORIGIN=https://%s:%s\nWEBUI_PORT=%s\nWEBUI_HOST=0.0.0.0\nWEBUI_UID=%s\nWEBUI_GID=%s\nWEBUI_TLS_DIR=./.local/tls/server\n' "$urlhost" "$port" "$port" "$uid" "$gid" >> "$tmp/env"
install -m 600 "$tmp/env" "$envfile"
echo "HTTPS prepared: https://$urlhost:$port (LAN listener; authentication mode unchanged)."
echo 'Install ONLY .local/tls/ca/ca.crt on your devices and explicitly trust it.'
echo 'Never share ca.key or server.key. Rebuild/recreate the existing NG Compose project; do not touch the legacy service.'
openssl x509 -in "$root/ca/ca.crt" -noout -fingerprint -sha256
