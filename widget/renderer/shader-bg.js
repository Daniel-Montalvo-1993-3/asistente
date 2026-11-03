// --- Fondo animado con dos escenas intercambiables ---
// Las dos usan UnrealBloomPass del ejemplo oficial de three.js.
// Solo UNA está activa al mismo tiempo (perf). Cambiar entre ellas destruye
// la geometría/materiales/composer anterior y construye los nuevos.
//
//   window.JarvisBG.setState(state)
//   window.JarvisBG.setBackground('neural' | 'iondrive')
//   window.JarvisBG.setAudioLevel(level)

import * as THREE          from 'three';
import { EffectComposer }  from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass }      from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass }      from 'three/addons/postprocessing/OutputPass.js';
import { GLTFLoader }      from 'three/addons/loaders/GLTFLoader.js';

const canvas = document.getElementById('bgCanvas');
if (canvas) {

  // ---------- Renderer compartido ----------
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ReinhardToneMapping;
  renderer.toneMappingExposure = 1.1;

  // ---------- Presets de estado ----------
  // activity 0..1 = qué tan "en acción" está Jarvis (modula giro del motor,
  // bloom extra, pulso de nodos).
  const PRESETS = {
    idle:         { color: 0x5b8cff, speed: 0.35, bloom: 1.00, exposure: 1.00, activity: 0.00 },
    listening:    { color: 0x5bc8ff, speed: 0.55, bloom: 1.30, exposure: 1.10, activity: 0.25 },
    recording:    { color: 0xff5b5b, speed: 1.00, bloom: 1.80, exposure: 1.20, activity: 0.85 },
    transcribing: { color: 0xffbf4d, speed: 0.70, bloom: 1.40, exposure: 1.05, activity: 0.50 },
    thinking:     { color: 0xffbf4d, speed: 1.20, bloom: 1.90, exposure: 1.20, activity: 1.00 },
    speaking:     { color: 0x4df0ff, speed: 0.85, bloom: 1.70, exposure: 1.15, activity: 0.80 },
    ears_off:     { color: 0x747882, speed: 0.20, bloom: 0.60, exposure: 0.80, activity: 0.00 },
    ear_error:    { color: 0xff5b5b, speed: 0.90, bloom: 1.10, exposure: 1.00, activity: 0.00 },
    offline:      { color: 0x595c66, speed: 0.10, bloom: 0.40, exposure: 0.70, activity: 0.00 },
  };

  const target = {
    color: new THREE.Color(PRESETS.offline.color),
    speed: PRESETS.offline.speed,
    bloom: PRESETS.offline.bloom,
    exposure: PRESETS.offline.exposure,
    activity: 0,
  };

  // --- Parámetros ajustables desde el dashboard (ion drive) ---
  // Se guardan en localStorage y se aplican en tiempo real.
  // Defaults alineados con el ejemplo oficial de three.js (imagen de referencia).
  const ION_DEFAULTS = {
    bloomStrength:  0.86,
    bloomRadius:    0.59,
    bloomThreshold: 0.10,
    exposure:       1.11,
    maxRpm:         3.0,
    scale:          1.0,
    cameraDist:     4.5,     // distancia de cámara frente al modelo
    rotXOffset:     0.0,     // orientación inicial X (radianes)
    rotYOffset:     Math.PI / 2,   // 90° — gira el modelo para que su eje salga hacia la cámara
    rotZOffset:     0.0,
  };
  const ionParams = loadIonParams();
  function loadIonParams() {
    try {
      const raw = localStorage.getItem('jarvis-iondrive');
      if (!raw) return Object.assign({}, ION_DEFAULTS);
      return Object.assign({}, ION_DEFAULTS, JSON.parse(raw));
    } catch { return Object.assign({}, ION_DEFAULTS); }
  }
  function saveIonParams() {
    try { localStorage.setItem('jarvis-iondrive', JSON.stringify(ionParams)); } catch {}
  }

  // ---------- Colores por escena (modificables desde admin) ----------
  // Cada escena tiene colorA (dominante / nodos / tint) y colorB (secundario /
  // líneas / fondo). Se persisten aparte de los otros sliders → el botón
  // "Restaurar colores" solo toca este objeto.
  const COLOR_DEFAULTS = {
    neural:    { a: '#5b8cff', b: '#5b8cff' },
    iondrive:  { a: '#ff8c3c', b: '#05070d' },
    particles: { a: '#5bc8ff', b: '#ff5bd0' },
    quantum:   { a: '#667eea', b: '#f093fb' },
  };
  function loadColors() {
    try {
      const raw = localStorage.getItem('jarvis-colors');
      if (raw) return Object.assign({}, COLOR_DEFAULTS, JSON.parse(raw));
    } catch {}
    return JSON.parse(JSON.stringify(COLOR_DEFAULTS));
  }
  const colorParams = loadColors();
  function saveColors() {
    try { localStorage.setItem('jarvis-colors', JSON.stringify(colorParams)); } catch {}
  }
  // Objeto THREE.Color por canal (reutilizables) para no crear basura cada frame
  const colA = new THREE.Color(), colB = new THREE.Color();
  function userColorA(scene) { colA.set(colorParams[scene]?.a || '#ffffff'); return colA; }
  function userColorB(scene) { colB.set(colorParams[scene]?.b || '#ffffff'); return colB; }

  // --- Parámetros ajustables de la escena particles ---
  const PART_DEFAULTS = {
    bloomStrength:  1.20,
    bloomRadius:    0.55,
    bloomThreshold: 0.00,
    exposure:       1.00,
    particleCount:  220,
    linkDistance:   2.4,
    speed:          0.6,
    spread:         10,
    lineOpacity:    0.35,
    pointSize:      3.0,
  };
  const partParams = (() => {
    try {
      const raw = localStorage.getItem('jarvis-particles');
      if (raw) return Object.assign({}, PART_DEFAULTS, JSON.parse(raw));
    } catch {}
    return Object.assign({}, PART_DEFAULTS);
  })();
  function savePartParams() {
    try { localStorage.setItem('jarvis-particles', JSON.stringify(partParams)); } catch {}
  }

  // --- Parámetros ajustables de la escena quantum ---
  const QUANT_DEFAULTS = {
    bloomStrength:  1.80,
    bloomRadius:    0.60,
    bloomThreshold: 0.70,
    exposure:       1.00,
    scale:          1.00,
    nodeBrightness: 1.00,
    edgeOpacity:    0.55,
    flowSpeed:      1.40,
    flowBrightness: 1.60,
    starBrightness: 0.90,
    bgColor:        '#050508',
    starColor:      '#ffffff',
  };
  const quantParams = (() => {
    try {
      const raw = localStorage.getItem('jarvis-quantum');
      if (raw) return Object.assign({}, QUANT_DEFAULTS, JSON.parse(raw));
    } catch {}
    return Object.assign({}, QUANT_DEFAULTS);
  })();
  function saveQuantParams() {
    try { localStorage.setItem('jarvis-quantum', JSON.stringify(quantParams)); } catch {}
  }

  // ---------- Escena activa ----------
  let active = null;        // { update(dt,t), dispose(), composer, bloomPass }
  let currentName = null;
  let rafId = null;
  const clock = new THREE.Clock();

  function stopLoop() {
    if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
  }

  function disposeActive() {
    stopLoop();
    if (active) {
      try { active.dispose(); } catch {}
      active = null;
    }
  }

  function onResize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    if (active) active.resize(w, h);
  }
  window.addEventListener('resize', onResize);

  function loop() {
    rafId = requestAnimationFrame(loop);
    const dt = Math.min(0.05, clock.getDelta());
    const t = clock.elapsedTime;
    if (!active) return;
    const k = Math.min(1, dt * 2.2);
    renderer.toneMappingExposure +=
      (target.exposure - renderer.toneMappingExposure) * k;
    active.update(dt, t, k);
    active.composer.render();
  }

  // ===========================================================
  //  ESCENA 1 · "neural" — nodos emisivos flotando (procedural)
  // ===========================================================
  function buildNeural() {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      55, canvas.clientWidth / Math.max(1, canvas.clientHeight), 0.1, 500
    );
    camera.position.set(0, 0, 18);

    const group = new THREE.Group();
    scene.add(group);

    const NODE_COUNT = 36;
    const nodes = [];
    const geometry = new THREE.IcosahedronGeometry(0.55, 0);
    const baseColor = userColorA('neural').clone();

    for (let i = 0; i < NODE_COUNT; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: baseColor.clone() });
      const mesh = new THREE.Mesh(geometry, mat);
      const r = 7 + Math.random() * 5;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos((Math.random() * 2) - 1);
      mesh.position.set(
        r * Math.sin(phi) * Math.cos(theta),
        r * Math.sin(phi) * Math.sin(theta),
        r * Math.cos(phi) - 2
      );
      mesh.scale.setScalar(0.6 + Math.random() * 1.2);
      mesh.userData = {
        spin: new THREE.Vector3(
          (Math.random() - 0.5) * 0.6,
          (Math.random() - 0.5) * 0.6,
          (Math.random() - 0.5) * 0.6
        ),
        pulsePhase: Math.random() * Math.PI * 2,
      };
      group.add(mesh);
      nodes.push(mesh);
    }

    const lineMat = new THREE.LineBasicMaterial({
      color: 0x5b8cff, transparent: true, opacity: 0.15
    });
    const linePositions = [];
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        if (nodes[i].position.distanceTo(nodes[j].position) < 4.5) {
          linePositions.push(
            nodes[i].position.x, nodes[i].position.y, nodes[i].position.z,
            nodes[j].position.x, nodes[j].position.y, nodes[j].position.z
          );
        }
      }
    }
    const lineGeom = new THREE.BufferGeometry();
    lineGeom.setAttribute('position',
      new THREE.Float32BufferAttribute(linePositions, 3));
    const lines = new THREE.LineSegments(lineGeom, lineMat);
    group.add(lines);

    const renderScene = new RenderPass(scene, camera);
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(canvas.clientWidth, canvas.clientHeight), 1.2, 0.75, 0.0);
    const outputPass = new OutputPass();
    const composer = new EffectComposer(renderer);
    composer.addPass(renderScene);
    composer.addPass(bloomPass);
    composer.addPass(outputPass);

    const tmpColor = new THREE.Color();

    return {
      composer, bloomPass,
      resize(w, h) {
        camera.aspect = w / Math.max(1, h);
        camera.updateProjectionMatrix();
        composer.setSize(w, h);
        bloomPass.setSize(w, h);
      },
      update(dt, t, k) {
        // La escena neural sí usa el bloom reactivo al estado
        bloomPass.strength += (target.bloom - bloomPass.strength) * k;
        group.rotation.y += dt * 0.08 * target.speed;
        group.rotation.x += dt * 0.03 * target.speed;
        // Mezcla color user (A) con el tinte del estado para que la escena
        // responda a los dos: tus colores + reactividad del estado.
        const nodeColor = userColorA('neural').clone().lerp(target.color, 0.4);
        for (const n of nodes) {
          n.userData.pulsePhase += dt * (1.5 + target.speed);
          const pulse = 0.55 + 0.45 * Math.sin(n.userData.pulsePhase);
          tmpColor.copy(nodeColor).multiplyScalar(0.5 + pulse * 1.2);
          n.material.color.lerp(tmpColor, k);
          n.rotation.x += dt * n.userData.spin.x * target.speed;
          n.rotation.y += dt * n.userData.spin.y * target.speed;
          n.position.x += Math.sin(t * 0.4 + n.userData.pulsePhase) * dt * 0.08;
          n.position.y += Math.cos(t * 0.5 + n.userData.pulsePhase) * dt * 0.08;
        }
        const lineColor = userColorB('neural').clone().lerp(target.color, 0.3);
        lineMat.color.lerp(lineColor, k);
        lineMat.opacity = 0.08 + 0.12 * (target.bloom / 2);
      },
      dispose() {
        geometry.dispose();
        lineGeom.dispose();
        lineMat.dispose();
        for (const n of nodes) n.material.dispose();
        composer.dispose();
        scene.clear();
      }
    };
  }

  // =====================================================================
  //  ESCENA 2 · "iondrive" — modelo oficial PrimaryIonDrive con bloom
  //  (reproduce visualmente https://threejs.org/examples/#webgl_postprocessing_unreal_bloom)
  // =====================================================================
  function buildIonDrive(url) {
    const scene = new THREE.Scene();
    scene.background = userColorB('iondrive').clone();

    const camera = new THREE.PerspectiveCamera(
      40, canvas.clientWidth / Math.max(1, canvas.clientHeight), 0.1, 100
    );
    // Vista FRONTAL del motor: cámara sobre el eje Z, mirando al origen.
    camera.position.set(0, 0, ionParams.cameraDist);
    camera.lookAt(0, 0, 0);

    scene.add(new THREE.AmbientLight(0xcccccc));
    const dir = new THREE.DirectionalLight(0xffffff, 2);
    dir.position.set(1, 1, 1);
    scene.add(dir);

    // Placeholder emisivo mientras el GLB carga (~5 MB). Se destruye luego.
    const phGeom = new THREE.TorusKnotGeometry(0.8, 0.25, 90, 20);
    const phMat  = new THREE.MeshBasicMaterial({ color: userColorA('iondrive').clone() });
    const placeholder = new THREE.Mesh(phGeom, phMat);
    scene.add(placeholder);

    const renderScene = new RenderPass(scene, camera);
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(canvas.clientWidth, canvas.clientHeight),
      ionParams.bloomStrength, ionParams.bloomRadius, ionParams.bloomThreshold);
    const outputPass = new OutputPass();
    const composer = new EffectComposer(renderer);
    composer.addPass(renderScene);
    composer.addPass(bloomPass);
    composer.addPass(outputPass);

    let mixer = null;
    let model = null;
    const disposables = [];
    let spinVel = 0;  // velocidad angular suave (rad/s) para que arranque como motor

    const loader = new GLTFLoader();
    console.log('[JarvisBG] cargando GLB:', url);
    loader.load(url, (gltf) => {
      // Quitar el placeholder cuando el modelo real está listo
      scene.remove(placeholder);
      try { phGeom.dispose(); phMat.dispose(); } catch {}

      model = gltf.scene;
      model.scale.setScalar(ionParams.scale);
      model.rotation.set(
        ionParams.rotXOffset, ionParams.rotYOffset, ionParams.rotZOffset
      );
      scene.add(model);
      if (gltf.animations && gltf.animations.length) {
        mixer = new THREE.AnimationMixer(model);
        mixer.clipAction(gltf.animations[0]).play();
      }
      model.traverse(o => {
        if (o.isMesh) {
          if (o.geometry) disposables.push(o.geometry);
          if (o.material) disposables.push(o.material);
        }
      });
      console.log('[JarvisBG] GLB cargado OK');
    }, (prog) => {
      if (prog.lengthComputable) {
        const pct = (prog.loaded / prog.total * 100).toFixed(0);
        console.log(`[JarvisBG] GLB progreso: ${pct}%`);
      }
    }, (err) => {
      console.error('[JarvisBG] falló la carga del GLB:', err);
    });

    return {
      composer, bloomPass,
      resize(w, h) {
        camera.aspect = w / Math.max(1, h);
        camera.updateProjectionMatrix();
        composer.setSize(w, h);
        bloomPass.setSize(w, h);
      },
      update(dt, t, k) {
        // Bloom + exposición en vivo
        bloomPass.strength  += (ionParams.bloomStrength  - bloomPass.strength)  * k;
        bloomPass.radius    += (ionParams.bloomRadius    - bloomPass.radius)    * k;
        bloomPass.threshold += (ionParams.bloomThreshold - bloomPass.threshold) * k;
        renderer.toneMappingExposure +=
          (ionParams.exposure - renderer.toneMappingExposure) * k;
        // Fondo + tinte del placeholder reaccionan al color user en vivo
        scene.background.lerp(userColorB('iondrive'), k);
        if (!model) phMat.color.lerp(userColorA('iondrive'), k);

        // Zoom de cámara en vivo
        camera.position.z += (ionParams.cameraDist - camera.position.z) * k;
        camera.lookAt(0, 0, 0);

        if (mixer) mixer.update(dt);

        if (model) {
          if (Math.abs(model.scale.x - ionParams.scale) > 0.01) {
            model.scale.setScalar(ionParams.scale);
          }
          // Mantener la orientación BASE en X/Y (user config) y acumular el
          // giro de motor solo en Z (eje de visión → rotación circular).
          model.rotation.x = ionParams.rotXOffset;
          model.rotation.y = ionParams.rotYOffset;

          const targetVel = ionParams.maxRpm * Math.PI * 2 * target.activity;
          spinVel += (targetVel - spinVel) * Math.min(1, dt * 1.8);
          model.rotation.z += spinVel * dt;
        } else if (placeholder.parent) {
          placeholder.rotation.z += dt * 1.0;
          phMat.color.lerp(target.color, k);
        }
      },
      dispose() {
        if (mixer) mixer.stopAllAction();
        try { phGeom.dispose(); phMat.dispose(); } catch {}
        for (const d of disposables) try { d.dispose(); } catch {}
        composer.dispose();
        scene.clear();
      }
    };
  }

  // ========================================================================
  //  ESCENA 3 · "particles" — ríos de partículas conectadas por líneas luminosas
  //  Aproximación WebGL del ejemplo webgpu_tsl_vfx_linkedparticles.
  //  Partículas drift en un volumen con conexiones entre vecinas (clásico
  //  efecto "red de puntos") + estelas + bloom intenso.
  // ========================================================================
  function buildParticles() {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000006);

    const camera = new THREE.PerspectiveCamera(
      55, canvas.clientWidth / Math.max(1, canvas.clientHeight), 0.1, 500
    );
    camera.position.set(0, 0, 12);
    camera.lookAt(0, 0, 0);

    // --- Puntos ---
    const N = Math.max(20, Math.min(1200, partParams.particleCount | 0));
    const positions = new Float32Array(N * 3);
    const velocities = new Float32Array(N * 3);
    const spread = partParams.spread;

    for (let i = 0; i < N; i++) {
      positions[i*3+0] = (Math.random() - 0.5) * spread;
      positions[i*3+1] = (Math.random() - 0.5) * spread;
      positions[i*3+2] = (Math.random() - 0.5) * spread * 0.6;
      velocities[i*3+0] = (Math.random() - 0.5) * 0.5;
      velocities[i*3+1] = (Math.random() - 0.5) * 0.5;
      velocities[i*3+2] = (Math.random() - 0.5) * 0.3;
    }

    const pointGeom = new THREE.BufferGeometry();
    pointGeom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const pointMat = new THREE.PointsMaterial({
      size: partParams.pointSize,
      color: userColorA('particles').clone(),
      transparent: true,
      sizeAttenuation: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const points = new THREE.Points(pointGeom, pointMat);
    scene.add(points);

    // --- Líneas de conexión (buffer grande, se rellena por frame) ---
    const MAX_LINES = 1500;
    const linePositions = new Float32Array(MAX_LINES * 2 * 3);
    const lineGeom = new THREE.BufferGeometry();
    lineGeom.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));
    const lineMat = new THREE.LineBasicMaterial({
      color: userColorB('particles').clone(),
      transparent: true,
      opacity: partParams.lineOpacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const lines = new THREE.LineSegments(lineGeom, lineMat);
    scene.add(lines);

    const renderScene = new RenderPass(scene, camera);
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(canvas.clientWidth, canvas.clientHeight),
      partParams.bloomStrength, partParams.bloomRadius, partParams.bloomThreshold);
    const outputPass = new OutputPass();
    const composer = new EffectComposer(renderer);
    composer.addPass(renderScene);
    composer.addPass(bloomPass);
    composer.addPass(outputPass);

    return {
      composer, bloomPass,
      resize(w, h) {
        camera.aspect = w / Math.max(1, h);
        camera.updateProjectionMatrix();
        composer.setSize(w, h);
        bloomPass.setSize(w, h);
      },
      update(dt, t, k) {
        // Bloom y exposición en vivo
        bloomPass.strength  += (partParams.bloomStrength  - bloomPass.strength)  * k;
        bloomPass.radius    += (partParams.bloomRadius    - bloomPass.radius)    * k;
        bloomPass.threshold += (partParams.bloomThreshold - bloomPass.threshold) * k;
        renderer.toneMappingExposure +=
          (partParams.exposure - renderer.toneMappingExposure) * k;

        // Movimiento de partículas (velocidad modulada por speed + activity)
        const speed = partParams.speed * (0.5 + target.activity * 1.5);
        const halfSpread = partParams.spread;
        const posArr = pointGeom.attributes.position.array;
        for (let i = 0; i < N; i++) {
          posArr[i*3+0] += velocities[i*3+0] * dt * speed;
          posArr[i*3+1] += velocities[i*3+1] * dt * speed;
          posArr[i*3+2] += velocities[i*3+2] * dt * speed;
          // Rebote suave al salir del volumen
          for (let a = 0; a < 3; a++) {
            const lim = halfSpread * (a === 2 ? 0.3 : 0.5);
            if (posArr[i*3+a] >  lim) velocities[i*3+a] = -Math.abs(velocities[i*3+a]);
            if (posArr[i*3+a] < -lim) velocities[i*3+a] =  Math.abs(velocities[i*3+a]);
          }
        }
        pointGeom.attributes.position.needsUpdate = true;

        // Color de puntos (mezcla user + estado) + tamaño en vivo
        const pcol = userColorA('particles').clone().lerp(target.color, 0.35);
        pointMat.color.lerp(pcol, k);
        pointMat.size += (partParams.pointSize - pointMat.size) * k;

        // Calcular conexiones (vecinas dentro de linkDistance)
        const link2 = partParams.linkDistance * partParams.linkDistance;
        let li = 0;
        const linePos = lineGeom.attributes.position.array;
        for (let i = 0; i < N && li < MAX_LINES; i++) {
          const ax = posArr[i*3], ay = posArr[i*3+1], az = posArr[i*3+2];
          for (let j = i + 1; j < N && li < MAX_LINES; j++) {
            const dx = ax - posArr[j*3];
            const dy = ay - posArr[j*3+1];
            const dz = az - posArr[j*3+2];
            if (dx*dx + dy*dy + dz*dz < link2) {
              linePos[li*6+0] = ax; linePos[li*6+1] = ay; linePos[li*6+2] = az;
              linePos[li*6+3] = posArr[j*3];
              linePos[li*6+4] = posArr[j*3+1];
              linePos[li*6+5] = posArr[j*3+2];
              li++;
            }
          }
        }
        // Rellenar el resto con ceros para no mostrar líneas sueltas
        for (let z = li; z < MAX_LINES; z++) {
          linePos[z*6+0] = 0; linePos[z*6+1] = 0; linePos[z*6+2] = 0;
          linePos[z*6+3] = 0; linePos[z*6+4] = 0; linePos[z*6+5] = 0;
        }
        lineGeom.attributes.position.needsUpdate = true;
        lineGeom.setDrawRange(0, li * 2);

        const lcol = userColorB('particles').clone().lerp(target.color, 0.25);
        lineMat.color.lerp(lcol, k);
        lineMat.opacity += (partParams.lineOpacity - lineMat.opacity) * k;

        // Rotación global sutil para dar vida
        points.rotation.y += dt * 0.05 * (0.3 + target.activity);
        lines.rotation.y = points.rotation.y;
      },
      dispose() {
        pointGeom.dispose(); pointMat.dispose();
        lineGeom.dispose(); lineMat.dispose();
        composer.dispose();
        scene.clear();
      }
    };
  }

  // =====================================================================
  //  ESCENA 4 · "quantum" — Quantum Neural Network (shells Fibonacci + stars)
  //  Inspirada en www.web-leb.com/en/editor/3413
  // =====================================================================
  function buildQuantum() {
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x000000, 0.002);
    const camera = new THREE.PerspectiveCamera(
      65, canvas.clientWidth / Math.max(1, canvas.clientHeight), 0.1, 500
    );
    camera.position.set(0, 8, 28);
    camera.lookAt(0, 0, 0);

    const group = new THREE.Group();
    scene.add(group);

    // --- Starfield (puntos aditivos, destellantes) ---
    const STAR_COUNT = 3500;
    const starPos = new Float32Array(STAR_COUNT * 3);
    const starCol = new Float32Array(STAR_COUNT * 3);
    for (let i = 0; i < STAR_COUNT; i++) {
      const r = 50 + Math.random() * 100;
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(Math.random() * 2 - 1);
      starPos[i*3+0] = r * Math.sin(ph) * Math.cos(th);
      starPos[i*3+1] = r * Math.sin(ph) * Math.sin(th);
      starPos[i*3+2] = r * Math.cos(ph);
      const bias = Math.random();
      if (bias < 0.7)       { starCol[i*3]=1;  starCol[i*3+1]=1;  starCol[i*3+2]=1; }
      else if (bias < 0.85) { starCol[i*3]=0.7;starCol[i*3+1]=0.8;starCol[i*3+2]=1; }
      else                  { starCol[i*3]=1;  starCol[i*3+1]=0.9;starCol[i*3+2]=0.8;}
    }
    const starGeom = new THREE.BufferGeometry();
    starGeom.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    starGeom.setAttribute('color',    new THREE.BufferAttribute(starCol, 3));
    const starMat = new THREE.PointsMaterial({
      size: 0.6, vertexColors: true, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true
    });
    const stars = new THREE.Points(starGeom, starMat);
    scene.add(stars);

    // --- Shells Fibonacci con nodos (crystalline sphere) ---
    const SHELLS = [
      { r: 4,  count: 12 },
      { r: 8,  count: 24 },
      { r: 12, count: 36 },
      { r: 16, count: 48 },
      { r: 20, count: 60 },
    ];
    const PHI = Math.PI * (3 - Math.sqrt(5)); // golden angle
    const nodePositions = [];
    const nodeColors = [];
    const nodeShells = [];
    const paletteA = userColorA('quantum').clone();
    const paletteB = userColorB('quantum').clone();
    const mix = new THREE.Color();
    SHELLS.forEach((shell, si) => {
      const t = si / (SHELLS.length - 1);
      mix.copy(paletteA).lerp(paletteB, t);
      for (let i = 0; i < shell.count; i++) {
        const y = 1 - (i / (shell.count - 1)) * 2;
        const radius = Math.sqrt(1 - y * y);
        const theta = PHI * i;
        const x = Math.cos(theta) * radius;
        const z = Math.sin(theta) * radius;
        nodePositions.push(x * shell.r, y * shell.r, z * shell.r);
        nodeColors.push(mix.r, mix.g, mix.b);
        nodeShells.push(si);
      }
    });
    const nodeGeom = new THREE.BufferGeometry();
    nodeGeom.setAttribute('position', new THREE.Float32BufferAttribute(nodePositions, 3));
    nodeGeom.setAttribute('color',    new THREE.Float32BufferAttribute(nodeColors, 3));
    const nodeColAttr = nodeGeom.getAttribute('color');
    // Caché de la paleta vigente para detectar cambios desde los color pickers
    let cachedA = paletteA.getHex(), cachedB = paletteB.getHex();
    function recomputeGradient() {
      const A = userColorA('quantum').clone();
      const B = userColorB('quantum').clone();
      SHELLS.forEach((shell, si) => {
        const t = si / (SHELLS.length - 1);
        mix.copy(A).lerp(B, t);
        const base = shellOffsets[si];
        for (let i = 0; i < shell.count; i++) {
          const idx = (base + i) * 3;
          nodeColAttr.array[idx+0] = mix.r;
          nodeColAttr.array[idx+1] = mix.g;
          nodeColAttr.array[idx+2] = mix.b;
        }
      });
      nodeColAttr.needsUpdate = true;
      // Y las aristas: el color base por arista era el del shell del nodo "from"
      for (let i = 0; i < edgeData.length; i++) {
        const { start, segs, shell } = edgeData[i];
        const t = shell / (SHELLS.length - 1);
        mix.copy(A).lerp(B, t);
        for (let s = 0; s < segs; s++) {
          const idx = (start + s) * 6;
          baseEdgeCol[idx+0] = mix.r; baseEdgeCol[idx+1] = mix.g; baseEdgeCol[idx+2] = mix.b;
          baseEdgeCol[idx+3] = mix.r; baseEdgeCol[idx+4] = mix.g; baseEdgeCol[idx+5] = mix.b;
        }
      }
      cachedA = A.getHex(); cachedB = B.getHex();
    }
    const nodeMat = new THREE.PointsMaterial({
      size: 1.6, vertexColors: true, transparent: true, opacity: 0.95,
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true
    });
    const nodes = new THREE.Points(nodeGeom, nodeMat);
    group.add(nodes);

    // --- Aristas curvas entre shells adyacentes y vecinos cercanos ---
    // Para cada nodo, conecta con 2 vecinos: uno del shell siguiente, otro aleatorio cercano
    const SAMPLES = 20;      // puntos por arista
    const PERP_OFF = 0.6;    // amplitud de curva
    const edgePos = [];
    const edgeCol = [];
    const edgeData = [];     // {startIdx, len} para animar flujo
    const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3();
    const tmpMid = new THREE.Vector3(), tmpPerp = new THREE.Vector3();
    const nodesPerShell = SHELLS.map(s => s.count);
    let shellOffsets = [0];
    for (let i = 0; i < SHELLS.length - 1; i++) shellOffsets.push(shellOffsets[i] + nodesPerShell[i]);
    const total = nodePositions.length / 3;

    function pushEdge(i, j) {
      tmpA.fromArray(nodePositions, i*3);
      tmpB.fromArray(nodePositions, j*3);
      tmpMid.addVectors(tmpA, tmpB).multiplyScalar(0.5);
      const dir = new THREE.Vector3().subVectors(tmpB, tmpA);
      tmpPerp.crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
      if (tmpPerp.lengthSq() < 0.01) tmpPerp.set(1, 0, 0);
      const amp = PERP_OFF * tmpA.distanceTo(tmpB) * 0.15;
      tmpMid.addScaledVector(tmpPerp, amp);
      const curve = new THREE.QuadraticBezierCurve3(tmpA.clone(), tmpMid.clone(), tmpB.clone());
      const pts = curve.getPoints(SAMPLES);
      const start = edgePos.length / 3 / 2;
      const si = nodeShells[i];
      const t = si / (SHELLS.length - 1);
      mix.copy(paletteA).lerp(paletteB, t);
      for (let k = 0; k < pts.length - 1; k++) {
        edgePos.push(pts[k].x, pts[k].y, pts[k].z, pts[k+1].x, pts[k+1].y, pts[k+1].z);
        edgeCol.push(mix.r, mix.g, mix.b, mix.r, mix.g, mix.b);
      }
      edgeData.push({ start, segs: pts.length - 1, shell: si });
    }

    // Shell→shell siguiente
    for (let s = 0; s < SHELLS.length - 1; s++) {
      const off = shellOffsets[s];
      const nxt = shellOffsets[s+1];
      for (let i = 0; i < nodesPerShell[s]; i++) {
        const j = nxt + Math.floor(i * nodesPerShell[s+1] / nodesPerShell[s]);
        pushEdge(off + i, j);
      }
    }
    // Algunas conexiones radiales largas
    for (let k = 0; k < 40; k++) {
      pushEdge(Math.floor(Math.random() * total), Math.floor(Math.random() * total));
    }

    const edgeGeom = new THREE.BufferGeometry();
    edgeGeom.setAttribute('position', new THREE.Float32BufferAttribute(edgePos, 3));
    edgeGeom.setAttribute('color',    new THREE.Float32BufferAttribute(edgeCol, 3));
    const edgeColAttr = edgeGeom.getAttribute('color');
    const baseEdgeCol = new Float32Array(edgeCol);
    const edgeMat = new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.55,
      blending: THREE.AdditiveBlending, depthWrite: false
    });
    const edges = new THREE.LineSegments(edgeGeom, edgeMat);
    group.add(edges);

    // --- Post ---
    const renderScene = new RenderPass(scene, camera);
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(canvas.clientWidth, canvas.clientHeight),
      quantParams.bloomStrength, quantParams.bloomRadius, quantParams.bloomThreshold);
    const outputPass = new OutputPass();
    const composer = new EffectComposer(renderer);
    composer.addPass(renderScene);
    composer.addPass(bloomPass);
    composer.addPass(outputPass);

    // Guardar fondo original para restaurar al salir
    const prevClear = renderer.getClearColor(new THREE.Color()).clone();
    const prevAlpha = renderer.getClearAlpha();
    const bgCol = new THREE.Color(quantParams.bgColor);
    renderer.setClearColor(bgCol, 1);
    scene.fog.color.copy(bgCol);
    const starTint = new THREE.Color(quantParams.starColor);
    starMat.color.copy(starTint);

    return {
      composer, bloomPass,
      resize(w, h) {
        camera.aspect = w / Math.max(1, h);
        camera.updateProjectionMatrix();
        composer.setSize(w, h);
        bloomPass.setSize(w, h);
      },
      update(dt, t, k) {
        // Si el usuario cambió los colores A/B desde el admin, recomputa gradiente
        const curA = userColorA('quantum').getHex();
        const curB = userColorB('quantum').getHex();
        if (curA !== cachedA || curB !== cachedB) recomputeGradient();

        // Aplica parámetros en vivo
        group.scale.setScalar(quantParams.scale);
        bloomPass.radius     = quantParams.bloomRadius;
        bloomPass.threshold  = quantParams.bloomThreshold;
        // Fondo + fog + estrellas (color)
        bgCol.set(quantParams.bgColor);
        renderer.setClearColor(bgCol, 1);
        scene.fog.color.copy(bgCol);
        starTint.set(quantParams.starColor);
        starMat.color.copy(starTint);
        starMat.opacity = quantParams.starBrightness;
        edgeMat.opacity = quantParams.edgeOpacity;
        // Exposición de la escena (se mantiene mientras esté activa)
        target.exposure = quantParams.exposure;

        // Rotación global + vaivén
        group.rotation.y += dt * 0.06 * (0.4 + target.activity);
        group.rotation.y += Math.sin(t * 0.04) * 0.0003;
        stars.rotation.y -= dt * 0.005;

        // Breathing de nodos (modulado por nodeBrightness)
        const breath = 1.4 + 0.4 * Math.sin(t * 1.2) + target.activity * 0.6;
        nodeMat.size = breath * quantParams.nodeBrightness;
        nodeMat.opacity = Math.min(1, 0.6 + quantParams.nodeBrightness * 0.35);

        // Bandas de brillo viajando por las aristas (flow)
        const col = edgeColAttr.array;
        const speed = quantParams.flowSpeed + target.activity * 2.2;
        const flowAmp = quantParams.flowBrightness;
        for (let i = 0; i < edgeData.length; i++) {
          const { start, segs } = edgeData[i];
          const phase = (t * speed + i * 0.37) % 1;
          const headSeg = Math.floor(phase * segs);
          for (let s = 0; s < segs; s++) {
            const d = (s - headSeg + segs) % segs;
            const g = Math.exp(-d * d / 8); // gaussiana
            const brightness = 0.4 + flowAmp * g;
            const idx = (start + s) * 6;
            col[idx+0] = baseEdgeCol[idx+0] * brightness;
            col[idx+1] = baseEdgeCol[idx+1] * brightness;
            col[idx+2] = baseEdgeCol[idx+2] * brightness;
            col[idx+3] = baseEdgeCol[idx+3] * brightness;
            col[idx+4] = baseEdgeCol[idx+4] * brightness;
            col[idx+5] = baseEdgeCol[idx+5] * brightness;
          }
        }
        edgeColAttr.needsUpdate = true;

        // Bloom (strength = param base + reactividad al estado)
        const strengthTarget = quantParams.bloomStrength + target.bloom * 0.3 - 1.0;
        bloomPass.strength += (strengthTarget - bloomPass.strength) * k;
      },
      dispose() {
        starGeom.dispose(); starMat.dispose();
        nodeGeom.dispose(); nodeMat.dispose();
        edgeGeom.dispose(); edgeMat.dispose();
        composer.dispose();
        scene.clear();
        renderer.setClearColor(prevClear, prevAlpha);
      }
    };
  }

  // ---------- Controlador público ----------
  function setBackground(name) {
    if (name === currentName && active) return;
    disposeActive();
    currentName = name;
    if (name === 'iondrive') {
      const url = (location.pathname.indexOf('/dashboard/') !== -1)
        ? '../renderer/assets/PrimaryIonDrive.glb'
        : 'assets/PrimaryIonDrive.glb';
      active = buildIonDrive(url);
    } else if (name === 'particles') {
      active = buildParticles();
    } else if (name === 'quantum') {
      active = buildQuantum();
    } else {
      active = buildNeural();
    }
    onResize();
    clock.start();
    if (rafId === null) loop();
  }

  window.JarvisBG = {
    setState(state) {
      const p = PRESETS[state] || PRESETS.idle;
      target.color.setHex(p.color);
      target.speed = p.speed;
      target.bloom = p.bloom;
      target.exposure = p.exposure;
      target.activity = p.activity;
    },
    setBackground,
    setAudioLevel(level) {
      target.bloom = Math.min(2.5, target.bloom + level * 0.5);
    },
    getBackground() { return currentName; },

    // Admin: parámetros en vivo del iondrive
    setIonParams(partial, persist = true) {
      Object.assign(ionParams, partial);
      if (persist) saveIonParams();
    },
    getIonParams() { return Object.assign({}, ionParams); },

    // Admin: parámetros en vivo de particles
    setPartParams(partial, persist = true) {
      Object.assign(partParams, partial);
      if (persist) savePartParams();
      // Si cambió particleCount o spread, reconstruir
      if (currentName === 'particles' && ('particleCount' in partial || 'spread' in partial)) {
        setBackground('particles-rebuild');
        currentName = 'particles';
        active = buildParticles();
        onResize();
      }
    },
    getPartParams() { return Object.assign({}, partParams); },

    // Admin: parámetros en vivo de la escena quantum
    setQuantumParams(partial, persist = true) {
      Object.assign(quantParams, partial);
      if (persist) saveQuantParams();
    },
    getQuantumParams() { return Object.assign({}, quantParams); },

    // Admin: COLORES por escena (restaurables aparte)
    setColors(scene, a, b, persist = true) {
      if (!colorParams[scene]) colorParams[scene] = {};
      if (a) colorParams[scene].a = a;
      if (b) colorParams[scene].b = b;
      if (persist) saveColors();
    },
    getColors() { return JSON.parse(JSON.stringify(colorParams)); },
    resetColors(scene) {
      if (scene && COLOR_DEFAULTS[scene]) {
        colorParams[scene] = Object.assign({}, COLOR_DEFAULTS[scene]);
      } else {
        Object.assign(colorParams, JSON.parse(JSON.stringify(COLOR_DEFAULTS)));
      }
      saveColors();
    }
  };

  // Elección inicial: la que guardó el usuario (localStorage) o 'neural'.
  let saved = 'neural';
  try { saved = localStorage.getItem('jarvis-bg') || 'neural'; } catch {}
  setBackground(saved);
}
