#!/usr/bin/env python3
"""Loopback Jev (decision-model) relay for the Muse host.

The novel CLI posts the System One wire shape ({state, questions}) to this
relay; the relay shells out to a host-provided helper that holds the real
TypeSafe credential (in Muse's case, the connector CLI, whose key lives in
the vault). The CLI's JevClient never sees a real key: point it at this
relay with JEV_ENDPOINT=http://127.0.0.1:<port>, and give it any non-empty
placeholder key value — the relay strips authorization entirely and never
forwards it beyond loopback.

Configuration (environment):
  MUSE_JEV_HELPER  Path to the helper executable (required). It is invoked
                   as: <helper> ask --state <state>
                     --questions-json <json> --model <model>
                   and must print a JSON object (the answers payload) on
                   stdout.
  MUSE_JEV_MODEL   Model id passed to the helper (default: jev-1.13.0).
  MUSE_RELAY_HOST  Bind host (default: 127.0.0.1). Loopback only is the
                   supported configuration: a non-loopback bind would expose
                   a vault-backed helper to the network.
  MUSE_JEV_PORT    Port (default: 8791).

Standard library only. Exits 2 immediately when the helper is unset, so a
supervisor notices a misconfiguration instead of serving 502s.
"""

import json
import os
import subprocess
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HELPER = os.environ.get("MUSE_JEV_HELPER", "")
MODEL = os.environ.get("MUSE_JEV_MODEL", "jev-1.13.0")
HOST = os.environ.get("MUSE_RELAY_HOST", "127.0.0.1")
PORT = int(os.environ.get("MUSE_JEV_PORT", "8791"))

if not HELPER:
    print("jev-relay: MUSE_JEV_HELPER is not set (path to the Jev helper)", file=sys.stderr)
    sys.exit(2)
if HOST not in ("127.0.0.1", "localhost", "::1"):
    print(f"jev-relay: WARNING: binding non-loopback host {HOST!r} exposes a vault-backed helper", file=sys.stderr)


class H(BaseHTTPRequestHandler):
    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(n) or b"{}")
        raw_q = body.get("questions", {})
        questions = {}
        for key, q in raw_q.items():
            item = {"type": q.get("type", "noul"), "instructions": q.get("instructions", "")}
            crit = q.get("criteria")
            if isinstance(crit, dict) and crit:
                item["criteria"] = crit
            elif isinstance(crit, list) and crit:
                item["criteria"] = {str(x): str(x) for x in crit}
            questions[key] = item
        args = ["python3", HELPER, "ask", "--state", body.get("state", ""),
                "--questions-json", json.dumps(questions, ensure_ascii=False), "--model", MODEL]
        try:
            out = subprocess.run(args, capture_output=True, text=True, timeout=600)
            resp, code = json.loads(out.stdout.strip() or "{}"), 200
        except Exception as e:
            resp, code = {"error": str(e)}, 502
        raw = json.dumps(resp, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    ThreadingHTTPServer((HOST, PORT), H).serve_forever()
