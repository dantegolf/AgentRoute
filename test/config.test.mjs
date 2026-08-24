import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultConfig, mergePublicConfig, publicConfig } from '../src/config.mjs';

test('public config redacts static credentials and merge preserves them', () => {
  const current = defaultConfig();
  current.providers.headerSecret = { label: 'Header Secret', protocol: 'openai-chat', baseUrl: 'http://localhost', auth: { type: 'none' }, headers: { Authorization: 'Bearer secret', 'x-client': 'safe' } };
  const visible = publicConfig(current);
  assert.equal(visible.providers.claudegravity.auth.value, '***');
  assert.equal(visible.providers.headerSecret.headers.Authorization, '***');
  assert.equal(visible.providers.headerSecret.headers['x-client'], 'safe');

  visible.providers.custom = {
    label: 'Custom',
    protocol: 'openai-chat',
    baseUrl: 'http://localhost:9999/v1',
    auth: { type: 'env', name: 'CUSTOM_KEY', available: true },
  };
  const merged = mergePublicConfig(current, visible);
  assert.equal(merged.providers.claudegravity.auth.value, 'antigravity');
  assert.equal(merged.providers.headerSecret.headers.Authorization, 'Bearer secret');
  assert.equal('available' in merged.providers.custom.auth, false);
});

test('default config contains protocol-oriented provider presets', () => {
  const config = defaultConfig();
  assert.equal(config.providers.omnirouter.protocol, 'openai-responses');
  assert.equal(config.providers.openrouter.protocol, 'openai-chat');
  assert.equal(config.providers.gemini.protocol, 'openai-chat');
  assert.equal(config.providers.anthropic.protocol, 'anthropic-messages');
});
