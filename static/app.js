// app.js

let state = {
  serverStatus: "loading",
  lastChecked: null,
  serverHostname: "",
  uptime: null,
  network: null,
  groups: [],
  directChecks: [],
  directChecksLoading: true,
};

// ── Data fetching ─────────────────────────────────────────────────────────────

async function fetchServerStatus() {
  try {
    const resp = await fetch(window.CONFIG.STATUS_SERVER_URL, { cache: "no-store" });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    state.services = data.services || [];
    state.lastChecked = data.checked_at || null;
    state.serverHostname = data.server_hostname || "";
    state.uptime = data.uptime || null;
    state.network = data.network || null;
    state.groups = data.groups || [];
    state.serverStatus = data.overall || "ok";
  } catch (e) {
    state.serverStatus = "unreachable";
    state.services = [];
    state.lastChecked = null;
    console.warn("Status CGI unreachable:", e.message);
  }
}

async function runDirectCheck(check) {
  const start = performance.now();
  try {
    const resp = await fetch(check.url, { cache: "no-store" });
    const latency = Math.round(performance.now() - start);
    return {
      ...check,
      status: resp.status === check.expect_status ? "ok" : "degraded",
      latency_ms: latency,
      detail: `HTTP ${resp.status}`,
    };
  } catch (e) {
    return {
      ...check,
      status: "down",
      latency_ms: null,
      detail: e.message,
    };
  }
}

async function runAllDirectChecks() {
  const checks = window.CONFIG.DIRECT_CHECKS || [];
  state.directChecksLoading = true;
  state.directChecks = await Promise.all(checks.map(runDirectCheck));
  state.directChecksLoading = false;
}

async function refresh() {
  state.serverStatus = "loading";
  render();
  await Promise.all([fetchServerStatus(), runAllDirectChecks()]);
  render();
}

// ── Rendering ─────────────────────────────────────────────────────────────────

const STATUS_CFG = {
  ok:          { dot: "bg-green-400",  pill: "bg-green-50 text-green-700 border-green-200",  label: "OK" },
  degraded:    { dot: "bg-yellow-400", pill: "bg-yellow-50 text-yellow-700 border-yellow-200", label: "Degraded" },
  down:        { dot: "bg-red-400",    pill: "bg-red-50 text-red-700 border-red-200",          label: "Down" },
  unreachable: { dot: "bg-gray-400",   pill: "bg-gray-100 text-gray-500 border-gray-200",      label: "Unreachable" },
  loading:     { dot: "bg-gray-300 animate-pulse", pill: "bg-gray-50 text-gray-400 border-gray-200", label: "Checking…" },
};

function statusBadge(status) {
  const cfg = STATUS_CFG[status] ?? STATUS_CFG.loading;
  return `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${cfg.pill}">
    <span class="w-1.5 h-1.5 rounded-full flex-shrink-0 ${cfg.dot}"></span>${cfg.label}
  </span>`;
}

function checksPills(checks) {
  if (!checks || !Object.keys(checks).length) return null;
  return Object.entries(checks).map(([k, v]) => {
    const label = k.charAt(0).toUpperCase() + k.slice(1);
    const dot = v === "ok" ? "bg-green-400" : "bg-red-400";
    const text = v === "ok" ? "text-green-700" : "text-red-600";
    return `<span class="inline-flex items-center gap-1 text-xs ${text}">
      <span class="w-1.5 h-1.5 rounded-full ${dot}"></span>${label}
    </span>`;
  }).join("");
}

function serviceRow(svc) {
  const latency = svc.latency_ms != null ? `${svc.latency_ms}ms` : "—";
  const pills = checksPills(svc.checks);
  const detailCell = pills
    ? `<div class="flex gap-3 flex-wrap">${pills}</div>`
    : `<span class="truncate">${svc.detail ?? ""}</span>`;
  return `<tr class="border-b border-gray-100 last:border-0 hover:bg-gray-50/50 transition-colors">
    <td class="py-3 px-4 text-sm font-medium text-gray-800">${svc.name}</td>
    <td class="py-3 px-4">${statusBadge(svc.status)}</td>
    <td class="py-3 px-4 text-sm text-gray-400 font-mono tabular-nums w-20">${latency}</td>
    <td class="py-3 px-4 text-xs text-gray-400 max-w-xs hidden sm:table-cell">${detailCell}</td>
  </tr>`;
}

