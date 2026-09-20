#!/usr/bin/env python3
"""Verify configured queue capacity under concurrent public API uploads."""

import argparse
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from runtime_acceptance import call, multipart, register


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:3000")
    parser.add_argument("--benchmark", required=True, type=Path)
    parser.add_argument("--response", required=True, type=Path)
    parser.add_argument("--model", default="local_llm")
    parser.add_argument("--capacity", type=int, required=True)
    parser.add_argument("--requests", type=int, default=6)
    args = parser.parse_args()
    base = args.base_url.rstrip("/")
    _, token = register(base, "backpressure")

    benchmark = args.benchmark.read_bytes()
    response = args.response.read_bytes()

    def upload(index):
        body, content_type = multipart(
            {"modelType": args.model},
            [
                ("benchmarkFile", args.benchmark.name, benchmark, "text/csv"),
                ("userResponseFiles", f"response-{index}.csv", response, "text/csv"),
            ],
        )
        status, payload, _ = call(
            base, "/api/v1/analysis/upload", method="POST", token=token,
            body=body, content_type=content_type,
        )
        return status, payload

    with ThreadPoolExecutor(max_workers=args.requests) as executor:
        results = list(executor.map(upload, range(args.requests)))

    accepted = [payload["task_id"] for status, payload in results if status == 202]
    rejected = [payload for status, payload in results if status == 503]
    unexpected = [(status, payload) for status, payload in results if status not in {202, 503}]
    assert not unexpected, unexpected
    assert len(accepted) <= args.capacity, (accepted, rejected)
    assert len(accepted) + len(rejected) == args.requests
    print({"accepted": len(accepted), "rejected": len(rejected), "capacity": args.capacity})


if __name__ == "__main__":
    main()
