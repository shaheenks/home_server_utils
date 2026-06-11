#!/usr/bin/env python3
import os
import sys

import re

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

print("Content-Type: application/json")
print("Cache-Control: no-store")
if is_allowed_origin(origin):
    print(f"Access-Control-Allow-Origin: {origin}")
print()
print('{"ok": true}')
