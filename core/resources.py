"""
Monitor de recursos del proceso Jarvis en tiempo real.

Reporta uso de CPU y RAM del núcleo + hijos (claude CLI, piper, etc.).
"""
from __future__ import annotations

import os
import time

try:
    import psutil
    HAVE_PSUTIL = True
except Exception:  # noqa: BLE001
    HAVE_PSUTIL = False

_PROC = None
_last_cpu_sample = 0.0


def _proc():
    global _PROC
    if _PROC is None and HAVE_PSUTIL:
        _PROC = psutil.Process(os.getpid())
    return _PROC


def snapshot() -> dict:
    """Instantánea actual de recursos. Barata — segura para polling cada 1s."""
    global _last_cpu_sample
    if not HAVE_PSUTIL:
        return {"available": False}

    p = _proc()
    if p is None:
        return {"available": False}

    try:
        with p.oneshot():
            rss = p.memory_info().rss
            cpu_self = p.cpu_percent(interval=None)
            # Suma de hijos
            total_rss = rss
            cpu_children = 0.0
            child_count = 0
            try:
                for ch in p.children(recursive=True):
                    try:
                        total_rss += ch.memory_info().rss
                        cpu_children += ch.cpu_percent(interval=None)
                        child_count += 1
                    except (psutil.NoSuchProcess, psutil.AccessDenied):
                        continue
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                pass

        vm = psutil.virtual_memory()
        cpu_count = psutil.cpu_count(logical=True) or 1
        total_cpu = (cpu_self + cpu_children) / cpu_count

        _last_cpu_sample = time.time()
        return {
            "available": True,
            "cpu_percent": round(total_cpu, 1),
            "ram_mb": round(total_rss / 1024 / 1024, 1),
            "ram_percent": round(total_rss / vm.total * 100, 1),
            "system_cpu_percent": round(psutil.cpu_percent(interval=None), 1),
            "system_ram_percent": round(vm.percent, 1),
            "children": child_count,
            "ts": time.time(),
        }
    except Exception as e:  # noqa: BLE001
        return {"available": False, "error": str(e)}
