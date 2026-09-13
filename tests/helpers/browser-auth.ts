import { WebSocket } from 'ws';
import { TestCookieJar } from './cookie-jar.js';

/** Test-only browser cookie/origin adapter; never shipped in the production image. */
export function browserAuth(origin: string) {
  const cookies = new TestCookieJar(origin);
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    if (new URL(url).origin !== origin) throw new Error('Cross-origin test request');
    const headers = new Headers(init?.headers);
    headers.set('Origin', origin);
    if (init?.credentials !== 'omit') {
      const value = cookies.header(url);
      if (value) headers.set('Cookie', value);
    }
    const response = await fetch(input, { ...init, headers });
    if (init?.credentials !== 'omit')
      for (const header of response.headers.getSetCookie()) cookies.receive(header, url);
    return response;
  };
  return {
    fetcher,
    socketFactory: (url: string, protocols: string[]) =>
      new WebSocket(url, protocols, { origin }) as unknown as globalThis.WebSocket,
  };
}
