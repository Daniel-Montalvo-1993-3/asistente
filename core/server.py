"""
Núcleo de Jarvis — conecta el widget, el dashboard, el cerebro, la voz y el oído.

Mensajes del dashboard (type):
  - get_diagnostics / get_history / get_config / set_config
  - get_models / get_resources / get_vault_graph / get_vault_touches
  - get_commands / get_transparency / get_providers / set_provider
  - test_tts / benchmark_whisper / export_history
  - clear_history / restart_core
"""
from __future__ import annotations

import asyncio
import base64
import json
import shutil
import sys
import time
from pathlib import Path

import websockets

sys.path.insert(0, str(Path(__file__).resolve().parent))

from brain import Brain              # noqa: E402
from brain_ollama import list_ollama_models, is_ollama_up  # noqa: E402
from brain_gemini import RECOMMENDED_MODELS as GEMINI_MODELS, is_gemini_reachable  # noqa: E402
from tts import Speaker              # noqa: E402
from ears import Listener            # noqa: E402
from logger import Logger            # noqa: E402
from system_info import diagnostics  # noqa: E402
from vault_graph import build_graph  # noqa: E402
from resources import snapshot as resources_snapshot  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
CONFIG_PATH = ROOT / "config" / "config.json"
LOG_PATH = ROOT / "logs" / "jarvis.jsonl"
AUDIO_DIR = ROOT / "widget" / "renderer" / "audio"
AUDIO_ORIGINALS = AUDIO_DIR / "_originals"
SOUND_SLOTS = ("inicio", "escuchar", "pensando", "termino")
ALLOWED_AUDIO_EXT = {".mp3", ".wav", ".ogg", ".m4a"}
MAX_AUDIO_BYTES = 2 * 1024 * 1024  # 2 MB


def load_config() -> dict:
    return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))


config = load_config()
logger = Logger(LOG_PATH)
brain = Brain(config)
speaker = Speaker(config)
connected: set = set()
listener: Listener | None = None
main_loop: asyncio.AbstractEventLoop | None = None
start_time = time.time()
turns_count = 0


def resting_state() -> str:
    if listener and listener.enabled and listener._running:
        return "ears_off" if listener.muted else "listening"
    return "idle"


def current_models() -> dict:
    return {
        "brain": {
            "provider": brain.provider,
            "cmd": str(brain.cmd),
            "ollama_model": brain.ollama_model,
            "gemini_model": brain.gemini_model,
            "gemini_configured": bool(brain.gemini_api_key),
            "permission_level": brain.level,
            "vault": str(brain.vault),
            "vault_exists": brain.vault.exists(),
            "os": brain.os_label,
        },
        "ears": {
            "enabled": bool(listener.enabled) if listener else False,
            "running": bool(listener and listener._running),
            "muted": bool(listener.muted) if listener else False,
            "model": listener.whisper_model_name if listener else None,
            "device": listener.active_device if listener else None,
            "mic": config.get("ears", {}).get("mic_device"),
            "exclusive": bool(config.get("ears", {}).get("wasapi_exclusive")),
        },
        "voice": {
            "backend": config.get("tts", {}).get("backend"),
            "piper_voice": config.get("tts", {}).get("piper_voice"),
        },
        "uptime_seconds": round(time.time() - start_time, 1),
        "turns": turns_count,
    }


async def broadcast(message: dict) -> None:
    if connected:
        data = json.dumps(message, ensure_ascii=False)
        await asyncio.gather(*[c.send(data) for c in connected],
                             return_exceptions=True)


async def send_to(ws, message: dict) -> None:
    try:
        await ws.send(json.dumps(message, ensure_ascii=False))
    except Exception:  # noqa: BLE001
        pass


