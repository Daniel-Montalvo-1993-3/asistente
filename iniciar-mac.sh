#!/usr/bin/env bash
# ============================================================
#  Iniciar Jarvis en Mac (Apple Silicon / M1)
#  Uso:  chmod +x iniciar-mac.sh  &&  ./iniciar-mac.sh
# ============================================================
set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"

# Electron no debe correr en modo Node (por si se hereda esta variable).
unset ELECTRON_RUN_AS_NODE

# --- Entorno virtual + dependencias del núcleo ---
if [ ! -d "$ROOT/.venv" ]; then
  echo "Creando entorno de Python..."
  python3 -m venv "$ROOT/.venv"
fi
"$ROOT/.venv/bin/pip" install --quiet --upgrade pip
"$ROOT/.venv/bin/pip" install --quiet -r "$ROOT/core/requirements.txt"

# --- Dependencias del widget (Electron) ---
if [ ! -d "$ROOT/widget/node_modules" ]; then
  echo "Instalando Electron (solo la primera vez)..."
  (cd "$ROOT/widget" && npm install)
fi

# --- Arrancar el núcleo en segundo plano ---
echo "Iniciando núcleo de Jarvis..."
"$ROOT/.venv/bin/python" "$ROOT/core/server.py" &
CORE_PID=$!
sleep 2

# Al cerrar el widget, también cerramos el núcleo.
trap "kill $CORE_PID 2>/dev/null" EXIT

# --- Arrancar el widget ---
echo "Abriendo widget..."
(cd "$ROOT/widget" && npm start)
