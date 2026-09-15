#!/usr/bin/env bash
# Private CA and real, unmodified Hermes. All test homes and credentials are disposable.
set -euo pipefail
: "${RUNNER_TEMP:?Requires an isolated CI runner}"
: "${HERMES_TEST_REF:?Requires the upstream pin}"
hermes="$PWD/upstream/.venv/bin/hermes"
test "$(git -C upstream rev-parse HEAD)" = "$HERMES_TEST_REF"
bash scripts/setup-https.sh 127.0.0.1 8790 "$RUNNER_TEMP/tls-gate.env"
export NODE_EXTRA_CA_CERTS="$PWD/.local/tls/ca/ca.crt"
export CUSTOM_API_KEY=phase0-local-test-only CUSTOM_BASE_URL=http://127.0.0.1:9120/v1
node scripts/test-provider.mjs > "$RUNNER_TEMP/tls-provider.log" 2>&1 & provider=$!
backend=''
project="$(mktemp -d "$RUNNER_TEMP/webui-workspace.XXXXXX")"
cleanup() {
  code=$?; trap - EXIT
  docker rm -f webui-https >/dev/null 2>&1 || true
  if [[ -n "$backend" ]]; then kill "$backend" 2>/dev/null || true; wait "$backend" 2>/dev/null || true; fi
  kill "$provider" 2>/dev/null || true; wait "$provider" 2>/dev/null || true
  rm -rf -- "$project"
  exit "$code"
}
trap cleanup EXIT
# This is isolated CI project data, not a Hermes home or operator workspace.
printf 'export const value = 1;\n' > "$project/example.ts"
printf 'PRIVATE_WORKSPACE_CANARY\n' > "$project/.env"
git -C "$project" init -b main >/dev/null
git -C "$project" add example.ts
git -C "$project" -c user.name=Fixture -c user.email=fixture@example.invalid commit -m fixture >/dev/null
printf 'export const value = 2;\n' > "$project/example.ts"
git -C "$project" add example.ts
printf 'export const value = 3;\n' > "$project/example.ts"
ln -s /etc/passwd "$project/blocked-link"
expected="$(sha256sum "$project/.git/index" "$project/example.ts")"
for mode in dashboard trusted-local; do
  export HERMES_HOME; HERMES_HOME="$(mktemp -d "$RUNNER_TEMP/hermes-tls.XXXXXX")"
  unset HERMES_DASHBOARD_BASIC_AUTH_USERNAME HERMES_DASHBOARD_BASIC_AUTH_PASSWORD HERMES_DASHBOARD_BASIC_AUTH_SECRET HERMES_DASHBOARD_SESSION_TOKEN || true
  if [[ "$mode" == dashboard ]]; then
    export HERMES_DASHBOARD_BASIC_AUTH_USERNAME=phase4
    export HERMES_DASHBOARD_BASIC_AUTH_PASSWORD="$(openssl rand -hex 24)"
    export HERMES_DASHBOARD_BASIC_AUTH_SECRET="$(openssl rand -hex 32)"
    echo "::add-mask::$HERMES_DASHBOARD_BASIC_AUTH_PASSWORD"
    echo "::add-mask::$HERMES_DASHBOARD_BASIC_AUTH_SECRET"
    bind=0.0.0.0
  else
    export HERMES_DASHBOARD_SESSION_TOKEN="$(openssl rand -hex 32)"
    echo "::add-mask::$HERMES_DASHBOARD_SESSION_TOKEN"
    bind=127.0.0.1
  fi
  "$hermes" config set model.provider custom
  "$hermes" config set model.default phase0-fixture
  "$hermes" config set model.base_url http://127.0.0.1:9120/v1
  "$hermes" config set model.api_mode chat_completions
  "$hermes" serve --host "$bind" --port 9117 --no-open > "$RUNNER_TEMP/tls-hermes.log" 2>&1 & backend=$!
  for attempt in $(seq 1 90); do
    if curl -fsS http://127.0.0.1:9117/api/status >/dev/null 2>&1; then break; fi
    kill -0 "$backend"; sleep 1
  done
  curl -fsS http://127.0.0.1:9117/api/status >/dev/null
  docker run -d --init --name webui-https --network host --read-only --user "$(id -u):$(id -g)" \
    --tmpfs /tmp:rw,noexec,nosuid,size=16m --cap-drop ALL --security-opt no-new-privileges:true \
    -v "$PWD/.local/tls/server:/run/webui-tls:ro" -v "$project:/workspace:ro" \
    -e WORKSPACE_ROOTS=/workspace -e GIT_ENABLED=true -e WORKSPACE_WRITE_ENABLED=false -e GIT_WRITE_ENABLED=false \
    -e WEBUI_TLS_CERT=/run/webui-tls/server.crt -e WEBUI_TLS_KEY=/run/webui-tls/server.key -e WEBUI_TLS_CA=/run/webui-tls/ca.crt \
    -e "HERMES_AUTH_MODE=$mode" -e "HERMES_DASHBOARD_SESSION_TOKEN=${HERMES_DASHBOARD_SESSION_TOKEN:-}" \
    -e HERMES_DASHBOARD_URL=http://127.0.0.1:9117 -e PUBLIC_ORIGIN=https://127.0.0.1:8790 \
    -e HOST=127.0.0.1 -e PORT=8790 hermes-webui-ng:phase0
  for attempt in $(seq 1 30); do
    if curl --cacert "$NODE_EXTRA_CA_CERTS" -fsS https://127.0.0.1:8790/healthz >/dev/null 2>&1; then break; fi
    sleep 1
  done
  curl --cacert "$NODE_EXTRA_CA_CERTS" -fsS https://127.0.0.1:8790/readyz
  docker exec webui-https node build/server/healthcheck.js
  test "$(docker exec webui-https id -u)" != 0
  PHASE4_TLS_MODE="$mode" node build/tests/integration/tls-live.js
  PHASE4_TLS_MODE="$mode" node build/tests/integration/workspace-live.js
  docker exec webui-https node --input-type=module -e '
    import fs from "node:fs";
    try { fs.writeFileSync("/workspace/write-must-fail", "CI fixture"); process.exit(1); }
    catch (error) { if (!["EROFS", "EACCES"].includes(error.code)) process.exit(2); }
  '
  test "$(sha256sum "$project/.git/index" "$project/example.ts")" = "$expected"
  docker stop --time 10 webui-https >/dev/null
  test "$(docker inspect -f '{{.State.ExitCode}}' webui-https)" = 0
  docker rm webui-https >/dev/null
  # Separate writable deployment, after the original read-only gate has passed.
  printf 'Original writable fixture.\r\n' > "$project/editable.txt"
  docker run -d --init --name webui-https --network host --read-only --user "$(id -u):$(id -g)" \
    --tmpfs /tmp:rw,noexec,nosuid,size=16m --cap-drop ALL --security-opt no-new-privileges:true \
    -v "$PWD/.local/tls/server:/run/webui-tls:ro" -v "$project:/workspace:rw" \
    -e WORKSPACE_ROOTS=/workspace -e GIT_ENABLED=true -e WORKSPACE_WRITE_ENABLED=true -e WORKSPACE_WRITABLE_ROOTS=workspace -e GIT_WRITE_ENABLED=false \
    -e WEBUI_TLS_CERT=/run/webui-tls/server.crt -e WEBUI_TLS_KEY=/run/webui-tls/server.key -e WEBUI_TLS_CA=/run/webui-tls/ca.crt \
    -e "HERMES_AUTH_MODE=$mode" -e "HERMES_DASHBOARD_SESSION_TOKEN=${HERMES_DASHBOARD_SESSION_TOKEN:-}" \
    -e HERMES_DASHBOARD_URL=http://127.0.0.1:9117 -e PUBLIC_ORIGIN=https://127.0.0.1:8790 \
    -e HOST=127.0.0.1 -e PORT=8790 hermes-webui-ng:phase0
  for attempt in $(seq 1 30); do
    if curl --cacert "$NODE_EXTRA_CA_CERTS" -fsS https://127.0.0.1:8790/healthz >/dev/null 2>&1; then break; fi
    sleep 1
  done
  curl --cacert "$NODE_EXTRA_CA_CERTS" -fsS https://127.0.0.1:8790/readyz
  test "$(docker exec webui-https id -u)" != 0
  PHASE4_TLS_MODE="$mode" node build/tests/integration/workspace-write-live.js
  test "$(sha256sum "$project/.git/index" "$project/example.ts")" = "$expected"
  test -z "$(find "$project" -name '.webui-tmp-*' -print -quit)"
  docker stop --time 10 webui-https >/dev/null
  test "$(docker inspect -f '{{.State.ExitCode}}' webui-https)" = 0
  docker rm webui-https >/dev/null
  kill "$backend"; wait "$backend" 2>/dev/null || true; backend=''
done
test -z "$(git -C upstream diff --name-only HEAD)"
