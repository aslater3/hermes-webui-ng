/** Prevent deferred REST work from entering WebKit's network stack during navigation.
 * The request scope is disposable browser state, never an auth or session runtime. */
export class DocumentRequests {
  private controller = new AbortController();
  private paused = false;
  private disposed = false;
  private resumeOnInteraction = false;
  private readonly remove: (() => void)[] = [];

  constructor(target: EventTarget, private readonly fetcher: typeof fetch = fetch) {
    const listen = (event: string, handler: () => void) => {
      target.addEventListener(event, handler);
      this.remove.push(() => target.removeEventListener(event, handler));
    };
    // beforeunload precedes the network teardown; pagehide alone is too late in WebKit.
    // We neither cancel navigation nor request a browser confirmation dialog.
    listen('beforeunload', () => { this.resumeOnInteraction = true; this.pause(); });
    listen('pagehide', () => { this.resumeOnInteraction = false; this.pause(); });
    // A cancelled dirty-edit navigation has no pageshow. Only a later user gesture
    // reopens reads; no pending write is replayed and a genuinely hidden page stays paused.
    const interact = () => { if (this.resumeOnInteraction) this.resume(); };
    listen('pointerdown', interact); listen('keydown', interact);
    listen('pageshow', () => this.resume());
  }
  readonly fetch: typeof fetch = async (input, init) => {
    if (this.disposed || this.paused)
      throw new DOMException('Document request scope is inactive', 'AbortError');
    const signal = init?.signal
      ? AbortSignal.any([init.signal, this.controller.signal])
      : this.controller.signal;
    return this.fetcher.call(globalThis, input, { ...init, signal });
  };
  private pause(): void {
    this.paused = true;
    this.controller.abort();
  }
  private resume(): void {
    if (this.disposed || !this.paused) return;
    this.controller = new AbortController();
    this.paused = false; this.resumeOnInteraction = false;
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.pause();
    this.remove.forEach(remove => remove());
  }
}