# ---- Flujo principal: una interacción con Jarvis ----
async def handle_user_message(text: str, source: str = "text") -> None:
    global turns_count
    loop = asyncio.get_event_loop()
    turns_count += 1

    await broadcast({"type": "state", "value": "thinking"})
    t_brain = time.time()
    reply = await loop.run_in_executor(None, brain.ask, text)
    brain_s = round(time.time() - t_brain, 2)
    await broadcast({"type": "assistant_message", "text": reply})

    await broadcast({"type": "state", "value": "speaking"})
    if listener:
        listener.pause()
    t_voice = time.time()
    await loop.run_in_executor(None, speaker.say, reply)
    voice_s = round(time.time() - t_voice, 2)
    if listener:
        listener.resume()

    await broadcast({"type": "state", "value": resting_state()})

    turn_event = {
        "source": source,
        "user": text,
        "reply": reply,
        "latency": {"brain": brain_s, "voice": voice_s},
        "level": brain.level,
        "provider": brain.provider,
        "tokens": brain.last_turn_tokens,
        "files_touched": brain.last_turn_files,
        "commands_run": brain.last_turn_commands,
    }
    logger.log("turn", **turn_event)
    await broadcast({"type": "turn", **turn_event})
    await broadcast({"type": "vault_touches",
                     "data": [{"path": k, "ts": v}
                              for k, v in brain.vault_touches.items()]})


async def handle_voice(text: str) -> None:
    await broadcast({"type": "user_voice", "text": text})
    await handle_user_message(text, source="voice")


async def handle_wake() -> None:
    loop = asyncio.get_event_loop()
    await broadcast({"type": "state", "value": "speaking"})
    if listener:
        listener.pause()
    await loop.run_in_executor(None, speaker.say, "¿Sí? Te escucho.")
    if listener:
        listener.resume()
    await broadcast({"type": "state", "value": "listening"})


# ---- Callbacks del oído ----
def on_ear_state(state: str) -> None:
    if main_loop:
        asyncio.run_coroutine_threadsafe(
            broadcast({"type": "state", "value": state}), main_loop)


def on_ear_transcript(text: str) -> None:
    if main_loop:
        asyncio.run_coroutine_threadsafe(handle_voice(text), main_loop)


def on_ear_wake() -> None:
    if main_loop:
        asyncio.run_coroutine_threadsafe(handle_wake(), main_loop)


