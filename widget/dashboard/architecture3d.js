// Diagrama 3D de la arquitectura de Jarvis.
// Three.js vía importmap (ya cargado en index.html). Nodos agrupados por zona,
// aristas con partículas viajando, bloom holográfico, OrbitControls, hover.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

const ZONES = {
  voz:      { color: 0x22d3ee, label: 'Voz' },
  cerebro:  { color: 0x5b8cff, label: 'Cerebro' },
  memoria:  { color: 0x4ade80, label: 'Memoria' },
  ui:       { color: 0xfbbf24, label: 'UI' },
  sistema:  { color: 0xef4466, label: 'Sistema' },
};

// Nodos del sistema. x,y,z en espacio del diagrama.
const NODES = [
  { id: 'mic',      zone: 'voz',     label: '🎤 Micrófono',   desc: 'Captura WASAPI exclusivo 24-bit',          proto: 'PCM 48kHz int32', pos: [-6,  3.5,  2] },
  { id: 'ears',     zone: 'voz',     label: 'Ears (Whisper)', desc: 'faster-whisper small, VAD por energía',    proto: 'remuestreo→16k',  pos: [-3,  2.5,  1] },
  { id: 'server',   zone: 'ui',      label: 'Núcleo (WS)',    desc: 'Server Python, WebSocket :8765',           proto: 'ws://127.0.0.1:8765', pos: [ 0,  0,  0] },
  { id: 'brain',    zone: 'cerebro', label: 'Brain',          desc: 'Enruta a Claude Pro u Ollama',             proto: 'stdin/stdout',    pos: [ 2.5, 2,  -1] },
  { id: 'claude',   zone: 'cerebro', label: 'Claude CLI',     desc: 'claude -p · login Pro · tools permitidos', proto: 'claude.exe -p',   pos: [ 5.5, 3.5, -2] },
  { id: 'ollama',   zone: 'cerebro', label: 'Ollama local',   desc: 'Qwen 2.5 Coder 7B · GPU RTX 2070',          proto: 'HTTP :11434',     pos: [ 5.5, 1,   1] },
  { id: 'vault',    zone: 'memoria', label: 'Vault Obsidian', desc: 'Lectura/escritura directa de .md',         proto: 'filesystem',      pos: [ 2.5, -2,  2.5] },
  { id: 'piper',    zone: 'voz',     label: 'Piper TTS',      desc: 'Voz es_MX-claude-high',                    proto: 'PiperVoice.load',  pos: [-3, -2,  1] },
  { id: 'speaker',  zone: 'voz',     label: '🔊 Altavoces',   desc: 'winsound (Win) / afplay (Mac)',            proto: 'WAV',             pos: [-6, -3,  2] },
  { id: 'widget',   zone: 'ui',      label: 'Widget flotante',desc: 'Electron always-on-top',                   proto: 'WS cliente',      pos: [-3,  0, -3] },
  { id: 'dashboard',zone: 'ui',      label: 'Dashboard',      desc: 'Pestañas · métricas · controles',          proto: 'WS cliente',      pos: [ 3,  0, -4] },
  { id: 'platform', zone: 'sistema', label: 'Platform Layer', desc: 'Fase 4: apps, FS, web, sistema',           proto: 'subprocess',       pos: [ 0,  3, -2.5] },
  { id: 'os',       zone: 'sistema', label: 'Windows 11',     desc: 'Comandos del SO · webbrowser · psutil',    proto: 'nativo',          pos: [ 0,  4.5, -4.5] },
  { id: 'web',      zone: 'sistema', label: 'Web',            desc: 'WebSearch / WebFetch (vía Claude)',        proto: 'HTTPS',           pos: [ 6,  4.5, -4] },
];

