# Upgrade, rollback, Hermes re-certification and recovery

This guide is for an operator running HermesUI NG from a deployment checkout with Docker Compose. Paths and names are placeholders:

- `<deploy-checkout>`: the Git checkout that holds `compose.yaml`, `compose.host.yaml`, the `.env` file and `.local/`.
- `<project>`: the Compose project name already used by the running WebUI. Reuse it. Do not start a second project.
- `<host>` and `<port>`: the WebUI address and HTTPS port from `PUBLIC_ORIGIN`.

Never reset the checkout, overwrite `.env`, delete `.local/` (it holds the private CA) or touch any separate legacy service or Docker data root. Do not paste hostnames, IP addresses, serials or secrets into tickets or evidence.

## 1. Before every upgrade

1. Read the release notes or the commit log for the target. Check whether the Compose files, `Dockerfile` or `.env.example` changed. If they did, add any new variable to your `.env` before building.
2. Confirm the Hermes ref you run is the certified ref in the README **Compatibility** section. If the target release certifies a different ref, plan the Hermes upgrade first (section 4).
3. Check the checkout is clean:

   ```sh
   cd <deploy-checkout>
   git status --short        # expect no tracked changes you did not make
   ```

4. Back up `.env` and the CA directory to a private location outside the checkout:

   ```sh
   install -m 600 .env <private-backup-dir>/env.$(date +%Y%m%d)
   tar -C .local -czf <private-backup-dir>/local-tls.$(date +%Y%m%d).tgz tls
   ```

## 2. Upgrade

```sh
cd <deploy-checkout>

# 1. Fetch the target. Use a release tag when one exists; otherwise origin/main.
git fetch --tags origin
git pull --ff-only origin main        # or: git checkout <release-tag>

# 2. Keep the current image as a rollback point BEFORE rebuilding.
#    compose.host.yaml and compose.yaml both build hermes-webui-ng:phase0.
docker tag hermes-webui-ng:phase0 hermes-webui-ng:rollback-$(date +%Y%m%d)

# 3. Build and start with the SAME Compose files you used before.
docker compose -p <project> -f compose.host.yaml build
docker compose -p <project> -f compose.host.yaml up -d
```

Use exactly the same file set as the running deployment. For bridge networking, use `compose.yaml`. If you use a workspace override, add it in the same way, for example `-f compose.workspace.yaml`, or `-f compose.workspace-write.yaml` instead of the read-only one. Never combine two base files.

If the build fails, the rollback tag is still present and the running container is unchanged until `up -d` succeeds. Check the build log, fix the cause, and retry.

## 3. Verify

Use the local CA that the setup script created. Replace `<host>` and `<port>` with the values in `PUBLIC_ORIGIN`. The `Host` header must equal `PUBLIC_ORIGIN`'s host and port, otherwise the BFF returns `ORIGIN_REJECTED`. The URL host and port already produce this header in the examples below.

```sh
CA=<deploy-checkout>/.local/tls/ca/ca.crt
BASE=https://<host>:<port>

# Process is alive (no upstream dependency). Expect HTTP 200 and {"ok":true,...}.
curl --fail --silent --show-error --cacert "$CA" "$BASE/healthz"

# Upstream state. Expect 200 in dashboard mode when Hermes is reachable and gated;
# 503 means the WebUI is up but Hermes is unreachable or not gated. Diagnostics still work.
curl --silent --show-error --cacert "$CA" -o /dev/null -w '%{http_code}\n' "$BASE/readyz"

# Access mode. Expect 200 with the access mode the deployment is configured for.
curl --fail --silent --show-error --cacert "$CA" "$BASE/api/webui/access"

# Proxied upstream status. Expect an upstream response through the same-origin proxy.
# In dashboard mode an unauthenticated call is refused by Hermes (401/403); that shows the proxy
# reaches Hermes. A connection or TLS error is a failure. In trusted-local mode expect 200.
curl --silent --show-error --cacert "$CA" -o /dev/null -w '%{http_code}\n' "$BASE/__hermes/api/status"

# Container health as Docker sees it.
docker compose -p <project> -f compose.host.yaml ps
```

Then open the exact HTTPS origin in a browser, sign in through Hermes, send a short test prompt and reload the page. On a phone, reopen the installed app once after the update so the new shell is fetched.

## 4. Roll back

Use the rollback tag if the new image misbehaves. This does not touch `.env`, the CA or the project data.

```sh
cd <deploy-checkout>
docker tag hermes-webui-ng:rollback-<date> hermes-webui-ng:phase0
docker compose -p <project> -f compose.host.yaml up -d --no-build
```

`--no-build` makes Compose use the restored image. Run the section 3 checks again.

If the Compose files or `Dockerfile` changed in the failed release and the old image alone is not enough, also return the checkout to the previous commit (`git checkout <previous-commit>`) before `up -d --no-build`. Record the commit you deployed so this is possible.

