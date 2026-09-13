import { DashboardClient } from './hermes/dashboard-client.js';
import { GatewayClient } from './hermes/gateway-client.js';
import { ChatController } from './hermes/chat-controller.js';
import { ChatView } from './hermes/chat-view.js';
import { ClientError } from './hermes/protocol.js';
import { WsAuthClient } from './hermes/ws-auth.js';
import { DiagnosticsRing } from './hermes/diagnostics.js';
import { ConnectionStore } from './hermes/connection-store.js';
import { connectionSummary } from './hermes/connection-summary.js';

function element<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error('Missing diagnostic element');
  return node as T;
}
const diagnostics = new DiagnosticsRing();
const dashboard = new DashboardClient(location.origin, fetch, 15_000, diagnostics);
const gateway = new GatewayClient(new WsAuthClient(dashboard, (signal) => foundation.verifyAdmission(signal)), { diagnostics });
const foundation: ConnectionStore = new ConnectionStore(dashboard, gateway, diagnostics);
const chat = new ChatController(dashboard, gateway, (error) => gateway.suspend(error));
const chatView = new ChatView(chat, foundation, gateway);
let viewEpoch = 0;
let providersSignature = '';
let actionError: unknown;
let scheduled = false;
const loginForm = element<HTMLFormElement>('login-form');
function showError(error: unknown): void {
  const alert = element('error');
  alert.textContent = error instanceof ClientError ? error.message : 'Operation failed; check the connection and retry explicitly.';
  alert.hidden = false;
}
function run(operation: () => Promise<unknown>): void {
  const epoch = viewEpoch; actionError = undefined;
  void operation().catch((error: unknown) => {
    if (epoch === viewEpoch) { actionError = error; showError(error); }
  }).finally(render);
}
function render(): void {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    const connection = foundation.state;
    element('rest-state').textContent = connection.rest;
    element('auth-state').textContent = connection.auth;
    const banner = element('connection-banner');
    banner.textContent = connectionSummary(connection, gateway.state);
    banner.dataset.state = connection.offline ? 'offline' : gateway.state.phase;
    element('gateway-state').textContent = gateway.state.phase;
    loginForm.hidden = connection.auth === 'signed-in';
    const providers = foundation.providers.filter((provider) => provider.supports_password);
    const signature = JSON.stringify(providers);
    if (signature !== providersSignature) {
      const select = element<HTMLSelectElement>('provider'); const selected = select.value;
      select.replaceChildren(...providers.map((provider) => new Option(provider.display_name, provider.name)));
      if (providers.some((provider) => provider.name === selected)) select.value = selected;
      providersSignature = signature;
    }
    element('provider-note').hidden = providers.length !== 0 || connection.rest !== 'healthy';
    element<HTMLButtonElement>('login').disabled = connection.busy || connection.offline || connection.auth === 'checking' || !providers.length;
    for (const id of ['reconnect', 'disconnect', 'signout', 'refresh-capabilities'])
      element<HTMLButtonElement>(id).disabled = connection.busy || connection.offline;
    element<HTMLButtonElement>('signout').hidden = !['signed-in', 'unconfirmed'].includes(connection.auth);
    element('diagnostic-count').textContent = String(diagnostics.snapshot().length);
    const metrics = gateway.telemetry();
    element('latency').textContent = metrics.latencyMs === undefined ? 'Not measured' : `${metrics.latencyMs} ms`;
    for (const [feature, capability] of Object.entries(foundation.capabilities.snapshot())) {
      element(`cap-${feature}`).textContent = `${capability.state} · ${capability.evidence}${capability.implemented ? '' : ' · UI not implemented'}`;
    }
    element('error').hidden = true;
    if (actionError) showError(actionError);
    else if (foundation.state.error) showError(foundation.state.error);
    else if (gateway.state.error && ['auth-required', 'error'].includes(gateway.state.phase)) showError(gateway.state.error);
    chatView.render();
  });
}
chat.subscribe(render);
foundation.subscribe(() => { chatView.activate(); render(); });
foundation.onIdentityBoundary(() => {
  viewEpoch++; chat.clear(); chatView.clear();
  element<HTMLInputElement>('password').value = ''; element<HTMLInputElement>('username').value = '';
  history.replaceState(null, '', location.pathname); actionError = undefined;
  element<HTMLTextAreaElement>('diagnostic-report').value = '';
});
gateway.onState(render);
loginForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const provider = element<HTMLSelectElement>('provider').value;
  const username = element<HTMLInputElement>('username').value;
  const password = element<HTMLInputElement>('password'); const credential = password.value; password.value = '';
  run(() => foundation.login(provider, username, credential));
});
element('reconnect').addEventListener('click', () => run(() => foundation.start()));
element('disconnect').addEventListener('click', () => foundation.disconnect());
element('signout').addEventListener('click', () => run(() => foundation.logout()));
element('refresh-capabilities').addEventListener('click', () => run(() => foundation.refreshCapabilities()));
function report(): string {
  const text = JSON.stringify(foundation.report(), null, 2);
  element<HTMLTextAreaElement>('diagnostic-report').value = text; return text;
}
element('copy-diagnostics').addEventListener('click', () => {
  const text = report();
  void navigator.clipboard?.writeText(text).then(() => { element('export-status').textContent = 'Sanitised report copied.'; })
    .catch(() => { element('export-status').textContent = 'Clipboard unavailable. Select and copy the report below.'; });
  if (!navigator.clipboard) element('export-status').textContent = 'Select and copy the report below.';
});
element('download-diagnostics').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([report()], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = 'hermes-webui-ng-diagnostics.json';
  link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  element('export-status').textContent = 'Sanitised report exported.';
});
element('clear-diagnostics').addEventListener('click', () => {
  diagnostics.clear(); element<HTMLTextAreaElement>('diagnostic-report').value = '';
  element('export-status').textContent = 'This tab’s diagnostic history is cleared.'; render();
});
function resumeVisible(): void {
  const visible = document.visibilityState === 'visible'; foundation.poll(visible ? 30_000 : 0);
  if (visible) run(() => foundation.resume());
}
document.addEventListener('visibilitychange', resumeVisible);
window.addEventListener('pageshow', resumeVisible);
window.addEventListener('online', () => run(() => foundation.setOffline(false)));
window.addEventListener('offline', () => run(() => foundation.setOffline(true)));
function viewport(): void { document.documentElement.style.setProperty('--viewport-height', `${window.visualViewport?.height ?? window.innerHeight}px`); }
window.visualViewport?.addEventListener('resize', viewport);
viewport(); foundation.poll();
run(async () => { if (!navigator.onLine) await foundation.setOffline(true); else await foundation.start(); });
