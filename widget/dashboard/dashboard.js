// --- Conexión con el núcleo (mismo WebSocket que el widget) ---
const WS_URL = 'ws://127.0.0.1:8765';

const $ = (id) => document.getElementById(id);

let ws = null;
let models = null;
let pendingReplies = new Map();
let replyIdSeq = 1;

// --- Sesión: contadores de tokens / costo ---
let sessionTokens = { input: 0, output: 0 };
// Precio aproximado Sonnet (USD por M tokens): input 3, output 15.
const PRICE_IN_PER_M = 3;
const PRICE_OUT_PER_M = 15;
// Tipo de cambio aproximado MXN
const USD_TO_MXN = 18;

function send(obj) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return null;
  const id = String(replyIdSeq++);
  obj.reply_id = id;
  ws.send(JSON.stringify(obj));
  return id;
}

function request(type, extra = {}) {
  return new Promise((resolve, reject) => {
    const id = send({ type, ...extra });
    if (id === null) return reject(new Error('ws no listo'));
    const timeout = setTimeout(() => {
      pendingReplies.delete(id);
      reject(new Error('timeout'));
    }, 30000);
    pendingReplies.set(id, (data) => { clearTimeout(timeout); resolve(data); });
  });
}

// --- Pestañas ---
document.querySelectorAll('.tab').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    $(`tab-${btn.dataset.tab}`).classList.add('active');
    const t = btn.dataset.tab;
    if (t === 'sistema') loadDiagnostics();
    if (t === 'historial') loadHistory();
    if (t === 'config') loadConfig();
    if (t === 'grafo') loadGraph();
    if (t === 'comandos') { loadCommands(); loadFilesHistory(); }
    if (t === 'transparencia') loadTransparency();
    if (t === 'sonidos') loadSounds();
    if (t === 'arquitectura') window.__archInit && window.__archInit();
  };
});

// --- Tema claro/oscuro ---
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  $('themeToggle').textContent = theme === 'dark' ? '☀️' : '🌙';
  try { localStorage.setItem('jarvis-theme', theme); } catch {}
}
$('themeToggle').onclick = () => {
  const cur = document.documentElement.getAttribute('data-theme');
  applyTheme(cur === 'dark' ? 'light' : 'dark');
};
try {
  const saved = localStorage.getItem('jarvis-theme');
  if (saved) applyTheme(saved);
} catch {}

// --- Estado y modelos ---
function setState(state) {
  const labels = {
    idle: 'listo (micrófono apagado)',
    listening: '🎙️ escuchando',
    recording: '🔴 grabando tu voz',
    transcribing: 'entendiendo…',
    thinking: '🧠 pensando…',
    speaking: '🗣️ hablando…',
    ears_off: '🔇 oído apagado',
    ear_error: '⚠️ error de micrófono',
    offline: 'sin conexión'
  };
  $('stateBig').textContent = labels[state] || state;
  const colors = {
    listening: 'var(--accent)', recording: 'var(--danger)',
    thinking: 'var(--warn)', speaking: 'var(--speak)',
    idle: 'var(--ok)', ears_off: 'var(--muted)', offline: 'var(--danger)',
    ear_error: 'var(--danger)', transcribing: 'var(--warn)',
  };
  $('stateBig').style.color = colors[state] || 'var(--text)';

  // Shader del fondo reacciona al estado (mismo preset del widget)
  if (window.JarvisBG) window.JarvisBG.setState(state);
  // Sonido: loop de "pensando", "escuchar", "termino" según estado
  if (window.JarvisSound) window.JarvisSound.setState(state);

  // Chat flotante: etiqueta + punto de color + habilitar/deshabilitar input
  const fcStatus = $('fcStatus');
  if (fcStatus) fcStatus.textContent = labels[state] || state;
  const fcDot = $('fcDot');
  if (fcDot) fcDot.className = 'fc-dot ' + state;
  const fcText = $('fcText'), fcSend = $('fcSendBtn');
  const busy = ['thinking', 'speaking', 'recording', 'transcribing'].includes(state);
  if (fcText) fcText.disabled = busy;
  if (fcSend) fcSend.disabled = busy;
  if (state === 'thinking') fcShowTyping(); else fcRemoveTyping();
  const fcMic = $('fcMicBtn');
  if (fcMic) {
    const off = (state === 'ears_off' || state === 'offline');
    fcMic.classList.toggle('on', !off);
    fcMic.textContent = off ? '🔇' : '🎤';
  }
}

function applyModels(m) {
  models = m;
  const provider = m.brain?.provider || 'claude';
  const brainLabel = provider === 'ollama'
    ? `Ollama local · ${escapeHtml(m.brain?.ollama_model || '?')}`
    : `Claude Pro · ${escapeHtml((m.brain?.cmd || '').split(/[\\\/]/).slice(-1)[0] || 'claude')}`;
  $('mBrain').innerHTML = brainLabel;
  $('mLevel').textContent = m.brain?.permission_level || '—';
  $('mEars').textContent = m.ears?.enabled
    ? `${m.ears.model || '?'} / ${m.ears.device || '?'}` + (m.ears.muted ? ' (apagado)' : '')
    : 'desactivado';
  $('mVoice').textContent = m.voice?.backend === 'piper'
    ? `piper: ${m.voice.piper_voice}` : (m.voice?.backend || '—');
  $('mVault').textContent = m.brain?.vault || '—';
  $('turnsCount').textContent = m.turns || 0;
  $('uptimeLabel').textContent = `Núcleo activo hace ${formatSecs(m.uptime_seconds || 0)}`;
}

function formatSecs(s) {
  if (s < 60) return `${Math.round(s)} segundos`;
  if (s < 3600) return `${Math.floor(s/60)} minutos`;
  return `${Math.floor(s/3600)} h ${Math.floor((s%3600)/60)} min`;
}

// --- Recursos CPU/RAM ---
async function pollResources() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  try {
    const { data } = await request('get_resources');
    if (!data?.available) return;
    $('resCpu').textContent = `${data.cpu_percent} %`;
    $('resRam').textContent = `${data.ram_mb} MB`;
    $('resSysCpu').textContent = `${data.system_cpu_percent} %`;
    $('resSysRam').textContent = `${data.system_ram_percent} %`;
  } catch {}
}
setInterval(pollResources, 2000);

// --- Diagnóstico de hardware ---
async function loadDiagnostics() {
  try {
    const { data } = await request('get_diagnostics');
    renderHardware(data.hardware);
    renderRecommendations(data.recommendations);
    // Mostrar guía CUDA si NVIDIA detectada pero cuda no lista
    const needCuda = data.hardware?.gpu?.vendor === 'nvidia' && !data.hardware?.cuda?.ready;
    $('cudaGuideCard').style.display = needCuda ? 'block' : 'none';
  } catch (e) {
    $('hwBox').innerHTML = `<div class="muted">No pude obtener el diagnóstico: ${e.message}</div>`;
  }
}

function renderHardware(hw) {
  const items = [
    ['Sistema operativo', `${hw.os.system} ${hw.os.release}`, hw.os.machine],
    ['Procesador', (hw.cpu.brand || 'desconocido').trim(),
     hw.cpu.cores_physical ? `${hw.cpu.cores_physical} núcleos / ${hw.cpu.cores_logical} hilos` : ''],
    ['Memoria RAM', hw.memory.total_gb ? `${hw.memory.total_gb} GB` : '—',
     hw.memory.available_gb ? `${hw.memory.available_gb} GB libres` : ''],
    ['Disco', hw.disk.total_gb ? `${hw.disk.total_gb} GB total` : '—',
     hw.disk.free_gb ? `${hw.disk.free_gb} GB libres` : ''],
    ['GPU', hw.gpu?.name || 'no detectada',
     hw.gpu?.vram_gb ? `${hw.gpu.vram_gb} GB VRAM · driver ${hw.gpu.driver || '?'}` : ''],
    ['CUDA (para Whisper en GPU)',
     hw.cuda.ready ? '✅ Lista' : (hw.gpu?.name ? '⚠️ Falta configurar' : 'no aplica'),
     hw.cuda.visible_devices ? `${hw.cuda.visible_devices} GPU(s) visibles` : ''],
  ];
  $('hwBox').innerHTML = items.map(([label, value, meta]) => `
    <div class="hw-item">
      <div class="label">${label}</div>
      <div class="value">${escapeHtml(value || '—')}</div>
      ${meta ? `<div class="meta">${escapeHtml(meta)}</div>` : ''}
    </div>`).join('');
}

