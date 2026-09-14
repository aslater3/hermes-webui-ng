import { workspaceRoots, type WorkspaceRoot } from './workspace/files.js';
import { tlsFiles, type TlsFiles } from './tls.js';
import { resolve } from 'node:path';
import { configureAccess } from './trusted-local.js';

export const PROXY_PREFIX = '/__hermes';
export interface Config {
  tls?: TlsFiles;
  workspaceRoots?: WorkspaceRoot[];
  gitEnabled?: boolean;
  authMode?: 'dashboard' | 'trusted-local';
  readonly sessionToken?: string;
  upstream: URL;
  publicOrigin: URL;
  host: string;
  port: number;
  staticDir: string;
  requestTimeoutMs: number;
  maxBodyBytes: number;
}

function origin(value: string | undefined, name: string): URL {
  try {
    const url = new URL(value ?? '');
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    )
      throw new Error();
    return url;
  } catch {
    // Never echo a URL: a mistaken URL can contain operator credentials.
    throw new Error(`${name} must be an HTTP(S) origin without credentials, path, query or fragment`);
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const port = Number(env.PORT ?? '8787');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
  for (const [key, allowed] of Object.entries({
    HERMES_PROXY_PREFIX: PROXY_PREFIX,
    WEBUI_BASE_PATH: '/',
    WORKSPACE_WRITE_ENABLED: 'false',
    GIT_WRITE_ENABLED: 'false',
  })) {
    if (env[key] && env[key] !== allowed) throw new Error(`${key} is not supported by this read-only build`);
  }
  if (env.TRUST_PROXY) throw new Error('Client-supplied proxy trust is not enabled');
  if (env.GIT_ENABLED && !['true', 'false'].includes(env.GIT_ENABLED)) throw new Error('GIT_ENABLED must be true or false');
  const config: Config = {
    workspaceRoots: workspaceRoots(env.WORKSPACE_ROOTS),
    gitEnabled: env.GIT_ENABLED === 'true',
    upstream: origin(env.HERMES_DASHBOARD_URL, 'HERMES_DASHBOARD_URL'),
    publicOrigin: origin(env.PUBLIC_ORIGIN, 'PUBLIC_ORIGIN'),
    host: env.HOST ?? '0.0.0.0',
    port,
    staticDir: resolve('dist'),
    requestTimeoutMs: 15_000,
    maxBodyBytes: 1_048_576,
  };
  config.tls = tlsFiles(env, config.publicOrigin);
  configureAccess(config, env);
  return config;
}
