interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
export interface PwaState {
  phase: 'unsupported' | 'checking' | 'ready' | 'failed';
  installed: boolean;
  installable: boolean;
  update: boolean;
  updating: boolean;
  note: string;
}
/** Browser lifecycle only. No auth, transcript, draft or credential storage. */
export class PwaController {
  state: PwaState = { phase: 'checking', installed: false, installable: false, update: false, updating: false, note: '' };
  private registration?: ServiceWorkerRegistration;
  private prompt?: InstallPrompt;
  private disposed = false;
  private started = false;
  private cleanup: (() => void)[] = [];
  private listeners = new Set<() => void>();
  private revision = 0;
  private reloadRequested = false;
  constructor(private readonly blockers: () => string, private readonly reload: () => void = () => location.reload()) {}
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  snapshot = () => this.revision;
  private publish(patch: Partial<PwaState>) { if (!this.disposed) { this.state = { ...this.state, ...patch }; ++this.revision; this.listeners.forEach(fn => fn()); } }
  private listen(target: EventTarget, type: string, callback: EventListener) {
    target.addEventListener(type, callback); this.cleanup.push(() => target.removeEventListener(type, callback));
  }
  async start() {
    if (this.started) return; this.started = true;
    const mode = matchMedia('(display-mode: standalone)');
    const standalone = () => this.publish({ installed: mode.matches || (navigator as Navigator & { standalone?: boolean }).standalone === true });
    standalone(); this.listen(mode, 'change', standalone);
    if (!isSecureContext || !('serviceWorker' in navigator)) {
      this.publish({ phase: 'unsupported', note: 'Offline installation needs HTTPS with a trusted certificate. Regular chat still works.' }); return;
    }
    this.listen(window, 'beforeinstallprompt', event => { event.preventDefault(); this.prompt = event as InstallPrompt; this.publish({ installable: true }); });
    this.listen(window, 'appinstalled', () => { this.prompt = undefined; this.publish({ installed: true, installable: false, note: 'App installed.' }); });
    this.listen(navigator.serviceWorker, 'controllerchange', () => {
      this.publish({ phase: 'ready' });
      if (!this.reloadRequested) return; // Never surprise-reload another document.
      this.reloadRequested = false;
      const blocked = this.blockers();
      if (blocked) this.publish({ updating: false, note: `Update installed. Reload when safe: ${blocked}` });
      else this.reload();
    });
    try {
      const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });
      if (this.disposed) return; this.registration = registration;
      const update = () => this.publish({ phase: registration.active ? 'ready' : 'checking', update: !!registration.waiting });
      const observe = () => { if (registration.installing) this.listen(registration.installing, 'statechange', update); update(); };
      this.listen(registration, 'updatefound', observe); observe();
    } catch {
      this.publish({ phase: 'failed', note: 'Offline setup failed. Check certificate trust, browser permissions and connectivity; chat is not affected.' });
    }
  }
  async check() {
    if (!this.registration || this.state.updating) return;
    this.publish({ note: 'Checking for an application update…' });
    try { await this.registration.update(); this.publish({ update: !!this.registration.waiting, note: this.registration.waiting ? 'An update is ready.' : 'Update check complete.' }); }
    catch { this.publish({ note: 'Update check failed. Reconnect and check certificate trust before trying again.' }); }
  }
  async install() {
    const prompt = this.prompt; if (!prompt) return;
    this.prompt = undefined; this.publish({ installable: false });
    try { await prompt.prompt(); const choice = await prompt.userChoice; this.publish({ note: choice.outcome === 'accepted' ? 'Installation requested; your browser will confirm it.' : 'Installation dismissed. Use your browser menu to install later.' }); }
    catch { this.publish({ note: 'Use your browser menu to install this app.' }); }
  }
  async applyUpdate() {
    const waiting = this.registration?.waiting;
    if (!waiting || this.state.updating) return;
    const blocked = this.blockers();
    if (blocked) { this.publish({ note: `Not reloading: ${blocked}` }); return; }
    this.publish({ updating: true, note: 'Preparing the update…' });
    this.reloadRequested = true;
    const channel = new MessageChannel();
    try {
      const result = await new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Update timeout')), 5000);
        channel.port1.onmessage = event => { clearTimeout(timeout); resolve(event.data?.result); };
        waiting.postMessage({ type: 'HERMES_ACTIVATE' }, [channel.port2]);
      });
      if (result !== 'activating') {
        this.reloadRequested = false; this.publish({ updating: false, note: 'Close other HermesUI tabs/windows, then try again. They have not been reloaded.' });
      } else {
        // A browser may activate without a controllerchange on this document; leave a retry path.
        const timer = setTimeout(() => { if (this.reloadRequested) { this.reloadRequested = false; this.publish({ updating: false, note: 'Update installed. Reload this tab when your work is safe.' }); } }, 10000);
        this.cleanup.push(() => clearTimeout(timer));
      }
    } catch { this.reloadRequested = false; this.publish({ updating: false, note: 'The update was not confirmed. Your page has not been reloaded.' }); }
    finally { channel.port1.close(); channel.port2.close(); }
  }
  dispose() { this.disposed = true; this.cleanup.forEach(fn => fn()); this.cleanup = []; this.listeners.clear(); this.prompt = undefined; }
}
