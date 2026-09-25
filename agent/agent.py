#!/usr/bin/env python3
"""Home server status agent.

Endpoints (served on localhost, published through the web server's reverse proxy):
  GET  /ping    reachability check
  GET  /status  runs the configured probes in parallel and returns JSON
  POST /power   {"action": "shutdown" | "reboot"}, requires "Authorization: Bearer <token>"

Standard library only. Configured by a JSON file, see config/*.json.
"""
import argparse
import hmac
import json
import re
import socket
import ssl
import subprocess
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

POWER_COMMANDS = {
    "shutdown": ["/usr/bin/systemctl", "poweroff"],
    "reboot": ["/usr/bin/systemctl", "reboot"],
}
POWER_DELAY_S = 3
MAX_BODY_BYTES = 1024


# ── Probes ────────────────────────────────────────────────────────────────────
# Each probe takes its config entry and returns a partial result; run_probe()
# adds id/name and turns exceptions into "down".

def probe_tcp(p):
    port = p["port"]
    start = time.monotonic()
    with socket.create_connection((p.get("host", "127.0.0.1"), port), timeout=p.get("timeout", 2)):
        pass
    return {"status": "ok", "latency_ms": _ms_since(start), "detail": f"TCP {port} open"}


def probe_http(p):
    kwargs = {}
    if p.get("insecure") and p["url"].startswith("https://"):
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        kwargs["context"] = ctx
    start = time.monotonic()
    try:
        with urllib.request.urlopen(p["url"], timeout=p.get("timeout", 3), **kwargs) as resp:
            code = resp.status
    except urllib.error.HTTPError as e:
        code = e.code
    status = "ok" if code < 400 else "degraded"
    return {"status": status, "latency_ms": _ms_since(start), "detail": f"HTTP {code}"}


def probe_health(p):
    """HTTP endpoint returning {"checks": {"name": "ok" | ...}}, e.g. the Trex API /health."""
    start = time.monotonic()
    try:
        with urllib.request.urlopen(p["url"], timeout=p.get("timeout", 3)) as resp:
            body, code = resp.read(), resp.status
    except urllib.error.HTTPError as e:
        body, code = e.read(), e.code
    latency = _ms_since(start)
    raw = json.loads(body).get("checks", {})
    checks = {k: ("ok" if v == "ok" else "down") for k, v in raw.items()}
    status = "ok" if code < 400 else "degraded"
    return {"status": status, "latency_ms": latency, "detail": f"HTTP {code}", "checks": checks}


def probe_systemd(p):
    result = subprocess.run(["systemctl", "is-active", "--quiet", p["unit"]], timeout=3)
    active = result.returncode == 0
    return {"status": "ok" if active else "down", "detail": "active" if active else "inactive"}


def probe_kvm(p):
    out = subprocess.run(
        ["virsh", "--connect", "qemu:///system", "dominfo", p["vm"]],
        capture_output=True, text=True, timeout=5,
    ).stdout
    match = re.search(r"^State:\s+(.+)$", out, re.MULTILINE)
    state = match.group(1).strip() if match else "unknown"
    status = "ok" if state == "running" else ("degraded" if state == "paused" else "down")
    return {"status": status, "detail": state}


PROBES = {
    "tcp": probe_tcp,
    "http": probe_http,
    "health": probe_health,
    "systemd": probe_systemd,
    "kvm": probe_kvm,
}


def run_probe(p):
    result = {"id": p["id"], "name": p["name"], "latency_ms": None}
    try:
        result.update(PROBES[p["type"]](p))
    except Exception as e:
        result.update(status="down", detail=str(e)[:120] or type(e).__name__)
    return result


def _ms_since(start):
    return round((time.monotonic() - start) * 1000)


# ── Host info ─────────────────────────────────────────────────────────────────

def get_uptime():
    try:
        with open("/proc/uptime") as f:
            seconds = int(float(f.read().split()[0]))
    except OSError:
        return None
    days, rem = divmod(seconds, 86400)
    hours, rem = divmod(rem, 3600)
    minutes = rem // 60
    if days:
        return f"{days}d {hours}h {minutes}m"
    if hours:
        return f"{hours}h {minutes}m"
    return f"{minutes}m"


def get_addresses(iface):
    try:
        out = subprocess.run(
            ["ip", "-j", "addr", "show", "dev", iface],
            capture_output=True, text=True, timeout=3, check=True,
        ).stdout
        addrs = [a for link in json.loads(out) for a in link.get("addr_info", [])
                 if a.get("scope") == "global"]
        return {
            "ipv4": [a["local"] for a in addrs if a["family"] == "inet"],
            "ipv6": [a["local"] for a in addrs if a["family"] == "inet6"],
        }
    except Exception as e:
        return {"ipv4": [], "ipv6": [], "error": str(e)[:80]}


# ── Agent ─────────────────────────────────────────────────────────────────────