// Aristas: {from, to, proto, bidir?, dash?}
const EDGES = [
  { from: 'mic',      to: 'ears',     proto: 'audio PCM' },
  { from: 'ears',     to: 'server',   proto: 'texto + wake' },
  { from: 'widget',   to: 'server',   proto: 'WS JSON', bidir: true },
  { from: 'dashboard',to: 'server',   proto: 'WS JSON', bidir: true },
  { from: 'server',   to: 'brain',    proto: 'prompt' },
  { from: 'brain',    to: 'claude',   proto: 'stdin', bidir: true },
  { from: 'brain',    to: 'ollama',   proto: 'HTTP',  bidir: true },
  { from: 'claude',   to: 'vault',    proto: 'FS Read/Write', bidir: true },
  { from: 'claude',   to: 'platform', proto: 'Bash tool' },
  { from: 'platform', to: 'os',       proto: 'subprocess' },
  { from: 'claude',   to: 'web',      proto: 'WebFetch' },
  { from: 'brain',    to: 'server',   proto: 'respuesta' },
  { from: 'server',   to: 'piper',    proto: 'texto' },
  { from: 'piper',    to: 'speaker',  proto: 'WAV' },
];

let initialized = false;
let scene, camera, renderer, controls, composer, bloomPass;
let container, tooltip, raf, nodeMeshes, edgeTubes, flows;
let autoRotate = true, showLabels = true, useBloom = true;

function makeLabelSprite(text, color) {
  const canvas = document.createElement('canvas');
  const pad = 12, fontSize = 44;
  const ctx = canvas.getContext('2d');
  ctx.font = `600 ${fontSize}px system-ui, -apple-system, Segoe UI, Roboto`;
  const w = Math.ceil(ctx.measureText(text).width) + pad * 2;
  const h = fontSize + pad * 2;
  canvas.width = w; canvas.height = h;
  ctx.font = `600 ${fontSize}px system-ui, -apple-system, Segoe UI, Roboto`;
  ctx.fillStyle = 'rgba(10,14,26,0.72)';
  ctx.strokeStyle = `rgba(${(color>>16)&255},${(color>>8)&255},${color&255},0.6)`;
  ctx.lineWidth = 2;
  const r = 14;
  ctx.beginPath();
  ctx.moveTo(r, 0); ctx.lineTo(w-r, 0); ctx.quadraticCurveTo(w, 0, w, r);
  ctx.lineTo(w, h-r); ctx.quadraticCurveTo(w, h, w-r, h);
  ctx.lineTo(r, h); ctx.quadraticCurveTo(0, h, 0, h-r);
  ctx.lineTo(0, r); ctx.quadraticCurveTo(0, 0, r, 0);
  ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#e8eaf0';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, pad, h / 2);

  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 4;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  const scale = 0.012;
  sprite.scale.set(w * scale, h * scale, 1);
  return sprite;
}

function buildNode(nodeDef) {
  const group = new THREE.Group();
  const color = ZONES[nodeDef.zone].color;

  const geom = new THREE.SphereGeometry(0.42, 32, 32);
  const mat = new THREE.MeshStandardMaterial({
    color, emissive: color, emissiveIntensity: 0.9,
    roughness: 0.3, metalness: 0.4
  });
  const sphere = new THREE.Mesh(geom, mat);
  group.add(sphere);

  // Halo
  const haloGeom = new THREE.SphereGeometry(0.75, 24, 24);
  const haloMat = new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: 0.08, side: THREE.BackSide
  });
  group.add(new THREE.Mesh(haloGeom, haloMat));

  // Anillo
  const ringGeom = new THREE.RingGeometry(0.65, 0.72, 48);
  const ringMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.45, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(ringGeom, ringMat);
  ring.rotation.x = Math.PI / 2;
  group.add(ring);

  // Label
  const label = makeLabelSprite(nodeDef.label, color);
  label.position.set(0, 0.95, 0);
  group.add(label);

  group.position.set(...nodeDef.pos);
  group.userData = { node: nodeDef, sphere, ring, label, baseEmissive: 0.9 };
  return group;
}

function curveBetween(a, b, lift = 0.6) {
  const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
  // elevamos el midpoint perpendicular a la línea para dar curva en 3D
  const dir = new THREE.Vector3().subVectors(b, a);
  const up = new THREE.Vector3(0, 1, 0);
  const perp = new THREE.Vector3().crossVectors(dir, up).normalize();
  if (perp.lengthSq() < 0.0001) perp.set(1, 0, 0);
  mid.addScaledVector(perp, lift * 0.5);
  mid.y += lift;
  return new THREE.CatmullRomCurve3([a.clone(), mid, b.clone()]);
}

