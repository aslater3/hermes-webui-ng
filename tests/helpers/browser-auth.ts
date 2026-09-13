import { WebSocket } from 'ws';

/** Test-only browser cookie/origin adapter; never shipped in the production image. */
export function browserAuth(origin: string) {
  const cookies = new Map<string, string>();
  const fetcher: typeof fetch = async (input, init) => {
    if (new URL(String(input)).origin !== origin) throw new Error('Cross-origin test request');
    const headers = new Headers(init?.headers);
    headers.set('Origin', origin);
    if (cookies.size) headers.set('Cookie', [...cookies.values()].join('; '));
    const response = await fetch(input, { ...init, headers });
    for (const header of response.headers.getSetCookie()) {
      const pair = header.split(';')[0]!;
      cookies.set(pair.split('=')[0]!, pair);
    }
    return response;
  };
  return {
    fetcher,
    socketFactory: (url: string, protocols: string[]) =>
      new WebSocket(url, protocols, { origin }) as unknown as globalThis.WebSocket,
  };
}
