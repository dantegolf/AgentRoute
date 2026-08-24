import { fetchJson, joinUrl } from './common.mjs';
import { providerKey } from '../config.mjs';

export function createAnthropicSession({ provider, worker, system, tools, task }) {
  const apiKey = providerKey(provider);
  const messages = [{ role: 'user', content: task }];
  const endpoint = joinUrl(provider.baseUrl, 'v1/messages');

  return {
    async step(toolResults = null) {
      if (toolResults) {
        messages.push({
          role: 'user',
          content: toolResults.map((result) => ({
            type: 'tool_result',
            tool_use_id: result.id,
            content: String(result.output),
            ...(result.isError ? { is_error: true } : {}),
          })),
        });
      }

      const body = {
        model: worker.model,
        max_tokens: worker.maxTokens || 16384,
        system,
        messages,
        tools,
        ...(provider.request || {}),
      };
      const response = await fetchJson(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'anthropic-version': '2023-06-01',
          ...(apiKey ? { 'x-api-key': apiKey } : {}),
          ...(provider.headers || {}),
        },
        body: JSON.stringify(body),
      });

      const content = Array.isArray(response.content) ? response.content : [];
      messages.push({ role: 'assistant', content });
      const toolCalls = content
        .filter((block) => block?.type === 'tool_use')
        .map((block) => ({ id: block.id, name: block.name, input: block.input || {} }));
      const text = content.filter((block) => block?.type === 'text').map((block) => block.text).filter(Boolean).join('\n');
      return { text, toolCalls, done: toolCalls.length === 0, raw: response };
    },
  };
}
