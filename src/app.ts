import { DashboardClient } from './hermes/dashboard-client.js';
import { GatewayClient } from './hermes/gateway-client.js';
import { NativeSession } from './hermes/native-session.js';
import { ClientError } from './hermes/protocol.js';

function element<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error('Missing diagnostic element');
  return node as T;
}
const dashboard = new DashboardClient(location.origin);
const gateway = new GatewayClient(dashboard);
let session = new NativeSession(gateway);
let rest = 'Checking';
let signedIn = false;
let scheduled = false;
const transcript = element('transcript');
const prompt = element<HTMLTextAreaElement>('prompt');
const loginForm = element<HTMLFormElement>('login-form');
const key = element<HTMLInputElement>('session-key');

function showError(error: unknown): void {
  const alert = element('error');
  alert.textContent =
    error instanceof ClientError
      ? error.message
      : 'Operation failed; check the connection and retry explicitly.';
  alert.hidden = false;
}
function run(operation: () => Promise<unknown>): void {
  element('error').hidden = true;
  void operation().catch(showError);
}
function render(): void {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    const state = session.state;
    const ready = gateway.state.phase === 'ready';
    element('rest-state').textContent = rest;
    element('gateway-state').textContent = gateway.state.phase;
    element('session-state').textContent = state.phase;
    loginForm.hidden = signedIn && gateway.state.phase !== 'auth-required';
    element<HTMLButtonElement>('create').disabled = !ready || state.phase === 'attaching';
    element<HTMLButtonElement>('resume').disabled = !ready || state.phase === 'attaching';
    element<HTMLButtonElement>('send').disabled = !ready || state.phase !== 'idle';
    prompt.disabled = !ready || state.phase !== 'idle';
    element<HTMLButtonElement>('interrupt').disabled =
      !ready || !['running', 'waiting'].includes(state.phase);
    element<HTMLButtonElement>('refresh').disabled = !ready || !state.runtimeId;
    element('attention').hidden = state.phase !== 'waiting';
    if (state.storedId) {
      if (document.activeElement !== key) key.value = state.storedId;
      const fragment = `session=${encodeURIComponent(state.storedId)}`;
      if (location.hash.slice(1) !== fragment) history.replaceState(null, '', `#${fragment}`);
    }
    if (state.error) showError(state.error);
    else if (gateway.state.error && ['auth-required', 'error'].includes(gateway.state.phase))
      showError(gateway.state.error);
    const follow = transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight < 80;
    const nodes = state.messages.map((message) => {
      const node = document.createElement('div');
      node.className = 'message';
      const role = document.createElement('strong');
      role.textContent = message.role;
      node.append(role, document.createTextNode(message.text));
      return node;
    });
    if (state.streaming) {
      const node = document.createElement('div');
      node.className = 'message';
      node.textContent = state.streaming;
      nodes.push(node);
    }
    if (!nodes.length) {
      const node = document.createElement('p');
      node.textContent = 'Create or resume a native Hermes session.';
      nodes.push(node);
    }
    transcript.replaceChildren(...nodes);
    if (follow) transcript.scrollTop = transcript.scrollHeight;
  });
}
session.subscribe(render);
gateway.onState(render);
async function connectAndResume(): Promise<void> {
  await gateway.connect();
  const storedId = new URLSearchParams(location.hash.slice(1)).get('session');
  if (storedId && !session.state.storedId) await session.resume(storedId);
}
loginForm.addEventListener('submit', (event) => {
  event.preventDefault();
  run(async () => {
    const button = element<HTMLButtonElement>('login');
    button.disabled = true;
    const password = element<HTMLInputElement>('password');
    signedIn = false;
    session.dispose();
    gateway.close();
    session = new NativeSession(gateway);
    session.subscribe(render);
    history.replaceState(null, '', location.pathname);
    key.value = '';
    try {
      await dashboard.login(
        element<HTMLSelectElement>('provider').value,
        element<HTMLInputElement>('username').value,
        password.value,
      );
      signedIn = true;
      rest = 'Authenticated';
      await connectAndResume();
    } finally {
      password.value = '';
      button.disabled = false;
      render();
    }
  });
});
element('create').addEventListener('click', () => run(() => session.create()));
element('resume-form').addEventListener('submit', (event) => {
  event.preventDefault();
  run(() => session.resume(key.value));
});
element('prompt-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const text = prompt.value;
  run(async () => {
    await session.submit(text);
    if (prompt.value === text) prompt.value = '';
  });
});
element('interrupt').addEventListener('click', () => run(() => session.interrupt()));
element('refresh').addEventListener('click', () => run(() => session.refresh()));
element('reconnect').addEventListener('click', () => run(() => gateway.reconnect()));
element('disconnect').addEventListener('click', () => gateway.close());
element('latest').addEventListener('click', () => {
  transcript.scrollTop = transcript.scrollHeight;
});
function resumeVisible(): void {
  if (document.visibilityState === 'visible') run(() => gateway.ensureLive());
}
document.addEventListener('visibilitychange', resumeVisible);
window.addEventListener('pageshow', resumeVisible);
window.addEventListener('online', resumeVisible);
function viewport(): void {
  document.documentElement.style.setProperty(
    '--viewport-height',
    `${window.visualViewport?.height ?? window.innerHeight}px`,
  );
}
window.visualViewport?.addEventListener('resize', viewport);
viewport();
run(async () => {
  await dashboard.status();
  rest = 'Authentication required';
  render();
  const providers = (await dashboard.providers()).filter((provider) => provider.supports_password);
  const select = element<HTMLSelectElement>('provider');
  select.replaceChildren(...providers.map((provider) => new Option(provider.display_name, provider.name)));
  element<HTMLButtonElement>('login').disabled = providers.length === 0;
  if (!providers.length)
    throw new ClientError('protocol', 'No password provider. OAuth is deferred in Phase 0.');
  try {
    await dashboard.me();
  } catch (error) {
    if (error instanceof ClientError && error.kind === 'auth-required') return;
    throw error;
  }
  signedIn = true;
  rest = 'Authenticated';
  render();
  await connectAndResume();
});
