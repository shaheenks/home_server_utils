#!/usr/bin/env python3
import os
import sys

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

print("Content-Type: application/json")
print("Cache-Control: no-store")
if origin in ALLOWED_ORIGINS:
    print(f"Access-Control-Allow-Origin: {origin}")
print()
print('{"ok": true}')
