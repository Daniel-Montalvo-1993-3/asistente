# 🤖 Alcances de Jarvis — Qué puede, qué no, y cómo compartirlo

> Documento general del proyecto. Qué sabe hacer Jarvis hoy, dónde están los límites,
> qué permisos existen, y qué hace falta para probarlo en otra máquina (Mac u otro
> Windows) o compartirlo con otra persona sin riesgos.
>
> **Nombre histórico del archivo:** `ALCANCES-FASE-4.md` (nació en Fase 4). Hoy es
> el documento maestro de alcances del proyecto completo.

- **Nivel actual de permisos:** Equilibrado 🟡
- **Última actualización:** 2026-10-31

---

## 1. Qué sabe hacer Jarvis hoy

### 🎙️ Voz y presencia
- **Escuchar en continuo** sin grabar nada hasta oír la palabra de activación
  ("Oye Jarvis" o variantes: *harvis, yervis, jervis, jarbis*…).
- **Modo estricto opcional** (en el dashboard): cada frase requiere el wake word,
  cero disparos accidentales.
- **Hablar** con voz latina (Piper es_MX-claude-high) o voz del sistema.
- **Widget flotante** siempre visible con fondo animado (shader WebGL),
  sonidos editables por el usuario (inicio / escuchar / pensando / terminó),
  botón de silencio y pausa del micrófono.
- **Dashboard** separado con 10 pestañas: Estado, Grafo del vault, Historial,
  Comandos y archivos, Transparencia, Sistema, Configuración, 🔊 Sonidos, MCPs, Ayuda.

### 🧠 Cerebro intercambiable
- **Claude Pro** (default): usa tu login de Claude Code, hereda sus MCPs, puede
  acceder al vault y ejecutar comandos según el nivel de permisos.
- **Ollama local** (opcional, gratis, offline): modelo recomendado Qwen 2.5 Coder
  7B. Solo conversa — no toca vault ni ejecuta.
- Cambio **en caliente** desde el dashboard.

### 📚 Vault de Obsidian (memoria)
- Lee y busca tus notas Markdown.
- Crea, edita y amplía notas con lenguaje natural ("añade al diario de hoy que…",
  "crea una nota en Proyectos llamada…").
- Grafo visual con D3 (nodo central Jarvis, pulso en notas recién tocadas,
  colores por carpeta).

### 🖥️ Apps y archivos (nivel actual: Equilibrado)
- Abrir aplicaciones por nombre (*"abre VS Code"*, *"abre Spotify"*).
- Abrir archivos, carpetas y URLs.
- Listar, leer y buscar archivos por nombre o contenido.
- Decir qué apps/procesos están abiertos; consultar fecha, hora, batería, disco.
- Capturar pantalla, controlar volumen y brillo, portapapeles.

### 🌐 Web
- Buscar en Google/Bing y leer páginas públicas para resumirlas.
- Consultar APIs públicas (clima, divisas, hora en otra ciudad).

### 🔗 Integraciones (MCPs)
- Hereda cualquier conector que tengas activo en Claude Code: Gmail, Google
  Calendar/Drive, Slack, HubSpot, monday.com, etc.
- La autorización OAuth la haces en `claude.ai → Connectors` (Jarvis no te la pide).

### 📊 Visibilidad y auditoría
- Historial persistente de turnos en `logs/jarvis.jsonl`.
- Panel de **comandos ejecutados** por Jarvis en el turno actual.
- Panel de **archivos del vault tocados** por turno.
- **Modo transparencia**: ver prompt system+user y respuesta cruda del último turno.
- **Monitor CPU/RAM** del proceso Jarvis + sistema.
- **Costo estimado** del plan Pro por sesión (tokens × precios públicos de Sonnet).
- **Exportar historial** JSON / CSV.

---

## 2. Qué NO puede hacer (en nivel Equilibrado)

Bloqueado por diseño para evitar daños accidentales:

