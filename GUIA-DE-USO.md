# 📖 Guía de Uso y Alcances — JARVIS

> Esta guía crece conforme avanzamos. Describe **qué puede hacer** tu Jarvis
> y **cómo usarlo**. Lo que aún no está construido se marca como 🔜 (próximamente).

- **Última actualización:** 2026-10-31
- **Estado:** Fases 1-4, 6, 7 y 8 construidas — voz, memoria, acciones, dashboard,
  cerebro local opcional, sonidos editables y wake word endurecido.

## 📊 Dashboard

Haz clic en el botón **📊** del widget (arriba a la derecha) para abrir el
dashboard en una ventana aparte. Ahí ves y configuras todo:

- **Estado**: qué está haciendo Jarvis ahora, latencia de la última respuesta, modelos activos.
- **Sistema y recomendaciones**: diagnóstico de tu PC y la mejor config para tu hardware.
- **Historial**: todas las conversaciones (texto + voz) con tiempos.
- **Configuración**: cambia nivel de permisos, modelo de Whisper, voz, vault, etc. sin editar archivos.

Los cambios se aplican al **Reiniciar núcleo** (botón del dashboard).

---

## 1. ¿Qué es?

Tu asistente personal por voz para Windows, con cerebro de Claude, memoria en
Obsidian y un widget flotante siempre visible. Le hablas o le escribes, y te
ayuda con archivos, web, apps y tus notas.

---

## 2. Cómo se usa (resumen)

### Para arrancar Jarvis
- **Windows (lo más fácil):** doble clic en el acceso directo **"Jarvis"** de tu escritorio.
  - También: clic derecho en `iniciar-windows.ps1` → "Ejecutar con PowerShell".
- **Mac (M1):** en Terminal, dentro de la carpeta: `chmod +x iniciar-mac.sh && ./iniciar-mac.sh`

**Para cerrar Jarvis:** cierra la ventana del widget (botón ✕). El núcleo se cierra solo.

El script instala lo necesario la primera vez, abre el núcleo y el widget flotante.

### Para hablar con él
- **Por texto:** escribe en la cajita del widget y presiona Enter. ✅ FUNCIONA
- **Respuesta:** te contesta en el chat **y en voz alta** con voz mexicana
  (Piper es_MX-claude-high). ✅ FUNCIONA
  Para cambiar de voz: edita `tts.piper_voice` en `config/config.json`.
- **Por voz:** di **"Oye Jarvis, ¿qué hora es?"** (todo de corrido) y te responde
  en voz. ✅ FUNCIONA. También puedes decir solo **"Oye Jarvis"**, esperar a que
  conteste *"¿Sí?"*, y luego tu petición.
  - Tarda ~4-5 s en responder (Whisper + cerebro + voz). Es normal; se puede
    acelerar más adelante (ver Fase 5 del plan).
  - El micro usado es el **PD100X** (configurable en `ears.mic_device`).
  - Mientras Jarvis habla, el micro se pausa para no oírse a sí mismo.

> **¿Está escuchando todo el tiempo?** No graba durante el silencio. Cuando hablas,
> transcribe esa frase **localmente** (en tu PC, nada sale a internet) para ver si
> dijiste "Jarvis"; si no, la descarta. Es privado, pero usa CPU cada vez que hablas.
> (Opción futura: wake-word real con Porcupine, que ignora todo hasta la palabra.)

> **¿Vas a usarlo en otra compu (tu Mac)?** Lee **`MIGRACION.md`**: dice qué revisar
> y cambiar (micrófono, ruta del vault, etc.) al llevar el proyecto a otro equipo.

### El widget
- Flota siempre encima de otras ventanas. Se arrastra desde la barra superior.
- Botón **—** minimiza, **✕** cierra. El punto de color indica el estado
  (verde = listo, amarillo = pensando, azul = hablando, rojo = sin conexión).

---

## 3. Alcances — ¿Qué podrá hacer?

### 📁 Archivos locales
- [ ] Leer, crear, editar y mover archivos
- [ ] Buscar archivos y dentro de documentos
- [ ] Resumir PDFs, documentos y hojas de cálculo
- [ ] Organizar carpetas ("ordena mis descargas")

### 🌐 Web
- [ ] Buscar información y resumirla
- [ ] Leer páginas concretas
- [ ] Descargar archivos
- [ ] Consultar APIs (clima, etc.)

### 🖥️ Aplicaciones y sistema (Fase 4 — nivel Equilibrado)
- [x] Abrir programas por nombre ("abre VS Code", "abre Spotify")
- [x] Abrir archivos, carpetas y URLs
- [x] Ejecutar comandos seguros (consultar estado, listar, buscar)
- [x] Control del sistema (volumen, brillo, portapapeles, capturas)
- [x] Nada destructivo sin aviso (ver **ALCANCES-FASE-4.md**)

