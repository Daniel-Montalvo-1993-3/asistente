const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');

// Permite reproducir el sonido de inicio sin gesto previo del usuario.
// Debe fijarse ANTES de app.whenReady().
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

let widgetWin = null;
let dashboardWin = null;
let isQuitting = false;

// Cerrar cualquier ventana con la X equivale a cerrar la app entera. Como el
// widget y el dashboard viven ocultándose entre sí (ver nota más abajo), sin
// esto el proceso Electron queda vivo con una ventana oculta y el launcher
// nunca detecta cierre → Python y cmd siguen corriendo.
function quitAll() {
  if (isQuitting) return;
  isQuitting = true;
  try { if (widgetWin)    widgetWin.destroy(); }    catch {}
  try { if (dashboardWin) dashboardWin.destroy(); } catch {}
  app.quit();
}

// ---------------------------------------------------------------------------
// Estrategia: ambas ventanas se crean una sola vez al arrancar y se ocultan /
// muestran según corresponda. Nunca se destruyen durante el swap, así que
// 'window-all-closed' nunca se dispara por accidente y la app no se cierra.
// Ventajas: cero latencia al cambiar, nada de condiciones de carrera y el
// WebSocket de cada vista sobrevive. Chromium congela render de ventanas
// ocultas, así que el ahorro de CPU se mantiene.
// ---------------------------------------------------------------------------

function createWidget() {
  if (widgetWin) return widgetWin;
  const { width } = screen.getPrimaryDisplay().workAreaSize;
  widgetWin = new BrowserWindow({
    width: 360,
    height: 540,
    x: width - 384,
    y: 64,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: false,
    hasShadow: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  // En macOS el nivel 'screen-saver' bloquea el minimize real (la ventana
  // reaparece sola); 'floating' se comporta igual de always-on-top pero sí
  // minimiza. Windows se queda con 'screen-saver' como antes.
  widgetWin.setAlwaysOnTop(true, process.platform === 'darwin' ? 'floating' : 'screen-saver');
  widgetWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  widgetWin.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  // X del widget = cerrar todo (el dashboard puede estar oculto; sin esto
  // seguiría vivo y el launcher no detectaría el cierre).
  widgetWin.on('close', (e) => {
    if (!isQuitting) { e.preventDefault(); quitAll(); }
  });
  widgetWin.on('closed', () => { widgetWin = null; });
  return widgetWin;
}

function createDashboard() {
  if (dashboardWin) return dashboardWin;
  dashboardWin = new BrowserWindow({
    width: 980,
    height: 720,
    minWidth: 720,
    minHeight: 500,
    title: 'Jarvis — Dashboard',
    backgroundColor: '#12141c',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  dashboardWin.loadFile(path.join(__dirname, 'dashboard', 'index.html'));

  // Minimizar el dashboard → ocultarlo y mostrar el widget.
  // Deshacemos la minimización primero para que, cuando el usuario vuelva al
  // dashboard, aparezca en tamaño normal. En macOS ese restore() reabre la
  // ventana a medio animar y el hide() posterior no la oculta del todo; ahí
  // nos lo saltamos (showDashboard ya restaura antes de mostrar).
  dashboardWin.on('minimize', () => {
    if (!dashboardWin) return;
    showWidget();
    if (process.platform !== 'darwin') {
      try { dashboardWin.restore(); } catch {}
    }
    try { dashboardWin.hide(); } catch {}
  });

  // X del dashboard = cerrar todo. El widget suele estar oculto detrás; sin
  // esto seguiría vivo y el launcher no detectaría el cierre.
  dashboardWin.on('close', (e) => {
    if (!isQuitting) { e.preventDefault(); quitAll(); }
  });
  dashboardWin.on('closed', () => { dashboardWin = null; });
  return dashboardWin;
}

function showDashboard() {
  const w = createDashboard();
  if (widgetWin) try { widgetWin.hide(); } catch {}
  try {
    if (w.isMinimized()) w.restore();
    w.show();
    w.focus();
  } catch {}
}

function showWidget() {
  const w = createWidget();
  if (dashboardWin) try { dashboardWin.hide(); } catch {}
  try {
    if (w.isMinimized()) w.restore();
    w.show();
    w.focus();
  } catch {}
}

// Al arrancar: directo al dashboard.
app.whenReady().then(() => {
  createWidget();     // creado oculto para tenerlo listo
  showDashboard();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) showDashboard();
});

ipcMain.on('quit-app', () => quitAll());

// "Minimizar" desde el widget: iconifica el widget (comportamiento clásico).
ipcMain.on('minimize-app', () => { if (widgetWin) widgetWin.minimize(); });

// Abrir dashboard desde el widget: oculta el widget, muestra el dashboard.
ipcMain.on('open-dashboard', () => { showDashboard(); });
