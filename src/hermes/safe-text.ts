/**
 * Display text from upstream management payloads. Control characters are removed, credential-looking
 * `key=value` pairs and bearer/API-key tokens are replaced, and the result is bounded. Used for every
 * free-text field the Memory and Cron views render, because job errors and run previews can echo secrets.
 */
const SECRET_PAIR = /\b(api[_-]?key|access[_-]?token|refresh[_-]?token|session[_-]?token|token|secret|password|passwd|authorization|cookie)(\s*[:=]\s*)(?:Bearer\s+)?(?:"[^"]*"|'[^']*'|\S+)/gi;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const PROVIDER_KEY = /\b(?:sk|pk|ghp|xox[abp])[-_][A-Za-z0-9_-]{12,}/g;

export function safeText(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(SECRET_PAIR, '$1$2[redacted]')
    .replace(BEARER, 'Bearer [redacted]')
    .replace(PROVIDER_KEY, '[redacted]')
    .slice(0, max);
}