function renderRecommendations(rec) {
  const w = rec.whisper;
  const modelsHtml = w.models.map(m => {
    const isRec = m.name === w.recommended_model;
    const cpu = m.fits_cpu ? '<span class="badge ok">CPU ✓</span>' : '<span class="badge ko">CPU ✗</span>';
    const gpu = m.fits_gpu ? '<span class="badge ok">GPU ✓</span>' : '<span class="badge">GPU —</span>';
    const rb = isRec ? '<span class="badge rec">RECOMENDADO</span>' : '';
    return `<div class="reco-model ${isRec ? 'rec' : ''}">
      <strong>${m.name}</strong> ${rb} ${cpu} ${gpu}
      <span class="muted small">${m.quality} · ${m.speed}</span>
    </div>`;
  }).join('');
  $('recoBox').innerHTML = `
    <p><strong>Para tu PC recomiendo:</strong> Whisper
       <code>${w.recommended_model}</code> en <code>${w.recommended_device}</code>.</p>
    <div style="margin-top:10px">${modelsHtml}</div>
    <button class="btn primary" style="margin-top:12px" id="applyReco">Aplicar configuración recomendada</button>`;
  $('applyReco').onclick = async () => {
    const patch = {
      'ears.whisper_model': w.recommended_model,
      'ears.whisper_device': w.recommended_device,
    };
    await request('set_config', { patch });
    $('cfgNote').textContent = 'Recomendación guardada. Reinicia el núcleo para aplicar.';
  };

  if (rec.advice && rec.advice.length) {
    $('adviceBox').innerHTML = rec.advice.map(a => `
      <div class="advice-item ${a.level || 'info'}">
        <strong>${escapeHtml(a.title)}</strong>
        <div class="small">${escapeHtml(a.detail)}</div>
      </div>`).join('');
  } else {
    $('adviceBox').innerHTML = '<div class="muted">Sin avisos. Todo en orden.</div>';
  }
}

// --- Benchmark Whisper ---
$('runBench').onclick = async () => {
  const models = [...document.querySelectorAll('input.bm:checked')].map(c => c.value);
  if (!models.length) { $('bmResult').textContent = 'Elige al menos un modelo.'; return; }
  $('bmResult').innerHTML = '<div class="muted">⏳ Ejecutando benchmark (puede tardar varios minutos)…</div>';
  try {
    const { data } = await request('benchmark_whisper', {
      models, device: $('bmDevice').value,
    });
    $('bmResult').innerHTML = data.map(r => r.error
      ? `<div class="bm-row"><strong>${r.model}</strong> — <span class="muted">${escapeHtml(r.error)}</span></div>`
      : `<div class="bm-row"><strong>${r.model}</strong> — carga ${r.load_s}s · inferencia ${r.inference_s}s · ${r.device}</div>`
    ).join('');
  } catch (e) {
    $('bmResult').textContent = `Error: ${e.message}`;
  }
};

$('copyCuda').onclick = () => {
  navigator.clipboard.writeText('pip install nvidia-cublas-cu12 nvidia-cudnn-cu12');
  $('copyCuda').textContent = '✓ Copiado';
  setTimeout(() => { $('copyCuda').textContent = 'Copiar comando pip'; }, 2000);
};

// --- Historial ---
async function loadHistory() {
  $('historyBox').innerHTML = '<div class="muted">Cargando…</div>';
  try {
    const { data } = await request('get_history', { limit: 50, types: ['turn'] });
    if (!data || data.length === 0) {
      $('historyBox').innerHTML = '<div class="muted">Aún no hay turnos registrados.</div>';
      return;
    }
    $('historyBox').innerHTML = data.slice().reverse().map(ev => {
      const ts = ev.ts ? new Date(ev.ts).toLocaleString() : '';
      const src = ev.source === 'voice' ? '🎤 voz' : '⌨️ texto';
      const prov = ev.provider === 'ollama' ? '🖥️ local' : '☁️ Pro';
      const lat = ev.latency ? `cerebro ${ev.latency.brain}s · voz ${ev.latency.voice}s` : '';
      return `<div class="turn-item">
        <div class="meta">
          <span>${escapeHtml(ts)}</span><span>${src}</span>
          <span>${prov}</span><span>${lat}</span>
          <span>permiso: ${escapeHtml(ev.level || '-')}</span>
        </div>
        <div class="user"><strong>Tú:</strong> ${escapeHtml(ev.user || '')}</div>
        <div class="reply"><strong>Jarvis:</strong> ${escapeHtml(ev.reply || '')}</div>
      </div>`;
    }).join('');
  } catch (e) {
    $('historyBox').innerHTML = `<div class="muted">Error: ${e.message}</div>`;
  }
}

$('refreshHist').onclick = loadHistory;
$('clearHist').onclick = async () => {
  if (!confirm('¿Borrar todo el historial? No se puede deshacer.')) return;
  await request('clear_history');
  loadHistory();
};

