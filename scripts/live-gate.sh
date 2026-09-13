#!/usr/bin/env bash
# An isolated UPSTREAM test environment, configured exclusively through its CLI.
set -euo pipefail
: "${RUNNER_TEMP:?Run in an isolated CI runner}"
: "${HERMES_TEST_REF:?Set the exact upstream checkout ref}"
hermes="$PWD/upstream/.venv/bin/hermes"
test "$(git -C upstream rev-parse HEAD)" = "$HERMES_TEST_REF"
export HERMES_HOME
HERMES_HOME="$(mktemp -d "$RUNNER_TEMP/hermes-phase0.XXXXXX")"
export HERMES_DASHBOARD_BASIC_AUTH_USERNAME=phase0
export HERMES_DASHBOARD_BASIC_AUTH_PASSWORD
export HERMES_DASHBOARD_BASIC_AUTH_SECRET
HERMES_DASHBOARD_BASIC_AUTH_PASSWORD="$(openssl rand -hex 24)"
HERMES_DASHBOARD_BASIC_AUTH_SECRET="$(openssl rand -hex 32)"
echo "::add-mask::$HERMES_DASHBOARD_BASIC_AUTH_PASSWORD"
echo "::add-mask::$HERMES_DASHBOARD_BASIC_AUTH_SECRET"
provider_pid=''
hermes_pid=''
cleanup() {
  result=$?
  trap - EXIT
  if [ "$result" != 0 ]; then
    tail -n 100 "$RUNNER_TEMP/hermes-phase0.log" || true
    docker logs webui-live || true
  fi
  docker rm -f webui-live >/dev/null 2>&1 || true
  if [ -n "$hermes_pid" ]; then kill "$hermes_pid" 2>/dev/null || true; fi
  if [ -n "$provider_pid" ]; then kill "$provider_pid" 2>/dev/null || true; fi
  exit "$result"
}
trap cleanup EXIT
# These are official Hermes CLI configuration operations, never WebUI filesystem writes.
"$hermes" config set model.provider custom
"$hermes" config set model.default phase0-fixture
"$hermes" config set model.base_url http://127.0.0.1:9120/v1
"$hermes" config set model.api_mode chat_completions
export CUSTOM_API_KEY=phase0-local-test-only
export CUSTOM_BASE_URL=http://127.0.0.1:9120/v1
node scripts/test-provider.mjs > "$RUNNER_TEMP/provider-phase0.log" 2>&1 &
provider_pid=$!
"$hermes" serve --host 0.0.0.0 --port 9119 --no-open > "$RUNNER_TEMP/hermes-phase0.log" 2>&1 &
hermes_pid=$!
for attempt in $(seq 1 120); do
  if curl --fail --silent http://127.0.0.1:9119/api/status >/dev/null; then break; fi
  kill -0 "$hermes_pid"
  sleep 1
done
curl --fail --silent http://127.0.0.1:9119/api/status >/dev/null
# No Hermes home/config/state mount; only the supported HTTP and WS boundary.
docker run -d --name webui-live --network host --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=16m --cap-drop ALL --security-opt no-new-privileges:true \
  -e HERMES_DASHBOARD_URL=http://127.0.0.1:9119 \
  -e PUBLIC_ORIGIN=http://127.0.0.1:8787 hermes-webui-ng:phase0
for attempt in $(seq 1 30); do
  if curl --fail --silent http://127.0.0.1:8787/healthz >/dev/null; then break; fi
  sleep 1
done
curl --fail --silent http://127.0.0.1:8787/readyz
npm run test:live
node build/tests/integration/phase1.js
node build/tests/integration/phase2.js
node build/tests/integration/phase3.js
# Tests may create upstream state; they must never alter tracked upstream source.
test -z "$(git -C upstream diff --name-only HEAD)"
