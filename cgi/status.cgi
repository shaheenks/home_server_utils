#!/usr/bin/env python3
import json
import os
import re
import socket
import ssl
import subprocess
import sys
import time
import urllib.error
import urllib.request

ALLOWED_ORIGINS = [
    "https://shaheenks.github.io",
    "https://dev.shaheenks.co.in",
    "http://localhost:8080",
]

method = os.environ.get("REQUEST_METHOD", "GET")
origin = os.environ.get("HTTP_ORIGIN", "")

if method == "OPTIONS":
    print("Status: 200 OK")
    print("Content-Type: text/plain")
    if origin in ALLOWED_ORIGINS:
        print(f"Access-Control-Allow-Origin: {origin}")
        print("Access-Control-Allow-Methods: GET, OPTIONS")
        print("Access-Control-Allow-Headers: Content-Type")
    print()
    sys.exit(0)


def probe_tcp(service_id, name, host, port, timeout=2):
    start = time.monotonic()
    try:
        sock = socket.create_connection((host, port), timeout=timeout)
        sock.close()
        latency = round((time.monotonic() - start) * 1000)
        return {"id": service_id, "name": name, "status": "ok", "latency_ms": latency, "detail": f"TCP {port} open"}
    except Exception as e:
        return {"id": service_id, "name": name, "status": "down", "latency_ms": None, "detail": str(e)[:120]}


def probe_http(service_id, name, url, timeout=3):
    start = time.monotonic()
    try:
        kwargs = {}
        if url.startswith("https://"):
            ctx = ssl.create_default_context()
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
            kwargs["context"] = ctx
        with urllib.request.urlopen(url, timeout=timeout, **kwargs) as resp:
            latency = round((time.monotonic() - start) * 1000)
            status = "ok" if resp.status < 400 else "degraded"
            return {"id": service_id, "name": name, "status": status, "latency_ms": latency, "detail": f"HTTP {resp.status}"}
    except urllib.error.HTTPError as e:
        latency = round((time.monotonic() - start) * 1000)
        return {"id": service_id, "name": name, "status": "degraded", "latency_ms": latency, "detail": f"HTTP {e.code}"}
    except Exception as e:
        return {"id": service_id, "name": name, "status": "down", "latency_ms": None, "detail": str(e)[:120]}


def probe_systemctl(service_id, name, unit):
    try:
        result = subprocess.run(
            ["systemctl", "is-active", "--quiet", unit],
            timeout=3,
        )
        status = "ok" if result.returncode == 0 else "down"
        detail = "active" if result.returncode == 0 else "inactive"
        return {"id": service_id, "name": name, "status": status, "latency_ms": None, "detail": detail}
    except Exception as e:
        return {"id": service_id, "name": name, "status": "down", "latency_ms": None, "detail": str(e)[:120]}


def get_br0_addresses():
    try:
        out = subprocess.run(
            ["ip", "addr", "show", "br0"],
            capture_output=True, text=True, timeout=3,
        ).stdout
        ipv4 = re.findall(r"inet (\d+\.\d+\.\d+\.\d+)/", out)
        ipv6 = [m for m in re.findall(r"inet6 ([0-9a-f:]+)/", out) if not m.startswith("fe80")]
        return {"ipv4": ipv4, "ipv6": ipv6}
    except Exception as e:
        return {"ipv4": [], "ipv6": [], "error": str(e)[:80]}


# ── Define your services here ─────────────────────────────────────────────────
SERVICES = [
    probe_tcp("ssh", "SSH (22)", "127.0.0.1", 22),
    probe_http("trex_api", "Trex API", "http://127.0.0.1:8000/health"),
    probe_systemctl("trex_worker", "Trex Celery Worker", "trex-celery.service"),
    probe_systemctl("apache2", "Apache2", "apache2.service"),
    probe_tcp("mongodb", "MongoDB (Docker)", "127.0.0.1", 27017),
    probe_systemctl("docker", "Docker", "docker.service"),
    probe_tcp("redis", "Redis (Docker)", "127.0.0.1", 6379),
]

overall = "ok" if all(s["status"] == "ok" for s in SERVICES) else "degraded"

result = {
    "overall": overall,
    "checked_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    "server_hostname": socket.gethostname(),
    "network": {"br0": get_br0_addresses()},
    "services": SERVICES,
}

print("Content-Type: application/json")
print("Cache-Control: no-store")
if origin in ALLOWED_ORIGINS:
    print(f"Access-Control-Allow-Origin: {origin}")
print()
print(json.dumps(result))