# ---- API del dashboard ----
async def handle_dashboard(ws, msg: dict) -> None:
    t = msg.get("type")
    reply_id = msg.get("reply_id")

    if t == "get_diagnostics":
        await send_to(ws, {"type": "diagnostics", "reply_id": reply_id,
                           "data": diagnostics()})
    elif t == "get_history":
        limit = int(msg.get("limit") or 100)
        types = msg.get("types")
        events = logger.tail(limit=limit, types=types)
        await send_to(ws, {"type": "history", "reply_id": reply_id, "data": events})
    elif t == "get_config":
        cfg = load_config()
        await send_to(ws, {"type": "config", "reply_id": reply_id, "data": cfg})
    elif t == "get_models":
        await send_to(ws, {"type": "models", "reply_id": reply_id,
                           "data": current_models()})
    elif t == "get_resources":
        await send_to(ws, {"type": "resources", "reply_id": reply_id,
                           "data": resources_snapshot()})
    elif t == "get_vault_graph":
        graph = build_graph(brain.vault, brain.vault_touches)
        await send_to(ws, {"type": "vault_graph", "reply_id": reply_id, "data": graph})
    elif t == "get_commands":
        await send_to(ws, {"type": "commands", "reply_id": reply_id,
                           "data": brain.commands_history})
    elif t == "get_files_history":
        await send_to(ws, {"type": "files_history", "reply_id": reply_id,
                           "data": brain.files_history})
    elif t == "get_transparency":
        await send_to(ws, {"type": "transparency", "reply_id": reply_id,
                           "data": brain.transparency()})
    elif t == "get_providers":
        installed = list_ollama_models(brain.ollama_host)
        await send_to(ws, {"type": "providers", "reply_id": reply_id, "data": {
            "current": brain.provider,
            "claude": {"cmd": str(brain.cmd)},
            "ollama": {
                "host": brain.ollama_host,
                "up": is_ollama_up(brain.ollama_host),
                "installed_models": installed,
                "selected_model": brain.ollama_model,
                "recommended": "qwen2.5-coder:7b",
            },
            "gemini": {
                "configured": bool(brain.gemini_api_key),
                "reachable": is_gemini_reachable(brain.gemini_api_key),
                "available_models": GEMINI_MODELS,
                "selected_model": brain.gemini_model,
            },
        }})
    elif t == "set_provider":
        provider = (msg.get("provider") or "").strip()
        model = (msg.get("model") or "").strip()
        if provider in ("claude", "ollama", "gemini"):
            brain.provider = provider
            if model and provider == "ollama":
                brain.ollama_model = model
            if model and provider == "gemini":
                brain.gemini_model = model
            logger.log("provider_change", provider=provider, model=model)
            # Persistir en config
            patch = {"brain.provider": provider}
            if model and provider == "ollama":
                patch["brain.ollama.model"] = model
            if model and provider == "gemini":
                patch["brain.gemini.model"] = model
            new_cfg = apply_patch(load_config(), patch)
            CONFIG_PATH.write_text(json.dumps(new_cfg, indent=2, ensure_ascii=False),
                                   encoding="utf-8")
            await broadcast({"type": "models", "data": current_models()})
        await send_to(ws, {"type": "provider_changed", "reply_id": reply_id,
                           "provider": brain.provider,
                           "ollama_model": brain.ollama_model,
                           "gemini_model": brain.gemini_model})
    elif t == "test_tts":
        text = (msg.get("text") or "Hola, soy Jarvis. Esta es una prueba de voz.")[:400]
        loop = asyncio.get_event_loop()
        if listener:
            listener.pause()
        try:
            await loop.run_in_executor(None, speaker.say, text)
        finally:
            if listener:
                listener.resume()
        await send_to(ws, {"type": "tts_tested", "reply_id": reply_id})
    elif t == "benchmark_whisper":
        models = msg.get("models") or ["tiny", "base", "small"]
        device = msg.get("device") or "auto"
        loop = asyncio.get_event_loop()
        results = await loop.run_in_executor(None, _benchmark_whisper, models, device)
        await send_to(ws, {"type": "benchmark_result", "reply_id": reply_id,
                           "data": results})
    elif t == "export_history":
        fmt = (msg.get("format") or "json").lower()
        text, mime = logger.export(fmt)
        await send_to(ws, {"type": "history_export", "reply_id": reply_id,
                           "format": fmt, "mime": mime, "content": text})
    elif t == "set_config":
        patch = msg.get("patch") or {}
        new_cfg = apply_patch(load_config(), patch)
        CONFIG_PATH.write_text(json.dumps(new_cfg, indent=2, ensure_ascii=False),
                               encoding="utf-8")
        logger.log("config_change", patch=patch)
        _apply_live(patch)
        await send_to(ws, {"type": "config_saved", "reply_id": reply_id,
                           "note": "Algunos cambios requieren reiniciar el núcleo."})
    elif t == "get_sounds":
        await send_to(ws, {"type": "sounds", "reply_id": reply_id,
                           "data": sounds_snapshot()})
    elif t == "set_sound_config":
        changes = msg.get("changes") or {}
        if "enabled" in changes:
            _save_sounds_config(enabled=bool(changes["enabled"]))
        if "master_volume" in changes:
            _save_sounds_config(master_volume=float(changes["master_volume"]))
        if "slot_volume" in changes:
            sv = changes["slot_volume"]
            _save_sounds_config(slot_volume=(sv.get("slot"), sv.get("volume")))
        snap = sounds_snapshot()
        await broadcast({"type": "sounds_updated", "data": snap})
        await send_to(ws, {"type": "sound_config_saved", "reply_id": reply_id,
                           "data": snap})
    elif t == "upload_sound":
        slot = (msg.get("slot") or "").strip()
        ext = (msg.get("ext") or "").strip().lower()
        if not ext.startswith("."):
            ext = "." + ext
        data_b64 = msg.get("data") or ""
        result = _upload_sound(slot, ext, data_b64)
        if result.get("ok"):
            logger.log("sound_uploaded", slot=slot, file=result["file"])
            await broadcast({"type": "sounds_updated", "data": sounds_snapshot()})
        await send_to(ws, {"type": "sound_uploaded", "reply_id": reply_id,
                           "data": result})
    elif t == "restore_sound":
        slot = (msg.get("slot") or "").strip()
        result = _restore_sound(slot)
        if result.get("ok"):
            logger.log("sound_restored", slot=slot)
            await broadcast({"type": "sounds_updated", "data": sounds_snapshot()})
        await send_to(ws, {"type": "sound_restored", "reply_id": reply_id,
                           "data": result})
    elif t == "play_sound":
        slot = (msg.get("slot") or "").strip()
        if slot in SOUND_SLOTS:
            await broadcast({"type": "play_sound", "slot": slot})
        await send_to(ws, {"type": "sound_played", "reply_id": reply_id,
                           "slot": slot})
    elif t == "stop_sound":
        # Si viene con slot, para solo ese; sin slot, para todos.
        slot = (msg.get("slot") or "").strip()
        payload = {"type": "stop_sound"}
        if slot in SOUND_SLOTS:
            payload["slot"] = slot
        await broadcast(payload)
        await send_to(ws, {"type": "sound_stopped", "reply_id": reply_id,
                           "slot": slot or None})
    elif t == "clear_history":
        if LOG_PATH.exists():
            LOG_PATH.unlink()
        await send_to(ws, {"type": "history_cleared", "reply_id": reply_id})
    elif t == "restart_core":
        await send_to(ws, {"type": "restarting", "reply_id": reply_id})
        logger.log("restart_requested")
        asyncio.get_event_loop().call_later(0.5, lambda: sys.exit(0))


