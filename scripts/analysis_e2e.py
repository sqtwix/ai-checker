#!/usr/bin/env python3
"""Run a real business E2E against the public frontend URL."""

import argparse
import csv
import json
import mimetypes
import subprocess
import time
import uuid
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


def request_json(url, *, method="GET", token=None, payload=None, body=None, content_type=None, timeout=30):
    headers = {"Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if payload is not None:
        body = json.dumps(payload).encode()
        headers["Content-Type"] = "application/json"
    elif content_type:
        headers["Content-Type"] = content_type
    request = Request(url, data=body, headers=headers, method=method)
    try:
        with urlopen(request, timeout=timeout) as response:
            return response.status, json.loads(response.read())
    except HTTPError as error:
        raw = error.read()
        try:
            payload = json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            payload = {"error": raw.decode(errors="replace")[:500]}
        return error.code, payload
    except URLError as error:
        return 0, {"error": str(error.reason)}


def multipart(fields, files):
    boundary = f"----ai-checker-{uuid.uuid4().hex}"
    chunks = []
    for name, value in fields.items():
        chunks.extend([
            f"--{boundary}\r\n".encode(),
            f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode(),
            str(value).encode(), b"\r\n",
        ])
    for name, path in files:
        mime = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        chunks.extend([
            f"--{boundary}\r\n".encode(),
            f'Content-Disposition: form-data; name="{name}"; filename="{path.name}"\r\n'.encode(),
            f"Content-Type: {mime}\r\n\r\n".encode(),
            path.read_bytes(), b"\r\n",
        ])
    chunks.append(f"--{boundary}--\r\n".encode())
    return b"".join(chunks), f"multipart/form-data; boundary={boundary}"


def csv_shape(benchmark, response_files):
    with benchmark.open(encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.reader(handle))
    question_count = sum(bool(value.strip()) for value in rows[2])

    student_ids = set()
    test_names = set()
    correct_answers = 0
    total_answers = 0
    expected_critical_rates = []
    for response_file in response_files:
        # Keep the expectation aligned with FileParser.ExtractTestName: exports
        # commonly use "Course - Test.ext", while the report shows only Test.
        test_names.add(response_file.stem.split(" - ", 1)[-1].strip())
        with response_file.open(encoding="utf-8-sig", newline="") as handle:
            rows = list(csv.reader(handle))
        header_index = next(index for index, row in enumerate(rows) if row and row[0].strip() == "ID")
        data_rows = [row for row in rows[header_index + 1:] if row and row[0].strip()]
        student_ids.update(row[0].strip() for row in data_rows)
        for offset in range(question_count):
            result_index = 5 + offset * 4
            results = [row[result_index].strip().lower() for row in data_rows
                       if len(row) > result_index and row[result_index].strip().lower() in {"lcnwu5wcgk", "r1s987zw3e"}]
            passed = sum(value == "lcnwu5wcgk" for value in results)
            correct_answers += passed
            total_answers += len(results)
            fail_rate = (len(results) - passed) * 100.0 / len(results) if results else 0.0
            if fail_rate >= 40.0:
                expected_critical_rates.append(fail_rate)
    return question_count, student_ids, test_names, correct_answers, total_answers, expected_critical_rates


def sample_shape(benchmark, response_files):
    if benchmark.suffix.lower() == ".csv" and all(path.suffix.lower() == ".csv" for path in response_files):
        return csv_shape(benchmark, response_files)

    repository = Path(__file__).resolve().parent.parent
    project = repository / "api-core/ApiCore/ParserSmoke/ParserSmoke.csproj"
    subprocess.run(
        ["dotnet", "build", str(project), "-c", "Release", "--no-restore"],
        cwd=repository,
        check=True,
        stdout=subprocess.DEVNULL,
    )
    combined = {
        "questions": 0,
        "students": set(),
        "tests": set(),
        "correct_answers": 0,
        "answers": 0,
        "critical_rates": [],
    }
    for response_file in response_files:
        completed = subprocess.run(
            [
                "dotnet", "run", "--project", str(project), "-c", "Release", "--no-build", "--",
                "--json", str(benchmark), str(response_file),
            ],
            cwd=repository,
            check=True,
            capture_output=True,
            text=True,
        )
        parsed = json.loads(completed.stdout)
        combined["questions"] += parsed["questions"]
        combined["students"].update(parsed["students"])
        combined["tests"].update(parsed["tests"])
        combined["correct_answers"] += parsed["correct_answers"]
        combined["answers"] += parsed["answers"]
        combined["critical_rates"].extend(parsed["critical_rates"])
    return (
        combined["questions"], combined["students"], combined["tests"],
        combined["correct_answers"], combined["answers"], combined["critical_rates"],
    )


def register(base, prefix):
    email_prefix = "".join(character.lower() if character.isalnum() else "-" for character in prefix)
    email = f"{email_prefix.strip('-')}-{uuid.uuid4().hex[:12]}@example.test"
    status, data = request_json(
        f"{base}/api/v1/auth/register",
        method="POST",
        payload={"username": prefix, "email": email, "password": "e2e-test-password-2026"},
    )
    assert status == 200, (status, data)
    return data["token"]


def contains_cyrillic(value):
    return any("а" <= character.casefold() <= "я" or character.casefold() == "ё" for character in value)


def validate_result(result, task_id, expected_answers, expected_students, expected_test_names,
                    correct_answers, total_answers, expected_critical_rates):
    assert result["batch_id"] == task_id
    assert result.get("generation_mode") == "llm", result.get("generation_mode")
    assert result.get("quality_status") in {"verified", "degraded"}, result.get("quality_status")
    assert isinstance(result.get("limitations", []), list)
    assert len(result["global_course_summary"].strip()) >= 20
    assert result["test_summaries"]
    assert {item["test_name"] for item in result["test_summaries"]} == expected_test_names
    actual_rates = sorted(
        error["fail_rate_percent"]
        for summary in result["test_summaries"]
        for error in summary["critical_mass_errors"]
    )
    assert actual_rates == sorted(expected_critical_rates), (actual_rates, expected_critical_rates)
    expected_success_rate = round(correct_answers * 100.0 / total_answers, 1)
    assert f"{expected_success_rate:g}%" in result["global_course_summary"]
    assert contains_cyrillic(result["global_course_summary"])

    details = result["student_detailed_analyses"]
    assert len(details) == expected_answers, (len(details), expected_answers)
    returned_students = {item["student_id"] for item in details}
    assert returned_students == expected_students, (returned_students, expected_students)
    assert not any(item["student_id"].startswith("student-") for item in details)
    assert all(0 <= item["ai_score_percent"] <= 100 for item in details)
    assert all(item["error_explanation"].strip() for item in details)
    assert all(contains_cyrillic(item["error_explanation"]) for item in details)

    for anomaly in result["anomalies"]:
        assert anomaly["student_id"] in expected_students
        assert anomaly["severity"] in {"Low", "Medium", "High"}
        assert anomaly["description"].strip()
        assert contains_cyrillic(anomaly["description"])

    recommendations = result["course_recommendations"]
    assert recommendations
    assert all(item["action_item"].strip() and item["priority"] in {"Low", "Medium", "High"}
               for item in recommendations)
    assert all(contains_cyrillic(item["action_item"]) for item in recommendations)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:3000")
    parser.add_argument("--benchmark", required=True, type=Path)
    parser.add_argument("--response", required=True, action="append", type=Path)
    parser.add_argument("--model", default="local_llm")
    parser.add_argument("--timeout", type=int, default=1800)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--require-verified", action="store_true")
    parser.add_argument("--expected-shape", type=Path, help="JSON from ParserSmoke --json for an XLSX fixture")
    parser.add_argument(
        "--expect-failure",
        help="Expected substring of a terminal validation error; skips local shape parsing.",
    )
    args = parser.parse_args()
    base = args.base_url.rstrip("/")
    if not args.expect_failure:
        if args.expected_shape:
            expected = json.loads(args.expected_shape.read_text(encoding="utf-8-sig"))
            shape = (
                expected["questions"], set(expected["students"]), set(expected["tests"]),
                expected["correct_answers"], expected["answers"], expected["critical_rates"],
            )
        else:
            shape = sample_shape(args.benchmark, args.response)
        expected_questions, expected_students, expected_test_names, correct_answers, total_answers, expected_rates = shape

    owner_token = register(base, "E2E Owner")
    other_token = register(base, "E2E Other")
    body, content_type = multipart(
        {"modelType": args.model},
        [("benchmarkFile", args.benchmark)] + [("userResponseFiles", path) for path in args.response],
    )
    status, uploaded = request_json(
        f"{base}/api/v1/analysis/upload", method="POST", token=owner_token,
        body=body, content_type=content_type, timeout=60,
    )
    assert status == 202, (status, uploaded)
    task_id = uploaded["task_id"]

    other_status, _ = request_json(f"{base}/api/v1/analysis/status/{task_id}", token=other_token)
    assert other_status == 404

    seen = []
    deadline = time.monotonic() + args.timeout
    while time.monotonic() < deadline:
        status, state = request_json(f"{base}/api/v1/analysis/status/{task_id}", token=owner_token)
        if status in {0, 502, 503, 504}:
            time.sleep(2)
            continue
        assert status == 200, (status, state)
        if not seen or seen[-1] != state["status"]:
            seen.append(state["status"])
            print(f"task {task_id}: {state['status']}", flush=True)
        if state["status"] == "Completed":
            if args.expect_failure:
                raise AssertionError(f"Task completed but failure containing {args.expect_failure!r} was expected")
            result = state["result"]
            if args.output:
                args.output.write_text(
                    json.dumps(result, ensure_ascii=False, indent=2) + "\n",
                    encoding="utf-8",
                )
            break
        if state["status"] == "Failed":
            if args.expect_failure and args.expect_failure.casefold() in (state.get("error") or "").casefold():
                print(json.dumps({
                    "task_id": task_id,
                    "statuses": seen,
                    "expected_failure": state.get("error"),
                }, ensure_ascii=False))
                return
            raise AssertionError(state.get("error"))
        time.sleep(2)
    else:
        raise TimeoutError(f"Task {task_id} did not complete in {args.timeout}s")

    validate_result(
        result, task_id, total_answers, expected_students, expected_test_names,
        correct_answers, total_answers, expected_rates,
    )
    if args.require_verified:
        assert result.get("quality_status") == "verified", result.get("limitations")
        assert not result.get("limitations"), result["limitations"]

    status, history = request_json(f"{base}/api/v1/analysis/history", token=owner_token)
    assert status == 200 and any(item["id"] == task_id and item["status"] == "Completed" for item in history)
    status, _ = request_json(
        f"{base}/api/v1/analysis/rename/{task_id}", method="PUT", token=owner_token,
        payload={"name": "E2E verified report"},
    )
    assert status == 200
    status, _ = request_json(f"{base}/api/v1/analysis/archive/{task_id}", method="PUT", token=owner_token)
    assert status == 200
    status, archived = request_json(f"{base}/api/v1/analysis/history?onlyArchived=true", token=owner_token)
    assert status == 200 and any(item["id"] == task_id for item in archived)
    status, _ = request_json(f"{base}/api/v1/analysis/unarchive/{task_id}", method="PUT", token=owner_token)
    assert status == 200

    print(json.dumps({
        "task_id": task_id,
        "statuses": seen,
        "students": len(expected_students),
        "questions": expected_questions,
        "details": len(result["student_detailed_analyses"]),
        "anomalies": len(result["anomalies"]),
        "recommendations": len(result["course_recommendations"]),
        "quality_status": result.get("quality_status"),
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
