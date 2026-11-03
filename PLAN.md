# 🤖 Proyecto JARVIS — Plan Maestro y Memoria

> **Este documento es la memoria del proyecto.** Si retomamos en otra sesión,
> aquí está qué decidimos, por qué, y en qué punto exacto nos quedamos.
> El checklist de cada fase se actualiza conforme avanzamos.

- **Dueño:** Daniel Montalvo (daniel.montalvo@mmkgroup.com.mx)
- **Inicio:** 2026-10-29
- **Última actualización:** 2026-10-31
- **Estado global:** 🟢 Fase 8 construida (Sonidos editables + wake word endurecido + autoplay) — pendiente que el usuario pruebe.

---

## 1. ¿Qué estamos construyendo?

Un asistente personal tipo **"Jarvis"** para Windows 11, que:
- Tiene **voz local** (te escucha y te responde hablando).
- Usa **Obsidian como memoria** (tus notas en Markdown).
- Tiene **interfaz propia**: un **widget flotante** siempre visible.
- Puede **hacer de todo** en la PC: archivos, abrir apps/proyectos, buscar en web, automatizar.
- Usa **Claude como cerebro** aprovechando el plan **Claude Pro** del usuario.
- Es **gratis** (sin costos nuevos más allá del Pro que ya se paga).

---

## 2. Hardware del equipo (detectado 2026-10-29)

| Componente | Detalle | Veredicto |
|---|---|---|
| CPU | Intel i7-10700K (8 núcleos / 16 hilos) | Excelente |
| RAM | 32 GB | Excelente |
| GPU | NVIDIA RTX 2070 SUPER — 8 GB VRAM (CUDA) | Muy bueno |
| Disco C: | 845 GB libres de 953 GB | De sobra |
| SO | Windows 11 Pro (64 bits) | Perfecto |

> Capaz de correr en paralelo: Whisper (GPU), Piper, wake-word, y un LLM local 7–8B de respaldo.

---

## 3. Decisiones clave (y por qué)

### 3.1 El cerebro: Claude vía Claude Code (plan Pro)
- ⚠️ **Claude Pro NO incluye la API de Anthropic** (son productos distintos).
- ✅ **Pero Claude Code sí se puede controlar por programa** (modo headless / Agent SDK)
  usando el login de Pro → **usamos Claude como cerebro sin pagar API aparte**,
  dentro de los límites de uso del plan Pro.
- ✅ **Claude Code ya es casi un Jarvis**: acceso a archivos, ejecutar comandos,
  leer web, servidores MCP (Gmail/Calendar/etc.). Nuestro proyecto le pone
  **voz + cara (widget) + memoria (Obsidian)**.
- 🔁 **Respaldo:** LLM local con **Ollama** (Qwen 2.5 7B o Llama 3.1 8B) para
  tareas simples, offline, o cuando se agote el cupo de Pro. Gratis e ilimitado.

### 3.2 El resto del stack (todo local y gratis)
| Función | Herramienta | Por qué |
|---|---|---|
| 👂 Palabra de activación | **openWakeWord** | Local, ligero, gratis. "Hey Jarvis". |
| 🎤 Oído (voz→texto) | **faster-whisper** | Local en GPU, muy preciso, gratis. |
| 🗣️ Voz (texto→voz) | **Piper** | Local, rápido, buena calidad, gratis. |
| 📚 Memoria | **Obsidian vault** (.md) | Archivos simples de leer/escribir. |
| 🖥️ Interfaz | **Electron** (o Tauri) | Widget flotante always-on-top. |
| 🧩 Núcleo | **Python** | Pega todo; mejor ecosistema de voz/IA. |

### 3.3 Privacidad del "siempre escuchando"
- Solo corre **openWakeWord** en continuo (detecta SOLO la palabra clave).
- **El audio no se graba ni sale de la PC** hasta oír "Hey Jarvis".
- La transcripción (Whisper) es **local** → tu voz nunca va a la nube.

### 3.4 Obsidian
- **Concepto:** un vault NO vive dentro de la app de Obsidian. Un vault = una
  carpeta normal de archivos `.md`. Obsidian solo "apunta" a esa carpeta; Jarvis
  lee/escribe los mismos archivos directamente en disco. Son dos programas usando
  la misma carpeta; ninguno es dueño.
- Arrancamos con un **vault de prueba** (`vault-prueba/`) para no tocar notas reales.
- Cuando el usuario sincronice su carpeta real con Drive, **solo se cambia la ruta**
  `obsidian.vault_path` en `config/config.json`. Sin reescribir código.
- Las notas se pueden mover/copiar libremente entre carpetas (son archivos).

### Arquitectura back/front (decidido)
- Monorepo: un solo proyecto, separado por carpetas. `core/` = backend (Python),
  `widget/` = frontend (Electron), `config/` = compartido. Juntos pero limpios.