async function doExport(fmt) {
  try {
    const res = await request('export_history', { format: fmt });
    const blob = new Blob([res.content], { type: res.mime || 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `jarvis-historial-${new Date().toISOString().slice(0,10)}.${fmt}`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) { alert('No pude exportar: ' + e.message); }
}
$('exportJson').onclick = () => doExport('json');
$('exportCsv').onclick = () => doExport('csv');

// --- Comandos ejecutados (Fase 4) ---
async function loadCommands() {
  try {
    const { data } = await request('get_commands');
    if (!data || data.length === 0) {
      $('commandsBox').innerHTML = '<div class="muted">Aún no se han registrado comandos.</div>';
      return;
    }
    $('commandsBox').innerHTML = data.slice().reverse().map(c => `
      <div class="log-row">
        <div class="log-ts">${new Date(c.ts * 1000).toLocaleTimeString()}</div>
        <div class="log-main"><code>${escapeHtml(c.command || '')}</code></div>
        <div class="log-sub muted small">${escapeHtml(c.description || '')}</div>
      </div>`).join('');
  } catch (e) {
    $('commandsBox').innerHTML = `<div class="muted">Error: ${e.message}</div>`;
  }
}
$('refreshCmds').onclick = loadCommands;

async function loadFilesHistory() {
  try {
    const { data } = await request('get_files_history');
    if (!data || data.length === 0) {
      $('filesBox').innerHTML = '<div class="muted">Aún no hay actividad en el vault.</div>';
      return;
    }
    const icons = { read: '👁️', write: '✍️', edit: '✏️', glob: '🔎' };
    $('filesBox').innerHTML = data.slice().reverse().map(f => `
      <div class="log-row">
        <div class="log-ts">${new Date(f.ts * 1000).toLocaleTimeString()}</div>
        <div class="log-main">${icons[f.op] || '•'} <span class="chip-small">${f.op}</span> <code>${escapeHtml(f.path || '')}</code></div>
      </div>`).join('');
  } catch (e) {
    $('filesBox').innerHTML = `<div class="muted">Error: ${e.message}</div>`;
  }
}
$('refreshFiles').onclick = loadFilesHistory;

// --- Modo transparencia ---
async function loadTransparency() {
  try {
    const { data } = await request('get_transparency');
    $('transSystem').textContent = data.system_prompt || '(aún no hay turnos)';
    $('transUser').textContent = data.user_prompt || '(aún no hay turnos)';
    $('transRaw').textContent = data.raw_output || '(aún no hay turnos)';
    $('transTokens').textContent = data.tokens
      ? JSON.stringify(data.tokens, null, 2)
      : '(sin datos de tokens)';
  } catch (e) {
    $('transSystem').textContent = `Error: ${e.message}`;
  }
}
$('refreshTrans').onclick = loadTransparency;

// --- Configuración ---
let configCache = null;
async function loadConfig() {
  try {
    const { data: cfg } = await request('get_config');
    configCache = cfg;
    $('cfgProvider').value = cfg.brain?.provider || 'claude';
    $('cfgLevel').value = cfg.brain?.permission_level || 'equilibrado';
    $('cfgPersona').value = cfg.brain?.custom_persona || '';
    $('cfgWhisper').value = cfg.ears?.whisper_model || 'small';
    $('cfgDevice').value = cfg.ears?.whisper_device || 'auto';
    $('cfgBackend').value = cfg.tts?.backend || 'piper';
    $('cfgVault').value = cfg.obsidian?.vault_path || '';
    $('cfgNotif').checked = cfg.ui?.notifications !== false;
    renderTriggerChips(cfg.ears?.trigger_words || []);
    initSlider('cfgSpeechRms', 'cfgSpeechRmsV', cfg.ears?.speech_rms ?? 900);
    initSlider('cfgSilenceRms', 'cfgSilenceRmsV', cfg.ears?.silence_rms ?? 500);
    initSlider('cfgSilenceSec', 'cfgSilenceSecV', cfg.ears?.silence_seconds ?? 0.9);
    $('cfgStrictWake').checked = !!cfg.ears?.strict_wake;
    initSlider('cfgArmedTimeout', 'cfgArmedTimeoutV', cfg.ears?.armed_timeout ?? 6);
    toggleOllamaRow();
    loadOllamaStatus();
  } catch (e) {
    $('cfgNote').textContent = `No pude cargar la configuración: ${e.message}`;
  }
}

function initSlider(id, labelId, val) {
  const el = $(id);
  el.value = val;
  $(labelId).textContent = val;
  el.oninput = () => { $(labelId).textContent = el.value; };
}

// Chips input para trigger words
let currentTriggers = [];
function renderTriggerChips(words) {
  currentTriggers = [...words];
  const container = $('triggerChips');
  const chipsHtml = currentTriggers.map((w, i) =>
    `<span class="chip-trigger" data-i="${i}">${escapeHtml(w)} ×</span>`
  ).join('');
  container.innerHTML = chipsHtml +
    `<input type="text" id="newTrigger" placeholder="añadir…" />`;
  container.querySelectorAll('.chip-trigger').forEach(ch => {
    ch.onclick = () => {
      currentTriggers.splice(+ch.dataset.i, 1);
      renderTriggerChips(currentTriggers);
    };
  });
  $('newTrigger').onkeydown = (e) => {
    if (e.key === 'Enter' && e.target.value.trim()) {
      currentTriggers.push(e.target.value.trim().toLowerCase());
      renderTriggerChips(currentTriggers);
    }
  };
}

function toggleOllamaRow() {
  $('ollamaRow').style.display = $('cfgProvider').value === 'ollama' ? 'flex' : 'none';
}
$('cfgProvider').onchange = toggleOllamaRow;

async function loadOllamaStatus() {
  try {
    const { data } = await request('get_providers');
    const o = data.ollama || {};
    const statusLine = o.up
      ? `✅ Ollama corriendo en ${o.host}. Modelos instalados: ${o.installed_models.length}.`
      : `⚠️ Ollama no responde en ${o.host}. Instálalo desde ollama.com y ejecuta: ollama pull ${o.recommended}`;
    $('ollamaStatus').innerHTML = escapeHtml(statusLine);
    const sel = $('cfgOllamaModel');
    sel.innerHTML = '';
    const installed = o.installed_models || [];
    if (installed.length === 0) {
      const opt = document.createElement('option');
      opt.value = o.recommended;
      opt.textContent = `${o.recommended} (no instalado)`;
      sel.appendChild(opt);
    } else {
      installed.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.name;
        opt.textContent = `${m.name} — ${m.size_gb} GB${m.parameter_size ? ' · ' + m.parameter_size : ''}`;
        sel.appendChild(opt);
      });
    }
    sel.value = o.selected_model;
  } catch (e) {
    $('ollamaStatus').textContent = `Error consultando Ollama: ${e.message}`;
  }
}
$('refreshOllama').onclick = loadOllamaStatus;

$('saveCfg').onclick = async () => {
  const patch = {
    'brain.provider': $('cfgProvider').value,
    'brain.permission_level': $('cfgLevel').value,
    'brain.custom_persona': $('cfgPersona').value,
    'ears.whisper_model': $('cfgWhisper').value,
    'ears.whisper_device': $('cfgDevice').value,
    'ears.trigger_words': currentTriggers,
    'ears.speech_rms': Number($('cfgSpeechRms').value),
    'ears.silence_rms': Number($('cfgSilenceRms').value),
    'ears.silence_seconds': Number($('cfgSilenceSec').value),
    'ears.strict_wake': $('cfgStrictWake').checked,
    'ears.armed_timeout': Number($('cfgArmedTimeout').value),
    'tts.backend': $('cfgBackend').value,
    'obsidian.vault_path': $('cfgVault').value,
    'ui.notifications': $('cfgNotif').checked,
  };
  if ($('cfgProvider').value === 'ollama') {
    patch['brain.ollama.model'] = $('cfgOllamaModel').value;
  }
  const { note } = await request('set_config', { patch });
  // Si cambió provider, aplícalo en caliente al cerebro
  await request('set_provider', {
    provider: $('cfgProvider').value,
    model: $('cfgOllamaModel').value,
  });
  $('cfgNote').textContent = note || 'Guardado.';
};

$('restartCore').onclick = async () => {
  if (!confirm('¿Reiniciar el núcleo ahora? Perderás la sesión actual.')) return;
  try { await request('restart_core'); } catch {}
  $('cfgNote').textContent = 'Núcleo cerrándose. Vuelve a abrirlo desde el acceso directo.';
};

$('ttsTestBtn').onclick = async () => {
  const text = $('ttsTestText').value.trim() || 'Hola, soy Jarvis. Esta es una prueba de voz.';
  $('ttsTestBtn').disabled = true;
  $('ttsTestBtn').textContent = '…';
  try { await request('test_tts', { text }); } catch (e) { alert(e.message); }
  $('ttsTestBtn').disabled = false;
  $('ttsTestBtn').textContent = 'Decir';
};

// --- Utilidades ---
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// --- Grafo del vault (D3 force-directed) ---
let simulation = null;
let graphData = null;
const FOLDER_COLORS = {
  'Proyectos':   '#22d3ee',
  'Ideas':       '#fbbf24',
  'Aprendizaje': '#a78bfa',
  'Diario':      '#4ade80',
  'raíz':        '#8b90a0',
  '__core__':    '#5b8cff',
};
function folderColor(f) { return FOLDER_COLORS[f] || '#8b90a0'; }

// ============================================================
//  Grafo 3D del vault con 3d-force-graph (UMD de unpkg)
// ============================================================
let graph3dInstance = null;
function graphContainer() { return document.getElementById('graph3d'); }

async function loadGraph() {
  if (!window.ForceGraph3D) {
    $('graphInfo').textContent = '❌ 3d-force-graph no cargó (revisa conexión / consola).';
    console.error('[Jarvis] window.ForceGraph3D no está definido. La librería no se cargó desde unpkg.');
    return;
  }
  $('graphInfo').textContent = 'Cargando datos del vault…';
  try {
    const { data } = await request('get_vault_graph');
    graphData = data;
    renderGraph(data);
  } catch (e) {
    $('graphInfo').textContent = `Error: ${e.message}`;
    console.error('[Jarvis] get_vault_graph falló:', e);
  }
}
$('graphReload').onclick = loadGraph;

