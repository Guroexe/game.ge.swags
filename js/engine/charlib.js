// ============================================================
// charlib.js — скелетные аниме-девушки (GLB из Mixamo FBX)
// для ботов и превью скинов. API экземпляра идентичен
// createCyberGirl: { root, update(dt,speed), setMode(m),
// explode(scene), reset(), state{leanTarget,aggroTarget,
// crouchTarget,flinchT,dodgeDir} }
// ============================================================
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as skClone } from 'three/addons/utils/SkeletonUtils.js';
import { flatMat, boxGeo } from './models.js';
import { createRealGun } from './realguns.js';

// Какой ствол держит персонаж (реальные модели из realguns.js)
const CHAR_WEAPON = { c1: 'rifle', c2: 'smg', c3: 'dmr' };

export const CHAR_IDS = ['c1', 'c2', 'c3'];
// Дефолтный персонаж команды (0=ALPHA, 1=BRAVO, 2=CHARLIE)
export const TEAM_CHAR = ['c1', 'c2', 'c3'];
export const CHAR_INFO = {
  c1: { name: 'RONIN-01', jp: '浪人', desc: 'кибер-ронин · винтовка' },
  c2: { name: 'DOLL-02',  jp: '人形', desc: 'боевой андроид · ПП' },
  c3: { name: 'HOLLOW-03', jp: '空虚', desc: 'призрак сети · DMR' },
};

const BASE = new URL('../../assets/models/girls/', import.meta.url).href;
const TARGET_H = 1.78;      // нормализация роста под хитбоксы ботов
const YAW_FIX = 0;          // поправка ориентации (если смотрит спиной — Math.PI)

const _gltfLoader = new GLTFLoader();
const _texLoader = new THREE.TextureLoader();
const _cache = new Map();   // id → Promise<tpl|null>
const _tpl = new Map();     // id → tpl (resolved)

function loadTex(url, srgb) {
  return new Promise((res) => _texLoader.load(url, (t) => {
    t.flipY = false;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    res(t);
  }, undefined, () => res(null)));
}

async function loadChar(id) {
  const gltf = await new Promise((res, rej) =>
    _gltfLoader.load(BASE + id + '.glb', res, undefined, rej));
  const scene = gltf.scene;
  const [map, mr] = await Promise.all([
    loadTex(BASE + id + '/tex.jpg', true),
    loadTex(BASE + id + '/mr.png', false),
  ]);
  const mat = new THREE.MeshStandardMaterial({
    map: map || null,
    metalnessMap: mr || null, roughnessMap: mr || null,
    metalness: mr ? 1.0 : 0.25, roughness: mr ? 1.0 : 0.8,
    color: map ? 0xffffff : 0xcfc4d4,
  });
  scene.traverse((o) => {
    if (o.isMesh) { o.material = mat; o.frustumCulled = false; o.castShadow = false; }
  });
  // убираем root-motion из клипов: Hips X/Z фиксируем на первом кадре,
  // Y (пружина шага) оставляем — иначе модель уходит с точки спавна
  for (const clip of gltf.animations || []) {
    for (const tr of clip.tracks) {
      if (!/Hips\.position$/.test(tr.name)) continue;
      const v = tr.values;
      const x0 = v[0], z0 = v[2];
      for (let i = 0; i < v.length; i += 3) { v[i] = x0; v[i + 2] = z0; }
    }
  }
  const box = new THREE.Box3().setFromObject(scene);
  const h = Math.max(0.01, box.max.y - box.min.y);
  const scale = TARGET_H / h;
  const footY = -box.min.y * scale;
  return { id, scene, clips: gltf.animations || [], scale, footY, mat };
}

// Реальные габариты СКИННИНГ-модели: Box3.setFromObject врёт для skinned mesh
// (геометрия в метрах × node scale 100, кости в сантиметрах). Меряем через
// SkinnedMesh.computeBoundingBox (учитывает скелет) и нормализуем по факту.
const _m4 = new THREE.Matrix4();
function measureSkinned(rootObj) {
  rootObj.updateMatrixWorld(true);
  const box = new THREE.Box3(); box.makeEmpty();
  const tmp = new THREE.Box3();
  rootObj.traverse((o) => {
    if (o.isSkinnedMesh) {
      o.computeBoundingBox();
      tmp.copy(o.boundingBox).applyMatrix4(o.matrixWorld);
      box.union(tmp);
    } else if (o.isMesh) {
      o.geometry.computeBoundingBox();
      tmp.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
      box.union(tmp);
    }
  });
  // в пространство rootObj
  _m4.copy(rootObj.matrixWorld).invert();
  box.applyMatrix4(_m4);
  return box;
}

