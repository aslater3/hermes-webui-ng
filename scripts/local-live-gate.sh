#!/usr/bin/env bash
# Isolated local-mode acceptance; never inspect or modify an operator's Hermes home.
set -euo pipefail
: "${RUNNER_TEMP:?Requires an isolated CI runner}"
: "${HERMES_TEST_REF:?Requires the exact upstream pin}"
hermes="$PWD/upstream/.venv/bin/hermes"
test "$(git -C upstream rev-parse HEAD)" = "$HERMES_TEST_REF"
export HERMES_HOME
HERMES_HOME="$(mktemp -d "$RUNNER_TEMP/hermes-local.XXXXXX")"
export HERMES_DASHBOARD_SESSION_TOKEN
HERMES_DASHBOARD_SESSION_TOKEN="$(openssl rand -hex 32)"
echo "::add-mask::$HERMES_DASHBOARD_SESSION_TOKEN"
provider_pid=''; hermes_pid=''
cleanup() {
  result=$?
  trap - EXIT
  if [ "$result" != 0 ]; then
    # The generated credential is masked above; retain no raw logs as artifacts.
    tail -n 50 "$RUNNER_TEMP/hermes-local.log" || true
    docker logs webui-local-live || true
  fi
  docker rm -f webui-local-live >/dev/null 2>&1 || true
  if [ -n "$hermes_pid" ]; then kill "$hermes_pid" 2>/dev/null || true; wait "$hermes_pid" 2>/dev/null || true; fi
  if [ -n "$provider_pid" ]; then kill "$provider_pid" 2>/dev/null || true; wait "$provider_pid" 2>/dev/null || true; fi
  exit "$result"
}
trap cleanup EXIT
"$hermes" config set model.provider custom
"$hermes" config set model.default phase0-fixture
"$hermes" config set model.base_url http://127.0.0.1:9120/v1
"$hermes" config set model.api_mode chat_completions
export CUSTOM_API_KEY=phase0-local-test-only CUSTOM_BASE_URL=http://127.0.0.1:9120/v1
node scripts/test-provider.mjs > "$RUNNER_TEMP/provider-local.log" 2>&1 & provider_pid=$!
"$hermes" serve --host 127.0.0.1 --port 9118 --no-open > "$RUNNER_TEMP/hermes-local.log" 2>&1 & hermes_pid=$!
for attempt in $(seq 1 120); do
  if curl --fail --silent http://127.0.0.1:9118/api/status >/dev/null; then break; fi
  kill -0 "$hermes_pid"; sleep 1
done
curl --fail --silent http://127.0.0.1:9118/api/status >/dev/null
docker run -d --init --name webui-local-live --network host --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=16m --cap-drop ALL --security-opt no-new-privileges:true \
  -e HERMES_AUTH_MODE=trusted-local -e HERMES_DASHBOARD_SESSION_TOKEN \
  -e HERMES_DASHBOARD_URL=http://127.0.0.1:9118 -e PUBLIC_ORIGIN=http://127.0.0.1:8789 \
  -e PORT=8789 -e HOST=127.0.0.1 hermes-webui-ng:phase0
for attempt in $(seq 1 30); do
  if curl --fail --silent http://127.0.0.1:8789/healthz >/dev/null; then break; fi
  sleep 1
done
curl --fail --silent http://127.0.0.1:8789/readyz
node build/tests/integration/local-live.js
PHASE4B_LOCAL=true node build/tests/integration/phase4b.js
test -z "$(git -C upstream diff --name-only HEAD)"
