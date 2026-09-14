import type { FixtureToolCall } from './phase3-model.js';
const object = (v: unknown): Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
/** Model decisions only. Commands are confined to a newly-created disposable CI lab. */
export function m3Tool(messages: unknown[], tools: unknown, lab = process.env.HERMES_M3_LAB): FixtureToolCall | undefined {
  let at = messages.length - 1; while (at >= 0 && object(messages[at]).role !== 'user') at--;
  const prompt = object(messages[at]).content;
  if (typeof prompt !== 'string' || !/^M3_(APPROVAL_(ALLOW|DENY|EXPIRE)|SUDO(_SKIP)?|SECRET(_CHECK|_SKIP)?)$/.test(prompt)) return;
  if (messages.slice(at + 1).some(row => object(row).role === 'tool')) return;
  if (!lab || !/^\/tmp\/hermes-m3-[A-Za-z0-9]+$/.test(lab)) throw new Error('Missing isolated M3 lab');
  let name: string, args: Record<string, unknown>;
  if (prompt.startsWith('M3_APPROVAL_')) {
    const target = prompt.slice('M3_APPROVAL_'.length).toLowerCase();
    name = 'terminal'; args = { command: `rm -rf -- ${lab}/${target}-target`, workdir: lab, timeout: 30 };
  } else if (prompt.startsWith('M3_SUDO')) {
    name = 'terminal'; args = { command: 'sudo /usr/bin/id -u', workdir: lab, timeout: 30 };
  } else {
    name = 'skill_view'; args = { name: prompt === 'M3_SECRET_SKIP' ? 'm3-skip-fixture' : 'm3-capture-fixture' };
  }
  if (!Array.isArray(tools) || !tools.some(tool => object(object(tool).function).name === name)) throw new Error('Required native M3 tool unavailable');
  return { id: `call_${prompt.toLowerCase()}`, type: 'function', function: { name, arguments: JSON.stringify(args) } };
}
