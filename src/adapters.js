// One adapter per tool in manifest/tools.json. Each maps validated agent
// input to the exact /api/v1 request the hosted MCP server would make
// (see alertkick-mcp/client/client.go), including the same defaults.
//
// Adapters return { method, path, query?, body?, link?(data) }. `link`
// builds the relative UI URL for a created/fetched resource so the agent
// can hand the user a doorway into the dashboard.
//
// Nothing here decides *whether* a call is allowed: the API enforces
// tenant scope, plan limits and roles on every request exactly as it does
// for the normal UI.

const int = (v, d) => (Number.isInteger(v) && v > 0 ? v : d);
const clamp = (v, d, max) => Math.min(int(v, d), max);
const str = (v, d = '') => (typeof v === 'string' && v.trim() ? v.trim() : d);
const paging = (i, max = 200) => ({ offset: int(i.offset, 0), limit: clamp(i.limit, 50, max) });
const req = (name, v) => {
  if (v === undefined || v === null || v === '') throw new Error(`${name} is required`);
  return v;
};
const uuidPath = (prefix, i) => `${prefix}/${encodeURIComponent(req('uuid', i.uuid))}`;

export const adapters = {
  // Servers
  list_servers: (i) => ({ method: 'GET', path: '/hosts', query: paging(i), link: () => '/servers' }),
  get_server: (i) => ({ method: 'GET', path: uuidPath('/hosts', i), link: () => `/servers/${i.uuid}` }),
  get_server_containers: (i) => ({ method: 'GET', path: uuidPath('/hosts', i) + '/containers' }),

  // Alerts
  list_alerts: (i) => ({
    method: 'GET',
    path: '/alerts',
    query: { ...paging(i), ...(str(i.status) && { status: str(i.status) }) },
    link: () => '/alerts',
  }),
  get_alert: (i) => ({ method: 'GET', path: uuidPath('/alerts', i), link: () => `/alerts/${i.uuid}` }),
  acknowledge_alert: (i) => ({ method: 'POST', path: '/alerts/acknowledge', body: { UUIDs: [req('uuid', i.uuid)] } }),
  resolve_alert: (i) => ({ method: 'POST', path: '/alerts/resolve', body: { UUIDs: [req('uuid', i.uuid)] } }),

  // Security events
  list_security_events: (i) => ({
    method: 'GET',
    path: '/security-events',
    query: {
      duration: str(i.duration, '24h'),
      ...paging(i, 500),
      ...(str(i.priority) && { priority: str(i.priority) }),
      ...(str(i.agent_type) && { agent_type: str(i.agent_type) }),
      ...(str(i.rule) && { rule: str(i.rule) }),
      ...(str(i.host_uuid) && { host_uuid: str(i.host_uuid) }),
      ...(str(i.llm_verdict) && { llm_verdict: str(i.llm_verdict) }),
      ...(str(i.event_class) && { event_class: str(i.event_class) }),
    },
    link: () => '/security-events',
  }),
  get_security_event_stats: (i) => ({
    method: 'GET',
    path: '/security-events/stats',
    query: { duration: str(i.duration, '24h') },
  }),

  // Monitors
  list_monitors: (i) => ({ method: 'GET', path: '/monitors/all', query: paging(i), link: () => '/monitors' }),
  get_monitor: (i) => ({ method: 'GET', path: uuidPath('/monitors', i), link: () => `/monitors/${i.uuid}` }),
  create_monitor: (i) => {
    const type = req('monitor_type', i.monitor_type);
    if (type === 'tcp' && !int(i.tcp_port, 0)) throw new Error('tcp_port is required for tcp monitors');
    const body = {
      display_name: req('display_name', i.display_name),
      monitor_type: type,
      url: req('url', i.url),
      timeout_seconds: int(i.timeout_seconds, 30),
      check_interval_seconds: int(i.check_interval_seconds, 300),
      expected_status_code: int(i.expected_status_code, 200),
    };
    if (type === 'http' || type === 'api') body.http_method = str(i.http_method, 'GET');
    if (str(i.expected_response_contains)) body.expected_response_contains = i.expected_response_contains;
    if (int(i.tcp_port, 0)) body.tcp_port = i.tcp_port;
    if (str(i.dns_record_type)) body.dns_record_type = i.dns_record_type;
    if (str(i.expected_dns_host)) body.expected_dns_host = i.expected_dns_host;
    if (i.ssl_cert_monitoring || int(i.ssl_cert_expiry_alert_days, 0)) {
      body.ssl_cert_monitoring = true;
      if (int(i.ssl_cert_expiry_alert_days, 0)) body.ssl_cert_expiry_alert_days = i.ssl_cert_expiry_alert_days;
    }
    if (int(i.domain_expiry_alert_days, 0)) body.domain_expiry_alert_days = i.domain_expiry_alert_days;
    if (int(i.response_time_alert_ms, 0)) body.response_time_alert_ms = i.response_time_alert_ms;
    if (int(i.failure_threshold, 0)) body.failure_threshold = i.failure_threshold;
    return createMonitor(body);
  },
  create_https_monitor: (i) => {
    const url = req('url', i.url);
    const body = {
      display_name: req('display_name', i.display_name),
      monitor_type: 'http',
      url,
      http_method: 'GET',
      expected_status_code: int(i.expected_status_code, 200),
      ssl_cert_monitoring:
        typeof i.monitor_ssl_cert === 'boolean' ? i.monitor_ssl_cert : url.toLowerCase().startsWith('https://'),
      timeout_seconds: 30,
      check_interval_seconds: int(i.check_interval_seconds, 300),
    };
    if (str(i.expected_response_contains)) body.expected_response_contains = i.expected_response_contains;
    if (int(i.ssl_cert_expiry_alert_days, 0)) body.ssl_cert_expiry_alert_days = i.ssl_cert_expiry_alert_days;
    if (int(i.response_time_alert_ms, 0)) body.response_time_alert_ms = i.response_time_alert_ms;
    if (int(i.failure_threshold, 0)) body.failure_threshold = i.failure_threshold;
    return createMonitor(body);
  },
  create_dns_monitor: (i) => {
    const recordType = str(i.record_type, 'A').toUpperCase();
    if (!['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS'].includes(recordType)) {
      throw new Error('record_type must be one of A, AAAA, CNAME, MX, TXT, NS');
    }
    const body = {
      display_name: req('display_name', i.display_name),
      monitor_type: 'dns',
      url: req('hostname', i.hostname),
      dns_record_type: recordType,
      timeout_seconds: 30,
      check_interval_seconds: int(i.check_interval_seconds, 300),
    };
    if (str(i.expected_value)) body.expected_dns_host = i.expected_value;
    return createMonitor(body);
  },
  create_domain_expiry_monitor: (i) => {
    let domain = req('domain', i.domain).trim().toLowerCase().replace(/^https?:\/\//, '');
    domain = domain.split('/')[0].replace(/\.$/, '');
    const body = {
      display_name: req('display_name', i.display_name),
      monitor_type: 'domain',
      url: domain,
      timeout_seconds: 30,
      check_interval_seconds: 86400,
    };
    if (int(i.domain_expiry_alert_days, 0)) body.domain_expiry_alert_days = i.domain_expiry_alert_days;
    return createMonitor(body);
  },
  create_tcp_monitor: (i) => {
    const port = Number(req('port', i.port));
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`port must be 1-65535, got ${i.port}`);
    const body = {
      display_name: req('display_name', i.display_name),
      monitor_type: 'tcp',
      url: req('host', i.host),
      tcp_port: port,
      timeout_seconds: 30,
      check_interval_seconds: int(i.check_interval_seconds, 300),
    };
    if (int(i.failure_threshold, 0)) body.failure_threshold = i.failure_threshold;
    return createMonitor(body);
  },
  pause_monitor: (i) => ({ method: 'POST', path: uuidPath('/monitors', i) + '/pause', body: {} }),
  resume_monitor: (i) => ({ method: 'POST', path: uuidPath('/monitors', i) + '/resume', body: {} }),
  delete_monitor: (i) => ({ method: 'DELETE', path: uuidPath('/monitors', i) }),

  // Heartbeats
  list_heartbeats: (i) => ({ method: 'GET', path: '/heartbeats/all', query: paging(i), link: () => '/heartbeats' }),
  get_heartbeat: (i) => ({ method: 'GET', path: uuidPath('/heartbeats', i), link: () => `/heartbeats/show/${i.uuid}` }),
  create_heartbeat: (i) => ({
    // Auto-provision endpoint: idempotent on slug, returns uuid + slug.
    method: 'GET',
    path: `/hb/auto/${encodeURIComponent(req('slug', i.slug))}`,
    query: {
      ...(int(i.interval_seconds, 0) && { interval: i.interval_seconds }),
      ...(int(i.grace_seconds, 0) && { grace: i.grace_seconds }),
      ...(str(i.name) && { name: i.name }),
    },
    link: (d) => (d && d.uuid ? `/heartbeats/show/${d.uuid}` : '/heartbeats'),
  }),
  enable_heartbeat: (i) => ({ method: 'POST', path: uuidPath('/heartbeats', i) + '/enable', body: {} }),
  disable_heartbeat: (i) => ({ method: 'POST', path: uuidPath('/heartbeats', i) + '/disable', body: {} }),
  delete_heartbeat: (i) => ({ method: 'POST', path: '/heartbeats/delete', body: { uuid: req('uuid', i.uuid) } }),

  // Incidents
  list_incidents: (i) => ({
    method: 'GET',
    path: '/incidents/all',
    query: {
      ...paging(i),
      ...(str(i.status) && { status: str(i.status) }),
      ...(str(i.severity) && { severity: str(i.severity) }),
    },
    link: () => '/incidents',
  }),
  get_incident: (i) => ({ method: 'GET', path: uuidPath('/incidents', i), link: () => `/incidents/${i.uuid}` }),

  // Change control
  list_changes: (i) => ({
    method: 'GET',
    path: '/changes/all',
    query: {
      ...paging(i),
      ...(str(i.status) && { status: str(i.status) }),
      ...(str(i.host_uuid) && { host_uuid: str(i.host_uuid) }),
    },
    link: () => '/changes',
  }),
  get_change: (i) => ({ method: 'GET', path: uuidPath('/changes', i), link: () => `/changes/${i.uuid}` }),
  create_change: (i) => {
    const hosts = Array.isArray(i.host_uuids) ? i.host_uuids.filter(Boolean) : [];
    if (!hosts.length) throw new Error('host_uuids must contain at least one host UUID');
    return {
      method: 'POST',
      path: '/changes/create',
      body: {
        title: req('title', i.title),
        description: str(i.description),
        window_start: req('window_start', i.window_start),
        window_end: req('window_end', i.window_end),
        host_uuids: hosts,
      },
      link: (d) => (d && d.uuid ? `/changes/${d.uuid}` : '/changes'),
    };
  },
  approve_change: (i) => ({ method: 'POST', path: uuidPath('/changes', i) + '/approve', body: {} }),
  start_change: (i) => ({ method: 'POST', path: uuidPath('/changes', i) + '/start', body: {} }),
  complete_change: (i) => ({ method: 'POST', path: uuidPath('/changes', i) + '/complete', body: {} }),
  verify_change: (i) => ({ method: 'POST', path: uuidPath('/changes', i) + '/verify', body: {} }),
};

function createMonitor(body) {
  return {
    method: 'POST',
    path: '/monitors/create',
    body,
    link: (d) => (d && d.uuid ? `/monitors/${d.uuid}` : '/monitors'),
  };
}
