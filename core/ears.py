"""
Oído de Jarvis (Fase 2) — modo "whisper".

Flujo: VAD por energía -> graba hasta el silencio -> Whisper (local) -> si el
texto contiene la palabra de activación ("jarvis/yervis/hierbiz…"), actúa con lo
que dijiste después.

Captura:
- WASAPI en modo EXCLUSIVO (int32, 24-bit): audio crudo, ignora las "mejoras de
  audio" de Windows (Voice Clarity, etc.). Así puedes dejarlas activadas para
  otras apps.  IMPORTANTE: el modo exclusivo SOLO abre desde el hilo principal,
  por eso usamos callback (se abre en el hilo principal y PortAudio entrega el
  audio por su cuenta a una cola; el procesamiento pesado va en un hilo aparte).
- Si el exclusivo no está disponible, cae a modo compartido.
"""
from __future__ import annotations

import queue
import re
import threading
import time
from math import gcd
from typing import Callable, Optional

import numpy as np
import sounddevice as sd
from scipy.signal import resample_poly

TARGET_SR = 16000
FRAME = 1280

# Regex endurecido: solo acepta la palabra "jarvis" (y sus variantes razonables
# que escribe Whisper) como PALABRA COMPLETA. Esto evita falsos positivos con
# "hervir", "hierbas", "yerbas", "jerez"... La "oye/hey" delante es opcional.
TRIGGER_RE = re.compile(
    r"\b(?:oy[eé]|hey)?\s*[jyhg][aáeéií]?r[bv]i[sz]\b",
    re.IGNORECASE,
)

# Tiempo máximo que el oído sigue "armado" tras un wake word solo
# ("Oye Jarvis" → "¿Sí?"). Si no hablas en este margen, vuelve a exigir el
# trigger en lugar de enviar al cerebro cualquier frase que oiga.
ARMED_TIMEOUT_SECONDS = 6.0


