/** Isolated acceptance tests only. Return fixed classifications, never upstream strings. */
const KINDS: readonly [string, RegExp][] = [
  ['unknown-provider', /unknown provider|provider .+ not found/i],
  ['credential-resolution', /credentials|api.?key|authentication|unauthori[sz]ed/i],
  ['model-validation', /could not validate|invalid model|model .+ not found|not supported|not available/i],
  ['in-place-switch', /staying on|in.place model|model switch to .+ failed/i],
  ['connection', /connection|connecterror|timeout|timed out|name resolution/i],
  ['request-rejected', /http [45][0-9][0-9]|bad request|status code/i],
  ['python-name', /not defined|unboundlocalerror|local variable|free variable/i],
  ['python-attribute', /has no attribute|attributeerror/i],
  ['python-import', /no module named|cannot import|importerror/i],
  ['python-type', /unexpected keyword|positional argument|not subscriptable|not iterable|nonetype/i],
  ['storage', /database|locked|read.only|permission denied|no such file|disk/i],
  ['missing-session', /session .+not found|no active session|unknown session/i],
];
export function rpcFailureKind(raw: unknown): { code: number; kinds: string[] } | undefined {
  if (typeof raw !== 'string' || raw.length > 4_194_304) return;
  try {
    const frame = JSON.parse(raw);
    if (!frame || frame.jsonrpc !== '2.0' || !frame.error || !Number.isInteger(frame.error.code)) return;
    const text = typeof frame.error.message === 'string' ? frame.error.message.slice(0, 8192) : '';
    const kinds = KINDS.filter(([, pattern]) => pattern.test(text)).map(([kind]) => kind);
    return { code: frame.error.code, kinds: kinds.length ? kinds : ['unclassified'] };
  } catch { return; }
}