def _benchmark_whisper(models: list[str], device: str) -> list[dict]:
    """Carga cada modelo de Whisper y mide latencia de transcribir un audio
    sintético corto (1 segundo de silencio). Útil para comparar velocidad en
    esta PC."""
    results: list[dict] = []
    try:
        import numpy as np
        from faster_whisper import WhisperModel
    except ImportError as e:
        return [{"model": m, "error": f"faster-whisper no disponible: {e}"}
                for m in models]
    audio = np.zeros(16000, dtype="float32")  # 1 s de silencio a 16 kHz
    dev = None if device == "auto" else device
    for m in models:
        try:
            t0 = time.time()
            wm = WhisperModel(m, device=(dev or "auto"), compute_type="auto")
            load_s = round(time.time() - t0, 2)
            t1 = time.time()
            segments, _ = wm.transcribe(audio, language="es", vad_filter=False)
            list(segments)  # drena el generador
            inf_s = round(time.time() - t1, 2)
            results.append({"model": m, "load_s": load_s, "inference_s": inf_s,
                            "device": device})
        except Exception as e:  # noqa: BLE001
            results.append({"model": m, "error": str(e)[:200]})
    return results


def _apply_live(patch: dict) -> None:
    """Aplica cambios que no requieren reinicio (nivel de permisos, prompt
    personal, provider, modelo Ollama)."""
    for key, value in patch.items():
        if key == "brain.permission_level" and value in {
                "limitado", "equilibrado", "amplio", "dev"}:
            brain.level = value
        elif key == "brain.custom_persona":
            brain.custom_persona = (value or "").strip()
        elif key == "brain.provider" and value in {"claude", "ollama", "gemini"}:
            brain.provider = value
        elif key == "brain.ollama.model":
            brain.ollama_model = value
        elif key == "brain.gemini.model":
            brain.gemini_model = value
        elif key == "brain.gemini.api_key":
            brain.gemini_api_key = (value or "").strip()
        elif key == "ears.trigger_words" and listener:
            try:
                listener.update_trigger_words(value)
            except Exception:  # noqa: BLE001
                pass
        elif key.startswith("ears.") and listener and hasattr(listener, "update_setting"):
            try:
                listener.update_setting(key.split(".", 1)[1], value)
            except Exception:  # noqa: BLE001
                pass


