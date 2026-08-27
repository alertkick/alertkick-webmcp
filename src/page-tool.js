// Register a single read-only tool on a plain page (marketing sites,
// free-tool pages, status pages). No auth, no manifest: the page describes
// its own tool. Used by alertkick.com/tools/*.
//
//   import { registerPageTool } from '@alertkick/webmcp/page-tool';
//   registerPageTool({
//     name: 'check_ssl_certificate',
//     description: 'Check a hostname's TLS certificate ...',
//     inputSchema: { type: 'object', properties: { host: { type: 'string' } }, required: ['host'] },
//     execute: ({ host }) => fetch(`/api/tools/ssl-check?host=${encodeURIComponent(host)}`).then(r => r.json()),
//   });

import { registerTools, unregisterTools, isSupported } from './model-context.js';

export { isSupported };

export function registerPageTool({ name, description, inputSchema, execute, readOnly = true }) {
  if (!name || !description || typeof execute !== 'function') {
    throw new Error('registerPageTool: name, description and execute are required');
  }
  const tool = {
    name,
    description,
    inputSchema: inputSchema || { type: 'object', properties: {} },
    annotations: { readOnlyHint: readOnly },
    execute: async (input, client) => {
      try {
        const data = await execute(input || {}, client);
        return { ok: true, data };
      } catch (err) {
        return { ok: false, error: String((err && err.message) || err) };
      }
    },
  };
  registerTools([tool]);
  return () => unregisterTools([name]);
}
