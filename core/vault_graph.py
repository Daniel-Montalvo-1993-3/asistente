"""
Grafo del vault de Obsidian.

Lee todos los .md del vault, extrae los enlaces [[nota]] y devuelve
estructura {nodes, edges} lista para pintar como grafo con D3.

Nodo central ficticio "jarvis" conectado a las notas tocadas recientemente,
y marca a los nodos con el timestamp de su último "touch" para que el
frontend los anime (pulse).
"""
from __future__ import annotations

import re
import time
from pathlib import Path

LINK_RE = re.compile(r"\[\[([^\]|#]+?)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]")


def _folder_of(path: Path, vault: Path) -> str:
    try:
        rel = path.relative_to(vault)
    except ValueError:
        return "otros"
    parts = rel.parts
    return parts[0] if len(parts) > 1 else "raíz"


def build_graph(vault: Path, recent_touches: dict[str, float] | None = None) -> dict:
    """Devuelve {nodes:[{id, label, folder, size, last_touch}], edges:[{source,target}]}"""
    recent_touches = recent_touches or {}
    if not vault.exists():
        return {"nodes": [], "edges": [], "folders": []}

    files: list[Path] = [p for p in vault.rglob("*.md") if p.is_file()]
    name_to_id: dict[str, str] = {}
    nodes: list[dict] = []
    folders: set[str] = set()

    for p in files:
        node_id = p.stem.lower()
        if node_id in name_to_id:
            continue
        folder = _folder_of(p, vault)
        folders.add(folder)
        name_to_id[node_id] = node_id
        try:
            size = p.stat().st_size
        except OSError:
            size = 0
        key = str(p.resolve())
        last_touch = recent_touches.get(key, 0)
        nodes.append({
            "id": node_id,
            "label": p.stem,
            "folder": folder,
            "size": size,
            "last_touch": last_touch,
            "path": str(p),
        })

    edges: list[dict] = []
    seen_edges: set[tuple[str, str]] = set()
    for p in files:
        src_id = p.stem.lower()
        try:
            text = p.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        for m in LINK_RE.finditer(text):
            target_label = m.group(1).strip()
            target_id = target_label.lower()
            if target_id not in name_to_id or target_id == src_id:
                continue
            key = (src_id, target_id)
            if key in seen_edges:
                continue
            seen_edges.add(key)
            edges.append({"source": src_id, "target": target_id})

    # Nodo central "Jarvis" conectado a las notas más recientes
    now = time.time()
    recent_sorted = sorted(
        [(k, v) for k, v in recent_touches.items() if v > 0],
        key=lambda kv: kv[1], reverse=True
    )[:8]
    if recent_sorted:
        nodes.append({
            "id": "__jarvis__",
            "label": "Jarvis",
            "folder": "__core__",
            "size": 2000,
            "last_touch": now,
            "path": "",
        })
        for path_key, _ in recent_sorted:
            stem = Path(path_key).stem.lower()
            if stem in name_to_id:
                edges.append({"source": "__jarvis__", "target": stem})

    return {
        "nodes": nodes,
        "edges": edges,
        "folders": sorted(folders),
    }
