import os

import httpx


def _local_enabled() -> bool:
    return (os.getenv("ENABLE_LOCAL_LLM") or "false").strip().lower() == "true"


def _local_config() -> tuple[str, str, str]:
    base_url = (os.getenv("LOCAL_LLM_BASE_URL") or os.getenv("QWEN_LOCAL_URL") or "http://local-llm:8080/v1").rstrip("/")
    model = os.getenv("LOCAL_LLM_MODEL") or os.getenv("QWEN_LOCAL_MODEL") or "local-model"
    api_key = os.getenv("LOCAL_LLM_API_KEY") or "not-needed"
    return base_url, model, api_key


def local_model_available() -> bool:
    if not _local_enabled():
        return False
    base_url, model, api_key = _local_config()
    try:
        response = httpx.get(
            f"{base_url}/models",
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=3,
        )
        response.raise_for_status()
        data = response.json().get("data", [])
        return any(item.get("id") == model for item in data) or bool(data)
    except (httpx.HTTPError, ValueError, TypeError):
        return False


def get_model_availability() -> dict:
    return {
        "deepseek": {
            "available": bool((os.getenv("DEEPSEEK_API_KEY") or "").strip()),
            "mode": "cloud",
        },
        "gigachat": {
            "available": bool((os.getenv("SBERGPT_API_KEY") or "").strip()),
            "mode": "cloud",
        },
        "local_llm": {
            "available": local_model_available(),
            "mode": (os.getenv("LOCAL_LLM_MODE") or "managed").strip().lower(),
            "model": _local_config()[1],
        },
    }


def verify_local_inference() -> bool:
    if not local_model_available():
        return False
    base_url, model, api_key = _local_config()
    try:
        response = httpx.post(
            f"{base_url}/chat/completions",
            headers={"Authorization": f"Bearer {api_key}"},
            json={
                "model": model,
                "messages": [{"role": "user", "content": "Ответь одним словом: готов"}],
                "temperature": 0,
                "max_tokens": 16,
            },
            timeout=90,
        )
        response.raise_for_status()
        content = response.json()["choices"][0]["message"]["content"]
        return bool(content and content.strip())
    except (httpx.HTTPError, KeyError, IndexError, ValueError, TypeError):
        return False
