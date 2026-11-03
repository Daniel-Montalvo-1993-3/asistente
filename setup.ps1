# ============================================================================
#  JARVIS — setup para Windows
#  Deja la máquina lista para arrancar Jarvis por primera vez:
#   1. Verifica Python 3.12+ y Node 18+
#   2. Crea el venv e instala dependencias Python
#   3. Instala dependencias del widget (npm)
#   4. Crea config/config.json a partir de config.sample.json (si no existe)
#   5. Crea carpetas que faltan (logs/, vault-prueba/)
#   6. Verifica que Claude Code CLI esté instalado y pide login
#   7. Imprime los siguientes pasos
#
#  Uso:
#     clic derecho → Ejecutar con PowerShell
#   o en una terminal:
#     powershell -ExecutionPolicy Bypass -File setup.ps1
# ============================================================================

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

function Write-Step($msg) { Write-Host "`n[Jarvis] $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "  OK  $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "  !!  $msg" -ForegroundColor Yellow }
function Write-Err($msg)  { Write-Host "  XX  $msg" -ForegroundColor Red }

# ---- 1. Python ----
Write-Step "Verificando Python..."
$pyCmd = $null
foreach ($cmd in @("python", "py -3.12", "py -3.11", "py -3")) {
    try {
        $out = Invoke-Expression "$cmd --version 2>&1"
        if ($out -match "Python 3\.(\d+)") {
            $minor = [int]$Matches[1]
            if ($minor -ge 10) { $pyCmd = $cmd; break }
        }
    } catch {}
}
if (-not $pyCmd) {
    Write-Err "No encontré Python 3.10+. Descarga desde https://www.python.org/downloads/windows/"
    exit 1
}
Write-Ok "Python detectado: $pyCmd"

# ---- 2. Node ----
Write-Step "Verificando Node.js..."
try {
    $nodeV = (node --version) -replace "v", ""
    $nodeMajor = [int]($nodeV.Split(".")[0])
    if ($nodeMajor -lt 18) { throw "Node $nodeV < 18" }
    Write-Ok "Node $nodeV"
} catch {
    Write-Err "No encontré Node.js 18+. Instala desde https://nodejs.org/"
    exit 1
}

# ---- 3. venv ----
Write-Step "Preparando entorno Python (.venv)..."
if (-not (Test-Path ".venv")) {
    Invoke-Expression "$pyCmd -m venv .venv"
    Write-Ok "venv creado"
} else {
    Write-Ok "venv ya existe"
}
$pip = Join-Path $root ".venv\Scripts\pip.exe"
$py  = Join-Path $root ".venv\Scripts\python.exe"
if (-not (Test-Path $pip)) {
    Write-Err "El venv no se creó bien. Borra la carpeta .venv y vuelve a correr este script."
    exit 1
}

Write-Step "Instalando dependencias Python..."
& $pip install --upgrade pip | Out-Null
& $pip install -r requirements.txt
if ($LASTEXITCODE -ne 0) { Write-Err "pip falló"; exit 1 }
Write-Ok "Dependencias Python listas"

# ---- 4. widget (npm) ----
Write-Step "Instalando dependencias del widget (npm)..."
Push-Location "widget"
npm install
if ($LASTEXITCODE -ne 0) { Pop-Location; Write-Err "npm install falló"; exit 1 }
Pop-Location
Write-Ok "Widget listo"

# ---- 5. config.json ----
Write-Step "Preparando config/config.json..."
if (-not (Test-Path "config\config.json")) {
    Copy-Item "config\config.sample.json" "config\config.json"
    Write-Ok "config.json creado desde la plantilla"
    Write-Warn "Edita config/config.json para ajustar: ruta de vault, trigger_words, mic_device, voz Piper."
} else {
    Write-Ok "config.json ya existe (no se sobrescribe)"
}

# ---- 6. Carpetas ----
Write-Step "Creando carpetas que falten..."
foreach ($d in @("logs", "vault-prueba", "vault-prueba\Proyectos",
                 "vault-prueba\Ideas", "vault-prueba\Aprendizaje",
                 "vault-prueba\Diario")) {
    if (-not (Test-Path $d)) { New-Item -ItemType Directory -Path $d | Out-Null }
}
Write-Ok "Carpetas listas"

# ---- 7. Claude Code CLI ----
Write-Step "Verificando Claude Code CLI..."
try {
    $cv = (claude --version) 2>&1
    Write-Ok "Claude CLI: $cv"
    Write-Warn "Si no has iniciado sesión, ejecuta en otra terminal:  claude login"
} catch {
    Write-Warn "No encontré 'claude' en el PATH. Instálalo desde:"
    Write-Warn "  https://docs.anthropic.com/claude-code"
    Write-Warn "Luego ejecuta:  claude login  (con tu cuenta Pro)"
}

# ---- 8. Siguientes pasos ----
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Jarvis listo para arrancar."
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Para iniciar:"
Write-Host "  .\iniciar-windows.ps1"
Write-Host ""
Write-Host "Antes de usarlo, abre config\config.json y revisa:"
Write-Host "  - obsidian.vault_path   -> apunta a tu vault real cuando lo tengas"
Write-Host "  - ears.mic_device        -> nombre o indice de tu microfono"
Write-Host "  - brain.permission_level -> 'limitado' por default (sube cuando confies)"
Write-Host ""
Write-Host "Opcional:"
Write-Host "  - Cerebro local: instala Ollama (https://ollama.com) y ejecuta:"
Write-Host "      ollama pull qwen2.5-coder:7b"
Write-Host ""
