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

def is_allowed_origin(origin):
    if origin in ("https://shaheenks.github.io", "http://localhost:8080"):
        return True
    return bool(re.match(r"^https://(?:[\w-]+\.)?shaheenks\.co\.in$", origin))

method = os.environ.get("REQUEST_METHOD", "GET")
origin = os.environ.get("HTTP_ORIGIN", "")

if method == "OPTIONS":
    print("Status: 200 OK")
    print("Content-Type: text/plain")
    if is_allowed_origin(origin):
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


def probe_trex_health(url, timeout=3):
    start = time.monotonic()
    try:
        try:
            resp = urllib.request.urlopen(url, timeout=timeout)
            body, code = resp.read(), resp.status
        except urllib.error.HTTPError as e:
            body, code = e.read(), e.code
        latency = round((time.monotonic() - start) * 1000)
        data = json.loads(body)
        raw = data.get("checks", {})
        checks = {k: ("ok" if v == "ok" else "down") for k, v in raw.items()}
        status = "ok" if code < 400 else "degraded"
        return {"id": "trex_api", "name": "Trex API", "status": status,
                "latency_ms": latency, "detail": f"HTTP {code}", "checks": checks}
    except Exception as e:
        return {"id": "trex_api", "name": "Trex API", "status": "down",
                "latency_ms": None, "detail": str(e)[:120], "checks": {}}


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


def get_uptime():
    try:
        with open("/proc/uptime") as f:
            seconds = int(float(f.read().split()[0]))
        days, rem = divmod(seconds, 86400)
        hours, rem = divmod(rem, 3600)
        minutes = rem // 60
        if days:
            return f"{days}d {hours}h {minutes}m"
        if hours:
            return f"{hours}h {minutes}m"
        return f"{minutes}m"
    except Exception:
        return None


def probe_kvm(service_id, name, vm_name):
    try:
        out = subprocess.run(
            ["virsh", "dominfo", vm_name],
            capture_output=True, text=True, timeout=5,
        ).stdout
        match = re.search(r"^State:\s+(.+)$", out, re.MULTILINE)
        state = match.group(1).strip() if match else "unknown"
        status = "ok" if state == "running" else ("degraded" if state == "paused" else "down")
        return {"id": service_id, "name": name, "status": status, "latency_ms": None, "detail": state}
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


# ── Define service groups here ────────────────────────────────────────────────
GROUPS = [
    {
        "id": "system",
        "label": "Service Health",
        "services": [
            probe_tcp("ssh", "SSH (22)", "127.0.0.1", 22),
            probe_systemctl("apache2", "Apache2", "apache2.service"),
            probe_systemctl("docker", "Docker", "docker.service"),
            probe_kvm("win10", "Windows 10 VM", "win10"),
        ],
    },
    {
        "id": "trex",
        "label": "TREX",
        "services": [
            probe_trex_health("http://127.0.0.1:8000/health"),
            probe_tcp("mongodb", "MongoDB Service", "127.0.0.1", 27017),
            probe_tcp("redis", "Redis Service", "127.0.0.1", 6379),
        ],
    },
]

all_services = [s for g in GROUPS for s in g["services"]]
overall = "ok" if all(s["status"] == "ok" for s in all_services) else "degraded"

result = {
    "overall": overall,
    "checked_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    "server_hostname": socket.gethostname(),
    "uptime": get_uptime(),
    "network": {"br0": get_br0_addresses()},
    "groups": GROUPS,
}

print("Content-Type: application/json")
print("Cache-Control: no-store")
if is_allowed_origin(origin):
    print(f"Access-Control-Allow-Origin: {origin}")
print()
print(json.dumps(result))
