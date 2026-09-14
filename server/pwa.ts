/** No arbitrary files or paths: operator certificates and API data are not static assets. */
export function pwaAsset(path: string): string | undefined {
  return ['/sw.js', '/manifest.webmanifest', '/pwa/icon-180.png', '/pwa/icon-192.png', '/pwa/icon-512.png'].includes(path)
    ? path.slice(1) : undefined;
}
