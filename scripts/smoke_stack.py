#!/usr/bin/env python3
"""HTTP smoke test for a running stack; deploy removes its reserved test user."""

import argparse
import uuid
from io import BytesIO

import httpx


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:3000")
    parser.add_argument("--expect-no-ai", action="store_true")
    args = parser.parse_args()
    base = args.base_url.rstrip("/")

    with httpx.Client(timeout=15) as client:
        health = client.get(f"{base}/health")
        health.raise_for_status()
        assert health.text.strip() == "ok"

        index = client.get(f"{base}/")
        index.raise_for_status()
        assert "НейроЭксперт" in index.text

        unauthorized = client.get(f"{base}/api/v1/analysis/history")
        assert unauthorized.status_code == 401

        email = f"smoke-{uuid.uuid4().hex[:12]}@example.test"
        registered = client.post(f"{base}/api/v1/auth/register", json={
            "username": "Smoke Test",
            "email": email,
            "password": "smoke-test-password",
        })
        registered.raise_for_status()
        token = registered.json()["token"]
        headers = {"Authorization": f"Bearer {token}"}

        history = client.get(f"{base}/api/v1/analysis/history", headers=headers)
        history.raise_for_status()
        assert history.json() == []

        saved = client.put(
            f"{base}/api/v1/user/settings",
            headers=headers,
            json={"highContrast": True},
        )
        saved.raise_for_status()
        loaded = client.get(f"{base}/api/v1/user/settings", headers=headers)
        loaded.raise_for_status()
        assert loaded.json()["highContrast"] is True

        if args.expect_no_ai:
            rejected = client.post(
                f"{base}/api/v1/analysis/upload",
                headers=headers,
                files=[
                    ("benchmarkFile", ("benchmark.csv", BytesIO(b"question\nanswer\n"), "text/csv")),
                    ("userResponseFiles", ("responses.csv", BytesIO(b"student\nanswer\n"), "text/csv")),
                ],
                data={"modelType": "deepseek"},
            )
            assert rejected.status_code == 503
            assert rejected.json().get("code") == "MODEL_UNAVAILABLE"
            history = client.get(f"{base}/api/v1/analysis/history", headers=headers)
            history.raise_for_status()
            assert history.json() == []

    print("Stack smoke test passed: frontend, proxy, auth, JWT, settings and configured AI mode.")


if __name__ == "__main__":
    main()