function buildEdge(edgeDef, posById) {
  const a = posById[edgeDef.from], b = posById[edgeDef.to];
  const curve = curveBetween(a, b, 0.4);
  const tubeGeom = new THREE.TubeGeometry(curve, 48, 0.025, 8, false);
  const color = 0x7aa2ff;
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35 });
  const tube = new THREE.Mesh(tubeGeom, mat);
  tube.userData = { edge: edgeDef, curve };
  return tube;
}

function buildFlowParticle(curve, color) {
  const geom = new THREE.SphereGeometry(0.08, 12, 12);
  const mat = new THREE.MeshBasicMaterial({ color });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.userData = { curve, t: Math.random(), speed: 0.1 + Math.random() * 0.15 };
  return mesh;
}

function buildLegend() {
  const el = document.getElementById('archLegend');
  if (!el) return;
  el.innerHTML = '';
  for (const key of Object.keys(ZONES)) {
    const z = ZONES[key];
    const hex = '#' + z.color.toString(16).padStart(6, '0');
    const item = document.createElement('div');
    item.className = 'legend-item';
    item.innerHTML = `<span class="legend-dot" style="background:${hex};color:${hex}"></span>${z.label}`;
    el.appendChild(item);
  }
}

function initScene() {
  container = document.getElementById('arch3d');
  if (!container) return;

  const w = container.clientWidth, h = container.clientHeight;

  scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x02030a, 0.03);

  camera = new THREE.PerspectiveCamera(55, w / h, 0.1, 100);
  camera.position.set(0, 4, 14);

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(w, h);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  container.appendChild(renderer.domElement);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.autoRotate = autoRotate;
  controls.autoRotateSpeed = 0.6;
  controls.minDistance = 6;
  controls.maxDistance = 30;

  // Luces
  scene.add(new THREE.AmbientLight(0x3a4a7a, 0.6));
  const key = new THREE.DirectionalLight(0x9fc0ff, 0.9);
  key.position.set(6, 10, 8);
  scene.add(key);
  const fill = new THREE.PointLight(0x22d3ee, 0.6, 40);
  fill.position.set(-8, -4, -4);
  scene.add(fill);

  // Grid etéreo
  const grid = new THREE.GridHelper(28, 28, 0x1a2a55, 0x0e1a3a);
  grid.position.y = -5.5;
  grid.material.transparent = true;
  grid.material.opacity = 0.35;
  scene.add(grid);

  // Nodos
  nodeMeshes = [];
  const posById = {};
  for (const n of NODES) {
    const g = buildNode(n);
    scene.add(g);
    nodeMeshes.push(g);
    posById[n.id] = g.position.clone();
  }

  // Aristas + flujos
  edgeTubes = [];
  flows = [];
  for (const e of EDGES) {
    const tube = buildEdge(e, posById);
    scene.add(tube);
    edgeTubes.push(tube);
    const color = ZONES[NODES.find(n => n.id === e.from).zone].color;
    const p = buildFlowParticle(tube.userData.curve, color);
    scene.add(p);
    flows.push(p);
    if (e.bidir) {
      const p2 = buildFlowParticle(tube.userData.curve, color);
      p2.userData.t = Math.random();
      p2.userData.reverse = true;
      scene.add(p2);
      flows.push(p2);
    }
  }

  // Post-procesado: Bloom holográfico
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), 0.9, 0.6, 0.1);
  composer.addPass(bloomPass);

  // Tooltip
  tooltip = document.createElement('div');
  tooltip.className = 'arch-tooltip';
  container.appendChild(tooltip);

  // Raycaster para hover
  const ray = new THREE.Raycaster();
  const mouse = new THREE.Vector2();
  let hovered = null;
  renderer.domElement.addEventListener('mousemove', (ev) => {
    const r = renderer.domElement.getBoundingClientRect();
    mouse.x = ((ev.clientX - r.left) / r.width) * 2 - 1;
    mouse.y = -((ev.clientY - r.top) / r.height) * 2 + 1;
    ray.setFromCamera(mouse, camera);
    const spheres = nodeMeshes.map(g => g.userData.sphere);
    const hits = ray.intersectObjects(spheres, false);
    if (hits.length) {
      const g = nodeMeshes.find(gg => gg.userData.sphere === hits[0].object);
      hovered = g;
      const n = g.userData.node;
      tooltip.innerHTML = `<strong>${n.label}</strong><br>${n.desc}<br><span class="proto">${n.proto}</span>`;
      tooltip.style.left = (ev.clientX - r.left) + 'px';
      tooltip.style.top  = (ev.clientY - r.top) + 'px';
      tooltip.style.opacity = '1';
      renderer.domElement.style.cursor = 'pointer';
    } else {
      hovered = null;
      tooltip.style.opacity = '0';
      renderer.domElement.style.cursor = 'grab';
    }
    container.__hovered = hovered;
  });

  // Controles UI
  const chkRotate = document.getElementById('archAutoRotate');
  const chkLabels = document.getElementById('archShowLabels');
  const chkBloom  = document.getElementById('archBloom');
  const btnReset  = document.getElementById('archReset');
  if (chkRotate) chkRotate.onchange = () => { autoRotate = chkRotate.checked; controls.autoRotate = autoRotate; };
  if (chkLabels) chkLabels.onchange = () => {
    showLabels = chkLabels.checked;
    for (const g of nodeMeshes) g.userData.label.visible = showLabels;
  };
  if (chkBloom)  chkBloom.onchange  = () => { useBloom = chkBloom.checked; };
  if (btnReset)  btnReset.onclick   = () => {
    camera.position.set(0, 4, 14); controls.target.set(0, 0, 0); controls.update();
  };

  // Resize observer
  const ro = new ResizeObserver(() => {
    const ww = container.clientWidth, hh = container.clientHeight;
    if (!ww || !hh) return;
    camera.aspect = ww / hh;
    camera.updateProjectionMatrix();
    renderer.setSize(ww, hh);
    composer.setSize(ww, hh);
  });
  ro.observe(container);

  buildLegend();
  animate();
}

