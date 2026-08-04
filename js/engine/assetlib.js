// ===== GEN.SWAGS AssetLib + RiggedCharacter =====
// Загрузка скачанных glTF-моделей (CC0, см. CREDITS.md) со скелетными
// анимациями. С v5 боты/MP-игроки — процедурные аниме-девушки
// (createAnimeGirl, models.js); RiggedCharacter сохранён как запасной
// скелетный вариант. GLB-оружие используется во viewmodel и на руках.
// Все пути относительные (assets/...) — работает из ZIP без внешних URL.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';
import { createNekoMech, flatMat, boxGeo, PALETTE } from './models.js';
import { createRealGun } from './realguns.js';

// ============================================================
// Каталог ассетов (скачано в assets/models/, CC0 — CREDITS.md)
// ============================================================
export const CHARACTERS = {
  Knight: { url: 'assets/models/Knight.glb', prefix: 'Knight_', height: 1.62 },
  Barbarian: { url: 'assets/models/Barbarian.glb', prefix: 'Barbarian_', height: 1.68 },
  Mage: { url: 'assets/models/Mage.glb', prefix: 'Mage_', height: 1.7 },
  Rogue: { url: 'assets/models/Rogue.glb', prefix: 'Rogue_', height: 1.6 },
  Rogue_Hooded: { url: 'assets/models/Rogue_Hooded.glb', prefix: 'Rogue_', height: 1.6 },
};
export const WEAPON_MODELS = {
  // ===== GLB LOW-POLY РЕАЛЬНЫЕ СТВОЛЫ (assets/weapons/, CC0 — CREDITS.md) =====
  rifle: 'assets/weapons/type-79_cheng_ying_kit.glb',     // АК-47 → штурмовой кит Type-79
  smg: 'assets/weapons/tactical_tommy_gun.glb',           // УЗИ → Томми-ган
  shotgun: 'assets/weapons/spas_12_tactical.glb',         // SPAS-12 → тактический SPAS-12
  dmr: 'assets/weapons/fn_scar-20.glb',                   // СВД → FN SCAR-20
  lmg: 'assets/weapons/type-79_cheng_ying_kit.glb',       // ПКМ → тяжёлый кит
  revolver: 'assets/weapons/low_poly_3d_magnum_revolver.glb', // Магнум .44 → револьвер
  awp: 'assets/weapons/benelli_m3_super_90.glb',          // AWP → Benelli M3 Super 90
  flamer: 'assets/weapons/tactic_mauser_pistol.glb',      // Огнемёт → Маузер (с баллоном)
  rocket: 'assets/weapons/tactic_mauser_pistol.glb',      // РПГ-7 → Маузер (пусковая)
  gl: 'assets/weapons/luger_p-08_pistol.glb',             // ГМ-94 → Luger P-08
  clip: 'assets/models/weapons/clip-small.glb',           // магазин (запасной)
};

// Нормализация имён клипов (KayKit Adventurers) → состояния игры.
// Порядок важен: берётся первый найденный.
export const CLIP_ALIASES = {
  idle: ['Idle', 'Unarmed_Idle'],
  walk: ['Walking_A', 'Walking_B', 'Walking_C'],
  run: ['Running_A', 'Running_B'],
  jump: ['Jump_Idle', 'Jump_Start', 'Jump_Full_Short'],
  shoot: ['2H_Ranged_Shooting', '2H_Ranged_Shoot', '1H_Ranged_Shooting', '1H_Ranged_Shoot', 'Spellcast_Shoot', 'Throw'],
  death: ['Death_A', 'Death_B'],
  death2: ['Death_B', 'Death_A'],
  hit: ['Hit_A', 'Hit_B'],
};

// Сопоставление доступных в gltf анимаций состояниям (покрытие idle/run/death
// проверяет test/assets.test.mjs).
export function mapClips(animations) {
  const names = animations.map((c) => (typeof c === 'string' ? c : c.name));
  const out = {};
  for (const [state, aliases] of Object.entries(CLIP_ALIASES)) {
    out[state] = aliases.find((a) => names.includes(a)) || null;
  }
  return out;
}

// ============================================================
// AssetLib: GLTFLoader + кеш + SkeletonUtils-клоны + frustum кадра
// ============================================================
const _loader = { current: null };
const _cache = new Map(); // url -> Promise<gltf>

