"""
El cerebro de Jarvis.

Soporta dos proveedores (config.brain.provider):
  - "claude" (default): Claude Code headless (`claude -p`) con el plan Pro.
  - "ollama": modelo local vía Ollama (p. ej. qwen2.5-coder:7b).

Fase 3: le damos acceso al vault de Obsidian como "memoria".
Fase 4: le damos manos (Bash/PowerShell) con niveles de permisos.
Fase 6+ (actual): instrumentación — guarda el prompt crudo + respuesta cruda del
último turno (modo transparencia), lista de archivos tocados por turno (del log
jsonl del CLI) y comandos Bash ejecutados.

Niveles (config.brain.permission_level):
  - "limitado": solo vault y herramientas de lectura.
  - "equilibrado" (default): + ejecutar comandos con lista negra.
  - "amplio": + ejecutar casi cualquier cosa.
  - "dev": como equilibrado + git/pip/npm/install habilitados.

Documentado en: `ALCANCES-FASE-4.md`.
"""
from __future__ import annotations

import json
import platform
import re
import subprocess
import time
from pathlib import Path

from platform_layer import resolve_claude_cmd
from brain_ollama import ask_ollama, is_ollama_up

ROOT = Path(__file__).resolve().parent.parent


BASE_PERSONA = (
    "Eres Jarvis, un asistente personal por voz que habla español latino. "
    "Respondes en español. "
    "Formato: tus respuestas se leen en voz alta por un sintetizador, así que "
    "escribes SOLO texto plano conversacional. No uses markdown, viñetas, "
    "emojis, símbolos ni títulos. Si algo es largo, resúmelo. Trata al usuario de 'tú'. "
    "Cuando ejecutes algo exitosamente, confirma brevemente qué hiciste "
    "(ej. 'Listo, abrí Visual Studio Code'). "
    "Cuando algo falle, dilo claro y sugiere qué intentar."
)

VAULT_INSTRUCTIONS = (
    "Tienes una memoria personal: un vault de Obsidian (carpeta con archivos .md) "
    "ubicado en: {vault}. "
    "Esa carpeta es tu cuaderno de notas. Puedes LEERLA cuando el usuario pregunte "
    "por sus notas, proyectos, ideas, diario o cualquier información personal. "
    "Puedes también CREAR o EDITAR notas cuando el usuario te lo pida. "
    "Reglas al escribir notas: usa Markdown dentro de los archivos; organiza por "
    "carpetas existentes (Proyectos, Ideas, Aprendizaje, Diario); para el diario, "
    "el nombre del archivo es la fecha en formato AAAA-MM-DD.md dentro de Diario. "
    "Cuando leas notas para responder al usuario, resume el contenido en lenguaje "
    "hablado natural. NO leas el markdown literal al usuario. "
    "Si una nota no existe, dilo claramente."
)

HANDS_EQUILIBRADO = """\
También tienes "manos": puedes ejecutar comandos en la PC del usuario (Windows,
PowerShell, o Mac/Linux con bash) para ayudarle. Sistema operativo actual: {os}.

LO QUE SÍ PUEDES HACER (nivel equilibrado):
- Abrir aplicaciones por nombre (Windows: `start <nombre>` o `Start-Process`;
  Mac: `open -a "<nombre>"`). Ejemplos: VS Code, Spotify, navegador, Obsidian.
- Abrir archivos y carpetas por ruta (`start "<ruta>"` / `open "<ruta>"`).
- Abrir URLs en el navegador (`start https://...` / `open https://...`).
- Listar carpetas y buscar archivos (ls/dir/Get-ChildItem, find, Select-String).
- Consultar estado del sistema de forma segura: fecha, hora, batería, uptime,
  procesos corriendo, espacio en disco, red (ipconfig/ifconfig).
- Controlar volumen y brillo.
- Capturas de pantalla.
- Portapapeles (leer, poner texto).
- Buscar en web y resumir resultados.

LO QUE NO DEBES HACER (bloqueado):
- Borrar archivos o carpetas (nunca uses: del, rm, Remove-Item, rmdir, erase, Clear-RecycleBin).
- Mover/renombrar sobre-escribiendo sin preguntar.
- Instalar o desinstalar software (nunca: winget install/uninstall, choco, msiexec,
  pip install --user/-g, npm i -g, brew install).
- Editar el registro de Windows (reg add/delete, Set-ItemProperty en HKLM/HKCU).
- Cambiar configuración del sistema (zona horaria, red, usuarios, políticas).
- Apagar/reiniciar (shutdown, Restart-Computer).
- Formatear discos.
- Cerrar sesiones o cambiar de usuario.
- Enviar correos/mensajes/publicaciones en nombre del usuario.
- Hacer compras ni nada que cueste dinero.

QUÉ HACER SI EL USUARIO TE PIDE ALGO BLOQUEADO:
No lo ejecutes. Dile claramente que no está en tus permisos actuales, propón el
comando exacto que resolvería lo que pide, y pregúntale si quieres que lo copie
al portapapeles para que él lo ejecute. Sé conciso.

CONFIRMACIÓN DE ACCIONES INUSUALES:
Si una acción podría cambiar algo importante aunque no esté en la lista negra,
describe brevemente qué vas a hacer antes de ejecutarla y espera confirmación.
Para abrir apps, archivos o URLs normales, procede sin preguntar.

ESTILO DE RESPUESTA:
Después de ejecutar algo, confirma al usuario en una frase corta y natural.
No le muestres salidas largas de comandos; resume o cuéntale lo relevante.
"""

