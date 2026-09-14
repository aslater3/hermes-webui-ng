import { useSyncExternalStore } from 'react';
import { Download, RefreshCw, ShieldCheck, Smartphone } from 'lucide-react';
import type { AppRuntime } from './runtime.js';
import { Notice } from './primitives.js';

export function PwaSettings({ runtime: rt }: { runtime: AppRuntime }) {
  useSyncExternalStore(rt.pwa.subscribe, rt.pwa.snapshot);
  const state = rt.pwa.state, blocked = rt.reloadBlocker();
  return <section className="pwa-settings"><h3><Smartphone size={19} aria-hidden="true"/> Install &amp; updates</h3>
    <p className="muted">A focused app window, with an offline shell. Chats and agent actions still require Hermes.</p>
    <dl className="connection-facts"><div><dt>Display</dt><dd>{state.installed ? 'Standalone app' : 'Browser tab'}</dd></div><div><dt>Offline shell</dt><dd data-testid="pwa-state">{state.phase}</dd></div><div><dt>Connection security</dt><dd>{isSecureContext ? 'Secure context' : 'HTTPS required'}</dd></div></dl>
    {state.phase === 'unsupported' || state.phase === 'failed' ? <Notice>{state.note}</Notice> : <>
      {state.installable && !state.installed && <button className="primary" onClick={() => void rt.pwa.install()}><Download size={16}/>Install HermesUI</button>}
      {!state.installed && <p className="small muted">On iPhone/iPad, use Safari’s Share menu → Add to Home Screen. On Android or desktop, use Install app in your browser menu when available.</p>}
      <div className="button-row"><button className="secondary" disabled={state.updating || rt.connection.state.offline} onClick={() => void rt.pwa.check()}><RefreshCw size={16}/>Check for updates</button>
      {state.update && <button className="primary" disabled={!!blocked || state.updating || rt.connection.state.offline} onClick={() => void rt.pwa.applyUpdate()}>Update and reload</button>}</div>
      {state.update && blocked && <Notice>Update ready. {blocked}</Notice>}
      {state.note && <p role="status" className="small">{state.note}</p>}
    </>}
    <div className="settings-divider"/><p className="small muted"><ShieldCheck size={15} aria-hidden="true"/> Only public app files are cached. No chat history, credentials, agent requests or offline send queue. Updates wait for safe conditions and other tabs to close.</p>
    <p className="small muted">With a self-signed installation, trust the local CA on each device first. Bypassing a certificate warning is not PWA setup.</p>
  </section>;
}