// Pausa el loop del grafo cuando el tab no está activo (ahorra GPU/CPU).
function graphPauseIfHidden() {
  if (!graph3dInstance) return;
  const activeId = document.querySelector('.tab-panel.active')?.id;
  if (activeId === 'tab-grafo') graph3dInstance.resumeAnimation();
  else graph3dInstance.pauseAnimation();
}
// Hookeamos el cambio de pestaña
document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => setTimeout(graphPauseIfHidden, 0));
});
// Y la visibilidad general de la ventana
document.addEventListener('visibilitychange', () => {
  if (!graph3dInstance) return;
  if (document.hidden) graph3dInstance.pauseAnimation();
  else graphPauseIfHidden();
});

function renderGraph(data) {
  const container = graphContainer();
  if (!container || !window.ForceGraph3D) return;

  // Normalizar: 3d-force-graph espera `links` no `edges`
  const nodes = (data.nodes || []).map(n => Object.assign({}, n));
  const links = (data.edges || []).map(e => ({
    source: e.source?.id || e.source,
    target: e.target?.id || e.target,
  }));

  // Leyenda y contador
  const folders = [...(data.folders || []), '__core__'];
  $('graphLegend').innerHTML = folders.map(f => `
    <span class="legend-item">
      <span class="legend-dot" style="background:${folderColor(f)}"></span>
      ${f === '__core__' ? 'Jarvis' : escapeHtml(f)}
    </span>`).join('');
  $('graphInfo').textContent = `${nodes.length} notas · ${links.length} enlaces`;

  if (nodes.length === 0) {
    container.innerHTML = '<div style="position:absolute;inset:0;display:grid;place-items:center;color:var(--muted)">El vault está vacío o no se encontró.</div>';
    return;
  }

  // Primera vez: crear instancia; después: actualizar datos
  if (!graph3dInstance) {
    graph3dInstance = window.ForceGraph3D()(container)
      .backgroundColor('rgba(0,0,0,0)')
      .showNavInfo(false)
      .nodeRelSize(5)
      .nodeOpacity(0.95)
      .linkOpacity(0.35)
      .linkColor(() => 'rgba(255,255,255,0.35)')
      .linkWidth(0.6)
      .nodeColor(n => n.id === '__jarvis__' ? '#ffffff' : folderColor(n.folder))
      .nodeVal(n => {
        if (n.id === '__jarvis__') return 20;
        return Math.max(1, Math.sqrt((n.size || 100)) / 4);
      })
      .nodeLabel(n => `<div style="padding:4px 8px;background:#171a24cc;border-radius:6px;color:#e8eaf0;font-size:12px">${escapeHtml(n.label || n.id)}<br><span style="color:#8b90a0">${escapeHtml(n.folder || '')}</span></div>`)
      .nodeThreeObjectExtend(true)
      .cooldownTicks(80)         // perf: deja de iterar fuerzas tras 80 ticks
      .warmupTicks(0);

    // Click: podríamos abrir la nota — por ahora solo centra la cámara en el nodo
    graph3dInstance.onNodeClick(n => {
      const dist = 60;
      const factor = 1 + dist / Math.hypot(n.x || 1, n.y || 1, n.z || 1);
      graph3dInstance.cameraPosition(
        { x: (n.x || 0) * factor, y: (n.y || 0) * factor, z: (n.z || 0) * factor },
        n, 1200
      );
    });

    // Charge: usamos el slider del UI
    const chargeInp = $('chargeSlider');
    if (chargeInp) {
      const applyCharge = () => {
        const v = Number(chargeInp.value);
        try { graph3dInstance.d3Force('charge').strength(v); graph3dInstance.d3ReheatSimulation(); } catch {}
      };
      chargeInp.oninput = applyCharge;
      applyCharge();
    }

    // Auto-rotación (OrbitControls)
    const auto = $('autoRotate');
    const applyAuto = () => {
      try {
        const ctl = graph3dInstance.controls();
        ctl.autoRotate = !!(auto && auto.checked);
        ctl.autoRotateSpeed = 0.6;
      } catch {}
    };
    if (auto) auto.onchange = applyAuto;
    // Esperamos un tick a que controls() exista
    setTimeout(applyAuto, 100);

    // Etiquetas 3D flotando con SpriteText (helper oficial)
    const lbl = $('showLabels');
    const applyLabels = () => {
      const show = lbl && lbl.checked;
      graph3dInstance.nodeThreeObject(n => {
        if (!show || !window.SpriteText) return null;
        const txt = new window.SpriteText(n.label || n.id);
        txt.color = '#e8eaf0';
        txt.backgroundColor = 'rgba(0,0,0,0.55)';
        txt.borderRadius = 3;
        txt.padding = 2;
        txt.textHeight = n.id === '__jarvis__' ? 6 : 3;
        return txt;
      });
    };
    if (lbl) lbl.onchange = applyLabels;
    applyLabels();

    // Resize cuando cambia el tamaño del contenedor
    const ro = new ResizeObserver(() => {
      if (!graph3dInstance) return;
      const w = container.clientWidth, h = container.clientHeight;
      graph3dInstance.width(w).height(h);
    });
    ro.observe(container);
  }

  graph3dInstance.graphData({ nodes, links });
  graphPauseIfHidden();
}