### 3.5 Multiplataforma (Windows + Mac) ✅
- El usuario tiene **PC Windows (casa)** y **Mac (trabajo)** → el proyecto debe correr en ambos.
- Todo el stack es multiplataforma. Diseñar desde Fase 1 con una **capa de sistema**
  que abstraiga lo específico de cada SO:
  - Abrir apps / control de sistema (`start` en Win vs `open` en Mac).
  - Aceleración: CUDA (RTX 2070 en Win) vs Metal/Apple Silicon o CPU (Mac) → autodetección.
  - Rutas y ajustes por-máquina en `config` (NO se comparten entre equipos).
- Sincronización del proyecto entre equipos: Git o Drive (pendiente de decidir).
- Mac: pendiente confirmar si es Apple Silicon o Intel (solo afecta al LLM local de respaldo).

### 3.6 Widget: Electron ✅
- Confirmado **Electron** (gratis, open source MIT, multiplataforma).

### 3.7 Palabra de activación: modificable ✅
- Default: **"Hey Jarvis"** (modelo ya incluido en openWakeWord).
- Cambiarla a otra palabra incluida = editar 1 línea en `config`.
- Palabra 100% personalizada (ej. un nombre propio) = entrenamiento rápido y gratuito.
- Conclusión: NO hay compromiso permanente; se cambia cuando el usuario quiera.

---

## 4. Arquitectura

```
┌─────────────────────────────────────────────┐
│   WIDGET FLOTANTE (always-on-top)  [Electron]│
│   • Estado: escuchando / pensando / hablando │
│   • Entrada por voz o texto · ondas de audio │
└───────────────┬─────────────────────────────┘
                │ (IPC / WebSocket local)
   ┌────────────┴───────────┐
   │   NÚCLEO  [Python]     │
   │                        │
   │  👂 openWakeWord  → "Hey Jarvis"      (local, continuo)
   │  🎤 faster-whisper → voz a texto      (GPU, local)
   │  🧠 Claude Code SDK → cerebro (Pro) ─┐
   │     └ Ollama 7B  (respaldo local) ───┘
   │  🗣️ Piper         → texto a voz       (local)
   │  📚 Obsidian vault → memoria (.md + búsqueda)
   └────────────────────────┘
```

---

## 5. Fases y Checklist

### Fase 0 — Planeación 🟡 EN CURSO
- [x] Revisar hardware del equipo
- [x] Decidir el stack (cerebro, voz, interfaz, memoria)
- [x] Aclarar tema de Claude Pro vs API
- [x] Crear `PLAN.md` (este documento)
- [x] Crear `GUIA-DE-USO.md`
- [x] Definir palabra de activación (default "Hey Jarvis", modificable después)
- [x] Confirmar tecnología de interfaz → **Electron** (gratis)
- [x] Confirmar requisito multiplataforma (Windows + Mac)

