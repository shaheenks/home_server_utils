# home_server_utils

Utilities for the home server at `dev.shaheenks.co.in`. Includes a static status dashboard hosted on GitHub Pages and Python CGI scripts served by Apache.

## Structure

```
home_server_utils/
├── cgi/                    ← deploy to Apache's cgi-bin
│   ├── status.cgi          ← probes services/ports, returns JSON
│   └── ping.cgi            ← reachability check endpoint
└── static/           ← static GitHub Pages site
    ├── index.html
    ├── config.js           ← user-editable config (URLs, branding)
    └── app.js              ← fetch logic and DOM rendering
```

## Landing Page

A static dashboard that shows home server health. Fetches `status.cgi` on page load and every 30 seconds, displaying:

- **Network** — IPv4 and IPv6 addresses on the `br0` bridge adapter
- **Service Health** — status and latency for each configured service
- **Browser Connectivity** — direct `fetch()` from the browser to `ping.cgi`, confirming external reachability

### Local development

```bash
make serve                  # serves static/ at http://localhost:8080
make serve SERVE_PORT=9000  # custom port
```

Point `STATUS_SERVER_URL` in `static/config.js` at `http://localhost/cgi-bin/status.cgi` while developing locally.

### GitHub Pages deployment

1. Enable Pages in the repo settings, set source to the root `/` of the branch (`index.html` is at root).
2. Update `ALLOWED_ORIGINS` in both `.cgi` files to include the GitHub Pages URL.

## CGI Scripts

Python 3 scripts executed by Apache on each request. No daemons, no dependencies beyond stdlib.

### `status.cgi`

`GET /cgi-bin/status.cgi` — runs all probes and returns JSON:

```json
{
  "overall": "ok",
  "checked_at": "2026-06-11T16:30:00Z",
  "server_hostname": "shaheen-homelab",
  "network": {
    "br0": { "ipv4": ["192.168.1.1"], "ipv6": ["2001:db8::1"] }
  },
  "services": [
    { "id": "ssh", "name": "SSH (22)", "status": "ok", "latency_ms": 1, "detail": "TCP 22 open" },
    { "id": "trex_api", "name": "Trex API", "status": "ok", "latency_ms": 12, "detail": "HTTP 200" }
  ]
}
```

**Probe types** (edit the `SERVICES` list at the bottom of the script):

| Function | Checks |
|---|---|
| `probe_tcp(id, name, host, port)` | TCP connect — any service |
| `probe_http(id, name, url)` | HTTP GET — 2xx/3xx = ok, 4xx/5xx = degraded |
| `probe_systemctl(id, name, unit)` | `systemctl is-active <unit>` |

### `ping.cgi`

`GET /cgi-bin/ping.cgi` — returns `{"ok": true}`. Used by the browser to verify external reachability independently of the full status check.

### CORS

Both scripts allow requests from `https://shaheenks.github.io`, `https://dev.shaheenks.co.in`, and `http://localhost:8080`. Update `ALLOWED_ORIGINS` in each script to add or remove origins.

## Deployment

### Requirements

- Apache with `mod_cgid` enabled
- Python 3 at `/usr/bin/env python3`

### Enable CGI

```bash
sudo a2enmod cgid
sudo systemctl reload apache2
```

### Deploy scripts

```bash
make deploy
```

Copies `cgi/*.cgi` to `/usr/lib/cgi-bin/`, sets executable permissions, and reloads Apache.

### Verify

```bash
# JSON response
curl https://dev.shaheenks.co.in/cgi-bin/status.cgi | python3 -m json.tool

# CORS headers
curl -H "Origin: https://shaheenks.github.io" -I https://dev.shaheenks.co.in/cgi-bin/ping.cgi
```
