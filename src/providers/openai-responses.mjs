import { fetchJson, joinUrl, normalizeTools } from './common.mjs';
import { providerKey } from '../config.mjs';

export function createOpenAIResponsesSession({ provider, worker, system, tools, task }) {
  const apiKey = providerKey(provider);
  const input = [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: task }] }];
  const normalized = normalizeTools(tools);
  const endpoint = joinUrl(provider.baseUrl, 'responses');

  return {
    async step(toolResults = null) {
      if (toolResults) {
        for (const result of toolResults) {
          input.push({ type: 'function_call_output', call_id: result.id, output: String(result.output) });
        }
      }

      const response = await fetchJson(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
          ...(provider.headers || {}),
        },
        body: JSON.stringify({
          model: worker.model,
          instructions: system,
          input,
          tools: normalized.map((tool) => ({
            type: 'function',
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
          })),
          store: false,
          include: ['reasoning.encrypted_content'],
          ...(provider.request || {}),
        }),
      });

      const output = Array.isArray(response.output) ? response.output : [];
      input.push(...output);
      const toolCalls = output
        .filter((item) => item?.type === 'function_call')
        .map((item) => {
          let parsed = {};
          try { parsed = JSON.parse(item.arguments || '{}'); } catch { parsed = {}; }
          return { id: item.call_id || item.id, name: item.name, input: parsed };
        });
      const text = output
        .filter((item) => item?.type === 'message')
        .flatMap((item) => item.content || [])
        .filter((part) => part?.type === 'output_text')
        .map((part) => part.text)
        .filter(Boolean)
        .join('\n');

      return { text, toolCalls, done: toolCalls.length === 0, raw: response };
    },
  };
}
