"""
Bitácora de Jarvis.

Guarda eventos en `logs/jarvis.jsonl` (una línea por evento, JSON).
Soporta export a CSV / JSON para que el dashboard descargue el historial.
"""
from __future__ import annotations

import csv
import io
import json
import threading
from datetime import datetime, timezone
from pathlib import Path


class Logger:
    def __init__(self, path: Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()

    def log(self, event_type: str, **fields):
        event = {
            "ts": datetime.now(timezone.utc).isoformat(timespec="milliseconds"),
            "type": event_type,
            **fields,
        }
        line = json.dumps(event, ensure_ascii=False)
        with self._lock:
            with self.path.open("a", encoding="utf-8") as f:
                f.write(line + "\n")

    def tail(self, limit: int = 100, types: list[str] | None = None) -> list[dict]:
        """Últimos `limit` eventos (opcionalmente filtrados por tipo)."""
        if not self.path.exists():
            return []
        with self._lock, self.path.open("r", encoding="utf-8") as f:
            lines = f.readlines()
        events: list[dict] = []
        for line in reversed(lines):
            line = line.strip()
            if not line:
                continue
            try:
                ev = json.loads(line)
            except json.JSONDecodeError:
                continue
            if types and ev.get("type") not in types:
                continue
            events.append(ev)
            if len(events) >= limit:
                break
        return list(reversed(events))

    def all_turns(self) -> list[dict]:
        """Todos los turnos (sin límite). Para export."""
        if not self.path.exists():
            return []
        with self._lock, self.path.open("r", encoding="utf-8") as f:
            lines = f.readlines()
        out = []
        for line in lines:
            line = line.strip()
            if not line:
                continue
            try:
                ev = json.loads(line)
            except json.JSONDecodeError:
                continue
            if ev.get("type") == "turn":
                out.append(ev)
        return out

    def export(self, fmt: str = "json") -> tuple[str, str]:
        """Devuelve (texto, mime_type_sugerido). fmt: 'json' | 'csv'."""
        turns = self.all_turns()
        if fmt == "csv":
            buf = io.StringIO()
            writer = csv.writer(buf)
            writer.writerow(["ts", "source", "user", "reply",
                             "latency_brain_s", "latency_voice_s", "level"])
            for t in turns:
                lat = t.get("latency") or {}
                writer.writerow([
                    t.get("ts", ""),
                    t.get("source", ""),
                    t.get("user", ""),
                    t.get("reply", ""),
                    lat.get("brain", ""),
                    lat.get("voice", ""),
                    t.get("level", ""),
                ])
            return buf.getvalue(), "text/csv"
        return json.dumps(turns, ensure_ascii=False, indent=2), "application/json"