- **Borrar** archivos/carpetas (ni `del`, `rm`, `Remove-Item`).
- **Mover de forma destructiva** o sobre-escribir sin aviso.
- **Instalar/desinstalar** programas (`winget`, `choco`, `msiexec`, `pip install -g`).
- **Modificar el registro de Windows** (`reg add/delete`).
- **Cambiar configuración del sistema** (zona horaria, red, usuarios, políticas).
- **Formatear discos**, apagar/reiniciar el equipo.
- **Ejecutar scripts descargados** sin que tú lo pidas.
- **Enviar correos, mensajes o publicar** en tu nombre.
- **Hacer compras** o cualquier cosa que cueste dinero.
- **Cerrar sesión / cambiar de usuario**.
- **Acceder a cuentas** (bancos, correo, redes) con tus credenciales.

### Qué pasa si le pides algo bloqueado
En vez de ejecutar, **te lo propone en texto** y tú decides:

> Tú: *"Oye Jarvis, desinstala Spotify"*
> Jarvis: *"Eso implicaría quitar un programa, lo cual no está en mis permisos.
> El comando sería: `winget uninstall Spotify`. ¿Lo copio al portapapeles?"*

---

## 3. Niveles de permisos y cómo cambiarlos

Los permisos viven en el **system prompt** y en las **herramientas permitidas** de
Claude Code (controlado desde [core/brain.py](core/brain.py) y
[config/config.json](config/config.json)).

| Nivel | Herramientas | Reglas | Para quién |
|---|---|---|---|
| **Limitado** | Read, Write, Grep, Glob (solo vault) | Solo abrir apps/URLs de una lista | Máxima seguridad |
| **Equilibrado** 🟡 (actual) | + Bash/PowerShell con lista negra | Lee, abre, controles seguros; no destructivo | Uso diario |
| **Amplio** 🔓 | Bash/PowerShell sin restricción | Todo lo que Claude pueda | Cuando confíes |
| **Dev** 🧪 | Equilibrado + instalar/git/entornos | Igual + puede programar | Para codear con él |

Cambio de nivel: desde el dashboard (Configuración → Nivel de permisos) **o** editando
`config/config.json`:

```json
"brain": {
  "permission_level": "equilibrado",
  "extra_allowed": ["winget install", "git push"],
  "extra_blocked": []
}
```

### Consejos antes de abrir más permisos
- Primero prueba con tareas no destructivas.
- Para operaciones riesgosas (borrar, mover, instalar), mejor pídele el comando y
  cópialo tú.
- Si trabajas con repos importantes, revisa qué hace *antes* de permitirle `git push`.
- El historial de comandos queda en los logs — puedes auditarlo en el dashboard.

---

## 4. Resumen rápido para el refri 🧊

> Hoy Jarvis puede: **oír cuando dices "Oye Jarvis", abrir, leer, consultar,
> buscar, controlar lo seguro, hablar con tus notas, recordar lo que le dices**.
>
> Hoy Jarvis NO puede: **borrar, instalar, cambiar config del sistema, mandar
> mensajes/correos ni gastar dinero**. Si le pides algo bloqueado, te lo propone
> en texto en vez de hacerlo.

---

## 5. 🍎 Probarlo en Mac — qué falta hacer

El proyecto se diseñó multiplataforma desde el inicio, pero **nunca se ha ejecutado
en Mac**. Esto es lo que falta para hacerlo correr en una Mac M1/M2/M3:

### 5.1 Lo que ya es portable sin cambios
- ✅ Python 3.12 + venv — igual.
- ✅ `websockets`, `faster-whisper`, `piper-tts`, `sounddevice`, `psutil`,
  `numpy`, `scipy` — todos tienen build de ARM64/Apple Silicon.
