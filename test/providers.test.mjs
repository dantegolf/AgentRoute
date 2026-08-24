import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createProviderSession } from '../src/providers/index.mjs';

const tools = [{
  name: 'read_file',
  description: 'read',
  input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
}];

async function withServer(handler, fn) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try { return await fn(`http://127.0.0.1:${port}`); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

async function readJson(req) {
  let text = '';
  for await (const chunk of req) text += chunk;
  return JSON.parse(text || '{}');
}

function send(res, body) {
  const text = JSON.stringify(body);
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(text);
}

test('Anthropic Messages adapter completes a tool round trip', async () => {
  let calls = 0;
  await withServer(async (req, res) => {
    const body = await readJson(req);
    calls++;
    assert.equal(req.url, '/v1/messages');
    if (calls === 1) {
      assert.equal(body.tools[0].name, 'read_file');
      return send(res, { content: [{ type: 'tool_use', id: 't1', name: 'read_file', input: { path: 'a.txt' } }] });
    }
    assert.equal(body.messages.at(-1).content[0].tool_use_id, 't1');
    return send(res, { content: [{ type: 'text', text: 'done' }] });
  }, async (baseUrl) => {
    const session = createProviderSession({ provider: { protocol: 'anthropic-messages', baseUrl, auth: { type: 'none' } }, worker: { model: 'fake' }, system: 'sys', tools, task: 'task' });
    const first = await session.step();
    assert.equal(first.toolCalls[0].name, 'read_file');
    const second = await session.step([{ id: 't1', output: 'hello' }]);
    assert.equal(second.done, true);
    assert.equal(second.text, 'done');
  });
});

test('OpenAI Chat adapter completes a function round trip', async () => {
  let calls = 0;
  await withServer(async (req, res) => {
    const body = await readJson(req);
    calls++;
    assert.equal(req.url, '/chat/completions');
    if (calls === 1) {
      assert.equal(body.tools[0].type, 'function');
      return send(res, { choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'read_file', arguments: '{"path":"a.txt"}' } }] } }] });
    }
    assert.equal(body.messages.at(-1).tool_call_id, 'c1');
    return send(res, { choices: [{ message: { role: 'assistant', content: 'done' } }] });
  }, async (baseUrl) => {
    const session = createProviderSession({ provider: { protocol: 'openai-chat', baseUrl, auth: { type: 'none' } }, worker: { model: 'fake' }, system: 'sys', tools, task: 'task' });
    const first = await session.step();
    assert.deepEqual(first.toolCalls[0].input, { path: 'a.txt' });
    const second = await session.step([{ id: 'c1', output: 'hello' }]);
    assert.equal(second.done, true);
    assert.equal(second.text, 'done');
  });
});

test('OpenAI Responses adapter completes a function round trip', async () => {
  let calls = 0;
  await withServer(async (req, res) => {
    const body = await readJson(req);
    calls++;
    assert.equal(req.url, '/responses');
    assert.equal(body.store, false);
    assert.ok(body.include.includes('reasoning.encrypted_content'));
    if (calls === 1) {
      return send(res, { output: [{ type: 'function_call', id: 'item1', call_id: 'r1', name: 'read_file', arguments: '{"path":"a.txt"}' }] });
    }
    assert.ok(body.input.some((item) => item.type === 'function_call_output' && item.call_id === 'r1'));
    return send(res, { output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'done' }] }] });
  }, async (baseUrl) => {
    const session = createProviderSession({ provider: { protocol: 'openai-responses', baseUrl, auth: { type: 'none' } }, worker: { model: 'fake' }, system: 'sys', tools, task: 'task' });
    const first = await session.step();
    assert.equal(first.toolCalls[0].id, 'r1');
    const second = await session.step([{ id: 'r1', output: 'hello' }]);
    assert.equal(second.done, true);
    assert.equal(second.text, 'done');
  });
});

test('provider model discovery normalizes standard model lists', async () => {
  const { listProviderModels } = await import('../src/providers/index.mjs');
  await withServer((req, res) => {
    assert.equal(req.url, '/models');
    assert.equal(req.headers.authorization, 'Bearer test-key');
    send(res, { data: [{ id: 'm1' }, { id: 'm2', name: 'Model Two' }] });
  }, async (baseUrl) => {
    const models = await listProviderModels({ protocol: 'openai-chat', baseUrl, auth: { type: 'static', value: 'test-key' } });
    assert.deepEqual(models, [{ id: 'm1', label: 'm1' }, { id: 'm2', label: 'Model Two' }]);
  });
});


test('Anthropic model discovery uses /v1/models', async () => {
  const { listProviderModels } = await import('../src/providers/index.mjs');
  await withServer((req, res) => {
    assert.equal(req.url, '/v1/models');
    assert.equal(req.headers['x-api-key'], 'anthropic-key');
    send(res, { data: [{ id: 'claude-test', display_name: 'Claude Test' }] });
  }, async (baseUrl) => {
    const models = await listProviderModels({ protocol: 'anthropic-messages', baseUrl, auth: { type: 'static', value: 'anthropic-key' } });
    assert.deepEqual(models, [{ id: 'claude-test', label: 'Claude Test' }]);
  });
});