class Agent:
    def __init__(self, config):
        self.config = config
        self.origins = set(config.get("allowed_origins", []))
        pattern = config.get("allowed_origin_pattern")
        self.origin_re = re.compile(pattern) if pattern else None
        self.power_token = self._load_token(config.get("power_token_file"))
        self.pool = ThreadPoolExecutor(max_workers=16)
        self.power_lock = threading.Lock()
        self.power_pending = False

    @staticmethod
    def _load_token(path):
        if not path:
            return None
        try:
            with open(path) as f:
                token = f.read().strip()
        except FileNotFoundError:
            return None
        if len(token) < 32:
            raise SystemExit(f"{path}: power token must be at least 32 characters")
        return token

    def origin_allowed(self, origin):
        if origin in self.origins:
            return True
        return bool(self.origin_re and self.origin_re.fullmatch(origin))

    def status(self):
        groups = self.config.get("groups", [])
        futures = [[self.pool.submit(run_probe, p) for p in g.get("probes", [])] for g in groups]
        ifaces = {i: self.pool.submit(get_addresses, i) for i in self.config.get("interfaces", [])}
        out_groups = [
            {"id": g["id"], "label": g["label"], "services": [f.result() for f in fs]}
            for g, fs in zip(groups, futures)
        ]
        services = [s for g in out_groups for s in g["services"]]
        return {
            "overall": "ok" if all(s["status"] == "ok" for s in services) else "degraded",
            "checked_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "server_hostname": socket.gethostname(),
            "uptime": get_uptime(),
            "network": {i: f.result() for i, f in ifaces.items()},
            "groups": out_groups,
            "power_enabled": self.power_token is not None,
        }

    def check_token(self, header):
        if not self.power_token or not header.startswith("Bearer "):
            return False
        return hmac.compare_digest(header[len("Bearer "):].encode(), self.power_token.encode())

    def schedule_power(self, action):
        """Returns an error string, or None once the action is scheduled."""
        cmd = POWER_COMMANDS[action]
        # Confirm the sudoers rule is in place before promising anything.
        try:
            allowed = subprocess.run(["sudo", "-n", "-l", *cmd], capture_output=True, timeout=5).returncode == 0
        except (OSError, subprocess.TimeoutExpired):
            allowed = False
        if not allowed:
            return "sudo rule for power actions is not installed"
        with self.power_lock:
            if self.power_pending:
                return "a power action is already pending"
            self.power_pending = True
        # Delay so the HTTP response gets out before the machine goes down.
        threading.Timer(POWER_DELAY_S, subprocess.run, [["sudo", "-n", *cmd]]).start()
        return None


class Handler(BaseHTTPRequestHandler):
    server_version = "status-agent"
    sys_version = ""
    agent: Agent = None  # set in main()

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.send_header("Access-Control-Max-Age", "600")
        self.end_headers()

    def _route(self):
        """Request path without query string or the /agent prefix, so the agent works
        whether or not the proxy strips it (e.g. a Cloudflare Tunnel pointed straight here)."""
        path = self.path.split("?", 1)[0]
        return path[len("/agent"):] if path.startswith("/agent/") else path

    def do_GET(self):
        path = self._route()
        if path == "/ping":
            self._json(200, {"ok": True, "hostname": socket.gethostname()})
        elif path == "/status":
            self._json(200, self.agent.status())
        else:
            self._json(404, {"error": "not found"})

    def do_POST(self):
        if self._route() != "/power":
            return self._json(404, {"error": "not found"})
        if not self.agent.power_token:
            return self._json(403, {"error": "power actions are disabled on this server"})
        if not self.agent.check_token(self.headers.get("Authorization", "")):
            self.log_message("rejected power request from %s", self._client())
            time.sleep(1)
            return self._json(401, {"error": "invalid token"})

        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_BODY_BYTES:
            return self._json(413, {"error": "body too large"})
        try:
            action = json.loads(self.rfile.read(length) or b"{}").get("action")
        except (ValueError, AttributeError):
            action = None
        if action not in POWER_COMMANDS:
            return self._json(400, {"error": f"action must be one of {sorted(POWER_COMMANDS)}"})

        error = self.agent.schedule_power(action)
        if error:
            return self._json(409 if "pending" in error else 500, {"error": error})
        self.log_message("%s requested by %s", action, self._client())
        self._json(202, {"ok": True, "action": action, "in_seconds": POWER_DELAY_S})

    def _client(self):
        return self.headers.get("X-Forwarded-For", self.client_address[0])

    def _cors(self):
        origin = self.headers.get("Origin", "")
        if origin and self.agent.origin_allowed(origin):
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")

    def _json(self, code, payload):
        body = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self._cors()
        self.end_headers()
        self.wfile.write(body)


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--config", default="/etc/status-agent/config.json")
    args = parser.parse_args()

    with open(args.config) as f:
        config = json.load(f)
    unknown = {p["type"] for g in config.get("groups", []) for p in g.get("probes", [])} - PROBES.keys()
    if unknown:
        raise SystemExit(f"unknown probe types in {args.config}: {sorted(unknown)}")

    Handler.agent = Agent(config)
    host, port = config.get("listen", "127.0.0.1"), config.get("port", 8765)
    server = ThreadingHTTPServer((host, port), Handler)
    server.daemon_threads = True
    print(f"status-agent listening on {host}:{port}, power actions "
          f"{'enabled' if Handler.agent.power_token else 'disabled'}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