- ✅ Electron — multiplataforma oficial.
- ✅ El vault de Obsidian es una carpeta de `.md` — igual.
- ✅ Claude Code CLI tiene build de macOS.
- ✅ El protocolo WebSocket interno (ws://127.0.0.1:8765) no cambia.
- ✅ Dashboard, sonidos, shader, UI — todo HTML/CSS/JS sin dependencias de SO.

### 5.2 Lo que necesita trabajo (en orden)

**🔧 1. Captura de micrófono (prioridad alta)**
- En Windows uso **WASAPI exclusivo** (ignora el "Voice Clarity" de Windows).
- En Mac el camino es **Core Audio** vía `sounddevice`, que es nativo. Debería
  funcionar con el modo "compartido" (fallback) ya implementado, pero
  **hay que probarlo**. Posible ajuste: deshabilitar `wasapi_exclusive` en config
  cuando `platform.system() == 'Darwin'`.
- Mac te pedirá **permiso de micrófono** la primera vez (TCC).

**🔧 2. Aceleración de Whisper**
- En Windows uso CUDA (RTX 2070 SUPER).
- En Mac se usa **Metal/Core ML** o **CPU**. `faster-whisper` lo decide con
  `device="auto"`. Ya está así en el código, no debería requerir cambios.

**🔧 3. Voz Piper**
- El binario de Piper tiene build para Darwin ARM64. Hay que **descargar el
  binario correcto** y los `.onnx`/`.json` de la voz es_MX en la ruta
  `voices/`. El código ya los busca ahí.
- Alternativa inmediata: usar la **voz del sistema** (`tts.backend: "system"`)
  → en Mac usa `say` con la voz "Paulina" (ya configurada en `config.json`).

**🔧 4. Fase 4 (acciones del sistema)**
- El system prompt menciona Windows. Hay que **detectar el SO** en
  [core/brain.py](core/brain.py) y adaptar los ejemplos:
  - `start` → `open`
  - `powershell` → `osascript`
  - Rutas con `/` en vez de `\`
- Hay un `brain.os_label` ya expuesto en `current_models()` — basta extenderlo
  para que el system prompt lo use.

**🔧 5. Lanzador**
- `start-jarvis.ps1` es PowerShell → crear `start-jarvis.sh` o un
  `.app` de macOS. Tareas simples: activar venv, lanzar `python core/server.py`,
  lanzar `npm start` en `widget/`, matar ambos al cerrar.

**🔧 6. Autoarranque / acceso directo**
- Windows: `.lnk` en el escritorio (ya existe).
- Mac: `~/Library/LaunchAgents/com.jarvis.plist` o un `.app` arrastrable al Dock.

**🔧 7. Permisos de macOS**
- La primera vez va a pedir: micrófono, automatización (si usas `osascript`),
  acceso completo al disco (si lees fuera del vault). Son prompts del sistema,
  solo hay que aceptar.
- Si Jarvis "controla" apps (p. ej. abrir Spotify y darle play), Mac te pedirá
  autorizar "Accesibilidad".

### 5.3 Checklist de porteo (orden sugerido)
1. [ ] Clonar/copiar proyecto a la Mac.
2. [ ] Crear venv: `python3.12 -m venv .venv && source .venv/bin/activate`.
3. [ ] `pip install -r requirements.txt` (o equivalente).
4. [ ] Instalar Claude Code CLI de Mac + `claude login`.
5. [ ] En `widget/`: `npm install`.
6. [ ] Ajustar `config/config.json`: `wasapi_exclusive: false`,
       `mic_device: null` (que autodetecte), `piper_dir` si usas Piper.
7. [ ] Lanzar y aceptar permisos del sistema.
8. [ ] Probar: texto → cerebro → voz. Luego: voz → cerebro → voz.
9. [ ] Adaptar system prompt para macOS en `brain.py`.
10. [ ] (Opcional) Instalar Ollama para Mac + modelo local.

### 5.4 Estimación de tiempo
- Si todo funciona a la primera: **1-2 horas**.
- Si aparecen problemas típicos de audio en Mac: **medio día**.
- Adaptar system prompt a macOS cuidadosamente: **1-2 horas adicionales**.

---

## 6. 📤 Si quieres compartir el proyecto con otra persona

### 6.1 Qué entregarles (mínimo viable)
- Carpeta del proyecto **sin estas cosas**:
  - `logs/` (contiene todas tus conversaciones).
  - `vault-prueba/` (si tiene datos reales).
  - `.venv/` (que creen el suyo).
  - `widget/node_modules/` (que corran `npm install`).
  - `voices/` si pesa mucho (link al descargador oficial de Piper).
- `README.md` o `GUIA-DE-USO.md` con pasos de instalación.
- `requirements.txt` actualizado.
- `config/config.sample.json` con placeholders, en vez de tu `config.json` real.

### 6.2 Qué deben hacer ellos
1. Instalar Python 3.12, Node.js 18+ y Git.
2. Instalar Claude Code CLI y hacer `claude login` **con su propio Pro**
   (no les sirve el tuyo; el login es por persona).
3. Crear su `config.json` desde la plantilla.
4. Si quieren voz Piper, descargar los binarios + voz.
5. Si quieren cerebro local, instalar Ollama + `ollama pull <modelo>`.

### 6.3 Lo que NO podrán usar hasta configurar lo suyo
- MCPs: cada quien autoriza sus propios Gmail/Drive/Slack (OAuth personal).
- Vault: cada quien apunta al suyo.
- Historial: empieza vacío.

---

## 7. ⚠️ Advertencias de seguridad antes de compartir

Antes de empaquetar y enviar a alguien, **revisa esto** — son cosas que podrían
exponer tu información o abrir puertas que no quieres:

### 🚨 Nivel crítico — NUNCA compartir sin limpiar

1. **`logs/jarvis.jsonl`** — contiene **todo** lo que le has dicho a Jarvis y sus
   respuestas (incluidos nombres, correos, código, posible info personal). Hay un
   botón "Borrar historial" en el dashboard, úsalo antes de empaquetar.

2. **`config/config.json`** — puede contener:
   - Tu nombre y preferencias de la IA.
   - Rutas absolutas que revelan tu nombre de usuario de Windows.
   - La ruta real de tu vault de Obsidian (sensible si lo usas de diario).
   - La lista de MCPs activos.
   - **Nunca** apunta a credenciales directas, pero sí revela qué servicios usas.
   - Comparte una `config.sample.json` genérica, no tu config real.

3. **`vault-prueba/` o la ruta de tu vault real** — ni se te ocurra incluir el vault
   con tus notas. Es tu memoria personal.

4. **`voices/`** — las voces de Piper son grandes y pueden tener licencia específica.
   Link al descargador oficial en vez de redistribuirlas.

5. **Autenticación de Claude Code** — vive fuera del proyecto (en `~/.claude/` del
   usuario). **No se comparte** aunque mandes la carpeta, bien. Pero recuerda que
   cualquier otra persona necesita su **propio** Claude Pro para que funcione el
   cerebro Claude (y pagará con su cupo, no con el tuyo).

6. **Capacidad de ejecutar comandos** — Jarvis en nivel Equilibrado puede abrir
   apps, controlar el sistema, leer archivos. Si lo compartes con alguien menos
   técnico, **bájalo a Limitado** antes y explícale cómo subirlo si lo necesita.
   El nivel **Amplio** y **Dev** pueden instalar/borrar — no entregues con esos
   niveles activados.

### ⚠️ Nivel alto — revisar

7. **`core/brain.py`** — tiene el system prompt completo con el nombre del usuario
   (del config) y referencias a tu equipo. Revísalo si lo editaste.

8. **MCPs conectados** — los OAuth viven en `~/.claude/`, no en el proyecto. Pero
   si tu `config.json` lista integraciones, bórralas de la plantilla.

9. **`vault/*.md`** — si en algún momento Jarvis guardó notas en el vault con info
   personal (nombres, correos, fechas, planes), bórralas o revisa antes de compartir.

10. **Capturas de pantalla / grabaciones** — si Jarvis hizo capturas en algún momento
    (nivel Equilibrado puede), revisa que no estén en el proyecto.

### ⚠️ Nivel medio — buenas prácticas

11. **Trigger words personalizadas** — si añadiste palabras que son tu nombre real
    o alguna variación, revísalas antes de compartir el config.

12. **Prompt personalizado** (`brain.custom_persona`) — si pusiste información
    personal ahí (tu nombre, tu trabajo, cómo te gusta que te hable), bórralo.

13. **`.vscode/`, `.idea/`** — pueden contener configuraciones locales con rutas
    tuyas. Añádelos a `.gitignore` si no están.

14. **`node_modules/` y `__pycache__/`** — no son peligrosos pero pesan mucho.

15. **Sonidos personalizados** (`widget/renderer/audio/*.mp3`) — si subiste
    sonidos propios por el dashboard, decide si los compartes o si los restauras
    a los originales con el botón ↺ Restaurar.

### 🛡️ Checklist antes de empaquetar

```
[ ] Borrar logs/jarvis.jsonl
[ ] Crear config.sample.json sin datos personales
[ ] Vaciar o excluir vault-prueba/
[ ] Confirmar que widget/node_modules y .venv NO están incluidos
[ ] Revisar que brain.custom_persona esté vacío
[ ] Bajar permission_level a "limitado" o "equilibrado"
[ ] Verificar que no haya archivos .env, keys, tokens
[ ] Buscar en todo el repo: "daniel", "montalvo", "mmkgroup", correos
[ ] Restaurar sonidos originales si los personalizaste
[ ] Añadir README con pasos de instalación limpios
[ ] Confirmar que el .gitignore cubre .venv, node_modules, logs, voices
```

### 🧪 Grep rápido antes de enviar

Antes de hacer `zip` o `git push`, corre esto para detectar fugas:

```bash
# Buscar correos y nombres personales en el proyecto
grep -riE "@(gmail|outlook|mmk|hotmail)" --include="*.py" --include="*.js" --include="*.json" --include="*.md" .

# Buscar rutas de Windows con tu usuario
grep -ri "C:\\\\Users\\\\" --include="*.py" --include="*.js" --include="*.json" .

# Buscar tokens/keys olvidados
grep -riE "(api[_-]?key|secret|token|password)" --include="*.py" --include="*.js" --include="*.json" .
```

Si alguno devuelve resultados, revísalos uno por uno antes de compartir.

---

## 8. 🧯 Qué hacer si "algo falla"

- **El widget no abre:** mira la terminal donde lanzas Electron, debería imprimir
  el error. 95% de las veces es `node_modules` sin instalar.
- **No oye nada:** mira el micrófono en el dashboard (Sistema), verifica permisos
  del SO (micrófono) y que `mic_device` en config apunte al correcto.
- **El cerebro no responde:** `claude login` otra vez; verifica cupo de Pro.
- **Sonidos no suenan:** mira la pestaña 🔊 Sonidos del dashboard, confirma que
  el toggle "Activar sonidos" esté encendido y el volumen general > 0.
- **Jarvis "piensa" sin que digas nada:** activa modo estricto en Configuración →
  Oído → "Requerir Oye Jarvis siempre".

---

## 9. Resumen final

> Jarvis hoy es un asistente de voz **local y privado** para tu PC, con cerebro
> Claude Pro (o Ollama local), memoria en Obsidian, interfaz propia y permisos
> graduales. Diseñado para Windows + Mac, pero **solo probado en Windows** hasta hoy.
>
> Si lo quieres en Mac: 1-2 h de setup + ~2 h de ajustes al prompt del sistema.
>
> Si lo quieres compartir: **borra `logs/`, usa `config.sample.json`, no incluyas
> tu vault, deja permisos en Equilibrado o menor**, y revisa el checklist de arriba.
