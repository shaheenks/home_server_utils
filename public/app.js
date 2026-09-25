// app.js

const state = {
  servers: {},            // id → { status, data }
  lastChecked: null,
};

const servers = () => window.CONFIG.SERVERS || [];

// ── Data fetching ─────────────────────────────────────────────────────────────

async function fetchServerStatus(server) {
  const entry = state.servers[server.id];
  try {
    const resp = await fetch(`${server.agent_url}/status`, { cache: "no-store" });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    entry.data = await resp.json();
    entry.status = entry.data.overall || "ok";
  } catch (e) {
    entry.status = "unreachable";
    entry.data = null;
    console.warn(`${server.name} agent unreachable:`, e.message);
  }
}

async function refresh() {
  for (const s of servers()) {
    state.servers[s.id] ??= { status: "loading", data: null };
  }
  render();
  await Promise.all(servers().map(fetchServerStatus));
  state.lastChecked = new Date();
  render();
}

// ── Power actions ─────────────────────────────────────────────────────────────

async function powerAction(serverId, action) {
  const server = servers().find(s => s.id === serverId);
  const verb = action === "reboot" ? "Reboot" : "Shut down";
  const warning = action === "shutdown"
    ? "\n\nIt will stay off until it is powered on physically."
    : "";
  if (!confirm(`${verb} ${server.name}?${warning}`)) return;

  const token = prompt(`Power token for ${server.name}:`);
  if (!token) return;

  try {
    const resp = await fetch(`${server.agent_url}/power`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${token.trim()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
    alert(`${server.name}: ${action} in ${data.in_seconds}s`);
  } catch (e) {
    alert(`${verb} failed: ${e.message}`);
  }
}

// ── Rendering ─────────────────────────────────────────────────────────────────

const STATUS_CFG = {
  ok:          { dot: "bg-green-400",  pill: "bg-green-50 text-green-700 border-green-200",  label: "OK" },
  degraded:    { dot: "bg-yellow-400", pill: "bg-yellow-50 text-yellow-700 border-yellow-200", label: "Degraded" },
  down:        { dot: "bg-red-400",    pill: "bg-red-50 text-red-700 border-red-200",          label: "Down" },
  unreachable: { dot: "bg-gray-400",   pill: "bg-gray-100 text-gray-500 border-gray-200",      label: "Unreachable" },
  loading:     { dot: "bg-gray-300 animate-pulse", pill: "bg-gray-50 text-gray-400 border-gray-200", label: "Checking…" },
};

const esc = s => String(s ?? "").replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const CARD = "rounded-xl border border-gray-200 bg-white shadow-sm";

function statusBadge(status) {
  const cfg = STATUS_CFG[status] ?? STATUS_CFG.loading;
  return `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${cfg.pill}">
    <span class="w-1.5 h-1.5 rounded-full flex-shrink-0 ${cfg.dot}"></span>${cfg.label}
  </span>`;
}

function cardHeader(title, right) {
  return `<div class="px-5 py-3.5 border-b border-gray-100 bg-gray-50/60 flex items-center justify-between gap-3">
    <h2 class="text-sm font-semibold text-gray-700">${esc(title)}</h2>
    ${right ?? ""}
  </div>`;
}

function checksPills(checks) {
  if (!checks || !Object.keys(checks).length) return null;
  return Object.entries(checks).map(([k, v]) => {
    const label = k.charAt(0).toUpperCase() + k.slice(1);
    const dot = v === "ok" ? "bg-green-400" : "bg-red-400";
    const text = v === "ok" ? "text-green-700" : "text-red-600";
    return `<span class="inline-flex items-center gap-1 text-xs ${text}">
      <span class="w-1.5 h-1.5 rounded-full ${dot}"></span>${esc(label)}
    </span>`;
  }).join("");
}

function serviceRow(svc) {
  const latency = svc.latency_ms != null ? `${svc.latency_ms}ms` : "—";
  const pills = checksPills(svc.checks);
  const detailCell = pills
    ? `<div class="flex gap-3 flex-wrap">${pills}</div>`
    : `<span class="truncate">${esc(svc.detail)}</span>`;
  return `<tr class="border-b border-gray-100 last:border-0 hover:bg-gray-50/50 transition-colors">
    <td class="py-3 px-4 text-sm font-medium text-gray-800">${esc(svc.name)}</td>
    <td class="py-3 px-4">${statusBadge(svc.status)}</td>
    <td class="py-3 px-4 text-sm text-gray-400 font-mono tabular-nums w-20">${latency}</td>
    <td class="py-3 px-4 text-xs text-gray-400 max-w-xs hidden sm:table-cell">${detailCell}</td>
  </tr>`;
}

function serviceTable(rows, caption, subtitle) {
  if (!rows.length) return "";
  return `<div class="${CARD} overflow-hidden">
    ${cardHeader(caption, subtitle ? `<span class="text-xs text-gray-400">${esc(subtitle)}</span>` : "")}
    <table class="w-full">
      <thead>
        <tr class="text-xs text-gray-400 border-b border-gray-100 bg-white">
          <th class="text-left py-2 px-4 font-medium">Service</th>
          <th class="text-left py-2 px-4 font-medium">Status</th>
          <th class="text-left py-2 px-4 font-medium">Latency</th>
          <th class="text-left py-2 px-4 font-medium hidden sm:table-cell">Detail</th>
        </tr>
      </thead>
      <tbody>${rows.map(serviceRow).join("")}</tbody>
    </table>
  </div>`;
}

function networkCard(network) {
  const ifaces = Object.entries(network || {});
  if (!ifaces.length) return "";
  const body = ifaces.map(([name, { ipv4 = [], ipv6 = [], error }]) => {
    const rows = [
      ...ipv4.map(a => ({ label: "IPv4", addr: a })),
      ...ipv6.map(a => ({ label: "IPv6", addr: a })),
    ];
    const content = rows.length
      ? rows.map(r => `<div class="flex items-center gap-3">
          <span class="text-xs text-gray-400 w-8 flex-shrink-0">${r.label}</span>
          <span class="text-sm font-mono text-gray-700 break-all">${esc(r.addr)}</span>
        </div>`).join("")
      : `<p class="text-xs text-gray-400">${esc(error || "no addresses")}</p>`;
    return `<div class="space-y-2">
      <p class="text-xs font-medium text-gray-500 font-mono">${esc(name)}</p>${content}
    </div>`;
  }).join("");
  return `<div class="${CARD} overflow-hidden">
    ${cardHeader("Network")}
    <div class="px-5 py-3 space-y-4">${body}</div>
  </div>`;
}

function powerButtons(server) {
  const btn = "text-xs border rounded-lg px-2.5 py-1 transition select-none";
  return `<div class="flex gap-2">
    <button onclick="powerAction('${server.id}', 'reboot')"
      class="${btn} text-gray-500 border-gray-200 hover:bg-gray-50 hover:text-gray-800">Reboot</button>
    <button onclick="powerAction('${server.id}', 'shutdown')"
      class="${btn} text-red-600 border-red-200 hover:bg-red-50">Shut down</button>
  </div>`;
}

function serverColumn(server) {
  const { status, data } = state.servers[server.id] ?? { status: "loading" };
  const meta = data
    ? [data.server_hostname, data.uptime && `up ${data.uptime}`].filter(Boolean).join(" · ")
    : new URL(server.agent_url).host;

  const header = `<div class="${CARD} px-5 py-4 flex items-center justify-between gap-3 flex-wrap">
    <div class="min-w-0">
      <div class="flex items-center gap-2">
        <h2 class="text-sm font-semibold text-gray-900">${esc(server.name)}</h2>
        ${statusBadge(status)}
      </div>
      <p class="text-xs text-gray-400 font-mono mt-1 truncate">${esc(meta)}</p>
    </div>
    ${data?.power_enabled ? powerButtons(server) : ""}
  </div>`;

  // Unreachable servers show only the header (badge + host), no body.
  let body = "";
  if (status === "loading") {
    body = `<div class="${CARD} p-10 text-center text-sm text-gray-400 animate-pulse">Checking services…</div>`;
  } else if (data) {
    body = [networkCard(data.network), ...data.groups.map(g => serviceTable(g.services, g.label))].join("");
  }

  return `<div class="space-y-4">${header}${body}</div>`;
}

function render() {
  document.getElementById("last-checked").textContent = state.lastChecked
    ? `Last checked ${state.lastChecked.toLocaleTimeString()}`
    : "";

  document.getElementById("servers-section").innerHTML = servers().map(serverColumn).join("");
}

// ── Auto-refresh ──────────────────────────────────────────────────────────────

let _autoRefreshEnabled = false;
let _refreshIntervalId = null;
let _nextRefreshIn = 0;
let _intervalMs = 30000;

function _setCountdownText() {
  const el = document.getElementById("next-refresh");
  if (!el) return;
  el.textContent = _autoRefreshEnabled ? `Refreshes in ${_nextRefreshIn}s` : "Auto-refresh paused";
}

function toggleAutoRefresh() {
  _autoRefreshEnabled = !_autoRefreshEnabled;

  const track = document.getElementById("refresh-toggle");
  const thumb = document.getElementById("toggle-thumb");

  if (_autoRefreshEnabled) {
    track.classList.replace("bg-gray-300", "bg-green-400");
    thumb.classList.replace("translate-x-0", "translate-x-4");
    track.setAttribute("aria-checked", "true");
    _nextRefreshIn = _intervalMs / 1000;
    _refreshIntervalId = setInterval(refresh, _intervalMs);
  } else {
    track.classList.replace("bg-green-400", "bg-gray-300");
    thumb.classList.replace("translate-x-4", "translate-x-0");
    track.setAttribute("aria-checked", "false");
    clearInterval(_refreshIntervalId);
    _refreshIntervalId = null;
  }

  _setCountdownText();
}

function startAutoRefresh() {
  _intervalMs = (window.CONFIG.REFRESH_INTERVAL_S || 30) * 1000;
  if (_intervalMs <= 0) return;

  _nextRefreshIn = _intervalMs / 1000;
  // interval not started — toggle is off by default

  setInterval(() => {
    if (!_autoRefreshEnabled) return;
    _nextRefreshIn = Math.max(0, _nextRefreshIn - 1);
    if (_nextRefreshIn === 0) _nextRefreshIn = _intervalMs / 1000;
    _setCountdownText();
  }, 1000);
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") refresh();
});

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  const cfg = window.CONFIG;
  document.title = cfg.SITE_TITLE || "Server Status";
  document.getElementById("site-title").textContent = cfg.SITE_TITLE || "Server Status";
  document.getElementById("server-name").textContent = servers().map(s => s.name).join(" · ");
  refresh();
  startAutoRefresh();
});
