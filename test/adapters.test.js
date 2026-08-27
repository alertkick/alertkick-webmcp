import test from 'node:test';
import assert from 'node:assert/strict';
import manifest from '../manifest/tools.js';
import { adapters } from '../src/adapters.js';
import { createAlertKickTools } from '../src/index.js';
import { registerTools, unregisterAll, registeredToolNames } from '../src/model-context.js';

test('every manifest tool has an adapter and vice versa', () => {
  const names = manifest.tools.map((t) => t.name).sort();
  assert.deepEqual(Object.keys(adapters).sort(), names);
});

test('every manifest tool carries an input schema and annotations', () => {
  for (const t of manifest.tools) {
    assert.equal(t.inputSchema.type, 'object', t.name);
    assert.equal(typeof t.annotations.readOnlyHint, 'boolean', t.name);
  }
});

test('read tools never confirm, write tools always do', async () => {
  const calls = [];
  let confirms = 0;
  const tools = createAlertKickTools({
    request: async (c) => (calls.push(c), { uuid: 'abc' }),
    confirm: async () => (confirms++, true),
  });
  const byName = Object.fromEntries(tools.map((t) => [t.name, t]));

  const r = await byName.list_alerts.execute({ status: 'open', limit: 999 });
  assert.equal(r.ok, true);
  assert.equal(confirms, 0);
  assert.deepEqual(calls.at(-1), { method: 'GET', path: '/alerts', query: { offset: 0, limit: 200, status: 'open' }, body: undefined });

  const w = await byName.create_https_monitor.execute({ display_name: 'Site', url: 'https://example.com' });
  assert.equal(w.ok, true);
  assert.equal(confirms, 1);
  assert.equal(calls.at(-1).path, '/monitors/create');
  assert.equal(calls.at(-1).body.ssl_cert_monitoring, true);
  assert.match(w.ui_url, /\/monitors\/abc$/);
});

test('declined confirmation cancels without calling the API', async () => {
  const calls = [];
  const [del] = createAlertKickTools({
    request: async (c) => calls.push(c),
    confirm: async () => false,
    only: ['delete_monitor'],
  });
  const r = await del.execute({ uuid: 'x' });
  assert.equal(r.ok, false);
  assert.equal(r.cancelled, true);
  assert.equal(calls.length, 0);
});

test('requestUserInteraction is used when the browser provides it', async () => {
  let paused = 0;
  const [ack] = createAlertKickTools({ request: async () => ({}), confirm: async () => true, only: ['acknowledge_alert'] });
  const r = await ack.execute({ uuid: 'x' }, { requestUserInteraction: async (cb) => (paused++, cb()) });
  assert.equal(r.ok, true);
  assert.equal(paused, 1);
});

test('adapter validation errors are returned, not thrown', async () => {
  const [tcp] = createAlertKickTools({ request: async () => ({}), confirm: async () => true, only: ['create_tcp_monitor'] });
  const r = await tcp.execute({ display_name: 'db', host: 'db.internal', port: 70000 });
  assert.equal(r.ok, false);
  assert.match(r.error, /port must be 1-65535/);
});

test('readOnly option drops every write tool', () => {
  const tools = createAlertKickTools({ request: async () => ({}), readOnly: true });
  assert.ok(tools.length > 0);
  assert.ok(tools.every((t) => t.annotations.readOnlyHint));
});

test('registerTools is a no-op without WebMCP and idempotent with it', () => {
  assert.deepEqual(registerTools([{ name: 'x' }], {}), []);
  const reg = new Map();
  const fake = {
    navigator: {
      modelContext: {
        registerTool: (t) => {
          if (reg.has(t.name)) throw new Error('InvalidStateError');
          reg.set(t.name, t);
        },
        unregisterTool: (n) => reg.delete(n),
      },
    },
  };
  assert.deepEqual(registerTools([{ name: 'a' }, { name: 'b' }], fake), ['a', 'b']);
  assert.deepEqual(registerTools([{ name: 'a' }], fake), ['a']); // re-register does not throw
  assert.deepEqual(registeredToolNames().sort(), ['a', 'b']);
  unregisterAll(fake);
  assert.equal(reg.size, 0);
});