export const AssetLib = {
  // Frustum текущего кадра (main.js дергает beginFrame раз в апдейт)
  frustum: null,
  _projView: new THREE.Matrix4(),
  _sphere: new THREE.Sphere(),

  loader() {
    if (!_loader.current) _loader.current = new GLTFLoader();
    return _loader.current;
  },

  load(url) {
    if (!_cache.has(url)) {
      _cache.set(url, this.loader().loadAsync(url));
    }
    return _cache.get(url);
  },

  // Клон сцены для независимого экземпляра (скелет/кожа — SkeletonUtils)
  async instance(url) {
    const gltf = await this.load(url);
    return { scene: skeletonClone(gltf.scene), animations: gltf.animations };
  },

  // Прогрев кеша на загрузочном экране (ошибки не фатальны).
  // С v5 персонажи — процедурные аниме-девушки, GLB-героев не греем
  // (~18MB парсинга на старте больше не нужно); греем только GLB-оружие.
  async preload(onProgress = null) {
    const urls = Object.values(WEAPON_MODELS);
    let done = 0;
    await Promise.all(urls.map(async (u) => {
      try { await this.load(u); } catch (e) { console.warn('[AssetLib] preload fail', u, e); }
      done++;
      onProgress?.(done / urls.length);
    }));
  },

  beginFrame(camera) {
    if (!camera) { this.frustum = null; return; }
    if (!this.frustum) this.frustum = new THREE.Frustum();
    camera.updateMatrixWorld();
    this._projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this._projView);
  },

  // Грубая сфера по позиции рута (персонаж ~1.7м — радиус 2)
  inFrame(pos, radius = 2) {
    if (!this.frustum) return true; // frustum не настроен — анимируем всё
    this._sphere.center.set(pos.x, pos.y + 0.9, pos.z);
    this._sphere.radius = radius;
    return this.frustum.intersectsSphere(this._sphere);
  },
};

// ============================================================
// RiggedCharacter: скелетная модель + миксер + карта клипов.
// API совместим с процедурным createNekoMech():
//   { root, update(dt, speed), setMode(m), explode(scene)->debris[], reset(), state }
// ============================================================
const FADE_SPEED = 5;      // кроссфейд клипов (1/сек) → 0.2с
const SHOOT_HOLD = 0.32;   // удержание клипа стрельбы после последнего выстрела
const HIT_HOLD = 0.28;
const DEATH_FADE_AT = 1.6; // после клипа смерти — растворение
const DEATH_GONE_AT = 2.6;

