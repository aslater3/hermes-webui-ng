#!/usr/bin/env bash
# Disposable CI OS account + external skill; never writes an operator's Hermes home.
set -euo pipefail
: "${RUNNER_TEMP:?Requires an isolated CI runner}"
: "${HERMES_TEST_REF:?Requires exact upstream ref}"
test "$(git -C upstream rev-parse HEAD)" = "$HERMES_TEST_REF"
mode="${1:-dashboard}"; test "$mode" = dashboard || test "$mode" = trusted-local
account=hermes-m3
if id "$account" >/dev/null 2>&1; then echo 'Refusing to reuse an existing test account'; exit 1; fi
lab="$(mktemp -d /tmp/hermes-m3-XXXXXXXX)"
export HERMES_M3_LAB="$lab"
hermes="$PWD/upstream/.venv/bin/hermes"
export HERMES_M3_PASSWORD="$(openssl rand -hex 16)" HERMES_M3_SECRET="$(openssl rand -hex 20)"
export HERMES_DASHBOARD_BASIC_AUTH_USERNAME=m3-fixture
export HERMES_DASHBOARD_BASIC_AUTH_PASSWORD="$(openssl rand -hex 20)"
export HERMES_DASHBOARD_BASIC_AUTH_SECRET="$(openssl rand -hex 32)"
export HERMES_DASHBOARD_SESSION_TOKEN="$(openssl rand -hex 32)"
for name in HERMES_M3_PASSWORD HERMES_M3_SECRET HERMES_DASHBOARD_BASIC_AUTH_PASSWORD HERMES_DASHBOARD_BASIC_AUTH_SECRET HERMES_DASHBOARD_SESSION_TOKEN; do echo "::add-mask::${!name}"; done
provider_pid=''; hermes_pid=''; created=false
cleanup() {
  result=$?; trap - EXIT
  docker logs webui-m3 2>/dev/null | tail -n 8 || true
  docker rm -f webui-m3 >/dev/null 2>&1 || true
  if [ -n "$hermes_pid" ]; then sudo kill "$hermes_pid" 2>/dev/null || true; fi
  if [ "$created" = true ]; then sudo pkill -u "$account" || true; for attempt in $(seq 1 30); do if ! pgrep -u "$account" >/dev/null; then break; fi; sleep 0.1; done; sudo pkill -KILL -u "$account" || true; if [ -n "$hermes_pid" ]; then wait "$hermes_pid" 2>/dev/null || true; fi; sudo rm -f /etc/sudoers.d/hermes-m3-fixture; sudo userdel "$account" || true; fi
  if [ -n "$provider_pid" ]; then kill "$provider_pid" 2>/dev/null || true; wait "$provider_pid" 2>/dev/null || true; fi
  sudo rm -rf -- "$lab"
  exit "$result"
}
trap cleanup EXIT
sudo useradd --no-create-home --home-dir "$lab/home" --shell /bin/bash "$account"; created=true
printf '%s:%s\n' "$account" "$HERMES_M3_PASSWORD" | sudo chpasswd
printf 'Defaults:%s timestamp_timeout=0\n%s ALL=(root) PASSWD: /usr/bin/id\n' "$account" "$account" | sudo tee /etc/sudoers.d/hermes-m3-fixture >/dev/null
sudo chmod 0440 /etc/sudoers.d/hermes-m3-fixture
sudo visudo -cf /etc/sudoers.d/hermes-m3-fixture
mkdir -p "$lab/home" "$lab/allow-target" "$lab/deny-target" "$lab/expire-target"
printf 'only a disposable fixture\n' > "$lab/allow-target/canary"
printf 'only a disposable fixture\n' > "$lab/deny-target/canary"
printf 'only a disposable fixture\n' > "$lab/expire-target/canary"
sudo chown -R "$account:$account" "$lab"; sudo chmod 0755 "$lab"
for target in "$hermes" "$(readlink -f upstream/.venv/bin/python)"; do
  dir="$(dirname "$target")"; while [ "$dir" != / ]; do sudo chmod o+x "$dir"; dir="$(dirname "$dir")"; done
done
common=(env "HOME=$lab/home" "HERMES_HOME=$lab/home/.hermes" "HERMES_INTERACTIVE=1" "CUSTOM_API_KEY=phase0-local-test-only" "CUSTOM_BASE_URL=http://127.0.0.1:9120/v1")
cli() { sudo -u "$account" "${common[@]}" "$hermes" "$@"; }
cli config set model.provider custom
cli config set model.default phase0-fixture
cli config set model.base_url http://127.0.0.1:9120/v1
cli config set model.api_mode chat_completions
cli config set approvals.mode manual
cli config set approvals.timeout 8
cli config set skills.external_dirs "[\"$PWD/tests/integration/skills\"]"
node scripts/test-provider.mjs > "$RUNNER_TEMP/m3-provider-$mode.log" 2>&1 & provider_pid=$!
if [ "$mode" = dashboard ]; then
  launch=("HERMES_DASHBOARD_BASIC_AUTH_USERNAME=$HERMES_DASHBOARD_BASIC_AUTH_USERNAME" "HERMES_DASHBOARD_BASIC_AUTH_PASSWORD=$HERMES_DASHBOARD_BASIC_AUTH_PASSWORD" "HERMES_DASHBOARD_BASIC_AUTH_SECRET=$HERMES_DASHBOARD_BASIC_AUTH_SECRET")
  bind=0.0.0.0; container_auth=()
else
  launch=("HERMES_DASHBOARD_SESSION_TOKEN=$HERMES_DASHBOARD_SESSION_TOKEN"); bind=127.0.0.1; container_auth=(-e HERMES_DASHBOARD_SESSION_TOKEN)
fi
sudo -u "$account" "${common[@]}" "${launch[@]}" "$hermes" serve --host "$bind" --port 9117 --no-open > "$RUNNER_TEMP/m3-hermes-$mode.log" 2>&1 & hermes_pid=$!
for attempt in $(seq 1 100); do
  if curl -fsS http://127.0.0.1:9117/api/status >/dev/null 2>&1; then break; fi
  kill -0 "$hermes_pid"; sleep 1
done
curl -fsS http://127.0.0.1:9117/api/status >/dev/null
docker run -d --init --name webui-m3 --network host --read-only --tmpfs /tmp:rw,noexec,nosuid,size=16m \
 --cap-drop ALL --security-opt no-new-privileges:true -e PORT=8790 -e HOST=127.0.0.1 \
 -e PUBLIC_ORIGIN=http://127.0.0.1:8790 -e HERMES_DASHBOARD_URL=http://127.0.0.1:9117 \
 -e HERMES_AUTH_MODE="$mode" "${container_auth[@]}" hermes-webui-ng:phase0
for attempt in $(seq 1 30); do if curl -fsS http://127.0.0.1:8790/readyz >/dev/null 2>&1; then break; fi; sleep 1; done
HERMES_M3_MODE="$mode" node build/tests/integration/phase3-full.js
test -z "$(git -C upstream diff --name-only HEAD)"