function networkCard(network) {
  if (!network || !network.br0) return "";
  const { ipv4 = [], ipv6 = [], error } = network.br0;
  if (error && !ipv4.length && !ipv6.length) {
    return `<div class="rounded-xl border border-gray-200 bg-white shadow-sm px-5 py-4 text-xs text-gray-400">
      br0: ${error}
    </div>`;
  }
  const rows = [
    ...ipv4.map(a => ({ label: "IPv4", addr: a })),
    ...ipv6.map(a => ({ label: "IPv6", addr: a })),
  ];
  return `<div class="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
    <div class="px-5 py-3.5 border-b border-gray-100 bg-gray-50/60 flex items-center justify-between">
      <h2 class="text-sm font-semibold text-gray-700">Network — br0</h2>
      <span class="text-xs text-gray-400">bridge adapter</span>
    </div>
    <div class="px-5 py-3 space-y-2">
      ${rows.map(r => `<div class="flex items-center gap-3">
        <span class="text-xs text-gray-400 w-8 flex-shrink-0">${r.label}</span>
        <span class="text-sm font-mono text-gray-700 break-all">${r.addr}</span>
      </div>`).join("")}
    </div>
  </div>`;
}

function serviceTable(rows, caption, subtitle) {
  if (!rows.length) return "";
  return `<div class="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
    <div class="px-5 py-3.5 border-b border-gray-100 bg-gray-50/60 flex items-center justify-between">
      <h2 class="text-sm font-semibold text-gray-700">${caption}</h2>
      ${subtitle ? `<span class="text-xs text-gray-400">${subtitle}</span>` : ""}
    </div>
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

function render() {
  const lastCheckedEl = document.getElementById("last-checked");
  if (state.lastChecked) {
    lastCheckedEl.textContent = `Last checked ${new Date(state.lastChecked).toLocaleTimeString()}`;
  } else {
    lastCheckedEl.textContent = "";
  }

  const uptimeEl = document.getElementById("uptime");
  if (uptimeEl) uptimeEl.textContent = state.uptime ? `up ${state.uptime}` : "";

  document.getElementById("network-section").innerHTML = networkCard(state.network);

  const serverSection = document.getElementById("server-section");
  if (state.serverStatus === "loading") {
    serverSection.innerHTML = `<div class="rounded-xl border border-gray-200 bg-white shadow-sm p-10 text-center text-sm text-gray-400 animate-pulse">Checking services…</div>`;
  } else if (state.serverStatus === "unreachable") {
    serverSection.innerHTML = `<div class="rounded-xl border border-red-200 bg-red-50 p-8 text-center space-y-1">
      <p class="font-semibold text-red-700">Status server unreachable</p>
      <p class="text-sm text-red-500">The server may be offline, or you may be outside the network.</p>
    </div>`;
  } else {
    const hostname = state.serverHostname ? `via ${state.serverHostname}` : "via CGI";
    serverSection.innerHTML = `<div class="space-y-4">${state.groups
      .map((g, i) => serviceTable(g.services, g.label, i === 0 ? hostname : ""))
      .join("")}</div>`;
  }

  const directSection = document.getElementById("direct-section");
  if (state.directChecksLoading && !state.directChecks.length) {
    directSection.innerHTML = `<div class="rounded-xl border border-gray-200 bg-white shadow-sm p-6 text-center text-sm text-gray-400 animate-pulse">Checking connectivity…</div>`;
  } else if (state.directChecks.length) {
    const subtitle = state.directChecksLoading ? "refreshing…" : "from your browser";
    directSection.innerHTML = serviceTable(state.directChecks, "Browser Connectivity", subtitle);
  }
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
  document.getElementById("site-title").textContent = cfg.SITE_TITLE || "Home Server Status";
  document.getElementById("server-name").textContent = cfg.SERVER_NAME || "";
  document.getElementById("footer-host").textContent = cfg.SERVER_NAME || "";
  refresh();
  startAutoRefresh();
});
