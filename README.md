# @alertkick/webmcp

WebMCP tools for [AlertKick](https://alertkick.com) website and server monitoring.

[WebMCP](https://webmachinelearning.github.io/webmcp/) lets a page register
tools with the browser's agent (`navigator.modelContext`). An agent such as
the ChatGPT desktop browser or Chrome with `#enable-webmcp-testing` can then
call those tools in the user's logged-in session instead of scraping the DOM.

This package exposes AlertKick's existing MCP tool surface in the page:

- **One manifest, two transports.** `src/manifest/tools.json` is generated from
  the AlertKick MCP server (`alertkick-mcp/cmd/webmcp-manifest`), so the
  in-page tools and the hosted connector at `mcp.alertkick.com` share names,
  descriptions and JSON Schemas. The browser only supplies `execute()`.
- **Session scoped.** Register on login, unregister on logout. Every call
  goes through the same `/api/v1` client the dashboard uses; the API enforces
  tenant scope, roles and plan limits exactly as it does for a human.
- **Human in the loop on writes.** Read tools carry `readOnlyHint: true`.
  Every write runs your `confirm()` inside `requestUserInteraction()` so the
  agent pauses until the person approves.

## Install

```sh
npm install @alertkick/webmcp
# or vendor it: scripts/sync-to.sh ../your-app/src/lib/webmcp
```

## Dashboard usage (React example)

```js
import { registerAlertKickTools, unregisterAlertKickTools } from '@alertkick/webmcp';

useEffect(() => {
  if (!user) return;
  registerAlertKickTools({
    request: ({ method, path, query, body }) =>
      api({ method, url: path, params: query, data: body }).then((r) => r.data),
    confirm: ({ tool, title, input }) => showConfirmDialog(title, input), // Promise<boolean>
  });
  return () => unregisterAlertKickTools();
}, [user]);
```

Options: `only: [...names]` to expose a subset, `readOnly: true` to drop
every write tool (mirrors the hosted connector's read-only OAuth grant).

Tool results are `{ ok: true, data, ui_url? }` or
`{ ok: false, error, cancelled? }`. Adapters validate required fields and
apply the same defaults as the MCP server; errors are returned, not thrown.

## Page tools (no auth)

For public pages such as the free checkers at alertkick.com/tools:

```js
import { registerPageTool } from '@alertkick/webmcp/page-tool';

registerPageTool({
  name: 'check_ssl_certificate',
  description: 'Check the TLS certificate served by a hostname: expiry, chain trust, hostname match, protocol, SANs.',
  inputSchema: { type: 'object', properties: { host: { type: 'string', description: 'hostname, e.g. example.com' } }, required: ['host'] },
  execute: ({ host }) => fetch(`/api/tools/ssl-check?host=${encodeURIComponent(host)}`).then((r) => r.json()),
});
```

## Tools

| Tool | Read-only | What it does |
|------|-----------|--------------|
| `acknowledge_alert` | no, confirmed | Acknowledge an open alert. |
| `approve_change` | no, confirmed | Approve a requested change, moving it to "approved" status so it can be started. |
| `complete_change` | no, confirmed | Complete a started change. |
| `create_change` | no, confirmed | Create a new change request in "requested" status with a title, maintenance window, and target servers. |
| `create_dns_monitor` | no, confirmed | Create a DNS monitor that resolves a record on an interval and alerts on resolution failure — or, when expected_value is set, whenever the answer no longer matches it (hijack/misconfiguration detection). |
| `create_domain_expiry_monitor` | no, confirmed | Create a domain registration expiry monitor. |
| `create_heartbeat` | no, confirmed | Create a heartbeat monitor for a cron job or scheduled task. |
| `create_https_monitor` | no, confirmed | Create an uptime monitor for a website or API endpoint. |
| `create_monitor` | no, confirmed | Create an uptime monitor. |
| `create_tcp_monitor` | no, confirmed | Create a TCP monitor that opens a connection to host:port on an interval and alerts when the port stops accepting connections (databases, mail servers, game servers, anything not speaking HTTP). |
| `delete_heartbeat` | no, confirmed | Permanently delete a heartbeat monitor. |
| `delete_monitor` | no, confirmed | Permanently delete a monitor and stop all its checks. |
| `disable_heartbeat` | no, confirmed | Disable a heartbeat so missed pings stop alerting (e.g. |
| `enable_heartbeat` | no, confirmed | Enable a disabled heartbeat so missed pings alert again. |
| `get_alert` | yes | Get detailed information about a specific alert including its full history and associated server. |
| `get_change` | yes | Get detailed information about a specific change request, including its status, verification status (pending, running, clean, changes_detected, failed), maintenance window, and affected servers. |
| `get_heartbeat` | yes | Get a heartbeat's full configuration and state, including its ping key and current health. |
| `get_incident` | yes | Get detailed information about a specific incident including its full timeline of updates. |
| `get_monitor` | yes | Get detailed information about a specific monitor including its configuration, check history, and assigned pollers. |
| `get_security_event_stats` | yes | Get aggregate statistics for security events: counts by priority, rule, host, and AI verdict over a time range. |
| `get_server` | yes | Get detailed information about a specific server including checks, host info, uptime, and agent details. |
| `get_server_containers` | yes | Get Docker containers running on a specific server, including status, CPU, memory, and network stats. |
| `list_alerts` | yes | List alerts with optional status filter. |
| `list_changes` | yes | List change requests with optional status and host filters. |
| `list_heartbeats` | yes | List all heartbeat monitors. |
| `list_incidents` | yes | List incidents with optional status and severity filters. |
| `list_monitors` | yes | List all HTTP/TCP/DNS/SSL monitors with their current status, response times, and check intervals. |
| `list_security_events` | yes | List security events (eBPF detections) with optional filters for priority, rule, host, AI verdict, and time range. |
| `list_servers` | yes | List all monitored servers with their status, hostname, IP addresses, OS info, and agent version. |
| `pause_monitor` | no, confirmed | Pause a monitor: checks stop and no alerts fire until it is resumed. |
| `resolve_alert` | no, confirmed | Resolve an alert, marking the issue as fixed. |
| `resume_monitor` | no, confirmed | Resume a paused monitor so checks and alerting start again. |
| `start_change` | no, confirmed | Start an approved change. |
| `verify_change` | no, confirmed | Re-run the FIM verification for a completed change. |

## Regenerating the manifest

```sh
scripts/build-manifest.sh   # needs ../alertkick-mcp and Go
npm test                    # asserts every manifest tool has an adapter
```

## Testing in a browser

- Chrome 146+: enable `chrome://flags/#enable-webmcp-testing`, load the
  page, then in DevTools: `await navigator.modelContextTesting.getTools()` and
  `await navigator.modelContextTesting.executeTool('list_alerts', { status: 'open' })`.
- ChatGPT desktop app: open the page in the built-in browser and ask.

`example/index.html` is a self-contained page that registers the full tool
set against a fake API so you can try the flow without an account.

## License

MIT. See LICENSE.
