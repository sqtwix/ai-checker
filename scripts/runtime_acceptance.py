#!/usr/bin/env python3
"""Exercise public API validation, ZIP handling, ACL and report lifecycle.

Run only against an isolated acceptance database: this script creates users and
one analysis report.
"""

import argparse
import io
import json
import time
import uuid
import zipfile
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen


def call(base, path, *, method="GET", token=None, payload=None, body=None, content_type=None):
    headers = {"Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if payload is not None:
        body = json.dumps(payload).encode()
        headers["Content-Type"] = "application/json"
    elif content_type:
        headers["Content-Type"] = content_type
    request = Request(base + path, data=body, headers=headers, method=method)
    try:
        with urlopen(request, timeout=30) as response:
            raw = response.read()
            return response.status, json.loads(raw) if raw else {}, dict(response.headers)
    except HTTPError as error:
        raw = error.read()
        try:
            data = json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            data = {"error": raw.decode(errors="replace")}
        return error.code, data, dict(error.headers)


def register(base, label):
    email = f"acceptance-{label}-{uuid.uuid4().hex[:10]}@example.test"
    status, data, _ = call(base, "/api/v1/auth/register", method="POST", payload={
        "username": f"Acceptance {label}", "email": email, "password": "acceptance-password-2026",
    })
    assert status == 200, (status, data)
    return email, data["token"]


def multipart(fields, files):
    boundary = f"----acceptance-{uuid.uuid4().hex}"
    chunks = []
    for name, value in fields.items():
        chunks += [
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n".encode(),
            str(value).encode(), b"\r\n",
        ]
    for name, filename, content, mime in files:
        chunks += [
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"; filename=\"{filename}\"\r\n".encode(),
            f"Content-Type: {mime}\r\n\r\n".encode(), content, b"\r\n",
        ]
    chunks.append(f"--{boundary}--\r\n".encode())
    return b"".join(chunks), f"multipart/form-data; boundary={boundary}"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:3000")
    parser.add_argument("--benchmark", required=True, type=Path)
    parser.add_argument("--response", required=True, type=Path)
    parser.add_argument("--model", default="local_llm")
    args = parser.parse_args()
    base = args.base_url.rstrip("/")

    with urlopen(base + "/health", timeout=10) as response:
        assert response.status == 200 and response.read().strip() == b"ok"
    with urlopen(base + "/", timeout=10) as response:
        headers = {key.lower(): value for key, value in response.headers.items()}
        assert headers["x-content-type-options"] == "nosniff"
        assert "default-src 'self'" in headers["content-security-policy"]

    invalid_cases = [
        ({"username": " x ", "email": "short-name@example.test", "password": "123456"}, 400),
        ({"username": "Valid User", "email": "bad email@example.test", "password": "123456"}, 400),
        ({"username": "Valid User", "email": "valid@example.test", "password": "12345"}, 400),
        ({"username": "Valid User", "email": "valid@example.test", "password": "x" * 1025}, 400),
    ]
    for payload, expected in invalid_cases:
        status, _, _ = call(base, "/api/v1/auth/register", method="POST", payload=payload)
        assert status == expected, (payload["email"], status)

    owner_email, owner = register(base, "owner")
    _, other = register(base, "other")
    status, _, _ = call(base, "/api/v1/auth/register", method="POST", payload={
        "username": "Duplicate", "email": owner_email.upper(), "password": "acceptance-password-2026",
    })
    assert status == 400
    status, _, _ = call(base, "/api/v1/auth/login", method="POST", payload={
        "email": owner_email, "password": "wrong-password",
    })
    assert status == 401
    status, logged_in, _ = call(base, "/api/v1/auth/login", method="POST", payload={
        "email": owner_email.upper(), "password": "acceptance-password-2026",
    })
    assert status == 200 and logged_in["token"]
    status, _, _ = call(base, "/api/v1/analysis/history", token="not-a-jwt")
    assert status == 401

    status, _, _ = call(base, "/api/v1/user/settings", method="PUT", token=owner, payload=[])
    assert status == 400
    status, _, _ = call(base, "/api/v1/user/settings", method="PUT", token=owner, payload={"value": "x" * 17000})
    assert status == 400
    settings = {"theme": "dark", "minimalUi": True, "accessibility": {"enabled": True}}
    status, _, _ = call(base, "/api/v1/user/settings", method="PUT", token=owner, payload=settings)
    assert status == 200
    status, loaded, _ = call(base, "/api/v1/user/settings", token=owner)
    assert status == 200 and loaded == settings

    invalid_body, invalid_type = multipart(
        {"modelType": args.model},
        [
            ("benchmarkFile", "benchmark.txt", b"invalid", "text/plain"),
            ("userResponseFiles", "response.csv", args.response.read_bytes(), "text/csv"),
        ],
    )
    status, _, _ = call(
        base, "/api/v1/analysis/upload", method="POST", token=owner,
        body=invalid_body, content_type=invalid_type,
    )
    assert status == 400

    archive_buffer = io.BytesIO()
    with zipfile.ZipFile(archive_buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("../ignored-path/response.csv", args.response.read_bytes())
        archive.writestr("ignored.exe", b"not accepted")
    upload_body, upload_type = multipart(
        {"modelType": args.model},
        [
            ("benchmarkFile", args.benchmark.name, args.benchmark.read_bytes(), "text/csv"),
            ("userResponseFiles", "responses.zip", archive_buffer.getvalue(), "application/zip"),
        ],
    )
    status, accepted, _ = call(
        base, "/api/v1/analysis/upload", method="POST", token=owner,
        body=upload_body, content_type=upload_type,
    )
    assert status == 202, (status, accepted)
    task_id = accepted["task_id"]

    for path, method, payload in [
        (f"/api/v1/analysis/status/{task_id}", "GET", None),
        (f"/api/v1/analysis/rename/{task_id}", "PUT", {"name": "forbidden"}),
        (f"/api/v1/analysis/archive/{task_id}", "PUT", None),
        (f"/api/v1/analysis/unarchive/{task_id}", "PUT", None),
    ]:
        status, _, _ = call(base, path, method=method, token=other, payload=payload)
        assert status == 404, (path, status)

    deadline = time.monotonic() + 180
    seen = []
    while time.monotonic() < deadline:
        status, state, _ = call(base, f"/api/v1/analysis/status/{task_id}", token=owner)
        assert status == 200
        if not seen or seen[-1] != state["status"]:
            seen.append(state["status"])
        if state["status"] == "Completed":
            assert len(state["result"]["student_detailed_analyses"]) == 6
            break
        if state["status"] == "Failed":
            raise AssertionError(state["error"])
        time.sleep(1)
    else:
        raise TimeoutError(task_id)

    for name, expected in [("", 400), ("x" * 201, 400), ("ZIP acceptance", 200)]:
        status, _, _ = call(
            base, f"/api/v1/analysis/rename/{task_id}", method="PUT", token=owner,
            payload={"name": name},
        )
        assert status == expected, (len(name), status)
    status, _, _ = call(base, f"/api/v1/analysis/archive/{task_id}", method="PUT", token=owner)
    assert status == 200
    status, archived, _ = call(base, "/api/v1/analysis/history?onlyArchived=true", token=owner)
    assert status == 200 and any(item["id"] == task_id for item in archived)
    status, _, _ = call(base, f"/api/v1/analysis/unarchive/{task_id}", method="PUT", token=owner)
    assert status == 200

    print(json.dumps({"task_id": task_id, "statuses": seen, "zip": "passed", "acl": "passed"}))


if __name__ == "__main__":
    main()
