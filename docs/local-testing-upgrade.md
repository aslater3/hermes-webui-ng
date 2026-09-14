# Upgrading an existing deployment to the HTTPS/PWA build

The modern React interface is served at `/`. The diagnostic remains at `/diagnostic`. **The supplied Compose configurations now require TLS files and an HTTPS public origin. Run certificate setup before recreating the container.** Do not discard a working local checkout or its uncommitted deployment fixes to try the new interface.

## Preserve the old checkout

Run these from the existing checkout. The patch files are private operator backups, not files to upload or commit: they can include locally added credentials.

```sh
umask 077
git diff --binary > ../hermes-ng-local-before-shell.patch
git diff --cached --binary > ../hermes-ng-staged-before-shell.patch
git fetch origin
git worktree add --detach ../hermes-webui-ng-modern origin/main
install -m 600 .env ../hermes-webui-ng-modern/.env
cd ../hermes-webui-ng-modern
```

This leaves tracked and untracked files in the old checkout untouched. Do not apply the deployment patch blindly to the modern tree: the supported local-access implementation replaces the former synthetic provider, identity and ticket workarounds.

This uses the merged `origin/main`. A detached worktree deliberately pins the fetched revision; updating it later is an explicit operator action. The new directory name must be unused; do not overwrite a previously created worktree.

## Linux host-network configuration

Use the standalone `compose.host.yaml`, not a merge with the bridge-network `compose.yaml`. Host mode reaches an upstream bound to host loopback and must not use a `ports` mapping. The existing unrelated service on port 8787 does not need to be stopped.

Edit the copied `.env` and retain the already configured operator token without exposing it in shell history:

```dotenv
HERMES_DASHBOARD_URL=http://127.0.0.1:9119
PUBLIC_ORIGIN=https://192.168.0.63:8788
WEBUI_HOST=0.0.0.0
WEBUI_PORT=8788
HERMES_AUTH_MODE=trusted-local
# Retain the local HERMES_DASHBOARD_SESSION_TOKEN entry, matching Hermes.
```

`HERMES_DASHBOARD_SESSION_TOKEN` is required in this explicit mode. It is held only by the server, never supplied in browser configuration or a browser WebSocket URL. The upstream must be the literal loopback address and intentionally report `auth_required:false`; a missing or rejected token fails readiness. This mode does not invent a browser account or pretend a successful local connection is an authenticated login.

The default `dashboard` mode still requires Hermes browser authentication and fresh one-use WS tickets. Supplying a server token without explicitly selecting `trusted-local` is an error; an ungated backend cannot silently downgrade a gated deployment.

## Prepare self-signed HTTPS

From the new checkout, after preserving `.env`, run as your normal deployment user:

```sh
bash scripts/setup-https.sh 192.168.0.63 8788
```

It creates a reusable self-signed private CA, a SAN-bearing server certificate and a mode-0600 server key. It privately backs up `.env`, retains the Hermes token/auth mode/upstream URL, and records the HTTPS origin, TLS mount and runtime UID/GID. Only the server certificate directory is mounted read-only; the CA signing key stays outside the container. Do not run setup from another directory or overwrite a protected `.env` with an example.

Install **only `.local/tls/ca/ca.crt`** on your devices and verify its fingerprint. On iPhone/iPad, manually installed roots also need SSL trust enabled under Settings → General → About → Certificate Trust Settings. Never distribute `ca.key` or `server.key`. Use the new HTTPS bookmark/Home Screen shortcut without certificate warnings; merely bypassing a warning is not reliable PWA setup. Full instructions and renewal are in `phase4-https-pwa.md`.

## Build and start

Use the maintained `docker compose` plugin. First identify the existing NG Compose project from the old container's `com.docker.compose.project` label. Reuse that project name when recreating the NG service from the new worktree; substituting a new project while the old service is still listening on 8788 will cause a port conflict.

```sh
# Replace EXISTING_NG_PROJECT with that existing NG project label.
docker compose -p EXISTING_NG_PROJECT -f compose.host.yaml up --build -d
```

The runtime image no longer runs `apt-get`; it does not install disabled workspace Git tooling or a second agent runtime. Compose supplies the init process, and the application remains non-root with a read-only root filesystem. No package-signature checking is disabled as a workaround.

The reported Compose 1.29.2 `ContainerConfig` exception is a legacy client/recreation issue, not a reason to delete images, volumes or the Docker data root. The operator's remove-only-the-old-NG-container workaround is recorded, but updating to maintained Compose is preferred. Do not run broad `docker system prune`, remove volumes or stop the legacy service on 8787.

## Check the result

```sh
curl --fail --cacert .local/tls/ca/ca.crt https://192.168.0.63:8788/healthz
curl --fail --cacert .local/tls/ca/ca.crt https://192.168.0.63:8788/readyz
```

In trusted-local mode, readiness must truthfully report `authenticatedMode:false`. Open the root URL, check the visible no-login/trusted-LAN notice, submit a harmless prompt, reload and confirm the conversation is recovered from Hermes. Test Disconnect then Reconnect; there is intentionally no Sign out button for an account that does not exist.

Keep this address restricted to a trusted LAN or VPN. Anyone who can reach it can use the agent and its tools; same-origin request guards are not user authentication or a firewall. Do not expose it to the public Internet. The host's Docker data-root and disk-repair operations are outside this repository's upgrade process and must not be altered by WebUI deployment commands.

HTTPS/WSS encrypts browser-to-WebUI traffic. The unchanged Hermes hop is HTTP on private host loopback, not encrypted LAN traffic. TLS does not authenticate trusted-local access. Physical iPhone/Android installation, keyboard and background testing are recorded separately in `phase4-device-smoke.md`; automated WebKit results do not sign those off.
