"""
Backend alternativo del cerebro: Gemini (Google AI Studio).

Permite usar Gemini (modelos de Google) en vez de Claude Pro u Ollama.
Requiere una API key gratuita de https://aistudio.google.com/apikey.

API usada: POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
Sin dependencias extra: urllib.
"""
from __future__ import annotations

import json
import urllib.error
import urllib.request

API_BASE = "https://generativelanguage.googleapis.com/v1beta"

# Modelos recomendados (los que usamos en el selector del dashboard).
# Habilitados en la cuenta Workspace del usuario: familia Gemini 3.x.
# (Los 2.5 aparecen en /models pero generateContent da 404 → no habilitados.)
RECOMMENDED_MODELS = [
    "gemini-3.6-flash",       # "Asistencia general" en la UI oficial
    "gemini-3.5-flash",
    "gemini-3.7-flash",
    "gemini-3.5-flash-lite",
    "gemini-3.8-flash",       # "Pensar" — problemas complejos
    "gemini-3.1-pro-preview", # "Razonamiento avanzado"
]

# Cadena de fallback: ordenada por velocidad+estabilidad para un asistente por voz.
# 3.6-flash primero (el default de la UI oficial), 3.1-pro-preview como último
# recurso (más lento pero más capaz).
FALLBACK_CHAIN = [
    "gemini-3.6-flash",
    "gemini-3.5-flash",
    "gemini-3.7-flash",
    "gemini-3.5-flash-lite",
    "gemini-3.8-flash",
    "gemini-3.1-pro-preview",
]

# Códigos que disparan fallback.
#  - 404: Google a veces renombra/retira modelos → prueba otro
#  - 429/5xx: saturación o cuota temporal
_RETRY_CODES = {404, 429, 500, 502, 503, 504}


class GeminiOverloadError(RuntimeError):
    """Error temporal (saturación/cuota) — señal para probar otro modelo."""


def ask_gemini(
    model: str,
    prompt: str,
    system: str,
    api_key: str,
    timeout: int = 180,
    temperature: float = 0.6,
) -> tuple[str, dict]:
    """Devuelve (respuesta_texto, metadata). Metadata incluye tokens.
    Lanza RuntimeError si Gemini no responde o la key es inválida.
    """
    if not api_key:
        raise RuntimeError(
            "Falta la API key de Gemini. Configúrala en el dashboard "
            "(Configuración → Cerebro → Gemini) o en config.brain.gemini.api_key."
        )

    payload = {
        "systemInstruction": {"parts": [{"text": system}]},
        "contents": [
            {"role": "user", "parts": [{"text": prompt}]},
        ],
        "generationConfig": {
            "temperature": temperature,
        },
    }
    data = json.dumps(payload).encode("utf-8")
    url = f"{API_BASE}/models/{model}:generateContent"
    req = urllib.request.Request(
        url,
        data=data,
        headers={
            "Content-Type": "application/json",
            "X-goog-api-key": api_key,
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        body = ""
        try:
            body = e.read().decode("utf-8", errors="replace")[:400]
        except Exception:  # noqa: BLE001
            pass
        cls = GeminiOverloadError if e.code in _RETRY_CODES else RuntimeError
        raise cls(
            f"Gemini respondió {e.code} ({e.reason}). {body}"
        ) from e
    except urllib.error.URLError as e:
        raise RuntimeError(
            f"No pude contactar a Gemini. ¿Hay internet? ({e})"
        ) from e

    try:
        obj = json.loads(raw)
    except json.JSONDecodeError as e:
        raise RuntimeError(f"Respuesta inválida de Gemini: {e}") from e

    candidates = obj.get("candidates") or []
    text = ""
    if candidates:
        parts = (candidates[0].get("content") or {}).get("parts") or []
        text = "".join(p.get("text", "") for p in parts).strip()

    usage = obj.get("usageMetadata") or {}
    meta = {
        "model": obj.get("modelVersion") or model,
        "prompt_tokens": usage.get("promptTokenCount"),
        "completion_tokens": usage.get("candidatesTokenCount"),
        "total_tokens": usage.get("totalTokenCount"),
    }
    return text, meta


def ask_gemini_with_fallback(
    primary_model: str,
    prompt: str,
    system: str,
    api_key: str,
    timeout: int = 180,
    temperature: float = 0.6,
) -> tuple[str, dict]:
    """Intenta `primary_model` y, si está saturado (503/429/5xx), prueba los
    demás modelos de FALLBACK_CHAIN en orden. Devuelve la primera respuesta
    válida. Si todos fallan por saturación, lanza GeminiOverloadError con el
    último mensaje. Otros errores (401/403/400) se propagan tal cual.
    """
    chain = [primary_model] + [m for m in FALLBACK_CHAIN if m != primary_model]
    tried: list[str] = []
    last_err: Exception | None = None
    for model in chain:
        tried.append(model)
        try:
            text, meta = ask_gemini(
                model, prompt, system, api_key,
                timeout=timeout, temperature=temperature,
            )
            meta["attempted_models"] = tried
            meta["fallback_used"] = model != primary_model
            return text, meta
        except GeminiOverloadError as e:
            last_err = e
            continue
        # RuntimeError (no retriable) se propaga directamente
    raise GeminiOverloadError(
        f"Todos los modelos de Gemini están saturados. "
        f"Probé: {', '.join(tried)}. Último error: {last_err}"
    )


def is_gemini_reachable(api_key: str, timeout: int = 5) -> bool:
    """True si la API responde con la key dada. Útil para el panel de estado."""
    if not api_key:
        return False
    url = f"{API_BASE}/models"
    req = urllib.request.Request(
        url,
        headers={"X-goog-api-key": api_key},
        method="GET",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status == 200
    except Exception:  # noqa: BLE001
        return False
