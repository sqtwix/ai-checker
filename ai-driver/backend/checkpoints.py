"""Persist validated inference results for retries of the same analysis job."""
import hashlib
import json
import logging
import os
from pathlib import Path
import threading
import uuid

logger = logging.getLogger(__name__)
_locks = {}
_locks_guard = threading.Lock()


def fingerprint(value):
    encoded = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


class Checkpoints:
    def __init__(self, source, model_type):
        self.directory = os.getenv("AI_CHECKPOINT_DIR", "").strip()
        self.values = {}
        self.lock_file = None
        self.thread_lock = None
        self.key = fingerprint({
            "version": 2, "source": source, "provider": model_type,
            "model": os.getenv("LOCAL_LLM_MODEL", "local-model"),
            "base_url": os.getenv("LOCAL_LLM_BASE_URL", ""),
        })

    def __enter__(self):
        if not self.directory:
            return self
        directory = Path(self.directory)
        directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.path = directory / (self.key + ".json")
        with _locks_guard:
            self.thread_lock = _locks.setdefault(self.key, threading.Lock())
        self.thread_lock.acquire()
        try:
            self.lock_file = (directory / (self.key + ".lock")).open("a+b")
            if os.name == "posix":
                import fcntl
                fcntl.flock(self.lock_file, fcntl.LOCK_EX)
            if self.path.exists():
                try:
                    saved = json.loads(self.path.read_text(encoding="utf-8"))
                    if isinstance(saved, dict):
                        self.values = saved
                except (ValueError, UnicodeError):
                    logger.warning("Ignoring an invalid analysis checkpoint")
            logger.info("Analysis checkpoint loaded: %s validated requests", len(self.values))
            return self
        except BaseException:
            self.__exit__(None, None, None)
            raise

    def __exit__(self, *args):
        if self.lock_file:
            self.lock_file.close()
            self.lock_file = None
        if self.thread_lock:
            self.thread_lock.release()
            self.thread_lock = None

    @staticmethod
    def request_key(prompt, payload, schema):
        return fingerprint([prompt, payload, schema])

    def get(self, key):
        return self.values.get(key)

    def put(self, key, value):
        if self.values.get(key) == value:
            return
        self.values[key] = value
        if not self.directory:
            return
        temp = self.path.with_suffix("." + uuid.uuid4().hex + ".tmp")
        try:
            with temp.open("x", encoding="utf-8") as stream:
                json.dump(self.values, stream, ensure_ascii=False, separators=(",", ":"))
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temp, self.path)
        finally:
            temp.unlink(missing_ok=True)
