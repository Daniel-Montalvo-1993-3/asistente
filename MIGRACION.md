# 🔄 Migración entre equipos (Windows ↔ Mac)

> Qué revisar y cambiar al llevar Jarvis a otra computadora (p. ej. de tu PC de
> casa a la Mac Mini M1 del trabajo). La **lógica es la misma**; solo cambian
> algunos ajustes **por-máquina** y hay que instalar dependencias en el equipo nuevo.

- **Regla de oro:** el código (`core/`, `widget/`) NO cambia. Lo que cambia vive
  en **`config/config.json`** y en lo que esté instalado en el equipo.

---

## 1. Puesta en marcha en un equipo nuevo

### Requisitos (instalar una vez)
| Herramienta | Windows | Mac (M1) |
|---|---|---|
| Python 3.12 | `winget install Python.Python.3.12` | `brew install python@3.12` |
| Node.js | ya instalado / nodejs.org | `brew install node` |
| Claude CLI (cerebro) | `npm i -g @anthropic-ai/claude-code` | igual |
| Sesión de Claude Pro | `claude` → iniciar sesión | igual |

### Arrancar
- **Windows:** ejecutar `iniciar-windows.ps1`
- **Mac:** `chmod +x iniciar-mac.sh && ./iniciar-mac.sh`

Los scripts crean el entorno de Python (`.venv`), instalan dependencias y abren
núcleo + widget. La **primera vez** descargan solos:
- El **modelo de Whisper** ("small") → a `~/.cache/huggingface`
- Las **dependencias** de `core/requirements.txt` y de Electron

---

## 2. Lo que SÍ hay que cambiar (en `config/config.json`)

| Ajuste | Qué es | Windows (casa) | Mac (trabajo) |
|---|---|---|---|
| `ears.mic_device` | Nombre del micrófono | `"PD100X"` | el micro de la Mac (ver abajo) |
| `obsidian.vault_path` | Carpeta de tu vault | ruta de prueba | tu vault real sincronizado |
| `ears.whisper_device` | CPU o GPU | `"auto"`→CPU (falta CUDA) | `"cpu"` (M1 no usa CUDA) |
| `ears.wasapi_exclusive` | Solo aplica en Windows | `true` | se ignora en Mac |

### Cómo saber el nombre del micrófono en la Mac
Con el entorno creado, corre:
```
.venv/bin/python -c "import sounddevice as sd; print(sd.query_devices())"
```
Busca tu micrófono en la lista y pon una parte de su nombre en `ears.mic_device`
(o `null` para usar el de por defecto del sistema).

---

## 3. Diferencias técnicas Windows vs Mac (ya resueltas en el código)

| Tema | Windows | Mac | ¿Hay que hacer algo? |
|---|---|---|---|
| Audio (captura) | WASAPI exclusivo (ignora "mejoras") | CoreAudio | No; el código elige solo. En Mac no hay el problema de Voice Clarity. |
| Abrir apps/sistema | `start` | `open` | No; `platform_layer.py` lo abstrae. |
| Voz del sistema (respaldo) | SAPI (Helena) | `say` (voz "Paulina") | No; automático. |
| Ruta del cerebro (Claude) | `%APPDATA%\npm\...\claude.exe` | `/opt/homebrew/bin/claude` | No; `resolve_claude_cmd` lo busca. |
| Variable `ELECTRON_RUN_AS_NODE` | se limpia en el script | idem | No; ya resuelto. |

---

## 4. Ojo con estos archivos (NO se sincronizan por git)

El `.gitignore` excluye cosas pesadas o personales. Al migrar, recuerda:

| Carpeta/archivo | ¿Qué hacer en el equipo nuevo? |
|---|---|
| `.venv/` | Se recrea solo al correr el script de inicio. |
| `widget/node_modules/` | Se reinstala solo (`npm install`). |
| `voices/` (voz de Piper) | **Re-descargar** el modelo es_MX-claude-high, o copiarlo a mano. |
| `config/config.local.json` | Si usas config por-máquina, no se comparte (a propósito). |

> **Voz de Piper:** el modelo (`voices/es_MX-claude-high.onnx` + `.json`) pesa ~60 MB
> y está en `.gitignore`. En el equipo nuevo, vuelve a descargarlo de
> huggingface.co/rhasspy/piper-voices (carpeta `es/es_MX/claude/high/`) a `voices/`,
> o cópialo con una USB. (Si prefieres que viaje con el proyecto, quita `voices/`
> del `.gitignore`.)

---

## 5. Checklist rápido al cambiar de equipo

- [ ] Instalar Python 3.12, Node.js y Claude CLI (y login Pro)
- [ ] Copiar/clonar la carpeta del proyecto
- [ ] Descargar la voz de Piper a `voices/`
- [ ] Ajustar `ears.mic_device` al micrófono del equipo
- [ ] Ajustar `obsidian.vault_path` a tu vault
- [ ] Correr el script de inicio (`iniciar-windows.ps1` o `iniciar-mac.sh`)
- [ ] Probar: escribir en el widget, y decir "Oye Jarvis, ¿qué hora es?"
- [ ] (Si el micro no responde) revisar nombre del micro y niveles/mute
