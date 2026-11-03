# ============================================================
#  Iniciar Jarvis en Windows
#  Doble clic derecho -> "Ejecutar con PowerShell", o:
#     powershell -ExecutionPolicy Bypass -File .\iniciar-windows.ps1
# ============================================================
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot

# Electron no debe correr en modo Node (VSCode a veces hereda esta variable).
$env:ELECTRON_RUN_AS_NODE = $null

# --- Python (preferimos el instalado por winget) ---
$py = Join-Path $env:LOCALAPPDATA "Programs\Python\Python312\python.exe"
if (-not (Test-Path $py)) { $py = "python" }

# --- Entorno virtual + dependencias del núcleo ---
$venv = Join-Path $root ".venv"
if (-not (Test-Path $venv)) {
  Write-Host "Creando entorno de Python..." -ForegroundColor Cyan
  & $py -m venv $venv
}
$venvPy = Join-Path $venv "Scripts\python.exe"
Write-Host "Instalando dependencias del nucleo..." -ForegroundColor Cyan
& $venvPy -m pip install --quiet --upgrade pip
& $venvPy -m pip install --quiet -r (Join-Path $root "core\requirements.txt")

# --- Dependencias del widget (Electron) ---
if (-not (Test-Path (Join-Path $root "widget\node_modules"))) {
  Write-Host "Instalando Electron (solo la primera vez)..." -ForegroundColor Cyan
  Push-Location (Join-Path $root "widget")
  npm install
  Pop-Location
}

# --- Arrancar el núcleo (en segundo plano, guardamos el proceso) ---
Write-Host "Iniciando nucleo de Jarvis..." -ForegroundColor Green
$core = Start-Process $venvPy -ArgumentList "`"$(Join-Path $root 'core\server.py')`"" `
          -WorkingDirectory $root -WindowStyle Minimized -PassThru
Start-Sleep -Seconds 2

# --- Arrancar el widget (bloquea hasta que cierres la ventana) ---
Write-Host "Abriendo widget..." -ForegroundColor Green
Push-Location (Join-Path $root "widget")
npm start
Pop-Location

# --- Al cerrar el widget/dashboard, detener también el núcleo y sus hijos ---
# (Python puede tener a claude.exe o piper como subprocesos vivos.)
function Stop-ProcessTree($rootId) {
  try {
    $children = Get-CimInstance Win32_Process -Filter "ParentProcessId=$rootId" -ErrorAction SilentlyContinue
    foreach ($c in $children) { Stop-ProcessTree $c.ProcessId }
    Stop-Process -Id $rootId -Force -ErrorAction SilentlyContinue
  } catch {}
}
if ($core -and -not $core.HasExited) {
  Write-Host "Cerrando nucleo de Jarvis..." -ForegroundColor Yellow
  Stop-ProcessTree $core.Id
}
