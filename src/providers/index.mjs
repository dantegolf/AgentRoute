import { createAnthropicSession } from './anthropic.mjs';
import { createOpenAIChatSession } from './openai-chat.mjs';
import { createOpenAIResponsesSession } from './openai-responses.mjs';
import { fetchJson, joinUrl } from './common.mjs';
import { providerKey } from '../config.mjs';

export function createProviderSession(options) {
  switch (options.provider.protocol) {
    case 'anthropic-messages': return createAnthropicSession(options);
    case 'openai-chat': return createOpenAIChatSession(options);
    case 'openai-responses': return createOpenAIResponsesSession(options);
    default: throw new Error(`Unsupported provider protocol: ${options.provider.protocol}`);
  }
}

function providerHeaders(provider) {
  const key = providerKey(provider);
  if (provider.protocol === 'anthropic-messages') {
    return {
      ...(key ? { 'x-api-key': key } : {}),
      'anthropic-version': '2023-06-01',
      ...(provider.headers || {}),
    };
  }
  return {
    ...(key ? { authorization: `Bearer ${key}` } : {}),
    ...(provider.headers || {}),
  };
}

export async function listProviderModels(provider) {
  const modelsPath = provider.modelsPath || (provider.protocol === 'anthropic-messages' ? 'v1/models' : 'models');
  const endpoint = joinUrl(provider.baseUrl, modelsPath);
  const response = await fetchJson(endpoint, { headers: providerHeaders(provider), timeoutMs: 30000 });
  const source = Array.isArray(response) ? response : Array.isArray(response.data) ? response.data : Array.isArray(response.models) ? response.models : [];
  return source.map((model) => ({
    id: String(model?.id || model?.name || ''),
    label: String(model?.display_name || model?.displayName || model?.name || model?.id || ''),
  })).filter((model) => model.id);
}

export const protocols = [
  { id: 'anthropic-messages', label: 'Anthropic Messages', tools: true },
  { id: 'openai-chat', label: 'OpenAI Chat Completions', tools: true },
  { id: 'openai-responses', label: 'OpenAI Responses', tools: true },
];