**Ejemplos de voz/texto:**
- *"Oye Jarvis, abre VS Code"*
- *"Oye Jarvis, ¿cuánto espacio me queda en el disco C?"*
- *"Oye Jarvis, abre YouTube"*
- *"Oye Jarvis, baja el volumen"*
- *"Oye Jarvis, haz una captura de pantalla"*

Si le pides algo bloqueado (ej. desinstalar algo), te **propone el comando** en vez
de ejecutarlo. Lee **ALCANCES-FASE-4.md** para la lista completa de permisos y cómo
subirlos cuando confíes.

### 📚 Memoria (Obsidian)
- [x] Responder usando tus notas ✅
- [x] Crear y actualizar notas ✅
- [x] Buscar y resumir contenido en lenguaje natural ✅
- [ ] Búsqueda semántica avanzada (RAG) — opcional, cuando el vault crezca

**Cómo usarlo:**
- *"Oye Jarvis, ¿qué proyectos tengo?"* → te resume lo que hay en Proyectos
- *"Oye Jarvis, ¿qué ideas tengo anotadas?"* → te lee lo relevante de Ideas
- *"Oye Jarvis, agrega a mi diario de hoy que terminé la fase tres"* → lo escribe
- *"Oye Jarvis, crea una nota en Proyectos llamada 'Reunión del lunes' con…"* → la crea

El vault actual es `vault-prueba/`. Para cambiarlo a tu vault real, edita
`obsidian.vault_path` en `config/config.json`.

### ⚙️ Automatización
- [ ] Recordatorios y tareas programadas
- [ ] Flujos encadenados ("busca esto, resúmelo y guárdalo")

### 🎙️ Voz e interfaz
- [x] Palabra de activación ("Hey Jarvis") ✅ (openWakeWord)
- [x] Escuchar (voz → texto, local) ✅ (faster-whisper)
- [x] Hablar (texto → voz) — **voz mexicana Piper (es_MX-claude-high)** ✅
- [x] Widget flotante con estado visual ✅

> Las casillas se marcan ✅ conforme cada función queda lista y probada.

---

## 4. Límites importantes

- **Cupo de Claude Pro:** el cerebro (Claude) tiene topes de uso por tiempo.
  Para uso diario normal alcanza; si se satura, entra el **LLM local** (Ollama) de respaldo.
- **Privacidad:** el micrófono solo captura al oír "Hey Jarvis"; la transcripción
  es **local** (tu voz no sale de la PC).
- **Sitios con login** (banca, correos privados en web): posibles pero frágiles;
  mejor vía APIs/conectores oficiales.

---

## 5. Requisitos técnicos (referencia)

- **SO:** Windows 10/11 o macOS 12+ (Apple Silicon o Intel). También corre en Linux.
- **Python:** 3.10 o superior (recomendado 3.12).
- **Node.js:** 18 o superior (para el widget Electron).
- **Claude Code CLI** instalado y con sesión Pro iniciada (`claude login`).
- **(Opcional)** GPU NVIDIA con CUDA → acelera Whisper (STT).
- **(Opcional)** Ollama → cerebro local gratis cuando se agote Pro.

---

## 6. 🚀 Instalar en otra máquina (Windows o Mac)

> Toda la configuración personal queda **fuera del repositorio** gracias al
> `.gitignore`: tu `config.json` real, el vault, los logs y los binarios de voces
> nunca se suben. Para arrancar en una máquina nueva se usa un script de
> instalación que crea todo eso **desde las plantillas**.

### 6.1 Pasos (uno de los dos, según tu SO)

**🪟 En Windows**
```powershell
# 1. Clonar o copiar el proyecto a la carpeta donde lo quieras
cd ruta\al\proyecto

# 2. Ejecutar el instalador (clic derecho → Ejecutar con PowerShell, o:)
powershell -ExecutionPolicy Bypass -File setup.ps1

# 3. Iniciar sesión en Claude (una sola vez)
claude login

# 4. Arrancar Jarvis
.\iniciar-windows.ps1
```

**🍎 En Mac (M1/M2/M3) o Linux**
```bash
# 1. Clonar o copiar el proyecto
cd ruta/al/proyecto

# 2. Ejecutar el instalador
chmod +x setup.sh && ./setup.sh

# 3. Iniciar sesión en Claude (una sola vez)
claude login

# 4. Arrancar Jarvis
chmod +x iniciar-mac.sh && ./iniciar-mac.sh
```

### 6.2 ¿Qué hace exactamente el instalador?
El script [setup.ps1](setup.ps1) / [setup.sh](setup.sh) deja la máquina lista:

1. ✅ Verifica Python 3.10+ y Node 18+ (los pide si faltan).
2. ✅ Crea el entorno virtual `.venv` e instala las dependencias Python
   (`requirements.txt`).
