// ---- Conexión con el núcleo (Python) por WebSocket local ----
const WS_URL = 'ws://127.0.0.1:8765';

const messagesEl = document.getElementById('messages');
const inputEl = document.getElementById('input');
const sendBtn = document.getElementById('sendBtn');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const micBtn = document.getElementById('micBtn');

let ws = null;
let typingEl = null;

// ---- Controles de ventana ----
document.getElementById('closeBtn').onclick = () => window.jarvis.quit();
document.getElementById('minBtn').onclick = () => window.jarvis.minimize();
document.getElementById('dashBtn').onclick = () => window.jarvis.openDashboard();

// ---- Toggle de sonidos (persistente) ----
const soundBtn = document.getElementById('soundBtn');
function applySoundPref(on) {
  if (window.JarvisSound) window.JarvisSound.setEnabled(on);
  soundBtn.textContent = on ? '🔊' : '🔇';
  soundBtn.title = on ? 'Silenciar sonidos' : 'Activar sonidos';
  try { localStorage.setItem('jarvis-sound', on ? '1' : '0'); } catch {}
}
try {
  const saved = localStorage.getItem('jarvis-sound');
  applySoundPref(saved === null ? true : saved === '1');
} catch { applySoundPref(true); }
soundBtn.onclick = () => {
  const on = window.JarvisSound ? !window.JarvisSound.isEnabled() : true;
  applySoundPref(on);
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'set_sound_config', changes: { enabled: on }
    }));
  }
};

// Prender / apagar el micrófono (el oído)
micBtn.onclick = () => {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'toggle_ears' }));
  }
};

// ---- Estado visual ----
function setState(state) {
  statusDot.className = 'dot ' + state;
  // Avisa al fondo animado (shader) para que cambie velocidad y tinte.
  if (window.JarvisBG) window.JarvisBG.setState(state);
  // Y al audio para que suene / silencie el "pensando".
  if (window.JarvisSound) window.JarvisSound.setState(state);
  const labels = {
    idle: 'listo',
    listening: '🎙️ di "Oye Jarvis"',
    recording: '🔴 escuchando…',
    transcribing: 'revisando audio…',
    thinking: 'pensando…',
    speaking: 'hablando…',
    ear_error: 'micrófono con error',
    ears_off: '🔇 micrófono apagado',
    offline: 'sin conexión'
  };
  statusText.textContent = labels[state] || state;

  // Reflejar el estado del micrófono en el botón
  if (state === 'ears_off') {
    micBtn.classList.add('muted');
    micBtn.textContent = '🔇';
  } else if (['listening', 'recording', 'transcribing', 'thinking', 'speaking', 'idle'].includes(state)) {
    micBtn.classList.remove('muted');
    micBtn.textContent = '🎤';
  }

  // Solo mostramos "pensando…" cuando el cerebro corre de verdad.
  // Durante 'transcribing' puede ser solo ruido/respiración sin wake word,
  // así que no engañamos al usuario con la burbuja.
  if (state === 'thinking') showTyping();
  else removeTyping();

  const busy = ['thinking', 'speaking', 'recording', 'transcribing'].includes(state);
  inputEl.disabled = busy;
  sendBtn.disabled = busy;
  if (!busy) inputEl.focus();
}

// ---- Mensajes en pantalla ----
function addMessage(text, who) {
  const el = document.createElement('div');
  el.className = 'msg ' + who;
  el.textContent = text;
  messagesEl.appendChild(el);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function showTyping() {
  if (typingEl) return;
  typingEl = document.createElement('div');
  typingEl.className = 'msg assistant';
  typingEl.innerHTML = '<span class="typing"><span></span><span></span><span></span></span>';
  messagesEl.appendChild(typingEl);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function removeTyping() {
  if (typingEl) { typingEl.remove(); typingEl = null; }
}

// ---- Enviar ----
function send() {
  const text = inputEl.value.trim();
  if (!text || !ws || ws.readyState !== WebSocket.OPEN) return;
  addMessage(text, 'user');
  ws.send(JSON.stringify({ type: 'user_message', text }));
  inputEl.value = '';
}

sendBtn.onclick = send;
inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') send();
});