HANDS_AMPLIO = """\
También tienes "manos": puedes ejecutar comandos en la PC del usuario para ayudarle.
Sistema operativo actual: {os}.

Nivel de permisos: AMPLIO. Puedes ejecutar prácticamente cualquier comando.
Para acciones destructivas (borrar, instalar, cambiar config del sistema), aún
describe en una frase corta lo que vas a hacer antes de ejecutarlo.

Para abrir apps, archivos, URLs y consultas de estado, procede sin preguntar.
Después de ejecutar, confirma brevemente qué hiciste. No muestres salidas largas.
"""

HANDS_LIMITADO = """\
Tienes acceso de lectura al vault, pero NO puedes ejecutar comandos en la PC.
Si el usuario te pide hacer algo (abrir apps, archivos, etc.), explícale que en
el nivel limitado no tienes permisos para ejecutar, y propón que suba a nivel
equilibrado si quiere esa capacidad.
"""

HANDS_DEV = HANDS_EQUILIBRADO + (
    "\n\nEXTRAS PARA DESARROLLO: puedes usar git, npm, pip, pipx, cargo, make,"
    " node, python, abrir editores, compilar, correr tests. "
    "Sigue siendo cuidadoso con comandos destructivos sobre repos (reset --hard,"
    " push --force, rm -rf) — descríbelos antes de ejecutarlos."
)


LEVEL_PROMPTS = {
    "limitado": HANDS_LIMITADO,
    "equilibrado": HANDS_EQUILIBRADO,
    "amplio": HANDS_AMPLIO,
    "dev": HANDS_DEV,
}


