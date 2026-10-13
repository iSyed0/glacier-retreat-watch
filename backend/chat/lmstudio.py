"""
Thin client for LM Studio's native REST API (v1) -- the local model the
portal chatbot runs on. Covers the five endpoints LM Studio exposes:

    GET  /api/v1/models                         list models + loaded instances
    POST /api/v1/chat                           one chat turn (SSE when stream=true)
    POST /api/v1/models/load                    load a model with a given context
    POST /api/v1/models/download                start a model download
    GET  /api/v1/models/download/status/:job_id poll a download

Configured by environment variables (all optional):
    LMSTUDIO_URL      default http://127.0.0.1:1234
    LMSTUDIO_MODEL    default google/gemma-4-e2b
    LMSTUDIO_CONTEXT  default 4096 -- minimum context the chatbot needs; the
                      system prompt alone is ~1k tokens, so the 512 LM Studio
                      sometimes loads with is not enough.

/api/v1/chat has no custom-function-tools field (tools there are MCP
plugins only), so the chatbot doesn't use native tool calling -- the model
answers with a small JSON plan instead (see prompt.py / agent.py).
"""

import json
import os
import threading

import requests

BASE_URL = os.environ.get("LMSTUDIO_URL", "http://127.0.0.1:1234").rstrip("/")
MODEL = os.environ.get("LMSTUDIO_MODEL", "google/gemma-4-e2b")
MIN_CONTEXT = int(os.environ.get("LMSTUDIO_CONTEXT", "4096"))

# Loading takes ~10s and must not happen twice concurrently (each load
# call creates a *new* instance, e.g. "google/gemma-4-e2b:2").
_load_lock = threading.Lock()


class LMStudioUnavailable(Exception):
    """LM Studio isn't running / its server isn't started / the model is missing."""


def _url(path):
    return f"{BASE_URL}{path}"


def _request(method, path, timeout=10, **kwargs):
    try:
        r = requests.request(method, _url(path), timeout=timeout, **kwargs)
    except requests.RequestException as exc:
        raise LMStudioUnavailable(
            f"Can't reach LM Studio at {BASE_URL} -- is its server running? (lms server start)"
        ) from exc
    if not r.ok:
        try:
            detail = r.json().get("error", {}).get("message") or r.text
        except ValueError:
            detail = r.text
        raise LMStudioUnavailable(f"LM Studio {path} failed ({r.status_code}): {detail}")
    return r.json()


def list_models():
    return _request("GET", "/api/v1/models").get("models", [])


def load_model(model=MODEL, context_length=MIN_CONTEXT):
    return _request(
        "POST", "/api/v1/models/load", timeout=300,
        json={"model": model, "context_length": context_length, "echo_load_config": True},
    )


def download_model(model=MODEL):
    return _request("POST", "/api/v1/models/download", timeout=30, json={"model": model})


def download_status(job_id):
    return _request("GET", f"/api/v1/models/download/status/{job_id}")


def model_status(model=MODEL):
    """Where the configured model stands: missing / not_loaded / ready,
    plus the instance the chatbot would use."""
    entry = next((m for m in list_models() if m.get("key") == model), None)
    if entry is None:
        return {"state": "missing", "model": model, "baseUrl": BASE_URL}
    instance = _usable_instance(entry)
    return {
        "state": "ready" if instance else "not_loaded",
        "model": model,
        "displayName": entry.get("display_name"),
        "instanceId": instance["id"] if instance else None,
        "contextLength": instance["config"]["context_length"] if instance else None,
        "minContext": MIN_CONTEXT,
        "baseUrl": BASE_URL,
    }


def _usable_instance(entry):
    for inst in entry.get("loaded_instances", []):
        if inst.get("config", {}).get("context_length", 0) >= MIN_CONTEXT:
            return inst
    return None


def ensure_instance(model=MODEL):
    """Instance id with at least MIN_CONTEXT tokens, loading one if needed."""
    status = model_status(model)
    if status["state"] == "ready":
        return status["instanceId"]
    if status["state"] == "missing":
        raise LMStudioUnavailable(f"Model {model} isn't downloaded in LM Studio.")
    with _load_lock:
        status = model_status(model)  # another request may have loaded it meanwhile
        if status["state"] == "ready":
            return status["instanceId"]
        return load_model(model)["instance_id"]


def chat_stream(instance_id, system_prompt, user_input, max_output_tokens=400):
    """One stateless chat turn, streamed. Yields (event_name, data_dict)
    straight from LM Studio's SSE stream (chat.start, prompt_processing.*,
    message.delta, chat.end, error, ...)."""
    body = {
        "model": instance_id,
        "system_prompt": system_prompt,
        "input": user_input,
        "stream": True,
        "store": False,
        "reasoning": "off",  # no thinking tokens -- far faster on CPU
        "temperature": 0.2,
        "max_output_tokens": max_output_tokens,
    }
    try:
        r = requests.post(_url("/api/v1/chat"), json=body, stream=True, timeout=(10, 300))
    except requests.RequestException as exc:
        raise LMStudioUnavailable(f"Can't reach LM Studio at {BASE_URL}") from exc
    if not r.ok:
        raise LMStudioUnavailable(f"LM Studio chat failed ({r.status_code}): {r.text[:300]}")

    event = None
    with r:
        for raw in r.iter_lines(decode_unicode=True):
            if not raw:
                continue
            if raw.startswith("event:"):
                event = raw[6:].strip()
            elif raw.startswith("data:"):
                try:
                    data = json.loads(raw[5:].strip())
                except ValueError:
                    continue
                yield event or data.get("type"), data