// ---- Conexión (con reconexión automática) ----
function connect() {
  ws = new WebSocket(WS_URL);

  ws.onopen = () => setState('idle');

  ws.onmessage = (event) => {
    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }

    if (msg.type === 'state') {
      setState(msg.value);
    } else if (msg.type === 'assistant_message') {
      removeTyping();
      addMessage(msg.text, 'assistant');
    } else if (msg.type === 'user_voice') {
      addMessage('🎤 ' + msg.text, 'user');
    } else if (msg.type === 'system') {
      addMessage(msg.text, 'system');
    } else if (msg.type === 'sounds_updated') {
      // El dashboard (o el núcleo al conectar) nos manda la config actual.
      if (window.JarvisSound) {
        window.JarvisSound.applyConfig(msg.data);
        // Refleja el estado del toggle 🔊/🔇 del titlebar
        applySoundPref(!!msg.data.enabled);
      }
    } else if (msg.type === 'play_sound') {
      // Siempre viene del dashboard como prueba; usa previsualización
      // (sin loop, parada automática a 3 s).
      if (window.JarvisSound && msg.slot) window.JarvisSound.previewSlot(msg.slot);
    } else if (msg.type === 'background_updated') {
      const v = ['neural','iondrive','particles','quantum'].includes(msg.value) ? msg.value : 'neural';
      try { localStorage.setItem('jarvis-bg', v); } catch {}
      if (window.JarvisBG && window.JarvisBG.setBackground) window.JarvisBG.setBackground(v);
    } else if (msg.type === 'ion_params_updated') {
      if (window.JarvisBG && window.JarvisBG.setIonParams) {
        window.JarvisBG.setIonParams(msg.params || {}, true);
      }
    } else if (msg.type === 'part_params_updated') {
      if (window.JarvisBG && window.JarvisBG.setPartParams) {
        window.JarvisBG.setPartParams(msg.params || {}, true);
      }
    } else if (msg.type === 'quantum_params_updated') {
      if (window.JarvisBG && window.JarvisBG.setQuantumParams) {
        window.JarvisBG.setQuantumParams(msg.params || {}, true);
      }
    } else if (msg.type === 'colors_updated') {
      if (window.JarvisBG && window.JarvisBG.setColors && msg.scene) {
        window.JarvisBG.setColors(msg.scene, msg.a, msg.b, true);
        // Si estamos en esa escena, rebuild para repintar materiales base
        if (window.JarvisBG.getBackground && window.JarvisBG.getBackground() === msg.scene) {
          window.JarvisBG.setBackground(msg.scene);
        }
      }
    } else if (msg.type === 'colors_reset') {
      if (window.JarvisBG && window.JarvisBG.resetColors && msg.scene) {
        window.JarvisBG.resetColors(msg.scene);
        if (window.JarvisBG.getBackground && window.JarvisBG.getBackground() === msg.scene) {
          window.JarvisBG.setBackground(msg.scene);
        }
      }
    } else if (msg.type === 'stop_sound') {
      if (!window.JarvisSound) return;
      if (msg.slot) window.JarvisSound.stopSlot(msg.slot);
      else window.JarvisSound.stopAll();
    }
  };

  ws.onclose = () => {
    setState('offline');
    setTimeout(connect, 1500); // reintenta
  };

  ws.onerror = () => { ws.close(); };
}

setState('offline');
statusText.textContent = 'conectando…';
connect();

// Sonido de bienvenida al abrir el widget (una sola vez por sesión).
// Si el navegador bloquea autoplay, se dispara en el primer gesto del usuario.
let startupPlayed = false;
function tryStartup() {
  if (startupPlayed) return;
  startupPlayed = true;
  if (window.JarvisSound) window.JarvisSound.playStartup();
}
// Intenta al cargar y también cuando conecte el WS, lo que llegue primero gana.
window.addEventListener('load', () => setTimeout(tryStartup, 300));
