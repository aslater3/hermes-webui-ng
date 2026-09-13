import { DashboardClient } from './hermes/dashboard-client.js';
import { GatewayClient } from './hermes/gateway-client.js';
import { NativeSession } from './hermes/native-session.js';
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
let session = new NativeSession(gateway);
let viewEpoch = 0;
let providersSignature = '';
let previousMessages: unknown;
let previousStreaming: string | undefined;
let actionError: unknown;
let scheduled = false;
const transcript = element('transcript');
const prompt = element<HTMLTextAreaElement>('prompt');
const loginForm = element<HTMLFormElement>('login-form');
const key = element<HTMLInputElement>('session-key');
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
    const state = session.state;
    const connection = foundation.state;
    const ready = gateway.state.phase === 'ready' && connection.auth === 'signed-in' && !connection.offline;
    element('rest-state').textContent = connection.rest;
    element('auth-state').textContent = connection.auth;
    const banner = element('connection-banner');
    banner.textContent = connectionSummary(connection, gateway.state);
    banner.dataset.state = connection.offline ? 'offline' : gateway.state.phase;
    element('gateway-state').textContent = gateway.state.phase;
    element('session-state').textContent = state.phase;
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
    element<HTMLButtonElement>('create').disabled = !ready || state.phase === 'attaching';
    element<HTMLButtonElement>('resume').disabled = !ready || state.phase === 'attaching';
    element<HTMLButtonElement>('send').disabled = !ready || state.phase !== 'idle';
    prompt.disabled = !ready || state.phase !== 'idle';
    element<HTMLButtonElement>('interrupt').disabled = !ready || !['running', 'waiting'].includes(state.phase);
    element<HTMLButtonElement>('refresh').disabled = !ready || !state.runtimeId;
    element('attention').hidden = state.phase !== 'waiting';
    if (state.storedId) {
      if (document.activeElement !== key) key.value = state.storedId;
      const fragment = `session=${encodeURIComponent(state.storedId)}`;
      if (location.hash.slice(1) !== fragment) history.replaceState(null, '', `#${fragment}`);
    }
    element('error').hidden = true;
    if (actionError) showError(actionError);
    else if (foundation.state.error) showError(foundation.state.error);
    else if (state.error) showError(state.error);
    else if (gateway.state.error && ['auth-required', 'error'].includes(gateway.state.phase)) showError(gateway.state.error);
    if (previousMessages === state.messages && previousStreaming === state.streaming) return;
    previousMessages = state.messages; previousStreaming = state.streaming;
    const follow = transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight < 80;
    const nodes = state.messages.map((message) => {
      const node = document.createElement('div'); node.className = 'message';
      const role = document.createElement('strong'); role.textContent = message.role;
      node.append(role, document.createTextNode(message.text)); return node;
    });
    if (state.streaming) { const node = document.createElement('div'); node.className = 'message'; node.textContent = state.streaming; nodes.push(node); }
    if (!nodes.length) { const node = document.createElement('p'); node.textContent = 'Create or resume a native Hermes session.'; nodes.push(node); }
    transcript.replaceChildren(...nodes);
    if (follow) transcript.scrollTop = transcript.scrollHeight;
  });
}
session.subscribe(render);
foundation.subscribe(render);
foundation.onIdentityBoundary(() => {
  viewEpoch++; session.dispose(); transcript.replaceChildren(); prompt.value = ''; key.value = '';
  element<HTMLInputElement>('password').value = ''; element<HTMLInputElement>('username').value = '';
  history.replaceState(null, '', location.pathname); actionError = undefined;
  element<HTMLTextAreaElement>('diagnostic-report').value = '';
  session = new NativeSession(gateway); session.subscribe(render);
});
gateway.onState((state) => {
  if (state.phase === 'ready' && foundation.state.auth === 'signed-in' && !session.state.storedId) {
    const storedId = new URLSearchParams(location.hash.slice(1)).get('session');
    if (storedId) run(() => session.resume(storedId));
  }
  render();
});
loginForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const provider = element<HTMLSelectElement>('provider').value;
  const username = element<HTMLInputElement>('username').value;
  const password = element<HTMLInputElement>('password'); const credential = password.value; password.value = '';
  run(() => foundation.login(provider, username, credential));
});
element('create').addEventListener('click', () => run(() => session.create()));
element('resume-form').addEventListener('submit', (event) => { event.preventDefault(); run(() => session.resume(key.value)); });
element('prompt-form').addEventListener('submit', (event) => {
  event.preventDefault(); const text = prompt.value;
  run(async () => { await session.submit(text); if (prompt.value === text) prompt.value = ''; });
});
element('interrupt').addEventListener('click', () => run(() => session.interrupt()));
element('refresh').addEventListener('click', () => run(() => session.refresh()));
element('reconnect').addEventListener('click', () => run(() => foundation.start()));
element('disconnect').addEventListener('click', () => foundation.disconnect());
element('latest').addEventListener('click', () => { transcript.scrollTop = transcript.scrollHeight; });
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