### Fase 1 — Esqueleto que habla ✅ COMPLETA
> Meta: escribir en el widget → Claude responde → lo dice en voz.
- [x] Estructura de carpetas del proyecto
- [x] Entorno Python (venv) + dependencias base (websockets)
- [x] Widget flotante básico (Electron) always-on-top (tipo cristal, arrastrable)
- [x] Conexión widget ↔ núcleo (WebSocket ws://127.0.0.1:8765)
- [x] Integrar cerebro: Claude Code CLI headless (`claude -p`) con login Pro ✅ probado
- [x] Voz del sistema (Helena es-ES) como respaldo
- [x] **Integrar Piper (voz latina es_MX-claude-high)** ✅ probado end-to-end
- [x] Prueba end-to-end: texto → respuesta del cerebro → voz mexicana ✅

> Nota técnica: VSCode hereda `ELECTRON_RUN_AS_NODE=1`; los scripts de arranque
> la limpian para que Electron no crashee. (Ya resuelto.)

### Fase 2 — El oído ✅ COMPLETA (probada por voz)
> Meta: hablarle por voz. Logrado: "Oye Jarvis, ¿qué hora es?" → responde en voz.
- [x] Captura de micrófono (sounddevice, PD100X)
- [x] faster-whisper (voz → texto), modelo "small" en CPU
- [x] Activación por **Whisper + patrón** (no openWakeWord): detecta "jarvis/yervis/
      hierbiz…" por regex fonética. (openWakeWord no detectaba y no soporta español.)
- [x] Flujo: VAD por energía → grabar hasta silencio → transcribir → si hay palabra
      de activación → cerebro → responder. Soporta "Oye Jarvis <comando>" de corrido
      o "Oye Jarvis" solo (responde "¿Sí?" y espera el comando).
- [x] Indicadores visuales en el widget (escuchando/grabando/entendiendo/…)
- [x] Pausa del micro mientras Jarvis habla (no se oye a sí mismo)
- [x] Captura en **WASAPI exclusivo (int32/24-bit)**: ignora las "mejoras de audio"
      de Windows (Voice Clarity) que distorsionaban la voz. Se abre en el hilo
      principal con callback (el exclusivo solo abre desde ahí).
- [x] Probado end-to-end por voz ✅

> **Lecciones / gotchas de Fase 2** (ver también MIGRACION.md):
> - openWakeWord no funcionó (ni sintético) y no hay "oye jarvis" en español → se
>   cambió a Whisper-como-detector.
> - Mic: índices de Windows cambian; resolver por nombre. DirectSound daba 0;
>   WASAPI exige 48 kHz → se captura a 48 k y se remuestrea a 16 k (frase completa).
> - "Mejoras de audio" de Windows distorsionaban → WASAPI exclusivo (crudo).
> - WASAPI exclusivo SOLO abre desde el hilo principal → callback + hilo de proceso.
> - `vad_filter=True` de Whisper borraba el audio → desactivado (VAD propia).

### Fase 3 — La memoria (Obsidian) ✅ COMPLETA
> Meta: que responda con tu información y guarde notas.
- [x] Vault de prueba con estructura real (Proyectos, Ideas, Aprendizaje, Diario)
- [x] Ruta del vault configurable en `config/config.json` (`obsidian.vault_path`)
- [x] Leer/buscar notas del vault ✅ probado
- [x] Escribir/crear/editar notas desde Jarvis ✅ probado
- [x] Respuestas en lenguaje natural (no lee markdown literal al usuario) ✅
- [ ] Búsqueda semántica (RAG) sobre el vault — opcional (Fase 3b, si el vault crece)

> **Cómo funciona:** `brain.py` le pasa a `claude -p` el vault con `--add-dir` y
> le permite las herramientas Read/Write/Edit/Grep/Glob restringidas a esa carpeta.
> El system prompt le explica que ese es su "cuaderno de notas" y las reglas para
> leerlo/escribirlo. Claude ya trae esas herramientas; solo lo guiamos a usarlas
> bien dentro del vault. Latencia típica: 6-9 s por pregunta con lectura/escritura.

### Fase 4 — Las manos (acciones) ✅ COMPLETA
> Meta: que actúe en la PC con permisos equilibrados (nada destructivo sin aviso).
- [x] Niveles de permisos: `limitado` / **`equilibrado`** (actual) / `amplio` / `dev`
- [x] Herramientas habilitadas por nivel: Read/Write/Edit/Grep/Glob (siempre),
      Bash + WebSearch + WebFetch (equilibrado y superiores)
- [x] System prompt del nivel equilibrado documenta qué puede y qué NO puede
      (bloqueado: borrar, instalar, cambiar config, apagar, mandar mensajes, pagar)
- [x] Si pide algo bloqueado, PROPONE el comando en texto en vez de ejecutarlo
- [x] Config: `brain.permission_level`, `brain.extra_allowed`, `brain.extra_blocked`
- [x] Documento de alcances: **ALCANCES-FASE-4.md** (qué puede/no, cómo escalar)
- [x] Prueba del usuario ✅ (abrir apps, consultar sistema, negar lo bloqueado)
- [ ] (Opcional) Respaldo LLM local con Ollama cuando se agote el cupo Pro

### Fase 5 — Pulido y optimización ⚪ PENDIENTE
- [ ] Auto-arranque con Windows / acceso directo de un clic
- [ ] Configuración fácil (archivo central)
- [ ] Manejo de errores y límites de uso de Pro
- [ ] Mejoras de UI del widget
- [ ] **Reducir latencia** (hoy ~4-5s): Whisper en GPU (instalar CUDA), o modelo
      "base"/"tiny", y mantener el cerebro "caliente" (sesión persistente de Claude
      en vez de arrancar el CLI en cada pregunta).
- [ ] (Opcional) **Wake-word real** con Picovoice Porcupine ("Oye Jarvis" en español,
      gratis con llave): ignora todo hasta oír la palabra, usa casi nada de CPU.
      Alternativa al método actual (Whisper transcribe cada frase para detectar).

### Fase 6 — Dashboard de Jarvis 🟢 CONSTRUIDA (en prueba del usuario)
> Panel en tiempo real. Nueva ventana de Electron (separada del widget flotante),
> conectada al mismo núcleo por WebSocket. Logs persistentes en `logs/jarvis.jsonl`.

**Visibilidad (ver):**
- [x] Estado en vivo (escuchando / pensando / hablando / idle)
- [x] Historial de conversaciones (del jsonl, pestaña Historial)
- [x] **Modelos activos ahora**: cerebro, Whisper (modelo/device), Piper, vault
- [x] Latencia por etapa de la última respuesta (brain / voice)
- [x] Contador de turnos esta sesión + uptime del núcleo

**Sistema y recomendaciones:**
- [x] Detectar hardware: SO, CPU, RAM, disco, GPU (nvidia-smi) + VRAM + driver, CUDA ready
- [x] Comparar contra requisitos de 5 niveles de Whisper (tiny…large-v3)
- [x] **Config recomendada para TU PC** con tarjeta por modelo (CPU/GPU ok/ko) y
      botón "Aplicar configuración recomendada"
- [x] Avisos (ej. "Tu GPU podría acelerar Whisper, falta cublas64_12.dll — instala…")

**Configuración (cambiar sin editar archivos):**
- [x] Nivel de permisos (limitado/equilibrado/amplio/dev)
- [x] Modelo de Whisper (tiny/base/small/medium) y CPU/GPU/auto
- [x] Backend TTS (Piper / sistema)
- [x] Ruta del vault de Obsidian
- [x] Botones: Guardar · Reiniciar núcleo · Borrar historial

> Nota de consumo: el dashboard NO consume plan Pro (todo local).
> Las llamadas al cerebro sí (son las que ya hacías antes); el dashboard las cuenta.

**Arquitectura:**
- Nueva ventana de Electron (`widget/dashboard/`) — misma app, abre con botón 📊
  del widget flotante.
- Habla con el núcleo por el **mismo WebSocket** (ws://127.0.0.1:8765) usando
  mensajes nuevos (get_diagnostics, get_history, get_models, get_config, set_config,
  clear_history, restart_core) con `reply_id` para request/response.
- Logs persistentes en `logs/jarvis.jsonl` (una línea por evento).
- Hardware detector: `core/system_info.py` (psutil + nvidia-smi + ctranslate2).

### Fase 7 — Dashboard ampliado + cerebro local 🟢 CONSTRUIDA (en prueba del usuario)
> Meta: añadir visibilidad profunda, control granular, UX pulida y la posibilidad
> de cambiar el cerebro de Claude Pro a un modelo local (Ollama).

**Visualización:**
- [x] 🧠 **Grafo del vault con D3 force-directed**: nodos por nota, aristas por `[[enlaces]]`,
      nodo central Jarvis conectado a las notas recién tocadas, pulso glow en nodos
      recién leídos/escritos, colores por carpeta, zoom/pan, hover resalta vecinos,
      control de separación (fuerza) y toggle de etiquetas.
- [x] Panel de **comandos ejecutados** por Fase 4 (qué, cuándo, descripción).
- [x] Panel de **archivos del vault tocados** por turno (lectura/escritura/edición).
- [x] **Modo transparencia**: ver prompt system+user y respuesta cruda del último turno.
- [x] **Monitor CPU/RAM** del proceso Jarvis + sistema (polling 2 s).

**Analíticas:**
- [x] **Costo estimado del plan Pro**: tokens último turno + sesión + estimado USD
      (precios públicos Sonnet 3/15 USD por M tokens).

**Configuración desde la UI:**
- [x] **Editar palabras de activación** como chips (añadir/borrar sin tocar JSON).
- [x] **Sliders de umbrales de micrófono** (speech_rms, silence_rms, silence_seconds).
- [x] **Prompt personalizable** (persona extra en el system prompt).
- [x] Hot-update: nivel de permisos, prompt custom, trigger words y umbrales se
      aplican SIN reiniciar el núcleo (whisper/piper/vault siguen requiriéndolo).

**Herramientas:**
- [x] **Botón "Probar voz"** (dice el texto por Piper/sistema sin cambiar nada).
- [x] **Benchmark de modelos Whisper** (carga tiny/base/small/medium y mide load+inference).
- [x] **Guía interactiva CUDA**: aparece sola si NVIDIA detectada pero cuda_ready=false,
      con el comando pip exacto y botón "Copiar".
- [x] **Exportar historial** JSON / CSV.

**Experiencia:**
- [x] **Modo claro / oscuro** con toggle (localStorage persiste).
- [x] **Notificaciones del sistema** al terminar tareas >15 s (Web Notifications API).

**Integraciones:**
- [x] **Pestaña MCPs**: guía de activación (Gmail/Calendar/Drive/Slack/HubSpot/monday).
      Jarvis hereda cualquier MCP configurado en Claude Code.
- [x] **Pestaña Ayuda**: ejemplos por categoría (vault/sistema/web/charla), atajos.

**Cerebro local (opcional):**
- [x] **`brain_ollama.py`**: habla con Ollama vía HTTP (`/api/generate`).
- [x] **Selector de proveedor** en el dashboard: Claude Pro ↔ Ollama local.
- [x] **Modelo recomendado**: Qwen 2.5 Coder 7B (4.7 GB, cabe entero en la RTX 2070 SUPER).
- [x] Autodetección: lista los modelos instalados en Ollama, avisa si no está corriendo.
- [x] Cambio en caliente de proveedor (no requiere reiniciar).

**Arquitectura:**
- Nuevos módulos core: `vault_graph.py`, `resources.py`, `brain_ollama.py`.
- `brain.py` ahora soporta `provider: "claude" | "ollama"` y parsea el stream-json
  del CLI de Claude Code para extraer archivos tocados y comandos Bash ejecutados.
- `logger.py` extendido con `export(format)` → JSON/CSV.
- `server.py` expone endpoints nuevos: `get_vault_graph`, `get_resources`,
  `get_commands`, `get_files_history`, `get_transparency`, `get_providers`,
  `set_provider`, `test_tts`, `benchmark_whisper`, `export_history`.
- D3.js v7 incluido localmente en `widget/dashboard/lib/d3.v7.min.js` (273 KB).

> **Para probar Ollama (opcional):**
> 1. Instalar desde https://ollama.com (gratis).
> 2. `ollama pull qwen2.5-coder:7b` (descarga ~4.7 GB una vez).
> 3. En Dashboard → Configuración → Cerebro → Proveedor: Ollama local.

### Fase 8 — Sonidos, wake word endurecido y pulido UX 🟢 CONSTRUIDA (en prueba)
> Meta: que el widget tenga sonidos editables desde el dashboard, que el oído solo
> reaccione al wake word real (no al respirar), y que el sonido de inicio funcione
> al abrir la app.

**Sonidos del widget (archivos reales en `widget/renderer/audio/`):**
- [x] 4 slots editables: `inicio` (al abrir), `escuchar` (al grabar), `pensando` (loop
      mientras procesa), `termino` (al terminar de hablar).
- [x] `widget/renderer/sounds.js` reescrito: usa `Audio()` real, master+slot volumes,
      hot-reload tras upload/restore, `previewSlot` sin loop y auto-stop 3 s.
- [x] Pestaña **🔊 Sonidos** en el dashboard con: volumen general, volumen por slot,
      botones ▶ Probar / ⏹ Detener / 📁 Reemplazar / ↺ Restaurar, drag & drop del
      archivo sobre la fila, botón global **⏹ Parar todo**.
- [x] Backup automático de los originales en `audio/_originals/` (para Restaurar) y
      del reemplazado anterior en `audio/_backup/`.
- [x] Formatos aceptados: `.mp3`, `.wav`, `.ogg`, `.m4a` (máx 2 MB).
- [x] Config persistente en `config.json` → `ui.sounds.{enabled, master_volume, slots{...}}`.
- [x] Sincronización bidireccional: botón 🔊/🔇 del widget ↔ switch del dashboard.
- [x] **Autoplay desbloqueado** en Electron (`autoplay-policy: no-user-gesture-required`
      en `widget/main.js`) para que el sonido de inicio suene sin esperar al primer click.

**Wake word endurecido (menos falsos positivos):**
- [x] Regex en [core/ears.py](core/ears.py) endurecido con `\b…\b`: ya NO dispara con
      "hervir", "hierbas", "yerbas", "jerez", "hirvieron". SÍ dispara con "oye jarvis",
      "hey jarvis", "jarvis", "yervis", "harvis", "gervis", "jarbis", "hervis".
- [x] **Timeout del modo "armado"** tras "¿Sí? Te escucho." (default 6 s, configurable).
      Si no completas la frase en ese margen, vuelve a exigir el wake word.
- [x] **Modo estricto** (`ears.strict_wake` + switch en el dashboard): cada frase
      requiere el wake word. Sin modo armado. Cero disparos accidentales.
- [x] Separación de estados UI: `recording` y `transcribing` **ya no** disparan la
      burbuja de "pensando…" ni el sonido de pensando. Solo lo hace `thinking`
      (cerebro realmente corriendo). Esto evita que el chat "piense" al respirar.
- [x] Hot-reload: `strict_wake` y `armed_timeout` se aplican sin reiniciar.

**Backend:**
- [x] `core/server.py` extendido con endpoints: `get_sounds`, `set_sound_config`,
      `upload_sound` (base64, con validación de extensión/tamaño), `restore_sound`,
      `play_sound`, `stop_sound`. Broadcast `sounds_updated` al conectar.
- [x] `core/ears.py`: nuevo regex `TRIGGER_RE`, variables `_armed_until`,
      `strict_wake`, `armed_timeout`. `update_setting` acepta las nuevas claves.

---

## 6. ¿Dónde nos quedamos? (bitácora)

| Fecha | Avance | Siguiente paso |
|---|---|---|
| 2026-10-29 | Hardware revisado, stack decidido, `PLAN.md` y `GUIA-DE-USO.md` creados. | Confirmar detalles de Fase 1 y empezar a construir el esqueleto. |
| 2026-10-29 | Decisiones confirmadas: Electron, "Hey Jarvis" (modificable), multiplataforma Win+Mac. | Resolver Apple Silicon/Intel y arrancar Fase 1. |
| 2026-10-29 | Mac = M1. **Fase 1 construida y funcionando**: Python 3.12 + venv, Claude CLI global (cerebro, probado con Pro), widget Electron flotante, WebSocket, voz del sistema. Circuito texto→cerebro→voz OK. | Integrar **Piper (voz latina es_MX)**; luego Fase 2 (oído). |
| 2026-10-29 | **Piper integrado** (voz es_MX-claude-high, mexicana). Modelo en `voices/`, se carga una vez al iniciar. **Fase 1 COMPLETA.** Aclaradas dudas: vault=carpeta de .md; back/front en monorepo por carpetas; dashboard = Fase 6 opcional. | Arrancar **Fase 2 (oído)**: faster-whisper + openWakeWord ("Hey Jarvis"). |
| 2026-10-29 | **Fase 2 construida**: `core/ears.py` (openWakeWord "hey_jarvis" onnx + faster-whisper small en CPU + sounddevice). Mic=PD100X. Integrado al server con pausa durante TTS. Widget muestra estados de voz. Falta que el usuario pruebe hablando. | Validar con voz; opcional GPU; luego Fase 3 (Obsidian). |
| 2026-10-30 | **Fase 2 COMPLETA y probada por voz.** Se reemplazó openWakeWord por Whisper+patrón (soporta español "Oye Jarvis"). Resueltos: mic por nombre, remuestreo 48→16k por frase, WASAPI exclusivo (ignora Voice Clarity), apertura en hilo principal + callback. Creado `MIGRACION.md`. Latencia ~4-5s (normal: whisper CPU + arranque de Claude + Piper). | **Fase 3 (Obsidian)**. Opcionales: acelerar (GPU/modelo menor/cerebro caliente), wake-word real (Porcupine). |
| 2026-10-30 | Botón 🎤 en el widget para apagar/prender el oído. Acceso directo "Jarvis.lnk" en el escritorio (lanzador cierra el núcleo al cerrar el widget). Dashboard documentado para ver/cambiar modelos y latencia (Fase 6). | — |
| 2026-10-30 | **Fase 3 COMPLETA.** `brain.py` recibe el vault via `--add-dir` + `--allowed-tools Read,Write,Edit,Grep,Glob`. System prompt le explica que es su memoria. Vault de prueba poblado (Proyectos/Ideas/Aprendizaje/Diario). Probado: lee estructura, resume contenido en lenguaje natural, edita el diario inteligentemente (en la sección correcta, no al final). Latencia 6-9s por consulta. | **Fase 4 (acciones)**: abrir apps/proyectos, web, control del sistema. |
| 2026-10-30 | **Fase 4 construida (nivel equilibrado).** `brain.py` tiene 4 niveles de permisos (limitado/equilibrado/amplio/dev); el system prompt describe explícitamente qué puede/no puede hacer en Windows. Herramientas: + Bash + WebSearch + WebFetch. Creado **ALCANCES-FASE-4.md** con la política completa y cómo escalar. Nota: no pude probar la Fase 4 de forma automatizada (mi sandbox bloquea Claude anidado + Bash); el usuario la prueba desde el widget. | Validación del usuario; luego Fase 5 (pulido/optimización) o Fase 6 (dashboard). |
| 2026-10-30 | **Fase 4 COMPLETA.** Usuario confirmó pruebas OK (abrir apps, consultar sistema, propone comandos bloqueados sin ejecutar). | **Fase 6 (Dashboard)**. |
| 2026-10-30 | **Fase 6 construida.** Nueva ventana Electron (`widget/dashboard/`) abierta con botón 📊 del widget. 4 pestañas: Estado, Sistema+recomendaciones, Historial, Configuración. Backend: `core/logger.py` (jsonl), `core/system_info.py` (psutil + nvidia-smi + ctranslate2 CUDA check + tiers de Whisper + recomendaciones + avisos). Server extendido con API request/response por reply_id. Todo validado por imports y pruebas unitarias. Pendiente: usuario abre el dashboard y confirma. | Validación del usuario; luego Fase 5 (pulido) o cierre. |
| 2026-10-31 | Usuario pidió ideas de qué más agregar al dashboard. Lista completa guardada abajo (sección 6.1). Mañana se eligen las features a construir. | Elegir del menú de 6.1 e implementar. |
| 2026-10-31 | **Fase 8 construida (Sonidos editables + wake word endurecido + autoplay + pulido UX).** 1) Pestaña 🔊 Sonidos en el dashboard: 4 slots editables (inicio/escuchar/pensando/termino) con volumen general + por slot, botones Probar/Detener/Reemplazar/Restaurar, drag & drop sobre fila, Parar todo global. 2) `sounds.js` reescrito con `Audio()` reales, master+slot volumes, `previewSlot` sin loop con auto-stop a 3 s. 3) Backup automático en `audio/_originals/` + `audio/_backup/`. 4) `config.json` → `ui.sounds` persiste todo. 5) Autoplay desbloqueado en Electron (`autoplay-policy` en `widget/main.js`) → inicio.mp3 suena al abrir sin requerir gesto. 6) Wake word endurecido: regex con `\b…\b` que descarta "hervir/hierbas/yerbas/jerez"; timeout de 6 s al modo armado; **switch "Requerir Oye Jarvis siempre"** en el dashboard (modo estricto, sin armado). 7) Separación UI: `transcribing` ya no muestra burbuja de pensando ni dispara el zumbido — solo `thinking` real lo hace, así el chat no "piensa" al respirar. 8) Endpoints nuevos en server: get_sounds/set_sound_config/upload_sound/restore_sound/play_sound/stop_sound, broadcast `sounds_updated`. Validado: `py_compile` OK, syntax JS OK, regex probado con 13 ejemplos (10 match, 3 skip esperados). | Pruebas del usuario (ya en curso); pulir cualquier detalle que salte. |
| 2026-10-31 | **Fase 7 construida (Dashboard ampliado + modelo local).** Features entregadas: 1) Grafo del vault en D3 force-directed (nodo central Jarvis, pulso en notas recién tocadas, colores por carpeta, zoom/pan/hover-resalta-vecinos). 2) Panel de comandos Fase 4 + panel de archivos del vault tocados (`brain.py` parsea el stream-json del CLI de Claude y guarda `commands_history`/`files_history`/`vault_touches`). 3) Modo transparencia (prompt system+user + respuesta cruda + tokens). 4) Costo estimado Pro (contador de tokens, precio Sonnet). 5) Monitor en vivo CPU/RAM (`core/resources.py`, polling 2s). 6) Modo claro/oscuro (toggle con localStorage, variables CSS por `data-theme`). 7) Exportar historial JSON/CSV (`logger.export`). 8) Notificaciones Web Notifications al terminar tareas >15s. 9) Editar palabras de activación como chips desde la UI + sliders de umbrales de micro (hot-update sin reiniciar vía `ears.update_trigger_words`/`update_setting`). 10) Prompt personalizable (`brain.custom_persona` se concatena al system prompt). 11) Botón "Probar voz" (`test_tts`). 12) Guía interactiva CUDA (aparece sola si NVIDIA + no cuda_ready). 13) Benchmark Whisper (carga tiny/base/small/medium y mide load+inference). 14) Pestaña MCPs (guía de activación de Gmail/Calendar/Drive). 15) Pestaña Ayuda con ejemplos. 16) **Ollama como respaldo + selector**: `brain_ollama.py` habla con `http://127.0.0.1:11434/api/generate`; dashboard muestra modelos instalados; set_provider cambia entre Claude Pro ↔ Qwen 2.5 Coder 7B al vuelo (modelo recomendado para RTX 2070 SUPER 8 GB). D3 descargado local (`widget/dashboard/lib/d3.v7.min.js`). Validado: todos los módulos compilan (`py_compile`), vault_graph genera 6 nodos del vault de prueba, resources.snapshot responde. | Pruebas del usuario: abrir dashboard, verificar grafo, instalar Ollama + `ollama pull qwen2.5-coder:7b` y probar selector. Luego Fase 5 (pulido) o cierre. |