function animate() {
  raf = requestAnimationFrame(animate);
  const dt = 0.016;
  controls.update();

  // Pulso en nodos
  const t = performance.now() * 0.001;
  for (const g of nodeMeshes) {
    const base = g.userData.baseEmissive;
    g.userData.sphere.material.emissiveIntensity = base + Math.sin(t * 2 + g.position.x) * 0.25;
    g.userData.ring.rotation.z += 0.004;
    g.userData.ring.scale.setScalar(1 + Math.sin(t * 1.6 + g.position.y) * 0.05);
  }
  // Resalta el hovered
  const hv = container && container.__hovered;
  if (hv) hv.userData.sphere.material.emissiveIntensity = 2.0;

  // Partículas viajando
  for (const p of flows) {
    const u = p.userData;
    u.t += dt * u.speed * (u.reverse ? -1 : 1);
    if (u.t > 1) u.t -= 1;
    if (u.t < 0) u.t += 1;
    const pt = u.curve.getPointAt(u.t);
    p.position.copy(pt);
  }

  if (useBloom) composer.render();
  else renderer.render(scene, camera);
}

window.__archInit = function () {
  if (initialized) {
    // Al cambiar de pestaña puede quedar el canvas con tamaño 0; forzar resize.
    if (container) {
      const ww = container.clientWidth, hh = container.clientHeight;
      if (ww && hh && renderer) {
        camera.aspect = ww / hh;
        camera.updateProjectionMatrix();
        renderer.setSize(ww, hh);
        composer.setSize(ww, hh);
      }
    }
    return;
  }
  initialized = true;
  // Pequeño retraso para que el layout del panel ya tenga tamaño real.
  setTimeout(initScene, 30);
};
