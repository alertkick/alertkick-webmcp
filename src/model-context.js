/* global globalThis */
// Thin, defensive wrapper over the WebMCP entry point.
//
// The spec moved the attribute during 2026 (navigator.modelContext first,
// document.modelContext in later drafts) and removed provideContext(), so
// this file only relies on registerTool / unregisterTool and resolves
// whichever attribute the browser exposes. Everything is a no-op when the
// browser has no WebMCP support, so callers never need to feature-detect.

const registry = new Map(); // name -> tool, tracks what WE registered

export function getModelContext(root = globalThis) {
  const nav = root.navigator;
  const doc = root.document;
  const mc = (nav && nav.modelContext) || (doc && doc.modelContext) || null;
  return mc && typeof mc.registerTool === 'function' ? mc : null;
}

export function isSupported(root = globalThis) {
  return getModelContext(root) !== null;
}

/**
 * Register a list of WebMCP tools. Re-registering a name we already own
 * unregisters the old one first, so React effects and route changes can
 * call this freely without tripping InvalidStateError on duplicates.
 * Returns the names actually registered (empty when unsupported).
 */
export function registerTools(tools, root = globalThis) {
  const mc = getModelContext(root);
  if (!mc) return [];
  const done = [];
  for (const tool of tools) {
    if (registry.has(tool.name)) safeUnregister(mc, tool.name);
    try {
      mc.registerTool(tool);
      registry.set(tool.name, tool);
      done.push(tool.name);
    } catch (err) {
      // Never let one bad tool block the rest; surface it for the console.
      console.warn(`[webmcp] failed to register ${tool.name}:`, err);
    }
  }
  return done;
}

export function unregisterTools(names, root = globalThis) {
  const mc = getModelContext(root);
  if (!mc) return;
  for (const name of names) safeUnregister(mc, name);
}

export function unregisterAll(root = globalThis) {
  unregisterTools([...registry.keys()], root);
}

export function registeredToolNames() {
  return [...registry.keys()];
}

function safeUnregister(mc, name) {
  try {
    mc.unregisterTool(name);
  } catch {
    /* already gone */
  }
  registry.delete(name);
}
