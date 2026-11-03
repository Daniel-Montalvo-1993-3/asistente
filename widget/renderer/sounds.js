// --- Sonidos del widget (archivos reales en audio/) ---
// API pública:
//   window.JarvisSound.setState(state)
//   window.JarvisSound.playStartup()
//   window.JarvisSound.playSlot(slot)                -> reproduce un slot concreto
//   window.JarvisSound.previewSlot(slot)             -> previsualización: SIN loop, máx 3 s
//   window.JarvisSound.stopSlot(slot)                -> para un slot
//   window.JarvisSound.stopAll()                     -> para todos los sonidos
//   window.JarvisSound.setEnabled(bool)
//   window.JarvisSound.isEnabled()
//   window.JarvisSound.setMasterVolume(0..1)
//   window.JarvisSound.setSlotVolume(slot, 0..1)
//   window.JarvisSound.reloadSlot(slot)              -> re-carga tras upload/restore
//   window.JarvisSound.applyConfig({enabled, master_volume, slots:[{slot,volume,file,ext}]})
//
// Slots: inicio, escuchar, pensando, termino.
// Pensando se reproduce en loop; los demás "one-shot".

(function () {
  // Permite que el dashboard (que vive en otra carpeta) sobreescriba la base
  // antes de cargar este script poniendo window.JARVIS_AUDIO_BASE.
  const BASE = (typeof window !== 'undefined' && window.JARVIS_AUDIO_BASE)
    ? window.JARVIS_AUDIO_BASE
    : 'audio/';
  const SLOTS = ['inicio', 'escuchar', 'pensando', 'termino'];
  const EXT_FALLBACK = ['.mp3', '.wav', '.ogg', '.m4a'];

  let enabled = true;
  let masterVolume = 0.6;
  const slotVolume = { inicio: 1, escuchar: 1, pensando: 1, termino: 1 };
  const slotFile = { inicio: 'inicio.mp3', escuchar: 'escuchar.mp3',
                     pensando: 'pensando.mp3', termino: 'termino.mp3' };
  const nodes = {};  // slot -> Audio
  let unlocked = false;
  let pendingStartup = false;
  let currentState = null;

  function makeAudio(slot) {
    const a = new Audio(BASE + slotFile[slot] + '?v=' + Date.now());
    a.preload = 'auto';
    a.loop = (slot === 'pensando');
    a.volume = masterVolume * slotVolume[slot];
    return a;
  }

  function ensureAll() {
    for (const s of SLOTS) if (!nodes[s]) nodes[s] = makeAudio(s);
  }

  function applyVolumes() {
    for (const s of SLOTS) {
      if (nodes[s]) nodes[s].volume = masterVolume * slotVolume[s];
    }
  }

  function play(slot) {
    if (!enabled) return;
    ensureAll();
    const a = nodes[slot];
    if (!a) return;
    try {
      a.currentTime = 0;
      const p = a.play();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch {}
  }

  function stop(slot) {
    const a = nodes[slot];
    if (!a) return;
    try { a.pause(); a.currentTime = 0; } catch {}
    // Si estaba en modo preview, cancela su timer de parada.
    if (previewTimers[slot]) {
      clearTimeout(previewTimers[slot]);
      delete previewTimers[slot];
    }
  }

  function stopAll() {
    for (const s of SLOTS) stop(s);
  }

  // Reproducción de prueba desde el dashboard: sin loop y con parada
  // automática a los 3 s. Así nunca se queda sonando en bucle.
  const previewTimers = {};
  const PREVIEW_MAX_MS = 3000;
  function preview(slot) {
    if (!enabled) return;
    ensureAll();
    const a = nodes[slot];
    if (!a) return;
    // Cancelar un preview previo del mismo slot
    stop(slot);
    const originalLoop = a.loop;
    a.loop = false;
    try {
      a.currentTime = 0;
      const p = a.play();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch {}
    previewTimers[slot] = setTimeout(() => {
      try { a.pause(); a.currentTime = 0; } catch {}
      a.loop = originalLoop;  // restaura el loop para su uso real
      delete previewTimers[slot];
    }, PREVIEW_MAX_MS);
  }

  function playStartup() {
    if (!enabled) return;
    // Intentamos desbloquear ya mismo. En Electron el switch
    // 'autoplay-policy=no-user-gesture-required' permite el play() sin gesto.
    unlock();
    play('inicio');
  }

  // Al arrancar la app, el servidor hace broadcast de su estado actual.
  // Si estaba en 'thinking' o 'recording' heredado de la sesión anterior,
  // disparar el loop de 'pensando' o el chirp de 'escuchar' sería incorrecto
  // (el usuario no inició nada). Durante los primeros 1500 ms tratamos
  // cualquier estado como "snapshot" y solo sincronizamos currentState sin
  // reproducir nada. Después, transiciones normales.
  const START_SILENCE_MS = 1500;
  const bootAt = Date.now();

  // Si la ventana queda oculta (al cambiar entre widget y dashboard), paramos
  // todos los sonidos en loop para que no sigan sonando en segundo plano.
  // Al volver visible, si el estado sigue siendo 'thinking' lo reactivamos.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stop('pensando');
    } else if (enabled && currentState === 'thinking') {
      play('pensando');
    }
  });

  function applyState(state) {
    if (!enabled) {
      stop('pensando');
      currentState = state;
      return;
    }
    if (Date.now() - bootAt < START_SILENCE_MS) {
      currentState = state;
      return;
    }
    const wasThinking = currentState === 'thinking';
    const isThinking  = state === 'thinking';
    if (isThinking && !wasThinking) play('pensando');
    if (!isThinking && wasThinking) stop('pensando');
    if (state === 'recording' && currentState !== 'recording') play('escuchar');
    if (state === 'idle' && currentState === 'speaking') play('termino');
    currentState = state;
  }

  function unlock() {
    if (unlocked) return;
    unlocked = true;
    ensureAll();
    // Desbloquea autoplay reproduciendo cada clip en silencio una vez
    for (const s of SLOTS) {
      const a = nodes[s];
      try {
        a.muted = true;
        const p = a.play();
        if (p && typeof p.then === 'function') {
          p.then(() => { try { a.pause(); a.currentTime = 0; a.muted = false; } catch {} })
           .catch(() => { a.muted = false; });
        } else {
          a.pause(); a.currentTime = 0; a.muted = false;
        }
      } catch {}
    }
    if (pendingStartup) {
      pendingStartup = false;
      setTimeout(() => play('inicio'), 120);
    }
  }
  window.addEventListener('click', unlock, { once: false });
  window.addEventListener('keydown', unlock, { once: false });

  function reloadSlot(slot) {
    if (!SLOTS.includes(slot)) return;
    try {
      if (nodes[slot]) {
        nodes[slot].pause();
        nodes[slot].src = '';
      }
    } catch {}
    nodes[slot] = makeAudio(slot);
  }

  function applyConfig(cfg) {
    if (!cfg) return;
    if (typeof cfg.enabled === 'boolean') enabled = cfg.enabled;
    if (typeof cfg.master_volume === 'number') masterVolume = Math.max(0, Math.min(1, cfg.master_volume));
    if (Array.isArray(cfg.slots)) {
      for (const s of cfg.slots) {
        if (!SLOTS.includes(s.slot)) continue;
        if (typeof s.volume === 'number') {
          slotVolume[s.slot] = Math.max(0, Math.min(1, s.volume));
        }
        if (s.file && s.file !== slotFile[s.slot]) {
          slotFile[s.slot] = s.file;
          reloadSlot(s.slot);
        }
      }
    }
    applyVolumes();
    if (!enabled) stop('pensando');
  }

  window.JarvisSound = {
    setState: applyState,
    playStartup,
    playSlot: play,
    previewSlot: preview,
    stopSlot: stop,
    stopAll,
    setEnabled(v) {
      enabled = !!v;
      if (!enabled) stopAll();
    },
    isEnabled() { return enabled; },
    setMasterVolume(v) {
      masterVolume = Math.max(0, Math.min(1, v));
      applyVolumes();
    },
    setSlotVolume(slot, v) {
      if (!SLOTS.includes(slot)) return;
      slotVolume[slot] = Math.max(0, Math.min(1, v));
      applyVolumes();
    },
    reloadSlot,
    applyConfig,
    // compat
    setVolume(v) { this.setMasterVolume(v); },
  };
})();
