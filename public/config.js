// config.js — edit this file to configure your dashboard
window.CONFIG = {
  // One entry per server running the status agent (agent_url = its /agent/ reverse proxy)
  SERVERS: [
    { id: "ubuntu", name: "Linux Server", agent_url: "https://dev.shaheenks.co.in/agent" },
    { id: "pi", name: "Raspberry Pi", agent_url: "https://rpi.shaheenks.co.in/agent" },
    { id: "windows", name: "Windows PC", agent_url: "https://pc.shaheenks.co.in/agent" },
  ],

  // Welcome page "Services" list, in display order. "server" is a SERVERS id (shows a live
  // status dot from its agent); "url" is for anything else and shows an Open link.
  HOME_SERVICES: [
    { name: "Raspberry Pi Gateway", server: "pi" },
    { name: "Ubuntu Server", server: "ubuntu" },
    { name: "Windows PC", server: "windows" },
    { name: "OpenWebRX SDR", url: "https://sdr.shaheenks.co.in" },
  ],

  // Auto-refresh interval in seconds (0 to disable)
  REFRESH_INTERVAL_S: 30,

  // Branding
  SITE_TITLE: "Server Status",          // dashboard (/dashboard/)
  HOME_TITLE: "shaheenks.co.in",        // welcome page (/)
  HOME_TAGLINE: "Home lab: a few small servers, monitored from one place.",
};
