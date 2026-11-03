"""
Capa de sistema (multiplataforma).

Aísla todo lo que es distinto entre Windows y Mac para que el resto
del código funcione igual en ambos equipos (PC de casa y Mac Mini M1).
"""
from __future__ import annotations

import os
import platform
import shutil
import subprocess
import tempfile
from pathlib import Path

SYSTEM = platform.system()          # 'Windows', 'Darwin' (Mac), 'Linux'
IS_WINDOWS = SYSTEM == "Windows"
IS_MAC = SYSTEM == "Darwin"
IS_LINUX = SYSTEM == "Linux"


def resolve_claude_cmd(configured: str = "claude") -> str:
    """Encuentra el ejecutable de Claude Code en cualquier sistema."""
    # 1) Ruta explícita ya válida
    if configured and (os.sep in configured) and Path(configured).exists():
        return configured

    # 2) Windows: el .exe real dentro del paquete global de npm
    if IS_WINDOWS:
        appdata = os.environ.get("APPDATA")
        if appdata:
            exe = (Path(appdata) / "npm" / "node_modules" / "@anthropic-ai"
                   / "claude-code" / "bin" / "claude.exe")
            if exe.exists():
                return str(exe)
            shim = Path(appdata) / "npm" / "claude.cmd"
            if shim.exists():
                return str(shim)

    # 3) En el PATH
    found = shutil.which(configured or "claude")
    if found:
        return found

    # 4) Rutas típicas en Mac / Linux
    for p in (
        Path("/opt/homebrew/bin/claude"),
        Path("/usr/local/bin/claude"),
        Path.home() / ".npm-global" / "bin" / "claude",
    ):
        if p.exists():
            return str(p)

    # 5) Último recurso: el nombre tal cual (que lo resuelva el shell)
    return configured or "claude"


def speak(text: str, voice: str | None = None) -> None:
    """
    Dice un texto en voz alta usando la voz nativa del sistema operativo.
    Es bloqueante (termina cuando acaba de hablar).

    El texto se pasa por archivo temporal para evitar problemas de comillas.
    """
    text = (text or "").strip()
    if not text:
        return

    tmp = Path(tempfile.gettempdir()) / "jarvis_tts.txt"
    tmp.write_text(text, encoding="utf-8")

    if IS_WINDOWS:
        ps = (
            "Add-Type -AssemblyName System.Speech;"
            "$s=New-Object System.Speech.Synthesis.SpeechSynthesizer;"
            "$v=$s.GetInstalledVoices()|"
            "Where-Object{$_.VoiceInfo.Culture.Name -like 'es*'}|"
            "Select-Object -First 1;"
            "if($v){$s.SelectVoice($v.VoiceInfo.Name)};"
            f"$t=Get-Content -Raw -Encoding UTF8 '{tmp}';"
            "$s.Speak($t);"
        )
        subprocess.run(
            ["powershell", "-NoProfile", "-Command", ps],
            capture_output=True,
        )
    elif IS_MAC:
        args = ["say"]
        if voice:
            args += ["-v", voice]
        args += ["-f", str(tmp)]
        subprocess.run(args, capture_output=True)
    else:  # Linux (respaldo)
        if shutil.which("espeak-ng"):
            subprocess.run(["espeak-ng", "-f", str(tmp)], capture_output=True)


def play_wav(path: str) -> None:
    """Reproduce un archivo WAV. Bloqueante. Multiplataforma."""
    path = str(path)
    if IS_WINDOWS:
        import winsound
        winsound.PlaySound(path, winsound.SND_FILENAME)
    elif IS_MAC:
        subprocess.run(["afplay", path])
    else:
        for player in ("aplay", "paplay", "ffplay"):
            if shutil.which(player):
                subprocess.run([player, path])
                break


def open_target(target: str) -> None:
    """Abre una app, archivo o URL. (Se usará en fases posteriores.)"""
    if IS_WINDOWS:
        os.startfile(target)          # type: ignore[attr-defined]
    elif IS_MAC:
        subprocess.run(["open", target])
    else:
        subprocess.run(["xdg-open", target])