def _slot_file(slot: str) -> Path | None:
    """Devuelve la ruta actual del archivo de un slot (buscando extensiones
    permitidas) o None si no existe."""
    for ext in (".mp3", ".wav", ".ogg", ".m4a"):
        p = AUDIO_DIR / f"{slot}{ext}"
        if p.exists():
            return p
    return None


def sounds_snapshot() -> dict:
    cfg_sounds = (load_config().get("ui", {}) or {}).get("sounds", {}) or {}
    slots_cfg = cfg_sounds.get("slots", {}) or {}
    slots_info = []
    for slot in SOUND_SLOTS:
        f = _slot_file(slot)
        orig = None
        for ext in (".mp3", ".wav", ".ogg", ".m4a"):
            p = AUDIO_ORIGINALS / f"{slot}{ext}"
            if p.exists():
                orig = p
                break
        vol = float(((slots_cfg.get(slot) or {}).get("volume") or 1.0))
        slots_info.append({
            "slot": slot,
            "file": f.name if f else None,
            "ext": f.suffix if f else None,
            "size": f.stat().st_size if f else 0,
            "volume": vol,
            "has_original": orig is not None,
        })
    return {
        "enabled": bool(cfg_sounds.get("enabled", True)),
        "master_volume": float(cfg_sounds.get("master_volume", 0.6)),
        "slots": slots_info,
    }


def _save_sounds_config(enabled: bool | None = None,
                        master_volume: float | None = None,
                        slot_volume: tuple[str, float] | None = None) -> dict:
    cfg = load_config()
    ui = cfg.setdefault("ui", {})
    s = ui.setdefault("sounds", {"enabled": True, "master_volume": 0.6, "slots": {}})
    if enabled is not None:
        s["enabled"] = bool(enabled)
    if master_volume is not None:
        s["master_volume"] = max(0.0, min(1.0, float(master_volume)))
    if slot_volume is not None:
        slot, vol = slot_volume
        if slot in SOUND_SLOTS:
            s.setdefault("slots", {}).setdefault(slot, {})["volume"] = \
                max(0.0, min(1.0, float(vol)))
    CONFIG_PATH.write_text(json.dumps(cfg, indent=2, ensure_ascii=False),
                           encoding="utf-8")
    return s


def _upload_sound(slot: str, ext: str, data_b64: str) -> dict:
    """Guarda un archivo de audio nuevo en el slot indicado.
    Hace backup del actual en _backup/ antes de sobreescribir."""
    if slot not in SOUND_SLOTS:
        return {"ok": False, "error": "slot inválido"}
    if ext.lower() not in ALLOWED_AUDIO_EXT:
        return {"ok": False, "error": f"extensión no permitida ({ext})"}
    try:
        raw = base64.b64decode(data_b64)
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": f"base64 inválido: {e}"}
    if len(raw) > MAX_AUDIO_BYTES:
        return {"ok": False, "error": f"archivo demasiado grande ({len(raw)} bytes)"}
    AUDIO_DIR.mkdir(parents=True, exist_ok=True)
    # Limpia otras extensiones del mismo slot (solo puede haber una)
    for e in ALLOWED_AUDIO_EXT:
        old = AUDIO_DIR / f"{slot}{e}"
        if old.exists():
            backup_dir = AUDIO_DIR / "_backup"
            backup_dir.mkdir(exist_ok=True)
            shutil.copy2(old, backup_dir / old.name)
            old.unlink()
    dest = AUDIO_DIR / f"{slot}{ext.lower()}"
    dest.write_bytes(raw)
    return {"ok": True, "file": dest.name, "size": dest.stat().st_size}


def _restore_sound(slot: str) -> dict:
    if slot not in SOUND_SLOTS:
        return {"ok": False, "error": "slot inválido"}
    orig = None
    for ext in ALLOWED_AUDIO_EXT:
        p = AUDIO_ORIGINALS / f"{slot}{ext}"
        if p.exists():
            orig = p
            break
    if not orig:
        return {"ok": False, "error": "no hay original guardado"}
    # Limpia el actual
    for ext in ALLOWED_AUDIO_EXT:
        cur = AUDIO_DIR / f"{slot}{ext}"
        if cur.exists():
            cur.unlink()
    dest = AUDIO_DIR / orig.name
    shutil.copy2(orig, dest)
    return {"ok": True, "file": dest.name, "size": dest.stat().st_size}