export function createRiggedCharacter({ character = 'Knight', team = 0, weapon = 'rifle', useFallback = true } = {}) {
  const root = new THREE.Group();
  root.name = `rigged_${character}`;

  // Процедурный fallback: виден до загрузки GLB и при ошибке загрузки
  const fallback = useFallback ? createNekoMech() : null;
  if (fallback) root.add(fallback.root);

  const state = { mode: 'idle', dead: false, rigged: false };
  const rig = {
    mixer: null, actions: {}, current: null,
    shootT: 0, hitT: 0, deathT: -1, fadeStarted: false,
    scene: null, mats: [],
  };

  function _play(name, { fade = 0.2, once = false } = {}) {
    const action = rig.actions[name];
    if (!action) return null;
    if (rig.current === action && !once) return action;
    action.reset();
    if (once) {
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
    } else {
      action.setLoop(THREE.LoopRepeat, Infinity);
    }
    action.enabled = true;
    action.fadeIn(fade).play();
    if (rig.current && rig.current !== action) rig.current.fadeOut(fade);
    rig.current = action;
    return action;
  }

  async function _load() {
    const def = CHARACTERS[character] || CHARACTERS.Knight;
    const { scene: model, animations } = await AssetLib.instance(def.url);

    // Прячем проп-меши пака (мечи/щиты/книги) — оставляем только тело
    model.traverse((o) => {
      if ((o.isMesh || o.isSkinnedMesh) && o.name && !o.name.startsWith(def.prefix)) {
        o.visible = false;
      }
      if (o.isMesh || o.isSkinnedMesh) {
        o.castShadow = true;
        o.frustumCulled = true;
        // Материалы клонируем per-экземпляр: независимый fade/tint
        if (o.material) { o.material = o.material.clone(); rig.mats.push(o.material); }
      }
    });

    // Масштаб до целевого роста (по AABB тела, без пропов)
    const bbox = new THREE.Box3();
    model.updateMatrixWorld(true);
    model.traverse((o) => {
      if ((o.isMesh || o.isSkinnedMesh) && o.visible && o.name.startsWith(def.prefix)) {
        bbox.expandByObject(o);
      }
    });
    const rawH = Math.max(0.001, bbox.max.y - bbox.min.y);
    const scale = def.height / rawH;
    model.scale.setScalar(scale);
    model.position.y = -bbox.min.y * scale; // стопы на земле

    // Миксер + карта клипов
    rig.mixer = new THREE.AnimationMixer(model);
    const names = mapClips(animations);
    for (const [stateName, clipName] of Object.entries(names)) {
      if (!clipName) continue;
      const clip = animations.find((c) => c.name === clipName);
      rig.actions[stateName] = rig.mixer.clipAction(clip);
    }

    // Оружие в правую руку (кость handslot.r у KayKit-рига;
    // GLTFLoader санирует точки в именах → пробуем варианты)
    try {
      let hand = null;
      for (const n of ['handslot.r', 'handslotr', 'handslot_r', 'hand.r', 'handr']) {
        hand = model.getObjectByName(n);
        if (hand) break;
      }
      if (hand && WEAPON_MODELS[weapon]) {
        const wGltf = await AssetLib.load(WEAPON_MODELS[weapon]);
        const wModel = wGltf.scene.clone(true);
        wModel.traverse((o) => { if (o.isMesh) o.castShadow = true; });
        // Бластеры Kenney смоделированы в метрах, длина ~1.31 — под кисть chibi.
        // Подгонка по rig (dev/attach-test.html): ствол -Z модели → вперёд +Z
        // персонажа при повороте -90° по Y; сдвиг +X кости двигает вперёд —
        // рукоять оказывается в кулаке, ствол смотрит по прицелу.
        const wScale = 0.5 / 1.31; // длина в руках ≈ 0.5м
        wModel.scale.setScalar(wScale / scale); // компенсация масштаба модели
        wModel.rotation.set(0, -Math.PI / 2, 0);
        wModel.position.set(0.16, 0.02, 0.02);
        hand.add(wModel);
      }
    } catch (e) { console.warn('[RiggedCharacter] weapon attach fail', e); }

    // Своп: убрать fallback, показать rig
    if (fallback) {
      fallback.root.removeFromParent();
    }
    root.add(model);
    rig.scene = model;
    state.rigged = true;
    _play(state.mode === 'dead' ? 'death' : 'idle', { fade: 0 });
  }

  const ready = _load().catch((e) => {
    console.warn('[RiggedCharacter] GLB load fail, процедурный fallback:', e);
    state.rigged = false;
  });

  // ---------- API (как у createNekoMech) ----------
  function setMode(m) {
    if (state.dead) return;
    state.mode = m;
    if (m === 'shoot') rig.shootT = SHOOT_HOLD;
    if (m === 'hit') rig.hitT = HIT_HOLD;
  }

  function update(dt, speed = 0) {
    if (!state.rigged) { fallback?.update(dt, speed); return; }

    // Смерть: клип death → удержание позы → растворение
    if (state.dead) {
      if (rig.deathT >= 0) {
        rig.deathT += dt;
        if (AssetLib.inFrame(root.position)) rig.mixer.update(dt);
        if (rig.deathT > DEATH_FADE_AT && !rig.fadeStarted) {
          rig.fadeStarted = true;
          for (const m of rig.mats) { m.transparent = true; }
        }
        if (rig.fadeStarted) {
          const k = Math.max(0, 1 - (rig.deathT - DEATH_FADE_AT) / (DEATH_GONE_AT - DEATH_FADE_AT));
          for (const m of rig.mats) m.opacity = k;
          if (k <= 0) { root.visible = false; rig.deathT = -1; }
        }
      }
      return;
    }

    // Анимация только для видимых (frustum culling миксеров)
    if (!AssetLib.inFrame(root.position)) return;

    if (rig.shootT > 0) rig.shootT -= dt;
    if (rig.hitT > 0) rig.hitT -= dt;

    let want = 'idle';
    if (rig.hitT > 0) want = 'hit';
    else if (rig.shootT > 0 && rig.actions.shoot) want = 'shoot';
    else if (state.mode === 'jump' && rig.actions.jump) want = 'jump';
    else if (speed > 3.0) want = 'run';
    else if (speed > 0.4) want = 'walk';
    if (!rig.actions[want]) want = 'idle';
    _play(want, { fade: 1 / FADE_SPEED, once: want === 'hit' });
    rig.mixer.update(dt);
  }

  // Смерть: клип death + несколько светящихся осколков (в духе прежнего рассыпания)
  function explode(scene) {
    state.dead = true;
    state.mode = 'dead';
    rig.deathT = 0;
    rig.fadeStarted = false;
    if (state.rigged) {
      const deathName = Math.random() < 0.5 ? 'death' : 'death2';
      _play(rig.actions[deathName] ? deathName : 'death', { fade: 0.12, once: true });
    } else if (fallback) {
      return fallback.explode(scene);
    }
    // Осколки: пара кристальных шардов — визуальная преемственность с v3
    const debris = [];
    root.updateMatrixWorld(true);
    const matShard = flatMat(PALETTE.crystal, { emissive: PALETTE.crystal, ei: 1.6, noCache: true });
    for (let i = 0; i < 4; i++) {
      const shard = new THREE.Mesh(boxGeo(0.09, 0.16, 0.09), matShard);
      shard.position.set(
        root.position.x + (Math.random() - 0.5) * 0.4,
        root.position.y + 0.9 + Math.random() * 0.5,
        root.position.z + (Math.random() - 0.5) * 0.4,
      );
      scene?.add(shard);
      debris.push({
        mesh: shard,
        vel: new THREE.Vector3((Math.random() - 0.5) * 3, 2 + Math.random() * 3, (Math.random() - 0.5) * 3),
        angVel: new THREE.Vector3(Math.random() * 8 - 4, Math.random() * 8 - 4, Math.random() * 8 - 4),
        life: 1.8,
      });
    }
    return debris;
  }

  function reset() {
    state.dead = false;
    state.mode = 'idle';
    rig.deathT = -1;
    rig.fadeStarted = false;
    rig.shootT = 0;
    rig.hitT = 0;
    root.visible = true;
    for (const m of rig.mats) { m.opacity = 1; m.transparent = false; }
    if (state.rigged) _play('idle', { fade: 0.1 });
    else fallback?.reset();
  }

  function _debug() {
    return {
      dead: state.dead, rigged: state.rigged,
      current: rig.current?.getClip?.().name || null,
      currentRunning: rig.current?.isRunning?.() ?? null,
      currentTime: rig.current?.time ?? null,
      deathT: rig.deathT, actions: Object.keys(rig.actions),
    };
  }

  return { root, update, setMode, explode, reset, state, ready, _debug };
}

