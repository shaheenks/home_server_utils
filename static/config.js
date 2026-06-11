// config.js — edit this file to configure your dashboard
window.CONFIG = {
  // URL of the status CGI on your home server
  STATUS_SERVER_URL: "https://dev.shaheenks.co.in/cgi-bin/status.cgi",

  // Auto-refresh interval in seconds (0 to disable)
  REFRESH_INTERVAL_S: 30,

  // Direct browser checks — the browser fetches these itself (proves external reachability)
  DIRECT_CHECKS: [
    {
      id: "ddns_ping",
      name: "Server Reachability",
      url: "https://dev.shaheenks.co.in/cgi-bin/ping.cgi",
      expect_status: 200,
    },
  ],

  // Branding
  SITE_TITLE: "Server Status",
  SERVER_NAME: "dev.shaheenks.co.in",
};