---

## 6.1 Ideas pendientes para el Dashboard (brainstorm 2026-10-31)

> Menú de posibles mejoras al dashboard. El usuario elige mañana cuáles construir.
> Esfuerzo marcado con 🌶️ (poco), 🌶️🌶️ (medio), 🌶️🌶️🌶️ (alto).

### 📈 Analíticas y uso
- 🌶️ Gráfica de latencia (últimos 20 turnos)
- 🌶️ Top preguntas frecuentes de la semana / carpetas del vault más consultadas
- 🌶️🌶️ Resumen diario (turnos del día, latencia promedio, acciones ejecutadas)
- 🌶️🌶️ Costo estimado del plan Pro (contar tokens aproximados por turno)

### 👁️ Visibilidad / auditoría
- 🌶️ Panel de comandos ejecutados por Fase 4 (qué, cuándo, resultado)
- 🌶️ Panel de archivos del vault tocados por turno (lectura/escritura)
- 🌶️🌶️ "Modo transparencia": ver el prompt exacto enviado al cerebro y su respuesta cruda

### ⚙️ Más configuración
- 🌶️ Editar palabras de activación desde la UI (añadir/quitar sin tocar JSON)
- 🌶️ Sliders en vivo para umbrales del micrófono (speech_rms, silence_seconds)
- 🌶️🌶️ Prompt personalizable (tono, idioma, formato) desde la UI
- 🌶️🌶️ Perfiles ("Trabajo" / "Casa" / "Streaming") con configs guardadas

