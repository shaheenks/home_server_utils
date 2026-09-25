// config.js — edit this file to configure your dashboard
window.CONFIG = {
  // One entry per server running the status agent (agent_url = its /agent/ reverse proxy)
  SERVERS: [
    { id: "ubuntu", name: "Linux Server", agent_url: "https://dev.shaheenks.co.in/agent" },
    { id: "pi", name: "Raspberry Pi", agent_url: "https://rpi.shaheenks.co.in/agent" },
  ],

  // Auto-refresh interval in seconds (0 to disable)
  REFRESH_INTERVAL_S: 30,

  // Extra direct browser checks. Each server's /ping is checked automatically.
  // e.g. { id: "trex_access", name: "Trex Server Access", url: "https://trex.shaheenks.co.in/health/ping", expect_status: 200 }
  DIRECT_CHECKS: [],

  // Branding
  SITE_TITLE: "Server Status",
};
