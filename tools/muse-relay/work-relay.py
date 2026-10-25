#!/usr/bin/env python3
"""Loopback work-LLM relay for the Muse host.

The novel CLI posts OpenAI-shaped POST /v1/chat/completions to this relay;
the relay shells out to a host-provided helper that holds the real work-model
credential (in Muse's case, the connector CLI, whose key lives in the vault).
Point the CLI at this relay with WORK_LLM_BASE_URL=http://127.0.0.1:<port>
and give it any non-empty placeholder key value — the relay strips
authorization entirely and never forwards it beyond loopback. The CLI runs
against the work model without the vault key ever entering its environment
or its secret store.

Configuration (environment):
  MUSE_WORK_HELPER  Path to the helper executable (required). It is invoked
                    as: <helper> complete --prompt <prompt>
                      [--system <system>] [--max-tokens <n>] [--json]
                    and must print the completion text on stdout (or a JSON
                    envelope with a "content" string, which is unwrapped).
  MUSE_RELAY_HOST  Bind host (default: 127.0.0.1). Loopback only is the
                   supported configuration: a non-loopback bind would expose
                   a vault-backed helper to the network.
  MUSE_WORK_PORT   Port (default: 8792).

Standard library only. Exits 2 immediately when the helper is unset, so a
supervisor notices a misconfiguration instead of serving 500s.
"""

import json
import os
import subprocess
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HELPER = os.environ.get("MUSE_WORK_HELPER", "")
HOST = os.environ.get("MUSE_RELAY_HOST", "127.0.0.1")
PORT = int(os.environ.get("MUSE_WORK_PORT", "8792"))

if not HELPER:
    print("work-relay: MUSE_WORK_HELPER is not set (path to the work-model helper)", file=sys.stderr)
    sys.exit(2)
if HOST not in ("127.0.0.1", "localhost", "::1"):
    print(f"work-relay: WARNING: binding non-loopback host {HOST!r} exposes a vault-backed helper", file=sys.stderr)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):  # quiet
        pass

    def do_POST(self):
        if not self.path.rstrip("/").endswith("/chat/completions"):
            self.send_response(404)
            self.end_headers()
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            body = json.loads(self.rfile.read(length) or b"{}")
            messages = body.get("messages", [])
            system = "\n".join(m.get("content", "") for m in messages if m.get("role") == "system")
            prompt = "\n".join(m.get("content", "") for m in messages if m.get("role") != "system")
            cmd = [sys.executable, HELPER, "complete", "--prompt", prompt]
            if system:
                cmd += ["--system", system]
            max_tokens = body.get("max_tokens") or 8192
            cmd += ["--max-tokens", str(int(max_tokens))]
            if (body.get("response_format") or {}).get("type") == "json_object":
                cmd += ["--json"]
            out = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
            if out.returncode != 0:
                raise RuntimeError(out.stderr.strip()[:400] or "helper failed")
            content = out.stdout.strip()
            try:
                envelope = json.loads(content)
                if isinstance(envelope, dict) and isinstance(envelope.get("content"), str):
                    content = envelope["content"]
            except json.JSONDecodeError:
                pass
            resp = {
                "id": "chatcmpl-relay",
                "object": "chat.completion",
                "model": body.get("model", "deepseek-chat"),
                "choices": [
                    {"index": 0, "message": {"role": "assistant", "content": content}, "finish_reason": "stop"}
                ],
                "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
            }
            payload = json.dumps(resp).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
        except Exception as exc:  # noqa: BLE001 - relay must answer JSON
            payload = json.dumps({"error": {"message": str(exc)}}).encode()
            self.send_response(500)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)


if __name__ == "__main__":
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
