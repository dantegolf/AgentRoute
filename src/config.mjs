import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

export function agentRouteHome() {
  return resolve(process.env.AGENTROUTE_HOME || join(homedir(), '.agentroute'));
}

export function configPath() {
  return resolve(process.env.AGENTROUTE_CONFIG || join(agentRouteHome(), 'config.json'));
}

export function defaultConfig() {
  return {
    server: { host: '127.0.0.1', port: 19777 },
    providers: {
      claudegravity: {
        label: 'ClaudeGravity',
        protocol: 'anthropic-messages',
        baseUrl: 'http://127.0.0.1:18080',
        auth: { type: 'static', value: 'antigravity' },
      },
      omnirouter: {
        label: 'Omni Router',
        protocol: 'openai-responses',
        baseUrl: 'https://api.omnirouter.ru/v1',
        auth: { type: 'env', name: 'OMNIROUTER_API_KEY' },
        request: { store: false },
      },
      openrouter: {
        label: 'OpenRouter',
        protocol: 'openai-chat',
        baseUrl: 'https://openrouter.ai/api/v1',
        auth: { type: 'env', name: 'OPENROUTER_API_KEY' },
      },
      openai: {
        label: 'OpenAI API',
        protocol: 'openai-responses',
        baseUrl: 'https://api.openai.com/v1',
        auth: { type: 'env', name: 'OPENAI_API_KEY' },
      },
      anthropic: {
        label: 'Anthropic API',
        protocol: 'anthropic-messages',
        baseUrl: 'https://api.anthropic.com',
        auth: { type: 'env', name: 'ANTHROPIC_API_KEY' },
      },
      gemini: {
        label: 'Google Gemini API',
        protocol: 'openai-chat',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
        auth: { type: 'env', name: 'GEMINI_API_KEY' },
        headers: { 'x-goog-api-client': 'agentroute/0.1.0' },
      },
      ollama: {
        label: 'Ollama (local)',
        protocol: 'openai-chat',
        baseUrl: 'http://127.0.0.1:11434/v1',
        auth: { type: 'none' },
      },
    },
    workers: {},
    defaults: { worker: '', workspaceMode: 'current' },
  };
}

function validateConfig(config) {
  if (!config || typeof config !== 'object') throw new Error('Config must be an object.');
  config.server ||= { host: '127.0.0.1', port: 19777 };
  config.providers ||= {};
  config.workers ||= {};
  config.defaults ||= { worker: '', workspaceMode: 'current' };
  return config;
}

export async function loadConfig({ create = true } = {}) {
  const path = configPath();
  if (!existsSync(path)) {
    const config = defaultConfig();
    if (create) await saveConfig(config);
    return config;
  }
  return validateConfig(JSON.parse(await readFile(path, 'utf8')));
}

export async function saveConfig(config) {
  const path = configPath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(validateConfig(structuredClone(config)), null, 2)}\n`, { mode: 0o600 });
  return path;
}

function sensitiveHeader(name) {
  return /authorization|api[-_]?key|token|secret|credential/i.test(name);
}

export function publicConfig(config) {
  const copy = structuredClone(config);
  for (const provider of Object.values(copy.providers || {})) {
    if (provider.auth?.type === 'static' && provider.auth.value) provider.auth.value = '***';
    if (provider.auth?.type === 'env') provider.auth.available = Boolean(process.env[provider.auth.name]);
    for (const name of Object.keys(provider.headers || {})) {
      if (sensitiveHeader(name) && provider.headers[name]) provider.headers[name] = '***';
    }
  }
  return copy;
}


export function mergePublicConfig(current, incoming) {
  const next = validateConfig(structuredClone(incoming));
  for (const [id, provider] of Object.entries(next.providers || {})) {
    const existing = current?.providers?.[id];
    if (provider.auth?.type === 'static' && provider.auth.value === '***') {
      if (existing?.auth?.type !== 'static') throw new Error(`Cannot preserve redacted static credential for new provider: ${id}`);
      provider.auth.value = existing.auth.value || '';
    }
    if (provider.auth?.type === 'env') delete provider.auth.available;
    for (const [name, value] of Object.entries(provider.headers || {})) {
      if (sensitiveHeader(name) && value === '***') {
        const previous = existing?.headers?.[name];
        if (previous === undefined) throw new Error(`Cannot preserve redacted header for new provider ${id}: ${name}`);
        provider.headers[name] = previous;
      }
    }
  }
  return next;
}

export function providerKey(provider) {
  const auth = provider.auth || { type: 'none' };
  if (auth.type === 'none') return '';
  if (auth.type === 'static') return auth.value || '';
  if (auth.type === 'env') {
    const value = process.env[auth.name];
    if (!value) throw new Error(`Missing provider credential environment variable: ${auth.name}`);
    return value;
  }
  throw new Error(`Unsupported auth type: ${auth.type}`);
}
