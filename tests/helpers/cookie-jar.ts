/** Minimal single-origin test jar. Browser cookie storage remains native in production. */
export class TestCookieJar {
  private values = new Map<string, { name: string; pair: string; path: string; secure: boolean; expires: number }>();
  constructor(private readonly origin: string, private readonly now = Date.now) {}
  receive(header: string, requestUrl: string): void {
    const url = new URL(requestUrl);
    if (url.origin !== this.origin) throw new Error('Cross-origin test cookie');
    const [pair, ...parts] = header.split(';');
    const separator = pair?.indexOf('=') ?? -1;
    if (!pair || separator < 1) return;
    const name = pair.slice(0, separator).trim();
    const attributes = new Map(parts.map((part) => {
      const at = part.indexOf('=');
      return [part.slice(0, at < 0 ? undefined : at).trim().toLowerCase(), at < 0 ? '' : part.slice(at + 1).trim()];
    }));
    // Hermes emits host-only cookies; this test jar deliberately rejects broader domains.
    if (attributes.has('domain')) return;
    const defaultPath = url.pathname.slice(0, url.pathname.lastIndexOf('/')) || '/';
    const declaredPath = attributes.get('path');
    const path = declaredPath?.startsWith('/') ? declaredPath : defaultPath;
    const secure = attributes.has('secure');
    if (name.startsWith('__Host-') && (!secure || path !== '/')) return;
    if (name.startsWith('__Secure-') && !secure) return;
    const key = `${path}\0${name}`;
    const maxAge = attributes.get('max-age');
    let expires = Infinity;
    if (maxAge !== undefined && /^-?\d+$/.test(maxAge)) {
      if (Number(maxAge) <= 0) { this.values.delete(key); return; }
      expires = this.now() + Number(maxAge) * 1000;
    } else if (attributes.has('expires')) {
      const parsed = Date.parse(attributes.get('expires')!);
      if (Number.isFinite(parsed)) expires = parsed;
    }
    if (expires <= this.now()) { this.values.delete(key); return; }
    if (secure && url.protocol !== 'https:') return;
    this.values.set(key, { name, pair: pair.trim(), path, secure, expires });
  }
  header(requestUrl: string): string {
    const url = new URL(requestUrl);
    if (url.origin !== this.origin) throw new Error('Cross-origin test cookie');
    const selected: { pair: string; path: string }[] = [];
    for (const [key, cookie] of this.values) {
      if (cookie.expires <= this.now()) { this.values.delete(key); continue; }
      if (cookie.secure && url.protocol !== 'https:') continue;
      if (url.pathname === cookie.path || (url.pathname.startsWith(cookie.path) &&
        (cookie.path.endsWith('/') || url.pathname[cookie.path.length] === '/'))) selected.push(cookie);
    }
    return selected.sort((a, b) => b.path.length - a.path.length).map((cookie) => cookie.pair).join('; ');
  }
}
