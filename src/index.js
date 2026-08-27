// @alertkick/webmcp - register AlertKick's tool surface with WebMCP.
//
//   import { registerAlertKickTools, unregisterAlertKickTools } from '@alertkick/webmcp';
//
//   registerAlertKickTools({
//     request: ({ method, path, query, body }) => fetch(...).then(r => r.json()),
//     confirm: ({ tool, title, input }) => Promise<boolean>,  // your confirm dialog
//   });
//
// Call registerAlertKickTools when a user is logged in and
// unregisterAlertKickTools on logout. Every tool comes from manifest/tools.json,
// which is generated from the AlertKick MCP server, so the in-page surface and
// the hosted MCP connector always expose the same names and schemas.

import manifest from './manifest/tools.js';
import { adapters } from './adapters.js';
import { registerTools, unregisterTools, getModelContext, isSupported } from './model-context.js';

export { manifest, adapters, getModelContext, isSupported };

/**
 * Build WebMCP tool objects (name, description, inputSchema, annotations,
 * execute) for every manifest tool, or the subset in `only`.
 *
 * options.request({ method, path, query, body }) -> Promise<any>
 *   Performs the API call against /api/v1 with the user's credentials.
 *   Must reject (or throw) on non-2xx; the message is returned to the agent.
 * options.confirm({ tool, title, description, input }) -> Promise<boolean>
 *   Required for write tools. Called inside requestUserInteraction() when
 *   the browser provides it, so the agent pauses until the person answers.
 * options.only  optional array of tool names to expose.
 * options.readOnly  when true, skip every write tool (mirrors the hosted
 *   connector's read-only OAuth grant).
 */
export function createAlertKickTools(options) {
  const { request, confirm, only, readOnly = false } = options || {};
  if (typeof request !== 'function') throw new Error('createAlertKickTools: options.request is required');

  const wanted = only ? new Set(only) : null;
  const tools = [];
  for (const t of manifest.tools) {
    if (wanted && !wanted.has(t.name)) continue;
    const isRead = Boolean(t.annotations && t.annotations.readOnlyHint);
    if (readOnly && !isRead) continue;
    const adapter = adapters[t.name];
    if (!adapter) {
      console.warn(`[webmcp] no adapter for manifest tool ${t.name}; skipped`);
      continue;
    }
    if (!isRead && typeof confirm !== 'function') {
      throw new Error(`createAlertKickTools: options.confirm is required to expose write tool ${t.name}`);
    }
    tools.push({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
      annotations: {
        readOnlyHint: isRead,
        destructiveHint: Boolean(t.annotations && t.annotations.destructiveHint),
        idempotentHint: Boolean(t.annotations && t.annotations.idempotentHint),
      },
      execute: (input, client) => execute({ tool: t, adapter, isRead, input, client, request, confirm }),
    });
  }
  return tools;
}

let active = [];

export function registerAlertKickTools(options) {
  const tools = createAlertKickTools(options);
  active = registerTools(tools);
  return active;
}

export function unregisterAlertKickTools() {
  unregisterTools(active);
  active = [];
}

async function execute({ tool, adapter, isRead, input, client, request, confirm }) {
  // Treat agent input like a form submission: adapters validate required
  // fields and defaults; the API validates everything again.
  let call;
  try {
    call = adapter(input && typeof input === 'object' ? input : {});
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }

  if (!isRead) {
    const approved = await askUser(client, () =>
      confirm({ tool: tool.name, title: tool.title || tool.name, description: tool.description, input })
    );
    if (!approved) return { ok: false, cancelled: true, error: 'The user declined this action.' };
  }

  try {
    const data = await request({ method: call.method, path: call.path, query: call.query, body: call.body });
    const out = { ok: true, data };
    if (call.link) {
      const href = call.link(data);
      if (href) out.ui_url = absolute(href);
    }
    return out;
  } catch (err) {
    return { ok: false, error: describeError(err) };
  }
}

// Prefer the spec's requestUserInteraction so the agent is paused for the
// duration of the dialog; fall back to calling the confirm directly.
async function askUser(client, fn) {
  if (client && typeof client.requestUserInteraction === 'function') {
    let result = false;
    await client.requestUserInteraction(async () => {
      result = Boolean(await fn());
    });
    return result;
  }
  return Boolean(await fn());
}

function absolute(href) {
  try {
    return new URL(href, globalThis.location && globalThis.location.origin).toString();
  } catch {
    return href;
  }
}

function describeError(err) {
  if (!err) return 'request failed';
  const r = err.response; // axios shape
  if (r) {
    const msg = r.data && (r.data.error || r.data.message || r.data.detail);
    return `${r.status}${msg ? ': ' + msg : ''}`;
  }
  return String(err.message || err);
}