// ============================================================
// Viewmodel upgrade: скачанный бластер вместо процедурного корпуса.
// Процедурные руки/рукава и анимации sway/bob/recoil/reload сохраняются.
// ============================================================
export async function upgradeViewmodel(vm, kind) {
  const url = WEAPON_MODELS[kind] || WEAPON_MODELS.rifle;
  try {
    const gunGltf = await AssetLib.load(url);
    // Прячем процедурный корпус (руки/рукава остаются)
    for (const m of vm.bodyParts || []) m.visible = false;

    const gun = gunGltf.scene.clone(true);
    gun.traverse((o) => { if (o.isMesh) o.frustumCulled = false; }); // всегда в кадре (камера-дочерний)
    // Унификация стиля: если у модели нет текстуры — тёмный ганметал + красная вставка
    gun.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (!m.map) {
          m.color?.set(0x2b2e38);
          if ('metalness' in m) m.metalness = 0.65;
          if ('roughness' in m) m.roughness = 0.38;
        }
      }
    });
    // АВТО-НОРМАЛИЗАЦИЯ: вычисляем реальный bbox скачанной модели и приводим
    // к целевой длине ствола в руках (~0.6м). Ось ствола — самая длинная
    // (обычно Z); ствол направляем в -Z (от камеры). Никакого хардкода под
    // конкретный юнит (Kenney/Sketchfab) — модель сама подгоняется.
    gun.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(gun);
    const sz = bb.getSize(new THREE.Vector3());
    const TARGET_LEN = 0.62; // длина ствола в руках, м
    // Определяем доминантную ось (ось ствола) — самый длинный размер
    const axis = sz.z >= sz.x && sz.z >= sz.y ? 'z' : (sz.x >= sz.y ? 'x' : 'y');
    const len = Math.max(sz.x, sz.y, sz.z, 0.001);
    const s = TARGET_LEN / len;
    // Поворот ствола в -Z, если ствол смотрит по X (редко у real-стволов)
    if (axis === 'x') gun.rotation.y = -Math.PI / 2;
    gun.scale.setScalar(s);
    gun.updateMatrixWorld(true);
    // Центрируем по XY, приклад у камеры: пересчёт bbox после поворота/масштаба
    const bb2 = new THREE.Box3().setFromObject(gun);
    const c2 = bb2.getCenter(new THREE.Vector3());
    gun.position.set(-c2.x, -c2.y * 0.6 + 0.02, -bb2.max.z + 0.16);
    vm.group.add(gun);

    // Магазин: если у модели есть нода 'magazine' — перетаскиваем её
    // в анимированную группу перезарядки (sway/bob/recoil/reload — процедурные).
    const magNode = gun.getObjectByName('magazine');
    if (magNode && vm.magazine) {
      vm.magazine.clear();
      vm.magazine.position.set(0, 0, 0);
      vm.magazine.rotation.set(0, 0, 0);
      vm.group.updateMatrixWorld(true);
      vm.magazine.attach(magNode); // мировой трансформ сохраняется
      vm.magHome.copy(magNode.position);
      vm.magazine.position.copy(vm.magHome);
      magNode.position.set(0, 0, 0);
    } else if (vm.magazine) {
      vm.magazine.visible = false; // процедурный магазин не нужен
    }

    // Дульная точка: кончик ствола скачанной модели (для трассеров/вспышки)
    if (vm.muzzle) {
      const bb = new THREE.Box3().setFromObject(gun);
      vm.muzzle.position.set(0, bb.max.y - 0.06, bb.min.z - 0.02);
    }
    vm.upgraded = true;
  } catch (e) {
    console.warn('[upgradeViewmodel] fail, остаётся процедурная:', e);
  }
  return vm;
}