def apply_patch(cfg: dict, patch: dict) -> dict:
    """Aplica un diccionario de cambios 'a.b.c' = valor sobre cfg."""
    for dotted_key, value in patch.items():
        parts = dotted_key.split(".")
        node = cfg
        for p in parts[:-1]:
            node = node.setdefault(p, {})
        node[parts[-1]] = value
    return cfg


# ---- Conexión del widget / dashboard ----
DASHBOARD_TYPES = {
    "get_diagnostics", "get_history", "get_config", "set_config",
    "get_models", "get_resources", "get_vault_graph", "get_commands",
    "get_files_history", "get_transparency", "get_providers",
    "set_provider", "test_tts", "benchmark_whisper", "export_history",
    "get_sounds", "set_sound_config", "upload_sound", "restore_sound",
    "play_sound", "stop_sound",
    "clear_history", "restart_core",
}


async def handler(ws) -> None:
    connected.add(ws)
    await send_to(ws, {"type": "state", "value": resting_state()})
    await send_to(ws, {"type": "models", "data": current_models()})
    await send_to(ws, {"type": "sounds_updated", "data": sounds_snapshot()})
    await send_to(ws, {"type": "system", "text": "Conectado al núcleo de Jarvis."})
    try:
        async for raw in ws:
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue
            t = msg.get("type")
            if t == "user_message":
                text = (msg.get("text") or "").strip()
                if text:
                    await handle_user_message(text, source="text")
            elif t == "toggle_ears":
                if listener and listener._running:
                    listener.set_muted(not listener.muted)
                await broadcast({"type": "state", "value": resting_state()})
            elif t == "set_background":
                # Relay simple: una ventana escoge animación, todas las demás
                # la aplican. No persiste en config.json (es solo visual).
                value = (msg.get("value") or "neural").strip()
                await broadcast({"type": "background_updated", "value": value})
            elif t == "set_ion_params":
                params = msg.get("params") or {}
                await broadcast({"type": "ion_params_updated", "params": params})
            elif t == "set_part_params":
                params = msg.get("params") or {}
                await broadcast({"type": "part_params_updated", "params": params})
            elif t == "set_quantum_params":
                params = msg.get("params") or {}
                await broadcast({"type": "quantum_params_updated", "params": params})
            elif t == "set_colors":
                await broadcast({
                    "type": "colors_updated",
                    "scene": msg.get("scene"),
                    "a": msg.get("a"), "b": msg.get("b"),
                })
            elif t == "reset_colors":
                await broadcast({"type": "colors_reset", "scene": msg.get("scene")})
            elif t in DASHBOARD_TYPES:
                await handle_dashboard(ws, msg)
    finally:
        connected.discard(ws)


async def main() -> None:
    global listener, main_loop
    main_loop = asyncio.get_running_loop()

    host = config["server"]["host"]
    port = int(config["server"]["port"])
    print(f"[Jarvis] Núcleo escuchando en ws://{host}:{port}")
    print(f"[Jarvis] Cerebro: {brain.provider} / {brain.cmd}  (nivel: {brain.level})")
    logger.log("startup", host=host, port=port, level=brain.level,
               provider=brain.provider)

    if config.get("ears", {}).get("enabled", False):
        print("[Jarvis] Cargando oído (puede tardar unos segundos)...")
        listener = Listener(config, on_state=on_ear_state,
                            on_transcript=on_ear_transcript, on_wake=on_ear_wake)
        listener.start()

    print('[Jarvis] Listo. Di "Oye Jarvis" o escribe en el widget.')
    async with websockets.serve(handler, host, port):
        await asyncio.Future()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n[Jarvis] Núcleo detenido.")