// Предзагрузка (вызывать на старте игры; не блокирует — fallback на старую модель)
export function preloadChars(ids = CHAR_IDS) {
  return Promise.all(ids.map((id) => {
    if (!_cache.has(id)) {
      const p = loadChar(id).then((tpl) => { _tpl.set(id, tpl); return tpl; })
        .catch((e) => { console.warn('[charlib] load fail', id, e); return null; });
      _cache.set(id, p);
    }
    return _cache.get(id);
  }));
}

export function charReady(id) { return _tpl.has(id); }

// Гибсы при смерти (та же схема, что и у createCyberGirl.explode)
function makeGoreDebris(root, scene) {
  const debris = [];
  const v = new THREE.Vector3();
  const mats = [
    flatMat(0x8a1020, { emissive: 0x5a0810, ei: 0.8 }),   // кровь
    flatMat(0xe8e4da),                                    // кость
    flatMat(0x1a1b22, { metal: 0.7, rough: 0.35 }),       // броня
    flatMat(0xff2a4a, { emissive: 0xff2a4a, ei: 2.0 }),   // свечение
  ];
  const p = root.position;
  for (let i = 0; i < 16; i++) {
    const s = 0.05 + Math.random() * 0.13;
    const m = new THREE.Mesh(boxGeo(s, s * (0.6 + Math.random()), s), mats[i % mats.length]);
    m.position.set(p.x + (Math.random() - 0.5) * 0.5,
      p.y + 0.2 + Math.random() * 1.4, p.z + (Math.random() - 0.5) * 0.5);
    m.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    scene.add(m);
    v.set((Math.random() - 0.5) * 4.5, 2 + Math.random() * 4.5, (Math.random() - 0.5) * 4.5);
    debris.push({
      mesh: m, vel: v.clone(),
      angVel: new THREE.Vector3(Math.random() * 8 - 4, Math.random() * 8 - 4, Math.random() * 8 - 4),
      life: 2.5,
    });
  }
  return debris;
}

// Белый контур силуэта для скиннинг-GLB: клон SkinnedMesh с BackSide-материалом,
// вершины сдвигаются по скиннёной нормали (инъекция в шейдер перед project_vertex).
// Толщина задаётся в локальных единицах меша — вычисляется из мирового масштаба.
function _makeOutlineMat(thick) {
  const m = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.BackSide });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uOutline = { value: thick };
    shader.vertexShader = 'uniform float uOutline;\n' + shader.vertexShader.replace(
      '#include <project_vertex>',
      'transformed += objectNormal * uOutline;\n#include <project_vertex>',
    );
  };
  return m;
}

function _addSkinnedOutlines(inner) {
  inner.updateMatrixWorld(true);
  const ws = new THREE.Vector3();
  const skins = [];
  inner.traverse((o) => { if (o.isSkinnedMesh) skins.push(o); });
  for (const sm of skins) {
    sm.getWorldScale(ws);
    const thick = 0.035 / Math.max(1e-4, ws.x); // ~3.5см в мире
    const o = new THREE.SkinnedMesh(sm.geometry, _makeOutlineMat(thick));
    o.bind(sm.skeleton, sm.bindMatrix);
    o.frustumCulled = false;
    o.userData.isOutline = true;
    sm.add(o);
  }
}

