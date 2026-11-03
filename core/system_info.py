"""
Diagnóstico de hardware del equipo y recomendaciones de configuración.

Lo usa el dashboard para mostrar:
  - Qué tienes (CPU, RAM, GPU/VRAM, CUDA, disco, SO)
  - Si cumple requisitos de cada componente
  - Qué config te recomendamos para TU PC
"""
from __future__ import annotations

import platform
import shutil
import subprocess
from typing import Any

try:
    import psutil
    HAVE_PSUTIL = True
except Exception:  # noqa: BLE001
    HAVE_PSUTIL = False


def _detect_nvidia() -> dict:
    """Si hay nvidia-smi en el PATH, devuelve datos de la GPU; si no, {}."""
    exe = shutil.which("nvidia-smi")
    if not exe:
        return {}
    try:
        out = subprocess.run(
            [exe, "--query-gpu=name,memory.total,driver_version",
             "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=5,
        )
        if out.returncode != 0 or not out.stdout.strip():
            return {}
        parts = [p.strip() for p in out.stdout.splitlines()[0].split(",")]
        return {
            "name": parts[0] if parts else "",
            "vram_mb": int(parts[1]) if len(parts) > 1 and parts[1].isdigit() else 0,
            "driver": parts[2] if len(parts) > 2 else "",
        }
    except Exception:  # noqa: BLE001
        return {}


def _detect_cuda_runtime() -> dict:
    """Comprueba si el runtime CUDA que usaría Whisper está disponible."""
    try:
        import ctranslate2
        count = ctranslate2.get_cuda_device_count()
        has_cublas = bool(shutil.which("cublas64_12.dll") or shutil.which("cublas64_12"))
        return {
            "visible_devices": count,
            "cublas_dll_in_path": has_cublas,
            "ready": count > 0 and has_cublas,
        }
    except Exception:  # noqa: BLE001
        return {"visible_devices": 0, "cublas_dll_in_path": False, "ready": False}


def hardware_report() -> dict[str, Any]:
    """Instantánea del hardware/SO del equipo."""
    report: dict[str, Any] = {
        "os": {
            "system": platform.system(),
            "release": platform.release(),
            "version": platform.version(),
            "machine": platform.machine(),
        },
        "cpu": {
            "brand": platform.processor(),
            "cores_physical": None,
            "cores_logical": None,
        },
        "memory": {"total_gb": None, "available_gb": None},
        "disk": {"free_gb": None, "total_gb": None},
        "gpu": {},
        "cuda": _detect_cuda_runtime(),
    }

    if HAVE_PSUTIL:
        try:
            report["cpu"]["cores_physical"] = psutil.cpu_count(logical=False)
            report["cpu"]["cores_logical"] = psutil.cpu_count(logical=True)
            vm = psutil.virtual_memory()
            report["memory"]["total_gb"] = round(vm.total / 1024 ** 3, 1)
            report["memory"]["available_gb"] = round(vm.available / 1024 ** 3, 1)
            du = psutil.disk_usage("/")
            report["disk"]["total_gb"] = round(du.total / 1024 ** 3, 1)
            report["disk"]["free_gb"] = round(du.free / 1024 ** 3, 1)
        except Exception:  # noqa: BLE001
            pass

    gpu = _detect_nvidia()
    if gpu:
        report["gpu"] = {
            "vendor": "nvidia",
            "name": gpu["name"],
            "vram_gb": round(gpu["vram_mb"] / 1024, 1) if gpu["vram_mb"] else None,
            "driver": gpu["driver"],
        }

    return report


# ---------- requisitos y recomendaciones ----------

WHISPER_TIERS = {
    # modelo -> (ram_min_gb, vram_min_gb_gpu, precisión relativa, velocidad relativa)
    "tiny":   dict(ram_gb=1,  vram_gb=1, quality="baja",    speed="muy rápida"),
    "base":   dict(ram_gb=1,  vram_gb=1, quality="media",   speed="rápida"),
    "small":  dict(ram_gb=2,  vram_gb=2, quality="buena",   speed="media"),
    "medium": dict(ram_gb=5,  vram_gb=5, quality="muy buena", speed="lenta en CPU"),
    "large-v3": dict(ram_gb=10, vram_gb=10, quality="excelente", speed="muy lenta en CPU"),
}


def recommendations(hw: dict) -> dict[str, Any]:
    """Dada la foto del hardware, devuelve recomendaciones concretas."""
    ram_gb = hw.get("memory", {}).get("total_gb") or 0
    gpu = hw.get("gpu") or {}
    vram_gb = gpu.get("vram_gb") or 0
    cuda_ready = hw.get("cuda", {}).get("ready", False)

    # Whisper
    whisper_models = []
    for name, req in WHISPER_TIERS.items():
        fits_cpu = ram_gb >= req["ram_gb"]
        fits_gpu = cuda_ready and vram_gb >= req["vram_gb"]
        whisper_models.append({
            "name": name,
            "fits_cpu": fits_cpu,
            "fits_gpu": fits_gpu,
            "quality": req["quality"],
            "speed": req["speed"],
        })

    # Recomendación de modelo "equilibrado": el más grande que corra cómodo en CPU
    # (y que mejore si hay GPU).
    if cuda_ready and vram_gb >= 10:
        rec_whisper = "medium"
    elif cuda_ready and vram_gb >= 5:
        rec_whisper = "medium"
    elif ram_gb >= 10:
        rec_whisper = "small"
    elif ram_gb >= 4:
        rec_whisper = "base"
    else:
        rec_whisper = "tiny"

    rec_whisper_device = "cuda" if cuda_ready else "cpu"

    # Avisos
    advice: list[dict] = []
    if gpu.get("vendor") == "nvidia" and not cuda_ready:
        advice.append({
            "level": "info",
            "title": "Tu GPU podría acelerar Whisper, pero falta configurarla",
            "detail": "Detecté una NVIDIA, pero el runtime CUDA no está listo "
                      "(no se encuentra cublas64_12.dll). Si la activas, Whisper "
                      "irá mucho más rápido con el mismo modelo. "
                      "Instala: `pip install nvidia-cublas-cu12 nvidia-cudnn-cu12`.",
        })
    if ram_gb and ram_gb < 8:
        advice.append({
            "level": "warn",
            "title": "RAM baja para el modo cómodo",
            "detail": "Con menos de 8 GB se recomienda Whisper 'base' o 'tiny' "
                      "para que no se trabe mientras usas otras apps.",
        })

    return {
        "whisper": {
            "models": whisper_models,
            "recommended_model": rec_whisper,
            "recommended_device": rec_whisper_device,
        },
        "advice": advice,
    }


def diagnostics() -> dict[str, Any]:
    """Todo junto: hardware + recomendaciones."""
    hw = hardware_report()
    return {"hardware": hw, "recommendations": recommendations(hw)}
