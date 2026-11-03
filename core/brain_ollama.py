"""
Backend alternativo del cerebro: Ollama (modelos locales).

Permite usar un modelo local (p. ej. qwen2.5-coder:7b) en vez de Claude Pro.
Se instala con: `winget install Ollama.Ollama` o desde https://ollama.com
Y luego: `ollama pull qwen2.5-coder:7b`.

API usada: POST http://localhost:11434/api/generate (síncrono, texto).
"""
from __future__ import annotations

import json
import urllib.error
import urllib.request


def ask_ollama(
    model: str,
    prompt: str,
    system: str,
    host: str = "http://127.0.0.1:11434",
    timeout: int = 180,
    temperature: float = 0.6,
    num_ctx: int = 4096,
) -> tuple[str, dict]:
    """Devuelve (respuesta_texto, metadata). Metadata incluye tokens.
    Lanza RuntimeError si Ollama no responde.
    """
    payload = {
        "model": model,
        "prompt": prompt,
        "system": system,
        "stream": False,
        "options": {
            "temperature": temperature,
            "num_ctx": num_ctx,
        },
    }
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        f"{host}/api/generate",
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
    except urllib.error.URLError as e:
        raise RuntimeError(
            f"No pude contactar a Ollama en {host}. "
            f"¿Está instalado y corriendo? ({e})"
        ) from e

    try:
        obj = json.loads(raw)
    except json.JSONDecodeError as e:
        raise RuntimeError(f"Respuesta inválida de Ollama: {e}") from e

    text = (obj.get("response") or "").strip()
    meta = {
        "model": obj.get("model"),
        "prompt_tokens": obj.get("prompt_eval_count"),
        "completion_tokens": obj.get("eval_count"),
        "total_duration_ms": round((obj.get("total_duration") or 0) / 1e6, 1),
    }
    return text, meta


def list_ollama_models(host: str = "http://127.0.0.1:11434", timeout: int = 5) -> list[dict]:
    """Lista los modelos instalados en Ollama. [] si no hay o Ollama no corre."""
    try:
        with urllib.request.urlopen(f"{host}/api/tags", timeout=timeout) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
        obj = json.loads(raw)
        return [
            {
                "name": m.get("name"),
                "size_gb": round((m.get("size") or 0) / 1024**3, 2),
                "family": (m.get("details") or {}).get("family"),
                "parameter_size": (m.get("details") or {}).get("parameter_size"),
            }
            for m in obj.get("models") or []
        ]
    except Exception:  # noqa: BLE001
        return []


def is_ollama_up(host: str = "http://127.0.0.1:11434", timeout: int = 2) -> bool:
    try:
        with urllib.request.urlopen(f"{host}/api/tags", timeout=timeout) as _:
            return True
    except Exception:  # noqa: BLE001
        return False