// ============================================================
// upgradeViewmodelReal(vm, kind) — СИНХРОННО ставит процедурную
// low-poly РЕАЛЬНУЮ модель оружия (АК/УЗИ/SPAS/СВД/ПКМ/Магнум/AWP/
// РПГ/ГМ/огнемёт) из realguns.js. Руки/рукава и sway/bob/recoil/
// reload — процедурные, сохраняются. Магазин перетаскивается в
// анимированную группу, muzzle — на срез ствола.
// ============================================================
export function upgradeViewmodelReal(vm, kind) {
  try {
    for (const m of vm.bodyParts || []) m.visible = false;
    const gun = createRealGun(kind);
    gun.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
    gun.position.set(0, 0.0, -0.10); // лёгкий сдвиг вперёд от камеры
    vm.group.add(gun);
    vm.realGun = gun;

    const magNode = gun.getObjectByName('magazine');
    if (magNode && vm.magazine) {
      vm.magazine.clear();
      vm.magazine.position.set(0, 0, 0);
      vm.magazine.rotation.set(0, 0, 0);
      vm.group.updateMatrixWorld(true);
      vm.magazine.attach(magNode);
      vm.magHome.copy(magNode.position);
      vm.magazine.position.copy(vm.magHome);
      magNode.position.set(0, 0, 0);
    }

    if (vm.muzzle) {
      const mz = gun.getObjectByName('muzzle');
      if (mz) {
        const wp = new THREE.Vector3();
        mz.getWorldPosition(wp);
        vm.group.worldToLocal(wp);
        vm.muzzle.position.copy(wp);
      }
    }
    vm.upgraded = true;
  } catch (e) {
    console.warn('[upgradeViewmodelReal] fail:', e);
  }
  return vm;
}
