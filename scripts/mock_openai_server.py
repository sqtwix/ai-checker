#!/usr/bin/env python3
"""Deterministic OpenAI-compatible test double for local deployment smoke tests."""

import json
import os
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


MODEL = os.getenv("MOCK_MODEL", "ai-checker-smoke")
DELAY = float(os.getenv("MOCK_DELAY_SECONDS", "0"))
ASSERT_PSEUDONYMS = os.getenv("ASSERT_PSEUDONYMS", "false").lower() == "true"


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/v1/models":
            self.respond({"object": "list", "data": [{"id": MODEL, "object": "model"}]})
        else:
            self.send_error(404)

    def do_POST(self):
        if self.path != "/v1/chat/completions":
            self.send_error(404)
            return
        length = int(self.headers.get("Content-Length", "0"))
        raw_request = self.rfile.read(length) or b"{}"
        json.loads(raw_request)
        if ASSERT_PSEUDONYMS and b"2025101000" in raw_request:
            self.send_error(400, "raw student id reached provider")
            return
        if DELAY:
            time.sleep(DELAY)
        content = json.dumps({
            "batch_id": "provider-smoke",
            "global_course_summary": "OpenAI-compatible provider smoke completed",
            "test_summaries": [],
            "student_detailed_analyses": [],
            "anomalies": [],
            "course_recommendations": [],
        }, ensure_ascii=False)
        self.respond({
            "id": "chatcmpl-smoke",
            "object": "chat.completion",
            "model": MODEL,
            "choices": [{"index": 0, "message": {"role": "assistant", "content": content}, "finish_reason": "stop"}],
        })

    def log_message(self, *_):
        return

    def respond(self, payload):
        body = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", int(os.getenv("MOCK_PORT", "18080"))), Handler).serve_forever()