### 🎙️ Herramientas de voz
- 🌶️🌶️ Botón "Probar voz": escribe texto y lo dice en Piper
- 🌶️🌶️ Selector de voz Piper + botón "Descargar más voces"
- 🌶️🌶️ Calibrar micrófono: graba 3s, muestra la onda y auto-ajusta umbrales

### 📚 Obsidian (Fase 3)
- 🌶️ Explorador del vault en el dashboard (ver carpetas, abrir notas)
- 🌶️🌶️ Crear/editar notas desde el dashboard (no sólo por voz)
- 🌶️🌶️🌶️ Búsqueda semántica RAG (lo que estaba como Fase 3b opcional)

### 🖥️ Sistema
- 🌶️ Monitor en tiempo real de CPU/RAM que consume Jarvis
- 🌶️🌶️ Guía interactiva: si falta cublas, botón "Instalar CUDA para Whisper"
- 🌶️🌶️ Benchmark: mide la latencia de cada modelo de Whisper en esta PC

### 🔗 Integraciones externas
- 🌶️🌶️ Pestaña de MCPs: habilitar Gmail/Calendar/Drive para que Jarvis los use
- 🌶️🌶️🌶️ Ollama como respaldo cuando se agote el cupo Pro, con selector en la UI

### 🎨 Experiencia del dashboard
- 🌶️ Modo claro / oscuro
- 🌶️ Exportar historial (.csv / .json)
- 🌶️ Notificaciones del sistema al terminar una tarea larga
- 🌶️🌶️ Pestaña "Ayuda" con ejemplos, tips, atajos