// Función obsoleta (D3 2D). Mantener stub por si algo externo la invoca.
function _oldRenderGraphD3(data) {
  const svg = d3.select('#graphSvg');
  svg.selectAll('*').remove();

  const rect = $('graphSvg').getBoundingClientRect();
  const W = rect.width || 900;
  const H = rect.height || 520;
  svg.attr('viewBox', `0 0 ${W} ${H}`);

  // Defs: glow filter + marker
  const defs = svg.append('defs');
  const glow = defs.append('filter').attr('id', 'glow').attr('width', '200%').attr('height', '200%');
  glow.append('feGaussianBlur').attr('stdDeviation', '3').attr('result', 'coloredBlur');
  const merge = glow.append('feMerge');
  merge.append('feMergeNode').attr('in', 'coloredBlur');
  merge.append('feMergeNode').attr('in', 'SourceGraphic');

  // Leyenda
  const folders = [...(data.folders || []), '__core__'];
  $('graphLegend').innerHTML = folders.map(f => `
    <span class="legend-item">
      <span class="legend-dot" style="background:${folderColor(f)}"></span>
      ${f === '__core__' ? 'Jarvis' : escapeHtml(f)}
    </span>`).join('');

  $('graphInfo').textContent = `${data.nodes.length} notas · ${data.edges.length} enlaces`;

  if (data.nodes.length === 0) {
    svg.append('text').attr('x', W/2).attr('y', H/2)
       .attr('text-anchor', 'middle').attr('fill', 'var(--muted)')
       .text('El vault está vacío o no se encontró.');
    return;
  }

  const g = svg.append('g');

  // Zoom + pan
  svg.call(d3.zoom().scaleExtent([0.2, 4]).on('zoom', (ev) => {
    g.attr('transform', ev.transform);
  }));

  const links = g.append('g').attr('class', 'links')
    .selectAll('line').data(data.edges).join('line')
    .attr('stroke', 'var(--edge)')
    .attr('stroke-width', 1)
    .attr('stroke-opacity', 0.5);

  const now = Date.now() / 1000;
  const nodes = g.append('g').attr('class', 'nodes')
    .selectAll('circle').data(data.nodes).join('circle')
    .attr('r', d => d.id === '__jarvis__' ? 18 : Math.min(16, 5 + Math.sqrt(d.size || 100) / 8))
    .attr('fill', d => folderColor(d.folder))
    .attr('stroke', 'var(--panel)')
    .attr('stroke-width', 1.5)
    .attr('filter', d => (now - (d.last_touch || 0) < 60) ? 'url(#glow)' : null)
    .on('mouseover', (ev, d) => {
      // Resaltar vecinos
      const neighbors = new Set();
      data.edges.forEach(e => {
        const sId = e.source.id || e.source;
        const tId = e.target.id || e.target;
        if (sId === d.id) neighbors.add(tId);
        if (tId === d.id) neighbors.add(sId);
      });
      nodes.attr('opacity', n => (n.id === d.id || neighbors.has(n.id)) ? 1 : 0.2);
      links.attr('stroke-opacity', e => {
        const sId = e.source.id || e.source;
        const tId = e.target.id || e.target;
        return (sId === d.id || tId === d.id) ? 0.95 : 0.08;
      }).attr('stroke', e => {
        const sId = e.source.id || e.source;
        const tId = e.target.id || e.target;
        return (sId === d.id || tId === d.id) ? 'var(--accent)' : 'var(--edge)';
      });
      labels.attr('opacity', n => (n.id === d.id || neighbors.has(n.id)) ? 1 : 0.15);
    })
    .on('mouseout', () => {
      nodes.attr('opacity', 1);
      links.attr('stroke-opacity', 0.5).attr('stroke', 'var(--edge)');
      labels.attr('opacity', $('showLabels').checked ? 0.9 : 0);
    })
    .call(drag(simulation));

  // Pulso para nodos recién tocados
  nodes.filter(d => (Date.now()/1000 - (d.last_touch || 0)) < 60)
    .append('animate')
    .attr('attributeName', 'r')
    .attr('values', '12;20;12')
    .attr('dur', '1.8s')
    .attr('repeatCount', 'indefinite');

  const labels = g.append('g').attr('class', 'labels')
    .selectAll('text').data(data.nodes).join('text')
    .text(d => d.label)
    .attr('font-size', 10)
    .attr('fill', 'var(--text)')
    .attr('opacity', $('showLabels').checked ? 0.9 : 0)
    .attr('text-anchor', 'middle')
    .attr('pointer-events', 'none')
    .attr('dy', -14);

  $('showLabels').onchange = (e) => {
    labels.attr('opacity', e.target.checked ? 0.9 : 0);
  };

  const charge = Number($('chargeSlider').value);
  simulation = d3.forceSimulation(data.nodes)
    .force('link', d3.forceLink(data.edges).id(d => d.id).distance(80).strength(0.5))
    .force('charge', d3.forceManyBody().strength(charge))
    .force('center', d3.forceCenter(W/2, H/2))
    .force('collide', d3.forceCollide().radius(d => d.id === '__jarvis__' ? 24 : 18))
    .on('tick', () => {
      links.attr('x1', d => d.source.x).attr('y1', d => d.source.y)
           .attr('x2', d => d.target.x).attr('y2', d => d.target.y);
      nodes.attr('cx', d => d.x).attr('cy', d => d.y);
      labels.attr('x', d => d.x).attr('y', d => d.y);
    });

  $('chargeSlider').oninput = (e) => {
    simulation.force('charge').strength(Number(e.target.value));
    simulation.alpha(0.5).restart();
  };
}

function drag(sim) {
  return d3.drag()
    .on('start', (ev, d) => {
      if (!ev.active) sim.alphaTarget(0.3).restart();
      d.fx = d.x; d.fy = d.y;
    })
    .on('drag', (ev, d) => { d.fx = ev.x; d.fy = ev.y; })
    .on('end', (ev, d) => {
      if (!ev.active) sim.alphaTarget(0);
      d.fx = null; d.fy = null;
    });
}

// --- Costo estimado por turno ---
function updateCostFromTurn(tokens) {
  if (!tokens || typeof tokens !== 'object') return;
  const i = Number(tokens.input) || 0;
  const o = Number(tokens.output) || 0;
  sessionTokens.input += i;
  sessionTokens.output += o;
  const costUsd = (i / 1e6) * PRICE_IN_PER_M + (o / 1e6) * PRICE_OUT_PER_M;
  const sessUsd = (sessionTokens.input / 1e6) * PRICE_IN_PER_M +
                  (sessionTokens.output / 1e6) * PRICE_OUT_PER_M;
  $('tokLast').textContent = `${i} in · ${o} out`;
  $('tokSession').textContent = `${sessionTokens.input + sessionTokens.output}`;
  $('costEst').textContent = `≈ $${sessUsd.toFixed(4)} USD (último $${costUsd.toFixed(4)})`;
}

// --- Notificaciones del sistema ---
function notify(title, body) {
  if (!configCache?.ui?.notifications) return;
  try {
    if (Notification.permission === 'granted') new Notification(title, { body });
    else if (Notification.permission !== 'denied') {
      Notification.requestPermission().then(p => {
        if (p === 'granted') new Notification(title, { body });
      });
    }
  } catch {}
}

// --- Conexión / reconexión ---
// ---- Sonidos ----
const SLOT_META = {
  inicio:   { icon: '🚀', label: 'Inicio',   hint: 'Al abrir el chat (una vez).' },
  escuchar: { icon: '👂', label: 'Escuchar', hint: 'Al empezar a grabar tu voz.' },
  pensando: { icon: '🧠', label: 'Pensando', hint: 'Mientras procesa (loop).' },
  termino:  { icon: '✅', label: 'Terminó',  hint: 'Al terminar de responder.' },
};
const ALLOWED_SOUND_EXT = ['.mp3', '.wav', '.ogg', '.m4a'];
const MAX_SOUND_MB = 2;
let soundsSnapshot = null;

async function loadSounds() {
  try {
    const res = await request('get_sounds');
    renderSounds(res.data);
  } catch (e) {
    $('sndSlots').innerHTML = `<div class="muted">Error cargando sonidos: ${escapeHtml(String(e))}</div>`;
  }
}

function fmtBytes(n) {
  if (!n) return '—';
  if (n < 1024) return n + ' B';
  if (n < 1024*1024) return (n/1024).toFixed(1) + ' KB';
  return (n/1024/1024).toFixed(2) + ' MB';
}

function renderSounds(data) {
  soundsSnapshot = data;
  const enabled = !!data.enabled;
  const master = Math.round((data.master_volume || 0) * 100);
  $('sndEnabled').checked = enabled;
  $('sndMaster').value = master;
  $('sndMasterV').textContent = master + '%';

  const box = $('sndSlots');
  box.innerHTML = '';
  for (const s of data.slots) {
    const meta = SLOT_META[s.slot] || { icon: '🔊', label: s.slot, hint: '' };
    const vol = Math.round((s.volume || 0) * 100);
    const row = document.createElement('div');
    row.className = 'snd-slot';
    row.dataset.slot = s.slot;
    row.innerHTML = `
      <div class="snd-head">
        <div class="snd-title">${meta.icon} ${meta.label}
          <span class="muted small">— ${escapeHtml(meta.hint)}</span>
        </div>
        <div class="snd-actions">
          <button class="btn ghost small" data-act="play">▶ Probar</button>
          <button class="btn ghost small" data-act="stop" title="Detener este sonido">⏹</button>
          <button class="btn ghost small" data-act="replace">📁 Reemplazar</button>
          <button class="btn danger-outline small" data-act="restore"${s.has_original ? '' : ' disabled'}>↺ Restaurar</button>
          <input type="file" accept=".mp3,.wav,.ogg,.m4a" />
        </div>
      </div>
      <div class="snd-vol">
        <span class="muted small">Volumen</span>
        <input type="range" min="0" max="100" value="${vol}" data-slotvol="${s.slot}" />
        <span class="muted small" data-volv>${vol}%</span>
      </div>
      <div class="snd-meta">
        ${s.file ? escapeHtml(s.file) : '<em>sin archivo</em>'} · ${fmtBytes(s.size)}
      </div>
      <div class="snd-drop-hint">Suelta aquí el archivo para reemplazar “${meta.label}”</div>
    `;
    box.appendChild(row);
    wireSoundSlot(row);
  }
}

