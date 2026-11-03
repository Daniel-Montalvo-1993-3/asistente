#!/usr/bin/env bash
# ============================================================================
#  JARVIS — setup para Mac (M1/M2/M3/Intel) y Linux
#  Deja la máquina lista para arrancar Jarvis por primera vez.
#
#  Uso:
#     chmod +x setup.sh && ./setup.sh
# ============================================================================

set -e
cd "$(dirname "$0")"

CYAN='\033[0;36m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'; RED='\033[0;31m'; NC='\033[0m'
step() { echo -e "\n${CYAN}[Jarvis] $1${NC}"; }
ok()   { echo -e "  ${GREEN}OK${NC}  $1"; }
warn() { echo -e "  ${YELLOW}!!${NC}  $1"; }
err()  { echo -e "  ${RED}XX${NC}  $1"; }

# ---- 1. Python ----
step "Verificando Python..."
PY_CMD=""
for cmd in python3.12 python3.11 python3; do
  if command -v $cmd >/dev/null 2>&1; then
    v=$($cmd -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
    maj=$(echo $v | cut -d. -f1)
    min=$(echo $v | cut -d. -f2)
    if [ "$maj" = "3" ] && [ "$min" -ge 10 ]; then
      PY_CMD=$cmd; break
    fi
  fi
done
if [ -z "$PY_CMD" ]; then
  err "No encontré Python 3.10+."
  echo "  Mac:   brew install python@3.12"
  echo "  Linux: usa el gestor de paquetes de tu distro"
  exit 1
fi
ok "Python detectado: $PY_CMD ($($PY_CMD --version))"

# ---- 2. Node ----
step "Verificando Node.js..."
if ! command -v node >/dev/null 2>&1; then
  err "No encontré Node.js."
  echo "  Mac:   brew install node"
  echo "  Linux: usa tu gestor de paquetes o nvm"
  exit 1
fi
NODE_V=$(node --version | sed 's/v//')
NODE_MAJ=$(echo $NODE_V | cut -d. -f1)
if [ "$NODE_MAJ" -lt 18 ]; then
  err "Node $NODE_V es < 18. Actualiza con: brew upgrade node (Mac) o nvm."
  exit 1
fi
ok "Node $NODE_V"

# ---- 3. venv ----
step "Preparando entorno Python (.venv)..."
if [ ! -d ".venv" ]; then
  $PY_CMD -m venv .venv
  ok "venv creado"
else
  ok "venv ya existe"
fi
PIP=".venv/bin/pip"
PY=".venv/bin/python"
if [ ! -x "$PIP" ]; then
  err "El venv no se creó bien. Borra .venv y vuelve a correr este script."
  exit 1
fi

step "Instalando dependencias Python..."
$PIP install --upgrade pip >/dev/null
$PIP install -r requirements.txt
ok "Dependencias Python listas"

# ---- 4. widget (npm) ----
step "Instalando dependencias del widget (npm)..."
pushd widget >/dev/null
npm install
popd >/dev/null
ok "Widget listo"

# ---- 5. config.json ----
step "Preparando config/config.json..."
if [ ! -f "config/config.json" ]; then
  cp config/config.sample.json config/config.json
  ok "config.json creado desde la plantilla"
  warn "Edita config/config.json para ajustar: ruta de vault, trigger_words, mic_device, voz Piper."
else
  ok "config.json ya existe (no se sobrescribe)"
fi

# ---- 6. Carpetas ----
step "Creando carpetas que falten..."
mkdir -p logs vault-prueba/{Proyectos,Ideas,Aprendizaje,Diario}
ok "Carpetas listas"

# ---- 7. Ajustes específicos por SO ----
OS_NAME=$(uname -s)
if [ "$OS_NAME" = "Darwin" ]; then
  step "Ajustes para macOS..."
  # Deshabilitar modo WASAPI exclusivo (es Windows-only)
  if command -v python3 >/dev/null 2>&1; then
    python3 - <<'PY'
import json, pathlib
p = pathlib.Path("config/config.json")
if p.exists():
    cfg = json.loads(p.read_text(encoding="utf-8"))
    cfg.setdefault("ears", {})["wasapi_exclusive"] = False
    if cfg.get("tts", {}).get("backend") == "piper":
        print("  (Tip: en Mac puedes usar tts.backend='system' con la voz Paulina)")
    p.write_text(json.dumps(cfg, indent=2, ensure_ascii=False), encoding="utf-8")
    print("  config.json: wasapi_exclusive = false")
PY
  fi
  warn "Mac te pedirá permiso de MICRÓFONO la primera vez. Acepta en Preferencias del Sistema."
fi

# ---- 8. Claude Code CLI ----
step "Verificando Claude Code CLI..."
if command -v claude >/dev/null 2>&1; then
  ok "Claude CLI: $(claude --version 2>&1 | head -1)"
  warn "Si no has iniciado sesión, ejecuta en otra terminal:  claude login"
else
  warn "No encontré 'claude' en el PATH."
  echo "    Instala desde: https://docs.anthropic.com/claude-code"
  echo "    Luego ejecuta:  claude login"
fi

# ---- 9. Siguientes pasos ----
echo ""
echo -e "${CYAN}========================================${NC}"
echo    "  Jarvis listo para arrancar."
echo -e "${CYAN}========================================${NC}"
echo ""
echo "Para iniciar:"
if [ "$OS_NAME" = "Darwin" ] || [ "$OS_NAME" = "Linux" ]; then
  echo "  chmod +x iniciar-mac.sh && ./iniciar-mac.sh"
else
  echo "  ./iniciar-mac.sh"
fi
echo ""
echo "Antes de usarlo, abre config/config.json y revisa:"
echo "  - obsidian.vault_path    -> apunta a tu vault real cuando lo tengas"
echo "  - ears.mic_device         -> nombre de tu micrófono (null = autodetección)"
echo "  - brain.permission_level  -> 'limitado' por default (sube cuando confíes)"
echo ""
echo "Opcional:"
echo "  - Cerebro local: instala Ollama (https://ollama.com) y ejecuta:"
echo "      ollama pull qwen2.5-coder:7b"
echo ""
