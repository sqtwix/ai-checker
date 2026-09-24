"""Durable, per-job cancellation checked between model requests."""
from contextlib import contextmanager
from contextvars import ContextVar
import hashlib
import os
from pathlib import Path
import threading

_job = ContextVar("analysis_job", default=None)
_cancelled = set()
_guard = threading.Lock()


class AnalysisCancelled(Exception):
    pass


def _marker(batch_id):
    directory = os.getenv("AI_CHECKPOINT_DIR", "").strip()
    return Path(directory) / (hashlib.sha256(batch_id.encode()).hexdigest() + ".cancelled") if directory else None


def cancel_job(batch_id):
    marker = _marker(batch_id)
    if marker is not None:
        marker.parent.mkdir(parents=True, exist_ok=True)
        marker.touch(exist_ok=True)
    else:
        with _guard:
            _cancelled.add(batch_id)


def check_cancelled():
    batch_id = _job.get()
    if not batch_id:
        return
    marker = _marker(batch_id)
    with _guard:
        cancelled = batch_id in _cancelled
    if cancelled or (marker is not None and marker.exists()):
        raise AnalysisCancelled("Анализ остановлен пользователем.")


@contextmanager
def job_context(batch_id):
    token = _job.set(batch_id)
    try:
        check_cancelled()
        yield
        check_cancelled()
    finally:
        _job.reset(token)