function wireSoundSlot(row) {
  const slot = row.dataset.slot;
  const fileInput = row.querySelector('input[type=file]');
  const volInput = row.querySelector('input[type=range][data-slotvol]');
  const volLabel = row.querySelector('[data-volv]');

  row.querySelector('[data-act=play]').onclick = () => {
    send({ type: 'play_sound', slot });
  };
  row.querySelector('[data-act=stop]').onclick = () => {
    send({ type: 'stop_sound', slot });
  };
  row.querySelector('[data-act=replace]').onclick = () => fileInput.click();
  row.querySelector('[data-act=restore]').onclick = async () => {
    if (!confirm('¿Restaurar el sonido original?')) return;
    const res = await request('restore_sound', { slot });
    if (!res?.data?.ok) alert('No se pudo restaurar: ' + (res?.data?.error || 'desconocido'));
  };

  fileInput.onchange = () => {
    const f = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    if (f) uploadSoundFile(slot, f);
  };

  // Volumen con debounce
  let volTimer = null;
  volInput.oninput = () => {
    const v = parseInt(volInput.value, 10);
    volLabel.textContent = v + '%';
    clearTimeout(volTimer);
    volTimer = setTimeout(() => {
      send({ type: 'set_sound_config', changes: {
        slot_volume: { slot, volume: v / 100 }
      }});
    }, 150);
  };

  // Drag & drop
  row.addEventListener('dragenter', (e) => { e.preventDefault(); row.classList.add('drag-over'); });
  row.addEventListener('dragover',  (e) => { e.preventDefault(); row.classList.add('drag-over'); });
  row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
  row.addEventListener('drop', (e) => {
    e.preventDefault();
    row.classList.remove('drag-over');
    const f = e.dataTransfer?.files?.[0];
    if (f) uploadSoundFile(slot, f);
  });
}

function uploadSoundFile(slot, file) {
  const name = (file.name || '').toLowerCase();
  const dot = name.lastIndexOf('.');
  const ext = dot >= 0 ? name.slice(dot) : '';
  if (!ALLOWED_SOUND_EXT.includes(ext)) {
    alert('Formato no permitido. Usa: ' + ALLOWED_SOUND_EXT.join(', '));
    return;
  }
  if (file.size > MAX_SOUND_MB * 1024 * 1024) {
    alert(`Archivo demasiado grande (máx ${MAX_SOUND_MB} MB).`);
    return;
  }
  const reader = new FileReader();
  reader.onload = async () => {
    const b64 = String(reader.result || '').split(',')[1] || '';
    const res = await request('upload_sound', { slot, ext, data: b64 });
    if (!res?.data?.ok) alert('Error al subir: ' + (res?.data?.error || 'desconocido'));
  };
  reader.onerror = () => alert('No se pudo leer el archivo.');
  reader.readAsDataURL(file);
}

// Toggle enabled + master volume (con debounce)
let masterTimer = null;
document.addEventListener('DOMContentLoaded', () => {
  const en = $('sndEnabled');
  const master = $('sndMaster');
  const masterV = $('sndMasterV');
  if (en) en.onchange = () => {
    send({ type: 'set_sound_config', changes: { enabled: en.checked } });
  };
  const stopAllBtn = $('sndStopAll');
  if (stopAllBtn) stopAllBtn.onclick = () => {
    send({ type: 'stop_sound' });  // sin slot = parar todos
  };
  if (master) master.oninput = () => {
    masterV.textContent = master.value + '%';
    clearTimeout(masterTimer);
    masterTimer = setTimeout(() => {
      send({ type: 'set_sound_config', changes: {
        master_volume: parseInt(master.value, 10) / 100
      }});
    }, 150);
  };
});

function connect() {
  ws = new WebSocket(WS_URL);
  ws.onopen = () => {
    $('connStatus').textContent = 'conectado al núcleo';
    request('get_models').then(({ data }) => applyModels(data)).catch(() => {});
    if (!window._modelsTimer) {
      window._modelsTimer = setInterval(() => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          request('get_models').then(({ data }) => applyModels(data)).catch(() => {});
        }
      }, 5000);
    }
    pollResources();
  };
  ws.onmessage = (ev) => {
    let msg; try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.reply_id && pendingReplies.has(msg.reply_id)) {
      const resolver = pendingReplies.get(msg.reply_id);
      pendingReplies.delete(msg.reply_id);
      resolver(msg);
      return;
    }
    if (msg.type === 'state') setState(msg.value);
    else if (msg.type === 'models') applyModels(msg.data);
    else if (msg.type === 'assistant_message') { fcRemoveTyping(); fcAddMessage(msg.text, 'assistant'); }
    else if (msg.type === 'user_voice') fcAddMessage('🎤 ' + msg.text, 'user');
    else if (msg.type === 'system') fcAddMessage(msg.text, 'system');
    else if (msg.type === 'background_updated') applyBackground(msg.value, false);
    else if (msg.type === 'ion_params_updated') applyIonParams(msg.params || {}, false);
    else if (msg.type === 'part_params_updated') applyPartParams(msg.params || {}, false);
    else if (msg.type === 'quantum_params_updated') applyQuantParams(msg.params || {}, false);
    else if (msg.type === 'colors_updated') {
      if (msg.scene) applyColors(msg.scene, msg.a, msg.b, false);
      refreshColorPickers(currentSceneName());
    }
    else if (msg.type === 'colors_reset') {
      if (msg.scene && COLOR_DEFAULTS[msg.scene]) {
        colorStore[msg.scene] = Object.assign({}, COLOR_DEFAULTS[msg.scene]);
        saveColorsLS(colorStore);
        if (window.JarvisBG && window.JarvisBG.resetColors) window.JarvisBG.resetColors(msg.scene);
        if (currentSceneName() === msg.scene && window.JarvisBG) {
          window.JarvisBG.setBackground(msg.scene);
          refreshColorPickers(msg.scene);
        }
      }
    }
    else if (msg.type === 'turn') {
      const brainS = msg.latency?.brain;
      $('latBrain').textContent = (brainS ?? '—') + ' s';
      $('latVoice').textContent = (msg.latency?.voice ?? '—') + ' s';
      $('lastReply').textContent = `Última: "${(msg.reply || '').slice(0, 160)}"`;
      updateCostFromTurn(msg.tokens);
      if (brainS && brainS > 15) notify('Jarvis', 'Terminé una tarea larga');
    } else if (msg.type === 'sounds_updated') {
      renderSounds(msg.data);
    } else if (msg.type === 'vault_touches') {
      // Si estamos en la pestaña grafo, refrescar nodos (sutil: recargar grafo cada tanto)
      if (document.querySelector('.tab-panel.active')?.id === 'tab-grafo') {
        clearTimeout(window._graphDebounce);
        window._graphDebounce = setTimeout(loadGraph, 500);
      }
    }
  };
  ws.onclose = () => {
    $('connStatus').textContent = 'desconectado — reintentando…';
    setState('offline');
    setTimeout(connect, 1500);
  };
  ws.onerror = () => { try { ws.close(); } catch {} };
}

connect();