// Создать экземпляр персонажа. null — если GLB ещё не загружен (fallback на createCyberGirl)
export function instantiateGirl(id, { team = 0 } = {}) {
  const tpl = _tpl.get(id) || _tpl.get(TEAM_CHAR[team % 3]);
  if (!tpl) return null;

  const inner = skClone(tpl.scene);
  inner.rotation.y = YAW_FIX;
  const root = new THREE.Group();
  root.name = 'charGirl_' + tpl.id;
  root.add(inner);

  const mixer = new THREE.AnimationMixer(inner);
  const actions = {};
  for (const c of tpl.clips) {
    const a = mixer.clipAction(c);
    a.enabled = true;
    if (c.name === 'reload') { a.setLoop(THREE.LoopOnce); a.clampWhenFinished = true; }
    actions[c.name] = a;
  }
  // нормализация по РЕАЛЬНЫМ габаритам в idle-позе (bind pose врёт:
  // skeleton.boneMatrices заполняются только при рендере/update)
  if (actions.idle) actions.idle.play();
  mixer.update(0);
  root.updateMatrixWorld(true);
  root.traverse((o) => { if (o.isSkinnedMesh) o.skeleton.update(); });
  const bbox = measureSkinned(root);
  const realH = Math.max(0.01, bbox.max.y - bbox.min.y);
  const ns = TARGET_H / realH;
  const bboxMinY = bbox.min.y;
  inner.scale.setScalar(ns);
  inner.position.y = -bbox.min.y * ns;
  _addSkinnedOutlines(inner); // белый силуэт — враги читаются на любом фоне

  // Реальное оружие в правой руке (Mixamo-кость *RightHand)
  let handBone = null, headBone = null;
  inner.traverse((o) => {
    if (!handBone && o.isBone && /right.?hand$/i.test(o.name)) handBone = o;
    if (!headBone && o.isBone && /head$/i.test(o.name)) headBone = o;
  });
  if (handBone) {
    const gun = createRealGun(CHAR_WEAPON[tpl.id] || 'rifle');
    root.updateMatrixWorld(true);
    const ws = new THREE.Vector3();
    handBone.getWorldScale(ws);
    const inv = 1 / Math.max(1e-4, ws.x); // компенсация масштаба арматуры
    gun.scale.setScalar(inv);
    // ствол (-Z локальный) → вдоль предплечья (поза прицеливания)
    gun.rotation.set(Math.PI / 2, 0, 0);
    gun.position.set(0.05 * inv, 0.02 * inv, -0.02 * inv);
    gun.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
    handBone.add(gun);
  }
  let current = null;
  function fadeTo(name, dur = 0.22, timeScale = 1) {
    const next = actions[name];
    if (!next) return;
    if (current === next) { next.timeScale = timeScale; return; }
    next.reset(); next.timeScale = timeScale; next.fadeIn(dur).play();
    if (current) current.fadeOut(dur);
    current = next;
  }
  if (actions.idle) { actions.idle.play(); current = actions.idle; }
  mixer.addEventListener('finished', () => fadeTo('idle', 0.25)); // после reload → idle

  const state = {
    mode: 'idle', t: 0, shootT: 0, flinchT: 0,
    leanTarget: 0, aggroTarget: 0, crouchTarget: 0, dodgeDir: 1,
    _lean: 0, _crouch: 1, _speedF: 0, _reloadT: 0,
  };

  function setMode(m) {
    if (state.mode === 'dead') return;
    state.mode = m;
    if (m === 'shoot') state.shootT = 0.22;
    if (m === 'hit') state.flinchT = Math.max(state.flinchT, 0.2);
    if (m === 'dodge') state._lean = state.dodgeDir * 1.6;
    if (m === 'reload') { fadeTo('reload', 0.12, 1.25); state._reloadT = 1.4; }
  }

  function update(dt, speed = 0) {
    if (state.mode === 'dead') {
      // Труп: реалистичное падение набок с перелётом и оседанием (0..0.55с),
      // затем миксер замирает (последняя поза), лёгкое оседание тела.
      state.deadT = (state.deadT || 0) + dt;
      const k = Math.min(1, state.deadT / 0.55);
      const e = 1 - Math.pow(1 - k, 3);
      // перелёт через вертикаль: лёгкий overshoot на 8% перед оседанием
      const bounce = k > 0.82 ? Math.sin((k - 0.82) / 0.18 * Math.PI) * 0.07 : 0;
      inner.rotation.z = state.fallDir * (e * (Math.PI / 2) + bounce);
      // тело ложится: опорная точка смещается к толщине торса
      inner.position.y = (-bboxMinY * ns) * (1 - e) + 0.16 * e;
      mixer.timeScale = Math.max(0, 1 - state.deadT * 2.2);
      if (mixer.timeScale > 0) mixer.update(dt);
      return;
    }
    state.t += dt;
    if (state.shootT > 0) state.shootT -= dt;
    if (state._reloadT > 0) state._reloadT -= dt;

    // локомоция: стоим/идём
    const moving = speed > 0.5;
    state._speedF += ((moving ? Math.min(speed / 5, 1.2) : 0) - state._speedF) * Math.min(1, dt * 8);
    if (state._reloadT <= 0) {
      // спринт — отдельный клип 'run' (если сконвертирован), иначе ускоренный walk
      const hasRun = !!actions.run;
      if (moving) {
        const running = hasRun && state._speedF > 0.82;
        fadeTo(running ? 'run' : 'walk', 0.18, running ? 1 : 0.85 + state._speedF * 0.55);
      } else fadeTo('idle', 0.22, 1);
    }
    mixer.update(dt);

    // процедурные наклоны поверх клипов
    const leanGoal = (state.mode === 'dodge' ? state._lean : state.leanTarget) * 0.14;
    state._lean += (leanGoal - state._lean) * Math.min(1, dt * 7);
    inner.rotation.z = -state._lean;
    // присед: пружинистое сжатие по Y
    const cGoal = 1 - (state.crouchTarget || 0) * 0.16;
    state._crouch += (cGoal - state._crouch) * Math.min(1, dt * 10);
    inner.scale.y = ns * state._crouch;
    // агро: лёгкий наклон вперёд + прицеливание
    const aggro = state.aggroTarget || 0;
    inner.rotation.x = aggro * 0.06 + (state.shootT > 0 ? -0.035 : 0);
    // флинч от попаданий: дрожание корпуса
    if (state.flinchT > 0) {
      state.flinchT -= dt;
      const k = Math.max(0, state.flinchT) * 2.2;
      inner.position.x = (Math.random() - 0.5) * 0.06 * k;
      inner.rotation.z += Math.sin(state.t * 60) * 0.05 * k;
      if (state.flinchT <= 0) inner.position.x = 0;
    }
    // отдача при стрельбе: микро-подброс
    if (state.shootT > 0) inner.position.z = -state.shootT * 0.12;
    else inner.position.z = 0;
  }

  // Смерть трупом (18+): тело падает набок и остаётся лежать до респавна.
  // style: 'corpse' — обычное падение; 'decap' — голова скрывается (отрыв),
  // 'guts' — разрыв живота (кишки спавнит вызывающий через GoreSystem).
  // Возвращает { style } или null (→ вызывающий использует explode()).
  function dieCorpse({ style = 'corpse' } = {}) {
    if (state.mode === 'dead') return null;
    if (style === 'explode') return null;
    state.mode = 'dead';
    state.deathStyle = style;
    state.deadT = 0;
    state.fallDir = Math.random() < 0.5 ? 1 : -1;
    state.flinchT = 0; state.shootT = 0;
    if (style === 'decap' && headBone) headBone.scale.setScalar(0.001);
    return { style };
  }

  function explode(scene) {
    state.mode = 'dead';
    state.deadT = 0;
    const d = makeGoreDebris(root, scene);
    root.visible = false;
    return d;
  }

  function reset() {
    state.mode = 'idle';
    state.flinchT = 0; state.shootT = 0; state._reloadT = 0;
    state.deadT = 0; state.deathStyle = null;
    root.visible = true;
    inner.rotation.z = 0;
    inner.position.x = 0; inner.position.z = 0;
    inner.position.y = -bboxMinY * ns;
    mixer.timeScale = 1;
    if (headBone) headBone.scale.setScalar(1);
    fadeTo('idle', 0.1);
  }

  return { root, update, setMode, explode, dieCorpse, reset, state, parts: [], isCharGLB: true, charId: tpl.id };
}

// Какой персонаж у команды с учётом скина игрока
export function charForTeam(team, playerTeam, playerSkin) {
  if (team === playerTeam && playerSkin && CHAR_IDS.includes(playerSkin)) return playerSkin;
  return TEAM_CHAR[team % TEAM_CHAR.length];
}