Rollback restores code only. Persistent Hermes data is owned by Hermes and is unaffected. Unsaved workspace edits and unacknowledged writes are not replayed by a rollback (see section 6).

## 5. When the Hermes upstream is upgraded

NG is certified against one pinned upstream commit at a time. A newer Hermes is **not certified** until the pinned workflow passes on it. A passing upstream source review is not certification.

Procedure, summarised from the recertification in PR #39 (`docs/implementation-status.md`, "Upstream recertification — 20 October 2026"):

1. Choose the target commit and inspect its public REST and JSON-RPC contracts before changing code: `hermes_cli/web_routers/*.py`, `tui_gateway/contracts/*.py`, the Dashboard auth routes and the Gateway methods NG uses. Do not import Hermes Python code or read Hermes state. Use only the supported surfaces.
2. Bump the ref in the two places that pin it: `HERMES_TEST_REF` in `.github/workflows/vanilla-hermes.yml`, and the `ref:` in `.github/workflows/contract-reference.yml`. Keep the frozen install on Python 3.14 (`uv sync --project upstream --frozen --no-dev --extra web --python 3.14`). If the upstream lock changed, fail the job rather than relax the lock.
3. Run the pinned workflow. It exercises gated and trusted-local deployments, approval, sudo and secret flows, read-only and writable workspace in both modes, and HTTPS/WSS against the real upstream. Triage each live failure. Decide whether NG or upstream changed, and fix the NG side with a contract test. Upstream prompts arrive as server requests (`request.cancel` withdraws them); the PR #39 changes are a worked example.
4. Keep the live gate's failures visible in the record. Do not weaken a gate to pass. Renamed or removed gates need a stated reason.
5. Record the change: update the README **Compatibility** table, `docs/implementation-status.md` (certified ref, the CI run that passed, known variances), and add an ADR under `docs/architecture-decisions.md` if the protocol or trust behaviour changed. Keep the old ref listed as superseded.
6. Only then deploy the new Hermes next to NG. Until step 3 passes, keep the previously certified Hermes, or accept and state that you are running an uncertified pairing.

Trusted-local mode has an extra check. Its readiness probe uses the token-protected `/api/profiles` route, because `/api/sessions` returns 503 until the first session creates the store on a fresh Hermes (PR #39). Re-check that probe on any new upstream.

## 6. Recovery notes

### TLS bind mount goes stale

The TLS directory (`WEBUI_TLS_DIR`) is bind-mounted read-only into the container. If the host filesystem holding it is unmounted, remounted or replaced, the running container can keep the old view. Symptoms are a healthy `/healthz` but TLS handshake failures, or certificate errors after a renewal. Fix: recreate the container so it binds the directory again.

```sh
docker compose -p <project> -f compose.host.yaml up -d --force-recreate webui
```

Certificate renewal: run `scripts/setup-https.sh <host> <port>` with the same values, which keeps the CA and issues a new server certificate, then recreate the container as above. Do not regenerate the CA unless you intend to reinstall it on every device.

### Trusted-local readiness on a fresh Hermes

`/readyz` in trusted-local mode is 503 when the token probe fails. On a fresh Hermes, check, in order:

1. Hermes is running and reachable from the container.
2. `HERMES_DASHBOARD_SESSION_TOKEN` in `.env` matches the token Hermes was started with. The value is never shown by the WebUI, so compare it inside your Hermes deployment.
3. `HERMES_AUTH_MODE=trusted-local` is set and you are using `compose.host.yaml`.

A fresh Hermes with no sessions is not a fault. The readiness probe does not use the sessions store.

### Legacy prompt path

The event-driven prompt path (`<kind>.request` and `<kind>.respond` events) is retained only for compatibility with older Hermes behaviour and for the synthetic fixture. Current upstream (c5a3c0f) sends approval, clarify, sudo and secret prompts as JSON-RPC server requests. If a prompt appears stuck, look at whether the request is still pending upstream. The recovery path is to use **Stop** and then send a fresh turn. Lost sudo or secret snapshots are not actionable after a reconnect, and NG does not replay them. Do not re-enter a secret to "retry" unless the prompt is shown again by Hermes.

### Unknown or lost write acknowledgements

For workspace writes, an unknown or lost acknowledgement may still have committed. NG reads the current state and does not repeat the write automatically. Check the file's current contents, then decide. Failed readback stays unresolved until you review it (ADR-025, `docs/phase6-deployment.md`).

### Stale offline shell

If the installed app shows an old offline shell after an update, clear site data and the service-worker registration for the exact HTTPS origin, after saving any unsent drafts. This removes cached public assets and browser preferences, not Hermes conversations (`docs/phase4-https-pwa.md`).

### Diagnostics

Use **Settings → Diagnostics** for the support report. It excludes credentials, cookies, tickets, paths and conversation content by design. The troubleshooting interface remains at `/diagnostic`.

### Browser or device loses a draft

Drafts and unsaved workspace edits are kept in tab memory only. Browser or OS termination can lose them. Update and reload guards protect drafts, but they do not protect against termination.