3. ✅ Instala las dependencias del widget (`npm install`).
4. ✅ **Crea `config/config.json`** a partir de `config.sample.json` si no existe
   (nunca sobrescribe uno tuyo).
5. ✅ **Crea las carpetas** `logs/`, `vault-prueba/{Proyectos,Ideas,Aprendizaje,Diario}`.
6. 🍎 En Mac: ajusta `wasapi_exclusive=false` (ese modo es solo Windows) y recuerda
   aceptar el permiso del micrófono.
7. ✅ Verifica que **Claude Code CLI** esté instalado y recuerda hacer `claude login`.
8. ✅ Imprime los siguientes pasos.

### 6.3 Archivos personales que crea cada instalador
Estos **nunca** vienen en el repo (están en `.gitignore`) y se recrean localmente:

| Archivo / carpeta | Qué contiene | Cómo se crea |
|---|---|---|
| `config/config.json` | Tu configuración (vault, mic, prompt, permisos) | Copia de `config.sample.json` |
| `logs/jarvis.jsonl` | Tus conversaciones con Jarvis | Se crea sola al primer turno |
| `vault-prueba/` | Vault de prueba (notas Markdown) | El setup crea las subcarpetas vacías |
| `.venv/` | Entorno Python aislado | `python -m venv .venv` |
| `widget/node_modules/` | Dependencias del widget | `npm install` |
| `voices/` | Voces de Piper (si usas Piper) | Se descargan aparte |

### 6.4 Primer arranque: qué revisar en `config/config.json`

Después del `setup`, abre `config/config.json` y confirma:

| Clave | Qué poner |
|---|---|
| `obsidian.vault_path` | Ruta a tu vault real (ej. `C:\Users\...\Obsidian\MiVault` o `~/Documents/Obsidian/MiVault`). Si no lo tienes aún, deja `vault-prueba`. |
| `ears.mic_device` | `null` para autodetectar, o el **nombre** de tu micrófono (ej. `"PD100X"`, `"MacBook Pro Microphone"`). |
| `ears.wasapi_exclusive` | `true` solo en Windows con micrófono USB "crudo". En Mac/Linux déjalo `false`. |
| `ears.strict_wake` | `true` si quieres que **cada frase** requiera "Oye Jarvis" (recomendado al principio). |
| `brain.permission_level` | `limitado` por default. Súbelo a `equilibrado` cuando confíes. |
| `tts.backend` | `system` (voz del SO, sin descargas) o `piper` (voz latina, requiere descargar la voz). |

### 6.5 Si quieres el cerebro local (Ollama, opcional)

```bash
# Mac
brew install ollama && brew services start ollama

# Windows
# Descarga el instalador desde https://ollama.com

# En cualquier SO, descarga el modelo recomendado (~4.7 GB)
ollama pull qwen2.5-coder:7b
```

Luego, en el dashboard: **Configuración → Cerebro → Proveedor: Ollama local**.

### 6.6 Cosas que podrían fallar y cómo arreglarlo

| Síntoma | Causa típica | Fix |
|---|---|---|
| `setup.ps1` dice "No encontré Python" | Python no en PATH | Reinstalar desde python.org marcando "Add to PATH" |
| `npm install` tarda mucho / falla | Firewall o npm desactualizado | `npm install -g npm@latest` y reintentar |
| Jarvis no oye | Permiso de micrófono, mic equivocado | Mac: Preferencias → Privacidad → Micrófono. Windows: comprueba `ears.mic_device`. |
| "claude: command not found" | Claude CLI no instalado | Instalar desde https://docs.anthropic.com/claude-code |
| Piper falla con la voz es_MX | Falta descargar el modelo | `tts.backend = "system"` como alternativa inmediata |
| Dashboard dice "desconectado" | El núcleo Python no arrancó | Mira la terminal donde lanzaste `iniciar-*` |

### 6.7 Antes de compartir el proyecto con otra persona

Lee **[ALCANCES-FASE-4.md § 6-7](ALCANCES-FASE-4.md)** — tiene el **checklist de
limpieza** (10 ítems) y los comandos `grep` para detectar fugas de datos antes de
hacer `zip` o `git push`.

**Resumen crítico:**
1. 🚨 Borrar `logs/jarvis.jsonl` (tus conversaciones).
2. 🚨 No incluir `config/config.json` real (solo `config.sample.json`).
3. 🚨 No incluir el vault real (tus notas).
4. 🚨 Bajar `permission_level` a `limitado` antes de empaquetar.
5. ✅ Confirmar que `.gitignore` cubre todo (ya lo hace: `.venv`, `node_modules`,
   `logs`, `vault*`, `voices`, `*.env`, keys, etc.).
