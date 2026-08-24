import { fetchJson, joinUrl, normalizeTools } from './common.mjs';
import { providerKey } from '../config.mjs';

export function createOpenAIChatSession({ provider, worker, system, tools, task }) {
  const apiKey = providerKey(provider);
  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: task },
  ];
  const normalized = normalizeTools(tools);
  const endpoint = joinUrl(provider.baseUrl, 'chat/completions');

  return {
    async step(toolResults = null) {
      if (toolResults) {
        for (const result of toolResults) {
          messages.push({ role: 'tool', tool_call_id: result.id, content: String(result.output) });
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
          messages,
          tools: normalized.map((tool) => ({
            type: 'function',
            function: { name: tool.name, description: tool.description, parameters: tool.parameters },
          })),
          ...(provider.request || {}),
        }),
      });

      const message = response.choices?.[0]?.message;
      if (!message) throw new Error('OpenAI Chat provider returned no assistant message.');
      messages.push(message);
      const toolCalls = (message.tool_calls || []).map((call) => {
        let input = {};
        try { input = JSON.parse(call.function?.arguments || '{}'); } catch { input = {}; }
        return { id: call.id, name: call.function?.name, input };
      });
      return {
        text: typeof message.content === 'string' ? message.content : '',
        toolCalls,
        done: toolCalls.length === 0,
        raw: response,
      };
    },
  };
}