### ⭐ Paquete recomendado para empezar
Si no sabe qué elegir, estos 5 dan mucho valor con poco esfuerzo:
1. 🌶️ Explorador del vault
2. 🌶️ Panel de comandos ejecutados (auditar Fase 4)
3. 🌶️ Editar palabras de activación + sliders de micro
4. 🌶️🌶️ Botón "Probar voz"
5. 🌶️ Gráfica de latencia

---

## 7. Decisiones pendientes / notas
- [x] ~~Palabra de activación~~ → "Hey Jarvis" por default, modificable después.
- [x] ~~Electron o Tauri~~ → **Electron** (gratis).
- [x] ~~Multiplataforma~~ → Sí, Windows + Mac (capa de sistema desde Fase 1).
- [x] ~~¿Mac Apple Silicon o Intel?~~ → **Mac Mini M1 (Apple Silicon)**: corre todo excelente.
- [ ] ¿Sincronización entre equipos con Git o con Drive?
- [ ] Ruta real del vault de Obsidian (pendiente de sincronizar con Drive).
- [x] ~~Voz de Piper~~ → **es_MX-claude-high** (mexicana, calidad alta).
- [x] ~~Modelo local elegido~~ → **Qwen 2.5 Coder 7B** vía Ollama (RTX 2070 SUPER).
- [ ] **Instalar Ollama + descargar Qwen 2.5 Coder 7B** (para activar el cerebro local
      desde el dashboard). Pasos:
      1. Descargar e instalar desde https://ollama.com (Windows installer).
      2. En PowerShell: `ollama pull qwen2.5-coder:7b` (~4.7 GB).
      3. Verificar que corra: `ollama list`.
      4. En Dashboard → Configuración → Cerebro → Proveedor: Ollama local.
- [x] ~~**Aspecto visual 3D del widget flotante**~~ → **Shader WebGL (Three.js r128)** como fondo
      animado del widget. Base: ejemplo oficial "Monjori" de three.js (patrones orgánicos
      procedurales). Reacciona al estado de Jarvis con `JarvisBG.setState(state)`:
      cambia velocidad del tiempo, tinte (azul/cian/ámbar/rojo) e intensidad.
      Archivos: [widget/renderer/lib/three.min.js](widget/renderer/lib/three.min.js) (589 KB),
      [widget/renderer/shader-bg.js](widget/renderer/shader-bg.js), canvas en
      [widget/renderer/index.html](widget/renderer/index.html), capa `.widget-content` con
      backdrop-filter blur para legibilidad. Latencia de GPU despreciable (RTX 2070 SUPER).