class Listener:
    def __init__(
        self,
        config: dict,
        on_state: Optional[Callable[[str], None]] = None,
        on_transcript: Optional[Callable[[str], None]] = None,
        on_wake: Optional[Callable[[], None]] = None,
    ):
        cfg = config.get("ears", {})
        self.enabled = bool(cfg.get("enabled", True))
        self.extra_triggers = [w.lower() for w in cfg.get("trigger_words", [])]
        self.language = cfg.get("whisper_language", "es")
        self.speech_rms = float(cfg.get("speech_rms", 900))
        self.silence_rms = float(cfg.get("silence_rms", 500))
        self.silence_seconds = float(cfg.get("silence_seconds", 0.9))
        self.min_speech_seconds = float(cfg.get("min_speech_seconds", 0.3))
        self.max_record = float(cfg.get("max_record_seconds", 15))
        self.mic_device = cfg.get("mic_device")
        self.exclusive = bool(cfg.get("wasapi_exclusive", True))
        self.whisper_model_name = cfg.get("whisper_model", "small")
        self.whisper_device = cfg.get("whisper_device", "auto")
        # Modo estricto: cada frase requiere el wake word, no hay "armado".
        self.strict_wake = bool(cfg.get("strict_wake", False))
        self.armed_timeout = float(cfg.get("armed_timeout", ARMED_TIMEOUT_SECONDS))

        self.on_state = on_state or (lambda s: None)
        self.on_transcript = on_transcript or (lambda t: None)
        self.on_wake = on_wake or (lambda: None)

        self._running = False
        self._paused = False       # pausa temporal (mientras Jarvis habla)
        self._muted = False        # apagado por el usuario (botón del widget)
        self._armed = False
        self._armed_until = 0.0    # timestamp hasta cuando sigue armado
        self.whisper = None
        self.active_device = "cpu"
        self.stream = None
        self._q: queue.Queue = queue.Queue(maxsize=400)
        self._thread: Optional[threading.Thread] = None

        # Parámetros del stream abierto (los fija _try_open).
        self._capture_sr = TARGET_SR
        self._scale = 1.0
        self._up = 1
        self._down = 1
        self._block_secs = 0.08

    # ---------- modelo ----------
    def _load_whisper(self):
        from faster_whisper import WhisperModel
        pref = self.whisper_device
        attempts = ([("cpu", "int8")] if pref == "cpu"
                    else [("cuda", "float16"), ("cpu", "int8")])
        last = None
        for dev, comp in attempts:
            try:
                model = WhisperModel(self.whisper_model_name, device=dev, compute_type=comp)
                list(model.transcribe(np.zeros(TARGET_SR, dtype=np.float32),
                                      language=self.language)[0])
                self.active_device = dev
                return model
            except Exception as e:  # noqa: BLE001
                last = e
                print(f"[Jarvis] Whisper en '{dev}' no disponible ({str(e)[:70]}).")
        raise last

    # ---------- micrófono ----------
    def _candidate_mics(self) -> list[int]:
        if isinstance(self.mic_device, int):
            return [self.mic_device]
        devices = sd.query_devices()
        hostapis = sd.query_hostapis()

        def api_of(d):
            return hostapis[d["hostapi"]]["name"].lower()

        name = str(self.mic_device).lower() if self.mic_device else ""
        matches = [(i, d) for i, d in enumerate(devices)
                   if d["max_input_channels"] > 0 and (not name or name in d["name"].lower())]
        if not matches:
            matches = [(i, d) for i, d in enumerate(devices) if d["max_input_channels"] > 0]
        matches = [m for m in matches
                   if "wdm-ks" not in api_of(m[1]) and "kernel streaming" not in api_of(m[1])]
        prefs = ["wasapi", "mme", "directsound"]

        def rank(item):
            api = api_of(item[1])
            for r, pref in enumerate(prefs):
                if pref in api:
                    return r
            return len(prefs)

        matches.sort(key=rank)
        return [i for i, _ in matches]

    def _attempts_for(self, idx):
        dev = sd.query_devices(idx)
        hostapis = sd.query_hostapis()
        api = hostapis[dev["hostapi"]]["name"].lower()
        native = int(dev["default_samplerate"])
        out = []
        if "wasapi" in api and self.exclusive:
            out.append(dict(sr=native, dtype="int32",
                            extra=sd.WasapiSettings(exclusive=True),
                            scale=1.0 / 65536.0, label="WASAPI exclusivo int32"))
        out.append(dict(sr=TARGET_SR, dtype="int16", extra=None, scale=1.0,
                        label="compartido 16k"))
        out.append(dict(sr=native, dtype="int16", extra=None, scale=1.0,
                        label="compartido nativo"))
        return dev, out

    def _cb(self, indata, frames, time_info, status):
        """Callback de PortAudio (su propio hilo): solo encolar, rápido."""
        try:
            self._q.put_nowait(indata[:, 0].astype(np.float32) * self._scale)
        except queue.Full:
            pass

    def _try_open(self) -> bool:
        """Abre el micrófono EN EL HILO ACTUAL (debe ser el principal para exclusivo)."""
        for idx in self._candidate_mics():
            dev, attempts = self._attempts_for(idx)
            for att in attempts:
                try:
                    block_in = int(att["sr"] * 0.08)
                    self._scale = att["scale"]
                    stream = sd.InputStream(
                        samplerate=att["sr"], channels=1, dtype=att["dtype"],
                        blocksize=block_in, device=idx, extra_settings=att["extra"],
                        callback=self._cb)
                    stream.start()
                    self.stream = stream
                    self._capture_sr = att["sr"]
                    g = gcd(TARGET_SR, att["sr"])
                    self._up, self._down = TARGET_SR // g, att["sr"] // g
                    self._block_secs = block_in / att["sr"]
                    print(f"[Jarvis] Micrófono: {dev['name']} @ {att['sr']}Hz [{att['label']}]")
                    return True
                except Exception as e:  # noqa: BLE001
                    print(f"[Jarvis] {att['label']} no abrió: {str(e)[:70]}")
        return False

    # ---------- control (start se llama en el HILO PRINCIPAL) ----------
    def start(self) -> bool:
        if not self.enabled:
            print("[Jarvis] Oído desactivado en config.")
            return False
        self.whisper = self._load_whisper()
        print(f"[Jarvis] Oído: whisper={self.whisper_model_name}/{self.active_device}, "
              f"exclusivo={self.exclusive}")
        if not self._try_open():
            print("[Jarvis] No pude abrir el micrófono.")
            self.on_state("ear_error")
            return False
        self._running = True
        self.on_state("listening")
        self._thread = threading.Thread(target=self._process_loop, daemon=True)
        self._thread.start()
        return True

    def stop(self):
        self._running = False
        if self.stream is not None:
            try:
                self.stream.stop()
                self.stream.close()
            except Exception:  # noqa: BLE001
                pass

    def pause(self):
        self._paused = True

    def resume(self):
        self._paused = False

    def update_trigger_words(self, words):
        """Actualiza en caliente las palabras de activación."""
        if isinstance(words, list):
            self.extra_triggers = [str(w).lower().strip()
                                   for w in words if str(w).strip()]

    def update_setting(self, key: str, value):
        """Actualiza en caliente umbrales del micrófono y similares."""
        hot_keys = {"speech_rms", "silence_rms", "silence_seconds",
                    "min_speech_seconds", "max_record_seconds",
                    "armed_timeout"}
        if key in hot_keys:
            try:
                target = "max_record" if key == "max_record_seconds" else key
                setattr(self, target, float(value))
            except (TypeError, ValueError):
                pass
        elif key == "strict_wake":
            self.strict_wake = bool(value)
            if self.strict_wake:
                self._armed = False
                self._armed_until = 0.0

    def set_muted(self, muted: bool):
        """Apagar/prender el oído desde el widget. Devuelve el estado efectivo."""
        self._muted = bool(muted)

    @property
    def muted(self) -> bool:
        return self._muted

    def _inactive(self) -> bool:
        return self._paused or self._muted

    # ---------- procesamiento (hilo secundario) ----------
    def _process_loop(self):
        recording = False
        rec: list[np.ndarray] = []
        preroll: list[np.ndarray] = []
        speech_blocks = 0
        silence_blocks = 0
        silence_limit = int(self.silence_seconds / self._block_secs)
        max_blocks = int(self.max_record / self._block_secs)

        while self._running:
            try:
                block = self._q.get(timeout=0.5)
            except queue.Empty:
                continue

            if self._inactive():
                recording, rec, preroll = False, [], []
                with self._q.mutex:
                    self._q.queue.clear()
                continue

            rms = float(np.sqrt(np.mean(block ** 2)))

            if not recording:
                preroll.append(block)
                if len(preroll) > 3:
                    preroll.pop(0)
                if rms >= self.speech_rms:
                    recording = True
                    rec = list(preroll)
                    preroll = []
                    speech_blocks = 1
                    silence_blocks = 0
                    self.on_state("recording")
            else:
                rec.append(block)
                if rms >= self.silence_rms:
                    speech_blocks += 1
                    silence_blocks = 0
                else:
                    silence_blocks += 1
                if silence_blocks >= silence_limit or len(rec) >= max_blocks:
                    recording = False
                    self._finish_utterance(rec, speech_blocks * self._block_secs)
                    rec = []
                    # Descartar lo que entró mientras transcribíamos.
                    with self._q.mutex:
                        self._q.queue.clear()

    def _finish_utterance(self, rec, speech_secs):
        if speech_secs < self.min_speech_seconds:
            if not self._inactive():
                self.on_state("listening")
            return

        native = np.concatenate(rec)
        audio16 = (resample_poly(native, self._up, self._down)
                   if (self._up, self._down) != (1, 1) else native)
        audio = audio16.astype(np.float32) / 32768.0

        self.on_state("transcribing")
        text = self._transcribe(audio)
        print(f"[oído] dur={len(audio)/TARGET_SR:.1f}s escuché: {text!r}")

        if not text:
            if not self._inactive():
                self.on_state("listening")
            return

        # Si ya estaba armado por un "Oye Jarvis" previo, aceptamos esta frase
        # directa SOLO si el armado no caducó.
        if self._armed and not self.strict_wake:
            if time.time() <= self._armed_until:
                self._armed = False
                self._armed_until = 0.0
                self.on_transcript(text)
                return
            # Caducó: lo tratamos como una frase normal (exige wake word).
            self._armed = False
            self._armed_until = 0.0

        end = self._match_trigger(text)
        if end is not None:
            command = text[end:].strip(" ,.?!¿¡:;")
            if command:
                self.on_transcript(command)
            elif self.strict_wake:
                # Modo estricto: no armamos, exigimos "Oye Jarvis + frase" junto.
                self.on_wake()
                if not self._inactive():
                    self.on_state("listening")
            else:
                self._armed = True
                self._armed_until = time.time() + self.armed_timeout
                self.on_wake()
            return

        # No se detectó wake word: descartamos y seguimos escuchando.
        if not self._inactive():
            self.on_state("listening")

    def _match_trigger(self, text: str):
        low = text.lower()
        m = TRIGGER_RE.search(low)
        if m:
            return m.end()
        for trig in self.extra_triggers:
            i = low.find(trig)
            if i >= 0:
                return i + len(trig)
        return None

    def _transcribe(self, audio: np.ndarray) -> str:
        segments, _info = self.whisper.transcribe(
            audio, language=self.language, beam_size=1)
        return " ".join(s.text.strip() for s in segments).strip()
