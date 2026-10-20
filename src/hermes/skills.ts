import { ClientError, record } from './protocol.js';

/** Read-only projection of Hermes `GET /api/skills` and `GET /api/skills/content`. Wire contract: NousResearch/hermes-agent c5a3c0f8767a72203363d249add14142dbcf3cc7 (hermes_cli/web_routers/skills.py). */
export const SKILL_LIST_LIMIT = 2000;
export const SKILL_CONTENT_LIMIT = 200_000;
export type SkillProvenance = 'hub' | 'bundled' | 'external' | 'agent' | 'unknown';
export interface SkillRow {
  name: string; description: string; category: string; enabled: boolean; provenance: SkillProvenance; usage: number;
}
export interface SkillDocument { name: string; content: string; truncated: boolean }

const PROVENANCE: readonly SkillProvenance[] = ['hub', 'bundled', 'external', 'agent'];

function text(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').slice(0, max);
}
function name(value: unknown): string {
  const result = text(value, 256);
  if (!result.trim()) throw new ClientError('protocol', 'Hermes skill omitted a name');
  return result;
}

/** The upstream response is a bare JSON array. Unknown or malformed rows fail the whole page, never render partially. */
export function skillList(input: unknown): SkillRow[] {
  if (!Array.isArray(input) || input.length > SKILL_LIST_LIMIT)
    throw new ClientError('protocol', 'Invalid Hermes skill list');
  return input.map((item: unknown) => {
    const row = record(item);
    const provenance = PROVENANCE.find(value => value === row.provenance) ?? 'unknown';
    const usage = typeof row.usage === 'number' && Number.isSafeInteger(row.usage) && row.usage >= 0 ? row.usage : 0;
    return {
      name: name(row.name),
      description: text(row.description, 1024),
      category: text(row.category, 128),
      enabled: row.enabled !== false,
      provenance,
      usage,
    };
  });
}

/** Only `name`, `content` and the truncation flag reach the UI. The upstream `path` is a server filesystem location and is dropped. */
export function skillDocument(input: unknown, requested: string): SkillDocument {
  const row = record(input);
  if (typeof row.content !== 'string') throw new ClientError('protocol', 'Hermes skill omitted its content');
  const content = row.content.replace(/\r\n?/g, '\n');
  return {
    name: typeof row.name === 'string' && row.name ? text(row.name, 256) : requested,
    content: content.slice(0, SKILL_CONTENT_LIMIT),
    truncated: content.length > SKILL_CONTENT_LIMIT,
  };
}

/** Skill names are sent as query values only, never as path segments. */
export function skillName(value: string): string {
  if (!value || value.length > 256 || /[\u0000-\u001f\u007f]/.test(value))
    throw new ClientError('protocol', 'Unsupported Hermes skill name');
  return value;
}
