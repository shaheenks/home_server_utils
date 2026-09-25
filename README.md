# home_server_utils

Status dashboard and agent for the home servers:

| Server | Agent URL |
|---|---|
| Linux (Ubuntu) | `https://dev.shaheenks.co.in/agent/` |
| Raspberry Pi | `https://rpi.shaheenks.co.in/agent/` |

Each server runs the same **status agent**, a small Python service with no dependencies beyond the standard library, managed by systemd. The **dashboard** is a static page hosted on Cloudflare Workers. It queries each agent directly from the browser.

## Structure

```
home_server_utils/
├── agent/agent.py          ← status agent (same file on every server)
├── config/
│   ├── ubuntu.json         ← per-host probes, interfaces, CORS
│   └── pi.json
├── deploy/
│   ├── status-agent.service
│   ├── status-agent.sudoers  ← allows poweroff/reboot only
│   ├── apache.conf         ← reverse-proxy snippets: /agent/ → 127.0.0.1:8765
│   └── nginx.conf
├── public/                 ← dashboard: the only folder uploaded to Cloudflare
│   ├── index.html
│   ├── config.js           ← servers, direct checks, branding
│   └── app.js
└── wrangler.jsonc          ← Cloudflare Workers deploy config
```

## Agent API

| Endpoint | Description |
|---|---|
| `GET /ping` | `{"ok": true, "hostname": "..."}` — reachability check |
| `GET /status` | Runs all probes in parallel and returns host info plus groups (see below) |
| `POST /power` | `{"action": "shutdown" \| "reboot"}` with `Authorization: Bearer <token>`. Returns `202`, then acts after 3s |

```json
{
  "overall": "ok",
  "checked_at": "2026-09-25T16:30:00Z",
  "server_hostname": "shaheen-homelab",
  "uptime": "3d 4h 12m",
  "network": { "enp1s0": { "ipv4": ["192.168.1.10"], "ipv6": ["2001:db8::1"] } },
  "groups": [],
  "power_enabled": true
}
```

With probes configured, each group lists its results:

```json
"groups": [
  { "id": "system", "label": "Service Health", "services": [
    { "id": "ssh", "name": "SSH (22)", "status": "ok", "latency_ms": 1, "detail": "TCP 22 open" }
  ]}
]
```

A service's `status` is `ok`, `degraded` or `down`. The dashboard shows the Reboot and Shut down buttons only when `power_enabled` is true.

### Probes

Probes are configured in `config/<host>.json` under `groups[].probes`:

| `type` | Fields | Checks |
|---|---|---|
| `tcp` | `port`, `host` (default `127.0.0.1`) | TCP connect |
| `http` | `url`, `insecure` (skip TLS verify) | HTTP GET: `<400` ok, otherwise degraded |
| `health` | `url` | HTTP JSON `{"checks": {...}}`, e.g. the Trex API `/health` |
| `systemd` | `unit` | `systemctl is-active` |
| `kvm` | `vm` | `virsh dominfo` state |

Every probe also needs an `id` and a `name`, and accepts an optional `timeout` in seconds. `interfaces` lists the network interfaces whose global addresses are reported.

### CORS

A browser origin is allowed if it appears in `allowed_origins` or fully matches `allowed_origin_pattern`. The default pattern allows `https://shaheenks.co.in` and any of its subdomains.

## Setting up a server

### Prerequisites

- A user with `sudo`
- `git`, `make`, `curl` and `python3`. Raspberry Pi OS Lite often lacks `make`:
  ```bash
  sudo apt install git make curl python3
  ```
- A public DNS record for the server's hostname (`dev.shaheenks.co.in` or `rpi.shaheenks.co.in`), routed to its web server
- An HTTPS site on that hostname with a valid TLS certificate, e.g. from Let's Encrypt via `certbot`. The dashboard runs over HTTPS, so browsers refuse to call an agent over plain HTTP or one with a self-signed certificate.

### Install

Run these steps on each server:

```bash
git clone https://github.com/shaheenks/home_server_utils.git
cd home_server_utils
make install CONFIG=config/ubuntu.json   # or config/pi.json on the Raspberry Pi
make token                               # optional: enables shutdown/reboot, prints the token
```

`install` does the following:
- creates a `status-agent` system user (added to `libvirt` if that group exists)
- installs the agent to `/opt/status-agent/` and the config to `/etc/status-agent/config.json`
- installs the sudoers rule, validated with `visudo`
- enables the systemd unit

