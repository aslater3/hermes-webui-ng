import { ClientError, record } from './protocol.js';

/** Hermes grammar, not a promise that every provider honours every effort. */
export const EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'] as const;
export type Effort = (typeof EFFORTS)[number];
export interface ModelChoice {
  model: string;
  provider: string;
  providerName: string;
  authenticated?: boolean;
  reasoning?: boolean;
  canDisableReasoning?: boolean;
}
export interface ModelCatalogue { model?: string; provider?: string; choices: ModelChoice[] }
export interface ProfileChoice { name: string; label: string; description: string }
export interface AgentMetadata { model?: string; provider?: string; reasoningEffort?: string }
export interface ModelChangeResult { confirmation?: string; warning?: string; deferred: boolean }

function optionalText(value: unknown, limit: number): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= limit &&
    !/[\u0000-\u001f\u007f]/.test(value) ? value : undefined;
}
/** The model setter uses Hermes' CLI-style parser. Never let catalogue text become flags. */
export function modelIdentifier(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/+@-]{0,255}$/.test(value))
    throw new ClientError('protocol', 'Unsupported model or provider identifier');
  return value;
}
export function profileIdentifier(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value))
    throw new ClientError('protocol', 'Unsupported profile name');
  return value;
}
export function effortValue(value: unknown): Effort {
  if (typeof value !== 'string' || !EFFORTS.includes(value as Effort))
    throw new ClientError('protocol', 'Unsupported reasoning effort');
  return value as Effort;
}
export function agentMetadata(input: unknown): AgentMetadata {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const info = record(input);
  const model = optionalText(info.model, 256), provider = optionalText(info.provider, 256);
  const reasoningEffort = info.reasoning_effort === '' ? 'provider-default' :
    typeof info.reasoning_effort === 'string' && EFFORTS.includes(info.reasoning_effort as Effort)
      ? info.reasoning_effort : undefined;
  return { ...(model ? { model } : {}), ...(provider ? { provider } : {}),
    ...(reasoningEffort ? { reasoningEffort } : {}) };
}
/** Project only public choice fields. Never retain paths, URLs, credentials or full config. */
export function modelCatalogue(input: unknown): ModelCatalogue {
  const data = record(input);
  if (!Array.isArray(data.providers) || data.providers.length > 128)
    throw new ClientError('protocol', 'Unsupported model inventory');
  const choices: ModelChoice[] = [], seen = new Set<string>();
  for (const raw of data.providers) {
    const row = record(raw), provider = modelIdentifier(row.slug);
    const providerName = optionalText(row.name, 120) ?? provider;
    if (!Array.isArray(row.models) || row.models.length > 4096)
      throw new ClientError('protocol', 'Unsupported provider model list');
    const caps = row.capabilities && typeof row.capabilities === 'object' && !Array.isArray(row.capabilities)
      ? record(row.capabilities) : {};
    for (const rawModel of row.models) {
      let model: string;
      try { model = modelIdentifier(rawModel); } catch { continue; }
      const key = JSON.stringify([provider, model]);
      if (seen.has(key)) continue;
      seen.add(key);
      if (choices.length >= 8192) throw new ClientError('protocol', 'Model inventory exceeds the UI limit');
      const capability = caps[model] && typeof caps[model] === 'object' && !Array.isArray(caps[model])
        ? record(caps[model]) : {};
      choices.push({ model, provider, providerName,
        ...(typeof row.authenticated === 'boolean' ? { authenticated: row.authenticated } : {}),
        ...(typeof capability.reasoning === 'boolean' ? { reasoning: capability.reasoning } : {}),
        ...(typeof capability.can_disable_reasoning === 'boolean'
          ? { canDisableReasoning: capability.can_disable_reasoning } : {}),
      });
    }
  }
  return { model: optionalText(data.model, 256), provider: optionalText(data.provider, 256), choices };
}
export function profileCatalogue(input: unknown): ProfileChoice[] {
  const data = record(input);
  if (!Array.isArray(data.profiles) || data.profiles.length > 256)
    throw new ClientError('protocol', 'Unsupported profile inventory');
  const seen = new Set<string>();
  return data.profiles.flatMap((raw: unknown) => {
    const row = record(raw); let name: string;
    try { name = profileIdentifier(row.name); } catch { return []; }
    if (seen.has(name)) return [];
    seen.add(name);
    return [{ name, label: optionalText(row.display_name, 120) ?? name,
      description: optionalText(row.description, 500) ?? '' }];
  });
}
export function modelSetParams(runtimeId: string, profile: string | undefined, choice: ModelChoice, confirm = false) {
  if (!runtimeId.trim()) throw new ClientError('protocol', 'A live native session is required');
  return { session_id: runtimeId, ...(profile ? { profile: profileIdentifier(profile) } : {}),
    key: 'model', value: `${modelIdentifier(choice.model)} --provider ${modelIdentifier(choice.provider)} --session`,
    confirm_expensive_model: confirm };
}
export function reasoningSetParams(runtimeId: string, profile: string | undefined, effort: Effort) {
  if (!runtimeId.trim()) throw new ClientError('protocol', 'A live native session is required');
  return { session_id: runtimeId, ...(profile ? { profile: profileIdentifier(profile) } : {}),
    key: 'reasoning', value: effortValue(effort), scope: 'session' };
}
export function modelChangeResult(input: unknown): ModelChangeResult {
  const data = record(input);
  if (data.key !== 'model' || typeof data.value !== 'string' ||
    (data.scope !== undefined && data.scope !== 'session'))
    throw new ClientError('protocol', 'Hermes returned an unexpected model-setting scope');
  if (data.confirm_required === true) return {
    confirmation: optionalText(data.confirm_message, 2000) ?? 'Hermes requires confirmation before using this model. It may have additional cost.',
    deferred: false,
  };
  return { warning: optionalText(data.warning, 2000), deferred: data.deferred === true };
}