// --- Selector de animación de fondo ---
function applyBackground(name, broadcast) {
  const value = ['neural','iondrive','particles','quantum'].includes(name) ? name : 'neural';
  try { localStorage.setItem('jarvis-bg', value); } catch {}
  const sel = $('cfgBackground');
  if (sel && sel.value !== value) sel.value = value;
  const ionAdmin  = $('ionAdmin');
  const partAdmin = $('partAdmin');
  const quantAdmin = $('quantumAdmin');
  if (ionAdmin)   ionAdmin.style.display   = (value === 'iondrive')  ? 'block' : 'none';
  if (partAdmin)  partAdmin.style.display  = (value === 'particles') ? 'block' : 'none';
  if (quantAdmin) quantAdmin.style.display = (value === 'quantum')   ? 'block' : 'none';
  // Al cambiar de escena, refrescamos los color pickers con los de esa escena
  refreshColorPickers(value);
  if (window.JarvisBG && window.JarvisBG.setBackground) {
    window.JarvisBG.setBackground(value);
  }
  if (broadcast && ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'set_background', value }));
  }
}
(function initBgSelector() {
  const sel = $('cfgBackground');
  if (!sel) return;
  let saved = 'neural';
  try { saved = localStorage.getItem('jarvis-bg') || 'neural'; } catch {}
  sel.value = saved;
  const ionAdmin  = $('ionAdmin');
  const partAdmin = $('partAdmin');
  const quantAdmin = $('quantumAdmin');
  if (ionAdmin)   ionAdmin.style.display   = (saved === 'iondrive')  ? 'block' : 'none';
  if (partAdmin)  partAdmin.style.display  = (saved === 'particles') ? 'block' : 'none';
  if (quantAdmin) quantAdmin.style.display = (saved === 'quantum')   ? 'block' : 'none';
  sel.onchange = () => applyBackground(sel.value, true);
})();

// ================================================================
//  Colores por escena (restaurar solo colores)
// ================================================================
const COLOR_DEFAULTS = {
  neural:    { a: '#5b8cff', b: '#5b8cff' },
  iondrive:  { a: '#ff8c3c', b: '#05070d' },
  particles: { a: '#5bc8ff', b: '#ff5bd0' },
  quantum:   { a: '#667eea', b: '#f093fb' },
};
function loadColorsLS() {
  try {
    const raw = localStorage.getItem('jarvis-colors');
    if (raw) return Object.assign({}, COLOR_DEFAULTS, JSON.parse(raw));
  } catch {}
  return JSON.parse(JSON.stringify(COLOR_DEFAULTS));
}
function saveColorsLS(c) {
  try { localStorage.setItem('jarvis-colors', JSON.stringify(c)); } catch {}
}
let colorStore = loadColorsLS();
function currentSceneName() {
  const sel = $('cfgBackground');
  return (sel && sel.value) || 'neural';
}
function refreshColorPickers(sceneName) {
  const s = sceneName || currentSceneName();
  const c = colorStore[s] || COLOR_DEFAULTS[s];
  const a = $('cfgColorA'), b = $('cfgColorB');
  if (a) a.value = c.a;
  if (b) b.value = c.b;
}
function applyColors(sceneName, a, b, broadcast) {
  if (!colorStore[sceneName]) colorStore[sceneName] = {};
  if (a) colorStore[sceneName].a = a;
  if (b) colorStore[sceneName].b = b;
  saveColorsLS(colorStore);
  if (window.JarvisBG && window.JarvisBG.setColors) {
    window.JarvisBG.setColors(sceneName, a, b, false);
  }
  if (broadcast && ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'set_colors',
      scene: sceneName, a: a || null, b: b || null }));
  }
}
(function initColorPickers() {
  const a = $('cfgColorA'), b = $('cfgColorB'), reset = $('colorsReset');
  if (!a || !b) return;
  refreshColorPickers();
  let dbA = null, dbB = null;
  a.oninput = () => {
    const s = currentSceneName();
    applyColors(s, a.value, null, false);
    clearTimeout(dbA);
    dbA = setTimeout(() => applyColors(s, a.value, null, true), 150);
  };
  b.oninput = () => {
    const s = currentSceneName();
    applyColors(s, null, b.value, false);
    clearTimeout(dbB);
    dbB = setTimeout(() => applyColors(s, null, b.value, true), 150);
  };
  if (reset) reset.onclick = () => {
    const s = currentSceneName();
    const def = COLOR_DEFAULTS[s];
    colorStore[s] = Object.assign({}, def);
    saveColorsLS(colorStore);
    refreshColorPickers(s);
    if (window.JarvisBG && window.JarvisBG.resetColors) window.JarvisBG.resetColors(s);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'reset_colors', scene: s }));
    }
    // Rebuild escena para que repinte materiales base
    if (window.JarvisBG && window.JarvisBG.setBackground) {
      window.JarvisBG.setBackground(s);
    }
  };
})();

// ================================================================
//  Sliders de partículas (en vivo)
// ================================================================
const PART_DEFAULTS = {
  bloomStrength: 1.20, bloomRadius: 0.55, bloomThreshold: 0.00, exposure: 1.00,
  particleCount: 220, linkDistance: 2.4, speed: 0.6, spread: 10,
  lineOpacity: 0.35, pointSize: 3.0,
};
function loadPartCfg() {
  try {
    const raw = localStorage.getItem('jarvis-particles');
    if (raw) return Object.assign({}, PART_DEFAULTS, JSON.parse(raw));
  } catch {}
  return Object.assign({}, PART_DEFAULTS);
}
const PART_MAP = [
  ['partBloomS', 'bloomStrength',  v => v.toFixed(2)],
  ['partBloomR', 'bloomRadius',    v => v.toFixed(2)],
  ['partBloomT', 'bloomThreshold', v => v.toFixed(2)],
  ['partExp',    'exposure',       v => v.toFixed(2)],
  ['partCount',  'particleCount',  v => v.toFixed(0)],
  ['partLink',   'linkDistance',   v => v.toFixed(1)],
  ['partSpeed',  'speed',          v => v.toFixed(2)],
  ['partSpread', 'spread',         v => v.toFixed(1)],
  ['partSize',   'pointSize',      v => v.toFixed(1)],
  ['partLineOp', 'lineOpacity',    v => v.toFixed(2)],
];
function applyPartParams(params, broadcast) {
  try { localStorage.setItem('jarvis-particles', JSON.stringify(params)); } catch {}
  if (window.JarvisBG && window.JarvisBG.setPartParams) {
    window.JarvisBG.setPartParams(params, false);
  }
  for (const [id, key, fmt] of PART_MAP) {
    const inp = $(id), lab = $(id + 'V');
    if (!inp) continue;
    if (parseFloat(inp.value) !== params[key]) inp.value = params[key];
    if (lab) lab.textContent = fmt(params[key]);
  }
  if (broadcast && ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'set_part_params', params }));
  }
}
(function initPartSliders() {
  const current = loadPartCfg();
  applyPartParams(current, false);
  let debounce = null;
  for (const [id, key] of PART_MAP) {
    const inp = $(id);
    if (!inp) continue;
    inp.oninput = () => {
      current[key] = parseFloat(inp.value);
      applyPartParams(current, false);
      clearTimeout(debounce);
      debounce = setTimeout(() => applyPartParams(current, true), 150);
    };
  }
  const reset = $('partReset');
  if (reset) reset.onclick = () => applyPartParams(Object.assign({}, PART_DEFAULTS), true);
})();

