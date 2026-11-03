"""
Voz de Jarvis (texto a voz).

- backend "piper"  -> voz de alta calidad en español latino (es_MX). Recomendado.
- backend "system" -> voz nativa del SO (respaldo si Piper falla).

El modelo de Piper se carga UNA sola vez al iniciar (no en cada frase).
"""
from __future__ import annotations

import tempfile
import wave
from pathlib import Path

from platform_layer import IS_MAC, play_wav, speak as system_speak

ROOT = Path(__file__).resolve().parent.parent


class Speaker:
    def __init__(self, config: dict):
        cfg = config.get("tts", {})
        self.backend = cfg.get("backend", "system")
        self.mac_voice = cfg.get("system_voice_mac")
        self.voice = None  # modelo de Piper cargado

        if self.backend == "piper":
            self._load_piper(cfg)

    def _load_piper(self, cfg: dict) -> None:
        try:
            from piper import PiperVoice
            voice_name = cfg.get("piper_voice", "es_MX-claude-high")
            voices_dir = ROOT / cfg.get("piper_dir", "voices")
            model = voices_dir / f"{voice_name}.onnx"
            if not model.exists():
                raise FileNotFoundError(f"No existe el modelo {model}")
            self.voice = PiperVoice.load(str(model))
            print(f"[Jarvis] Voz Piper cargada: {voice_name}")
        except Exception as e:  # noqa: BLE001
            print(f"[Jarvis] No pude cargar Piper ({e}). Uso voz del sistema.")
            self.voice = None
            self.backend = "system"

    def say(self, text: str) -> None:
        text = (text or "").strip()
        if not text:
            return

        if self.backend == "piper" and self.voice is not None:
            try:
                tmp = Path(tempfile.gettempdir()) / "jarvis_piper.wav"
                with wave.open(str(tmp), "wb") as wav_file:
                    self.voice.synthesize_wav(text, wav_file)
                play_wav(tmp)
                return
            except Exception as e:  # noqa: BLE001
                print(f"[Jarvis] Error en Piper ({e}). Uso voz del sistema.")

        voice = self.mac_voice if IS_MAC else None
        system_speak(text, voice=voice)