class Brain:
    def __init__(self, config: dict):
        cfg = config.get("brain", {})
        self.provider = cfg.get("provider", "claude")  # "claude" | "ollama"
        self.cmd = resolve_claude_cmd(cfg.get("claude_cmd", "claude"))
        self.timeout = int(cfg.get("timeout_seconds", 180))
        self.max_history = int(cfg.get("max_history", 12))
        self.level = cfg.get("permission_level", "equilibrado")
        if self.level not in LEVEL_PROMPTS:
            print(f"[Jarvis] Nivel '{self.level}' desconocido; uso 'equilibrado'.")
            self.level = "equilibrado"
        self.extra_allowed = list(cfg.get("extra_allowed", []))
        self.extra_blocked = list(cfg.get("extra_blocked", []))
        self.custom_persona = (cfg.get("custom_persona") or "").strip()

        ollama_cfg = cfg.get("ollama", {}) or {}
        self.ollama_model = ollama_cfg.get("model", "qwen2.5-coder:7b")
        self.ollama_host = ollama_cfg.get("host", "http://127.0.0.1:11434")

        self.history: list[tuple[str, str]] = []

        vault_rel = config.get("obsidian", {}).get("vault_path", "vault-prueba")
        vault_path = Path(vault_rel)
        if not vault_path.is_absolute():
            vault_path = ROOT / vault_path
        self.vault = vault_path.resolve()

        self.os_label = {
            "Windows": "Windows 11 con PowerShell",
            "Darwin": "macOS con bash/zsh",
            "Linux": "Linux con bash",
        }.get(platform.system(), platform.system())

        # Instrumentación — rellenada por cada ask()
        self.last_prompt: str = ""
        self.last_system_prompt: str = ""
        self.last_raw_output: str = ""
        self.last_turn_files: list[dict] = []
        self.last_turn_commands: list[dict] = []
        self.last_turn_tokens: dict = {}
        self.vault_touches: dict[str, float] = {}  # ruta -> last ts
        self.commands_history: list[dict] = []     # últimos 100 comandos
        self.files_history: list[dict] = []        # últimos 100 toques de archivo

    def _system_prompt(self) -> str:
        parts = [BASE_PERSONA]
        if self.custom_persona:
            parts.append("Instrucciones adicionales del usuario: " + self.custom_persona)
        if self.vault.exists():
            parts.append(VAULT_INSTRUCTIONS.format(vault=str(self.vault)))
        parts.append(LEVEL_PROMPTS[self.level].format(os=self.os_label))
        if self.extra_allowed:
            parts.append("EXCEPCIONES PERMITIDAS (además de lo anterior): "
                         + ", ".join(self.extra_allowed))
        if self.extra_blocked:
            parts.append("EXCEPCIONES PROHIBIDAS (nunca, aunque el nivel lo permita): "
                         + ", ".join(self.extra_blocked))
        return "\n\n".join(parts)

    def _allowed_tools(self) -> str:
        tools = ["Read", "Write", "Edit", "Grep", "Glob"]
        if self.level != "limitado":
            tools += ["Bash", "WebSearch", "WebFetch"]
        return ",".join(tools)

    def _build_prompt(self, user_text: str) -> str:
        lines: list[str] = []
        for role, text in self.history[-self.max_history:]:
            who = "Usuario" if role == "user" else "Jarvis"
            lines.append(f"{who}: {text}")
        lines.append(f"Usuario: {user_text}")
        lines.append("Jarvis:")
        return "\n".join(lines)

    # ---------- despacho ----------
    def ask(self, user_text: str) -> str:
        user_text = (user_text or "").strip()
        if not user_text:
            return ""
        self.last_turn_files = []
        self.last_turn_commands = []
        self.last_turn_tokens = {}

        if self.provider == "ollama":
            reply = self._ask_ollama(user_text)
        else:
            reply = self._ask_claude(user_text)

        self.history.append(("user", user_text))
        self.history.append(("assistant", reply))
        return reply

    # ---------- backend: Claude Code CLI ----------
    def _ask_claude(self, user_text: str) -> str:
        prompt = self._build_prompt(user_text)
        system = self._system_prompt()
        self.last_prompt = prompt
        self.last_system_prompt = system

        args = [
            self.cmd, "-p", prompt,
            "--append-system-prompt", system,
            "--allowed-tools", self._allowed_tools(),
            "--output-format", "stream-json",
            "--verbose",
        ]
        if self.vault.exists():
            args += ["--add-dir", str(self.vault)]

        try:
            result = subprocess.run(
                args,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=self.timeout,
                cwd=str(self.vault) if self.vault.exists() else None,
            )
        except subprocess.TimeoutExpired:
            return "Perdón, tardé demasiado en pensar. ¿Me lo repites?"
        except FileNotFoundError:
            return ("No encuentro el cerebro. "
                    "Revisa que Claude Code esté instalado y con sesión iniciada.")

        self.last_raw_output = (result.stdout or "")
        out_text = self._parse_claude_stream(result.stdout or "")
        if not out_text:
            # Fallback: puede que stream-json no sea soportado
            out_text = (result.stdout or "").strip()
        if not out_text:
            err = (result.stderr or "").strip()
            if err:
                return f"Tuve un problema al pensar: {err[:200]}"
            return "No obtuve respuesta."
        return out_text

    def _parse_claude_stream(self, raw: str) -> str:
        """Parsea el stream-json de Claude Code: extrae texto final, archivos
        y comandos tocados en este turno. Si no es stream-json, deja raw como está."""
        text_parts: list[str] = []
        now = time.time()
        for line in raw.splitlines():
            line = line.strip()
            if not line or not line.startswith("{"):
                continue
            try:
                ev = json.loads(line)
            except json.JSONDecodeError:
                continue

            etype = ev.get("type")
            if etype == "assistant":
                # Mensaje del modelo (puede tener múltiples bloques)
                msg = ev.get("message") or {}
                for block in msg.get("content") or []:
                    btype = block.get("type")
                    if btype == "text":
                        text_parts.append(block.get("text") or "")
                    elif btype == "tool_use":
                        self._track_tool_use(block, now)
                usage = msg.get("usage") or {}
                if usage:
                    self.last_turn_tokens = {
                        "input": usage.get("input_tokens"),
                        "output": usage.get("output_tokens"),
                        "cache_read": usage.get("cache_read_input_tokens"),
                        "cache_creation": usage.get("cache_creation_input_tokens"),
                    }
            elif etype == "result":
                # Mensaje final del cli
                final = ev.get("result")
                if final and not text_parts:
                    text_parts.append(final)
                usage = ev.get("usage") or {}
                if usage and not self.last_turn_tokens:
                    self.last_turn_tokens = {
                        "input": usage.get("input_tokens"),
                        "output": usage.get("output_tokens"),
                    }
        return "\n".join(text_parts).strip()

    def _track_tool_use(self, block: dict, ts: float) -> None:
        name = block.get("name") or ""
        inp = block.get("input") or {}
        if name in ("Read", "Write", "Edit", "Glob"):
            path = inp.get("file_path") or inp.get("path") or inp.get("pattern") or ""
            op = {"Read": "read", "Write": "write", "Edit": "edit", "Glob": "glob"}[name]
            entry = {"ts": ts, "op": op, "path": path}
            self.last_turn_files.append(entry)
            self.files_history.append(entry)
            self.files_history[:] = self.files_history[-100:]
            # Si está dentro del vault, marca el touch (para pulso en el grafo)
            try:
                rp = Path(path).resolve()
                if str(rp).startswith(str(self.vault)):
                    self.vault_touches[str(rp)] = ts
            except Exception:  # noqa: BLE001
                pass
        elif name == "Bash":
            cmd = inp.get("command") or ""
            desc = inp.get("description") or ""
            entry = {"ts": ts, "command": cmd[:400], "description": desc[:200]}
            self.last_turn_commands.append(entry)
            self.commands_history.append(entry)
            self.commands_history[:] = self.commands_history[-100:]

    # ---------- backend: Ollama ----------
    def _ask_ollama(self, user_text: str) -> str:
        prompt = self._build_prompt(user_text)
        system = self._system_prompt() + (
            "\n\nNota: estás corriendo en MODO LOCAL (Ollama). NO tienes acceso a "
            "archivos, al vault ni a comandos de la PC: solo puedes conversar. "
            "Si el usuario te pide algo que requiere acceso, dile que debe cambiar "
            "el cerebro a Claude Pro desde el dashboard."
        )
        self.last_prompt = prompt
        self.last_system_prompt = system
        try:
            text, meta = ask_ollama(
                self.ollama_model, prompt, system,
                host=self.ollama_host, timeout=self.timeout,
            )
        except RuntimeError as e:
            return f"El modelo local no está disponible. {e}"
        self.last_raw_output = text
        self.last_turn_tokens = {
            "input": meta.get("prompt_tokens"),
            "output": meta.get("completion_tokens"),
            "provider": "ollama",
            "model": meta.get("model"),
        }
        return text or "No obtuve respuesta del modelo local."

    # ---------- utilidades ----------
    def provider_status(self) -> dict:
        return {
            "provider": self.provider,
            "claude_cmd": str(self.cmd),
            "ollama_up": is_ollama_up(self.ollama_host),
            "ollama_model": self.ollama_model,
            "ollama_host": self.ollama_host,
        }

    def transparency(self) -> dict:
        """Para el modo transparencia del dashboard."""
        return {
            "provider": self.provider,
            "system_prompt": self.last_system_prompt,
            "user_prompt": self.last_prompt,
            "raw_output": self.last_raw_output[:50000],
            "tokens": self.last_turn_tokens,
            "files_this_turn": self.last_turn_files,
            "commands_this_turn": self.last_turn_commands,
        }