// ================================================================
//  Sliders de la escena quantum (en vivo)
// ================================================================
const QUANT_DEFAULTS = {
  bloomStrength: 1.80, bloomRadius: 0.60, bloomThreshold: 0.70, exposure: 1.00,
  scale: 1.00, nodeBrightness: 1.00, edgeOpacity: 0.55,
  flowSpeed: 1.40, flowBrightness: 1.60, starBrightness: 0.90,
  bgColor: '#050508', starColor: '#ffffff',
};
function loadQuantCfg() {
  try {
    const raw = localStorage.getItem('jarvis-quantum');
    if (raw) return Object.assign({}, QUANT_DEFAULTS, JSON.parse(raw));
  } catch {}
  return Object.assign({}, QUANT_DEFAULTS);
}
const QUANT_MAP = [
  ['quantBloomS', 'bloomStrength',  v => v.toFixed(2)],
  ['quantBloomR', 'bloomRadius',    v => v.toFixed(2)],
  ['quantBloomT', 'bloomThreshold', v => v.toFixed(2)],
  ['quantExp',    'exposure',       v => v.toFixed(2)],
  ['quantScale',  'scale',          v => v.toFixed(2)],
  ['quantNode',   'nodeBrightness', v => v.toFixed(2)],
  ['quantEdge',   'edgeOpacity',    v => v.toFixed(2)],
  ['quantFlowS',  'flowSpeed',      v => v.toFixed(2)],
  ['quantFlowB',  'flowBrightness', v => v.toFixed(2)],
  ['quantStar',   'starBrightness', v => v.toFixed(2)],
];
const QUANT_COLOR_MAP = [
  ['quantBg',      'bgColor'],
  ['quantStarCol', 'starColor'],
];
function applyQuantParams(params, broadcast) {
  try { localStorage.setItem('jarvis-quantum', JSON.stringify(params)); } catch {}
  if (window.JarvisBG && window.JarvisBG.setQuantumParams) {
    window.JarvisBG.setQuantumParams(params, false);
  }
  for (const [id, key, fmt] of QUANT_MAP) {
    const inp = $(id), lab = $(id + 'V');
    if (!inp) continue;
    if (parseFloat(inp.value) !== params[key]) inp.value = params[key];
    if (lab) lab.textContent = fmt(params[key]);
  }
  for (const [id, key] of QUANT_COLOR_MAP) {
    const inp = $(id);
    if (inp && inp.value !== params[key]) inp.value = params[key];
  }
  if (broadcast && ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'set_quantum_params', params }));
  }
}
(function initQuantSliders() {
  const current = loadQuantCfg();
  applyQuantParams(current, false);
  let debounce = null;
  const schedule = () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => applyQuantParams(current, true), 150);
  };
  for (const [id, key] of QUANT_MAP) {
    const inp = $(id);
    if (!inp) continue;
    inp.oninput = () => {
      current[key] = parseFloat(inp.value);
      applyQuantParams(current, false);
      schedule();
    };
  }
  for (const [id, key] of QUANT_COLOR_MAP) {
    const inp = $(id);
    if (!inp) continue;
    inp.oninput = () => {
      current[key] = inp.value;
      applyQuantParams(current, false);
      schedule();
    };
  }
  const reset = $('quantReset');
  if (reset) reset.onclick = () => applyQuantParams(Object.assign({}, QUANT_DEFAULTS), true);
})();

// --- Sliders de ajuste en vivo del iondrive ---
const ION_DEFAULTS = {
  bloomStrength: 0.86, bloomRadius: 0.59, bloomThreshold: 0.10,
  exposure: 1.11,
  maxRpm: 3.0, scale: 1.0, cameraDist: 4.5,
  rotXOffset: 0.0, rotYOffset: Math.PI / 2, rotZOffset: 0.0,
};
function loadIonCfg() {
  try {
    const raw = localStorage.getItem('jarvis-iondrive');
    if (raw) return Object.assign({}, ION_DEFAULTS, JSON.parse(raw));
  } catch {}
  return Object.assign({}, ION_DEFAULTS);
}
// map: [elementId, paramKey, formatValue, isAngle]
const ION_MAP = [
  ['ionBloomS', 'bloomStrength',  v => v.toFixed(2),              false],
  ['ionBloomR', 'bloomRadius',    v => v.toFixed(2),              false],
  ['ionBloomT', 'bloomThreshold', v => v.toFixed(2),              false],
  ['ionExp',    'exposure',       v => v.toFixed(2),              false],
  ['ionRpm',    'maxRpm',         v => v.toFixed(1) + ' rev/s',   false],
  ['ionScale',  'scale',          v => v.toFixed(2) + '×',        false],
  ['ionCam',    'cameraDist',     v => v.toFixed(1),              false],
  ['ionRotX',   'rotXOffset',     v => (v*180/Math.PI).toFixed(0) + '°', true],
  ['ionRotY',   'rotYOffset',     v => (v*180/Math.PI).toFixed(0) + '°', true],
  ['ionRotZ',   'rotZOffset',     v => (v*180/Math.PI).toFixed(0) + '°', true],
];
function applyIonParams(params, broadcast) {
  try { localStorage.setItem('jarvis-iondrive', JSON.stringify(params)); } catch {}
  if (window.JarvisBG && window.JarvisBG.setIonParams) {
    window.JarvisBG.setIonParams(params, false);
  }
  for (const [id, key, fmt, isAngle] of ION_MAP) {
    const inp = $(id); const lab = $(id + 'V');
    if (!inp) continue;
    const uiVal = isAngle ? (params[key] * 180 / Math.PI) : params[key];
    if (parseFloat(inp.value) !== uiVal) inp.value = uiVal;
    if (lab) lab.textContent = fmt(params[key]);
  }
  if (broadcast && ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'set_ion_params', params }));
  }
}
(function initIonSliders() {
  const current = loadIonCfg();
  applyIonParams(current, false);
  let debounce = null;
  for (const [id, key, , isAngle] of ION_MAP) {
    const inp = $(id);
    if (!inp) continue;
    inp.oninput = () => {
      const v = parseFloat(inp.value);
      current[key] = isAngle ? (v * Math.PI / 180) : v;
      applyIonParams(current, false);
      clearTimeout(debounce);
      debounce = setTimeout(() => applyIonParams(current, true), 120);
    };
  }
  const reset = $('ionReset');
  if (reset) reset.onclick = () => applyIonParams(Object.assign({}, ION_DEFAULTS), true);
})();

// --- Sonido de inicio (mismo flujo que el widget) ---
let startupPlayed = false;
function tryStartup() {
  if (startupPlayed) return;
  startupPlayed = true;
  if (window.JarvisSound) window.JarvisSound.playStartup();
}
window.addEventListener('load', () => setTimeout(tryStartup, 300));
// Fallback: primer gesto del usuario desbloquea autoplay si Chromium se negó.
window.addEventListener('pointerdown', tryStartup, { once: true });

// ============================================================
//  Chat flotante (widget embebido en el dashboard)
// ============================================================
const fcMessagesEl = $('fcMessages');
const fcTextEl     = $('fcText');
const fcSendEl     = $('fcSendBtn');
const fcMicEl      = $('fcMicBtn');
const fcMinEl      = $('fcMinBtn');
const fcOpenEl     = $('fcOpenBtn');
const fcPanel      = $('floatingChat');
let fcTypingEl = null;
let fcMicOn = false;

function fcAddMessage(text, who) {
  if (!fcMessagesEl) return;
  const el = document.createElement('div');
  el.className = 'fc-msg ' + who;
  el.textContent = text;
  fcMessagesEl.appendChild(el);
  fcMessagesEl.scrollTop = fcMessagesEl.scrollHeight;
}
function fcShowTyping() {
  if (!fcMessagesEl || fcTypingEl) return;
  fcTypingEl = document.createElement('div');
  fcTypingEl.className = 'fc-msg assistant';
  fcTypingEl.innerHTML = '<span class="fc-typing"><span></span><span></span><span></span></span>';
  fcMessagesEl.appendChild(fcTypingEl);
  fcMessagesEl.scrollTop = fcMessagesEl.scrollHeight;
}
function fcRemoveTyping() {
  if (fcTypingEl) { fcTypingEl.remove(); fcTypingEl = null; }
}
function fcSendMsg() {
  if (!fcTextEl) return;
  const text = fcTextEl.value.trim();
  if (!text || !ws || ws.readyState !== WebSocket.OPEN) return;
  fcAddMessage(text, 'user');
  ws.send(JSON.stringify({ type: 'user_message', text }));
  fcTextEl.value = '';
}
if (fcSendEl) fcSendEl.onclick = fcSendMsg;
if (fcTextEl) fcTextEl.addEventListener('keydown', e => { if (e.key === 'Enter') fcSendMsg(); });
if (fcMicEl) fcMicEl.onclick = () => {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: 'toggle_ears' }));
};
if (fcMinEl) fcMinEl.onclick = () => {
  fcPanel.classList.add('collapsed');
  fcOpenEl.classList.add('visible');
};
if (fcOpenEl) fcOpenEl.onclick = () => {
  fcPanel.classList.remove('collapsed');
  fcOpenEl.classList.remove('visible');
};