### Publish through the web server

Publish the agent through the HTTPS site on that server:

- **Apache:** run `sudo a2enmod proxy proxy_http`, add [deploy/apache.conf](deploy/apache.conf) to the `<VirtualHost *:443>`, then reload.
- **nginx:** add [deploy/nginx.conf](deploy/nginx.conf) to the `server { listen 443 ... }` block, then reload.

### Verify

Run these from any machine, replacing the host with `dev.shaheenks.co.in` or `rpi.shaheenks.co.in`:

```bash
HOST=rpi.shaheenks.co.in
curl https://$HOST/agent/status | python3 -m json.tool
# should print an Access-Control-Allow-Origin header
curl -si -H "Origin: https://status.shaheenks.co.in" https://$HOST/agent/ping | grep -i access-control
```

If `curl http://127.0.0.1:8765/ping` works on the server but the public URL doesn't, the proxy or TLS setup is the problem. For the agent's logs, run `make logs`.

### Update

```bash
cd home_server_utils
git pull
make install CONFIG=config/<host>.json
```

This reinstalls the agent and config and restarts the service. The power token is left in place.

### Power actions

- **Off by default:** power actions are disabled until `/etc/status-agent/power_token` exists (`make token`). Delete that file and restart the service to disable them again.
- **Token handling:** the agent compares the token in constant time and waits 1s after each failed attempt.
- **Root access:** the agent only gets root through the sudoers rule, which allows exactly `systemctl poweroff` and `systemctl reboot`.
- **Using it:** the dashboard asks for confirmation, then for the token. After a shutdown, the server stays off until someone powers it on physically.

### Migrating from the old CGI scripts

The CGI scripts have been replaced by the agent. On the Ubuntu server, remove the old copies:

```bash
sudo rm /usr/lib/cgi-bin/status.cgi /usr/lib/cgi-bin/ping.cgi
```

## Dashboard

For each server, the dashboard shows its status, host information, network addresses, service groups, and power buttons. A **Browser Connectivity** table pings each agent, plus any `DIRECT_CHECKS`, straight from your browser. To add a server, add an entry to `SERVERS` in [public/config.js](public/config.js).

### Configuration

All settings are in [public/config.js](public/config.js):

| Setting | Purpose |
|---|---|
| `SERVERS` | `{ id, name, agent_url }` per server; `agent_url` is the `/agent` base without a trailing slash |
| `REFRESH_INTERVAL_S` | Interval for the Auto toggle (off by default); the page also refreshes when the tab becomes visible |
| `DIRECT_CHECKS` | Extra URLs fetched by the browser: `{ id, name, url, expect_status }`. Each target must send CORS headers. |
| `SITE_TITLE` | Page title and header |

Probes, interfaces and allowed origins are configured on each server in `config/<host>.json`, not here.

### Local development

```bash
make serve                  # serves public/ at http://localhost:8080 (allowed by both agent configs)
```

### Deploy to Cloudflare Workers

The dashboard is the three files in `public/`, with no build step. [wrangler.jsonc](wrangler.jsonc) uploads that folder as Worker static assets, and nothing else in the repo is published.

**From your machine** (needs Node.js):

```bash
npx wrangler login          # first time only
make publish                # = npx wrangler deploy
```

**Or from Git:** in the Cloudflare dashboard, go to **Workers & Pages → Create → Import a repository**, pick `home_server_utils`, leave the build command empty, and set the deploy command to `npx wrangler deploy`. Every push to the production branch then redeploys.

Then, in the Cloudflare dashboard, go to **Workers & Pages → server-status → Settings → Domains & Routes** and add a custom domain under `shaheenks.co.in`, e.g. `status.shaheenks.co.in`.

The Worker name comes from `name` in `wrangler.jsonc`. If your existing Worker has a different name, change it to match, or the deploy creates a second Worker.

> The dashboard must be served from `shaheenks.co.in` or one of its subdomains. The agents only accept requests from those origins (plus `localhost:8080`), so on the default `*.workers.dev` URL the page loads but every server shows as unreachable. To use another origin, add it to `allowed_origins` in both `config/*.json` and rerun `make install` on each server.

After deploying, open the page and check the browser's Network tab. Requests to `/agent/ping` and `/agent/status` should return 200 with an `Access-Control-Allow-Origin` header matching the dashboard's domain.
