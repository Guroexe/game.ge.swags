// ===== GEN.SWAGS Models =====
// Процедурные low-poly модели (flatShading, без внешних ассетов).
// Палитра v2 (по референсам): белый мрамор/камень арены, фиолетовый кристалл,
// чёрный механический корпус неко-мех + платиновый блонд, красный биохазард.
import * as THREE from 'three';

export const PALETTE = {
  coal: 0x17181d, concrete: 0xd8d5de, darkMetal: 0x555a66,
  crimson: 0xff2d55, crimsonDark: 0x8f1430,
  crystal: 0xa05cff, crystalDark: 0x5a2ea6, crystalLight: 0xd9c8ff,
  bone: 0xe8e4da, skin: 0xf7f1ea, hair: 0x3a2a4a,
  blonde: 0xecd9a0, blondeLight: 0xf6ecc8,
  mechBlack: 0x17181d, mechSilver: 0xb9c1cd,
  mechArm: 0x8a94a4, glow: 0xff5c7a,
  marble: 0xf4f3f6, hazard: 0xd4102a,
};

// Кэш материалов — общие экземпляры для производительности
const matCache = new Map();
export function flatMat(color, opts = {}) {
  const key = `${color}|${opts.emissive || 0}|${opts.ei || 0}|${opts.metal ?? 0.15}|${opts.rough ?? 0.85}|${opts.map ? opts.map.uuid : ''}`;
  if (!opts.noCache && matCache.has(key)) return matCache.get(key);
  const m = new THREE.MeshStandardMaterial({
    color, flatShading: true,
    metalness: opts.metal ?? 0.15,
    roughness: opts.rough ?? 0.85,
    emissive: opts.emissive || 0x000000,
    emissiveIntensity: opts.ei ?? 1,
    map: opts.map || null,
  });
  if (!opts.noCache) matCache.set(key, m);
  return m;
}

const geoCache = new Map();
export function boxGeo(w, h, d) {
  const key = `b${w},${h},${d}`;
  if (!geoCache.has(key)) geoCache.set(key, new THREE.BoxGeometry(w, h, d));
  return geoCache.get(key);
}
function coneGeo(r, h, seg = 5) {
  const key = `c${r},${h},${seg}`;
  if (!geoCache.has(key)) geoCache.set(key, new THREE.ConeGeometry(r, h, seg));
  return geoCache.get(key);
}

function mesh(geo, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  return m;
}

// ===== Cel-shading: toon-материал + контурная оболочка (аниме-стиль) =====
let _toonGradient = null;
function toonGradientMap() {
  if (_toonGradient) return _toonGradient;
  const data = new Uint8Array([96, 156, 216, 255]);
  const tex = new THREE.DataTexture(data, 4, 1, THREE.RedFormat);
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  _toonGradient = tex;
  return tex;
}
const toonCache = new Map();
export function toonMat(color, opts = {}) {
  const key = `t${color}|${opts.emissive || 0}|${opts.ei || 0}`;
  if (toonCache.has(key)) return toonCache.get(key);
  const m = new THREE.MeshToonMaterial({
    color,
    gradientMap: toonGradientMap(),
    emissive: opts.emissive || 0x000000,
    emissiveIntensity: opts.ei ?? 1,
  });
  toonCache.set(key, m);
  return m;
}
// Белый контур силуэта: враги читаются на любом фоне (была «аниме-тушь» 0x0a0a10)
const _outlineMat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.BackSide });
export function addOutline(target, s = 1.08) {
  const o = new THREE.Mesh(target.geometry, _outlineMat);
  o.scale.setScalar(s);
  o.userData.isOutline = true;
  target.add(o);
  return o;
}
// Плавные примитивы с кешем
function capGeo(r, l, seg = 10) {
  const key = `cap${r},${l},${seg}`;
  if (!geoCache.has(key)) geoCache.set(key, new THREE.CapsuleGeometry(r, l, 4, seg));
  return geoCache.get(key);
}
function sphGeo(r, w = 12, h = 10) {
  const key = `s${r},${w},${h}`;
  if (!geoCache.has(key)) geoCache.set(key, new THREE.SphereGeometry(r, w, h));
  return geoCache.get(key);
}
function cylGeo(rt, rb, h, seg = 10) {
  const key = `cy${rt},${rb},${h},${seg}`;
  if (!geoCache.has(key)) geoCache.set(key, new THREE.CylinderGeometry(rt, rb, h, seg));
  return geoCache.get(key);
}

// ============================================================
// ТЕКСТУРЫ (canvas, процедурные)
// ============================================================

// Белый мрамор с прожилками и швами плитки (пол арены)
export function createMarbleTexture(size = 1024, tiles = 4) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  // База — тёплый белый
  ctx.fillStyle = '#f4f3f6';
  ctx.fillRect(0, 0, size, size);
  // Лёгкие пятна-тон
  for (let i = 0; i < 26; i++) {
    const x = Math.random() * size, y = Math.random() * size;
    const r = 60 + Math.random() * 200;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const tint = Math.random() < 0.3 ? '190,175,215' : '168,168,182';
    g.addColorStop(0, `rgba(${tint},${0.05 + Math.random() * 0.06})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // Прожилки — случайные ломаные
  for (let i = 0; i < 46; i++) {
    let x = Math.random() * size, y = Math.random() * size;
    ctx.beginPath();
    ctx.moveTo(x, y);
    const segs = 4 + Math.floor(Math.random() * 7);
    let ang = Math.random() * Math.PI * 2;
    for (let s = 0; s < segs; s++) {
      ang += (Math.random() - 0.5) * 1.3;
      const len = 20 + Math.random() * 80;
      x += Math.cos(ang) * len;
      y += Math.sin(ang) * len;
      ctx.lineTo(x, y);
    }
    const violet = Math.random() < 0.22;
    ctx.strokeStyle = violet
      ? `rgba(150,120,200,${0.05 + Math.random() * 0.07})`
      : `rgba(148,148,166,${0.06 + Math.random() * 0.1})`;
    ctx.lineWidth = 0.8 + Math.random() * 2.2;
    ctx.stroke();
  }
  // Швы плитки
  const step = size / tiles;
  for (let i = 0; i <= tiles; i++) {
    const p = i * step;
    ctx.strokeStyle = 'rgba(118,118,138,0.6)';
    ctx.lineWidth = Math.max(2, size / 512);
    ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, size); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(size, p); ctx.stroke();
    // бликовая кромка шва
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(p + 2, 0); ctx.lineTo(p + 2, size); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, p + 2); ctx.lineTo(size, p + 2); ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// ============================================================
// СКАЧАННЫЕ PBR-ТЕКСТУРЫ (ambientCG, CC0 — CREDITS.md, assets/textures/)
// Асинхронная загрузка с кешем; до загрузки / при ошибке сети/файла
// действуют процедурные canvas-текстуры выше (fallback, игра не ломается).
// ============================================================
export const ENV_TEXTURE_SETS = {
  marble: { // белый мрамор (пол СОБОРА)
    color: 'assets/textures/marble_white_color.jpg',
    roughness: 'assets/textures/marble_white_roughness.jpg',
    normal: 'assets/textures/marble_white_normal.jpg',
  },
  concrete: { // светлый бетон (стены всех арен)
    color: 'assets/textures/concrete_color.jpg',
    roughness: 'assets/textures/concrete_roughness.jpg',
    normal: 'assets/textures/concrete_normal.jpg',
  },
  metalPlates: { // sci-fi металл-панели (НЕКРО-ЗАВОД)
    color: 'assets/textures/metalplates_color.jpg',
    roughness: 'assets/textures/metalplates_roughness.jpg',
    normal: 'assets/textures/metalplates_normal.jpg',
    metalness: 'assets/textures/metalplates_metalness.jpg',
  },
  ground: { // камень/песок (пол ПУСТЫНИ ДАННЫХ)
    color: 'assets/textures/ground_color.jpg',
    roughness: 'assets/textures/ground_roughness.jpg',
    normal: 'assets/textures/ground_normal.jpg',
  },
  panel: { // тёмная металл-панель (акценты: станции, рамки зон)
    color: 'assets/textures/panel_color.jpg',
    roughness: 'assets/textures/panel_roughness.jpg',
    normal: 'assets/textures/panel_normal.jpg',
    metalness: 'assets/textures/panel_metalness.jpg',
  },
};

const _texLoader = { current: null };
const _fileCache = new Map(); // url|srgb -> Promise<Texture|null>
const _setCache = new Map();  // name|rx,ry -> {map,roughnessMap,normalMap,metalnessMap}|null

// Один файл → текстура (repeat wrapping, anisotropy 4, sRGB для albedo)
function _loadTexFile(url, srgb) {
  const key = `${url}|${srgb ? 1 : 0}`;
  if (_fileCache.has(key)) return _fileCache.get(key);
  const p = new Promise((resolve) => {
    try {
      _texLoader.current = _texLoader.current || new THREE.TextureLoader();
      _texLoader.current.load(url, (tex) => {
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 4;
        resolve(tex);
      }, undefined, () => resolve(null)); // нет файла — fallback
    } catch { resolve(null); }
  });
  _fileCache.set(key, p);
  return p;
}

// Набор целиком → {map, roughnessMap, normalMap, metalnessMap} или null
// (null = albedo не загрузилась, остаёмся на процедурных текстурах).
// repeat [rx, ry] — клонирует текстуры (общий image, свой тайлинг).
export async function loadTextureSet(name, { repeat = [1, 1] } = {}) {
  const key = `${name}|${repeat[0]},${repeat[1]}`;
  if (_setCache.has(key)) return _setCache.get(key);
  const def = ENV_TEXTURE_SETS[name];
  let out = null;
  if (def) {
    const [map, roughnessMap, normalMap, metalnessMap] = await Promise.all([
      def.color ? _loadTexFile(def.color, true) : null,
      def.roughness ? _loadTexFile(def.roughness, false) : null,
      def.normal ? _loadTexFile(def.normal, false) : null,
      def.metalness ? _loadTexFile(def.metalness, false) : null,
    ]);
    if (map) {
      out = {};
      const src = { map, roughnessMap, normalMap, metalnessMap };
      for (const [slot, tex] of Object.entries(src)) {
        if (!tex) continue;
        const c = tex.clone();
        c.wrapS = c.wrapT = THREE.RepeatWrapping;
        c.repeat.set(repeat[0], repeat[1]);
        c.anisotropy = 4;
        c.needsUpdate = true;
        out[slot] = c;
      }
    }
  }
  _setCache.set(key, out);
  return out;
}

// Синхронный доступ к уже загруженному набору (после preloadEnvTextures).
export function getTextureSet(name, repeat = [1, 1]) {
  return _setCache.get(`${name}|${repeat[0]},${repeat[1]}`) ?? null;
}

// Прелоад всех наборов, нужных аренам (вызывается из boot до buildArena).
export async function preloadEnvTextures() {
  const jobs = [
    ['marble', [5, 5]],
    ['concrete', [2, 2]],
    ['metalPlates', [5, 5]],
    ['metalPlates', [2, 2]],
    ['ground', [5, 5]],
    ['panel', [1, 1]],
  ];
  await Promise.all(jobs.map(([n, r]) => loadTextureSet(n, { repeat: r })));
  let loaded = 0;
  for (const [n, r] of jobs) if (getTextureSet(n, r)) loaded++;
  return loaded;
}

// Применить PBR-набор к готовому материалу (albedo+normal+roughness+metalness).
// baseRough/baseMetal — значения на случай отсутствующих карт.
export function applyTextureSet(mat, tex, { baseRough = 0.85, baseMetal = 0.05 } = {}) {
  if (!mat || !tex) return mat;
  mat.map = tex.map || null;
  if (tex.normalMap) mat.normalMap = tex.normalMap;
  if (tex.roughnessMap) { mat.roughnessMap = tex.roughnessMap; mat.roughness = 1.0; }
  else mat.roughness = baseRough;
  if (tex.metalnessMap) { mat.metalnessMap = tex.metalnessMap; mat.metalness = 1.0; }
  else mat.metalness = baseMetal;
  mat.needsUpdate = true;
  return mat;
}

// Красный БИОХАЗАРД-символ (декаль)
export function createBiohazardTexture(size = 512) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  const c = size / 2;
  const R = size * 0.42;
  ctx.strokeStyle = '#d4102a';
  ctx.fillStyle = '#d4102a';
  ctx.lineCap = 'round';
  // Три больших кольцевых сегмента
  ctx.lineWidth = size * 0.075;
  for (let i = 0; i < 3; i++) {
    const a = -Math.PI / 2 + (i * Math.PI * 2) / 3;
    const cx = c + Math.cos(a) * R * 0.52;
    const cy = c + Math.sin(a) * R * 0.52;
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.52, a + Math.PI * 0.62, a + Math.PI * 1.72);
    ctx.stroke();
  }
  // Внутреннее кольцо с тремя прорезями
  ctx.lineWidth = size * 0.06;
  for (let i = 0; i < 3; i++) {
    const a0 = -Math.PI / 2 + (i * Math.PI * 2) / 3 + 0.32;
    const a1 = -Math.PI / 2 + ((i + 1) * Math.PI * 2) / 3 - 0.32;
    ctx.beginPath();
    ctx.arc(c, c, R * 0.34, a0, a1);
    ctx.stroke();
  }
  // Центральный диск
  ctx.beginPath();
  ctx.arc(c, c, size * 0.05, 0, Math.PI * 2);
  ctx.fill();
  // Три спицы от центра к кольцу
  ctx.lineWidth = size * 0.045;
  for (let i = 0; i < 3; i++) {
    const a = -Math.PI / 2 + (i * Math.PI * 2) / 3;
    ctx.beginPath();
    ctx.moveTo(c + Math.cos(a) * size * 0.06, c + Math.sin(a) * size * 0.06);
    ctx.lineTo(c + Math.cos(a) * R * 0.62, c + Math.sin(a) * R * 0.62);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// Блик-солнце: радиальный глоу + анаморфная горизонтальная полоса
export function createSunGlareTexture(size = 256) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  const c = size / 2;
  const g = ctx.createRadialGradient(c, c, 0, c, c, c);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.18, 'rgba(255,252,244,0.85)');
  g.addColorStop(0.45, 'rgba(235,225,255,0.28)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  // Анаморфная полоса
  const lg = ctx.createLinearGradient(0, c, size, c);
  lg.addColorStop(0, 'rgba(255,255,255,0)');
  lg.addColorStop(0.5, 'rgba(255,255,255,0.75)');
  lg.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = lg;
  ctx.fillRect(0, c - size * 0.02, size, size * 0.04);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Гравировка/орнамент для корпуса оружия (map + bump)
function createEngravingTexture(w = 256, h = 128) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#8a8f9a';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(40,42,52,0.85)';
  ctx.lineWidth = 2;
  // Завитки-орнамент
  for (let i = 0; i < 14; i++) {
    const x = Math.random() * w, y = Math.random() * h;
    const r = 8 + Math.random() * 22;
    ctx.beginPath();
    ctx.arc(x, y, r, Math.random() * 3, Math.random() * 3 + 2.5);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x + r * 0.6, y, r * 0.45, 0, Math.PI * 1.4);
    ctx.stroke();
  }
  // Штриховка
  ctx.lineWidth = 1;
  for (let i = 0; i < 40; i++) {
    const x = Math.random() * w, y = Math.random() * h;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 14, y + 5);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// Anime-лицо неко-мех: большие тёмные глаза, маленький рот
function createFaceTexture(size = 256) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#f7f1ea';
  ctx.fillRect(0, 0, size, size);
  const eye = (cx, cy) => {
    // Тёмный миндалевидный глаз
    ctx.fillStyle = '#171320';
    ctx.beginPath();
    ctx.ellipse(cx, cy, size * 0.105, size * 0.14, 0, 0, Math.PI * 2);
    ctx.fill();
    // Нижняя ресничная кромка
    ctx.strokeStyle = '#3a3048';
    ctx.lineWidth = size * 0.012;
    ctx.beginPath();
    ctx.ellipse(cx, cy + size * 0.02, size * 0.115, size * 0.15, 0, 0.35, Math.PI - 0.35);
    ctx.stroke();
    // Блики
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(cx - size * 0.035, cy - size * 0.05, size * 0.03, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx + size * 0.04, cy + size * 0.05, size * 0.014, 0, Math.PI * 2);
    ctx.fill();
  };
  eye(size * 0.31, size * 0.5);
  eye(size * 0.69, size * 0.5);
  // Брови
  ctx.strokeStyle = '#c9b285';
  ctx.lineWidth = size * 0.016;
  ctx.beginPath(); ctx.moveTo(size * 0.22, size * 0.31); ctx.quadraticCurveTo(size * 0.31, size * 0.26, size * 0.4, size * 0.3); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(size * 0.6, size * 0.3); ctx.quadraticCurveTo(size * 0.69, size * 0.26, size * 0.78, size * 0.31); ctx.stroke();
  // Румянец
  ctx.fillStyle = 'rgba(240,160,170,0.4)';
  ctx.beginPath(); ctx.ellipse(size * 0.2, size * 0.66, size * 0.06, size * 0.03, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(size * 0.8, size * 0.66, size * 0.06, size * 0.03, 0, 0, Math.PI * 2); ctx.fill();
  // Рот — крошечная чёрточка
  ctx.strokeStyle = '#8a5a5a';
  ctx.lineWidth = size * 0.012;
  ctx.beginPath(); ctx.moveTo(size * 0.47, size * 0.76); ctx.quadraticCurveTo(size * 0.5, size * 0.78, size * 0.53, size * 0.76); ctx.stroke();
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ============================================================
// 1. ПЕРСОНАЖ «НЕКО-МЕХ ДЕВУШКА» (chibi, по референсу):
//    платиновые твинтейлы, большие тёмные глаза (anime-фейс),
//    чёрный мех-корпус, серебряные суставы, челюсть-респиратор,
//    светлые ушки-рожки, автомат в руках.
// ============================================================
export function createNekoMech() {
  const root = new THREE.Group();
  root.name = 'nekoMech';

  const matSkin = flatMat(PALETTE.skin, { rough: 0.9, metal: 0 });
  const matHair = flatMat(PALETTE.blonde, { rough: 0.65, metal: 0.05 });
  const matHairLight = flatMat(PALETTE.blondeLight, { rough: 0.6, metal: 0.05 });
  const matSuit = flatMat(PALETTE.mechBlack, { metal: 0.5, rough: 0.5 });
  const matSilver = flatMat(PALETTE.mechSilver, { metal: 0.7, rough: 0.35 });
  const matGlow = flatMat(PALETTE.crimson, { emissive: PALETTE.crimson, ei: 1.6 });
  const matCrystal = flatMat(PALETTE.crystal, { emissive: PALETTE.crystal, ei: 0.9, metal: 0.3 });
  const matEar = flatMat(0xe8e4ee, { metal: 0.4, rough: 0.4 });

  // --- Таз (корень анимации) ---
  const hips = new THREE.Group();
  hips.position.y = 0.62;
  root.add(hips);

  // Торс — чёрный механический корсет
  const torso = new THREE.Group();
  hips.add(torso);
  torso.add(mesh(boxGeo(0.34, 0.36, 0.22), matSuit, 0, 0.2, 0));
  torso.add(mesh(boxGeo(0.36, 0.06, 0.24), matSilver, 0, 0.1, 0)); // серебряный пояс-шарнир
  torso.add(mesh(boxGeo(0.2, 0.1, 0.05), matCrystal, 0, 0.28, 0.12)); // нагрудный кристалл
  torso.add(mesh(boxGeo(0.3, 0.04, 0.2), matGlow, 0, 0.02, 0)); // светящийся подол
  // Позвоночник-кабель сзади
  torso.add(mesh(boxGeo(0.06, 0.3, 0.04), matSilver, 0, 0.2, -0.13));

  // --- Голова (большая, chibi) ---
  const head = new THREE.Group();
  head.position.y = 0.44;
  torso.add(head);
  head.add(mesh(boxGeo(0.42, 0.38, 0.38), matSkin, 0, 0.2, 0));
  // Плоское anime-лицо (canvas-декаль): большие тёмные глаза
  const faceTex = createFaceTexture(256);
  const face = mesh(
    new THREE.PlaneGeometry(0.36, 0.32),
    new THREE.MeshStandardMaterial({ map: faceTex, roughness: 0.9, metalness: 0, transparent: true }),
    0, 0.2, 0.196,
  );
  head.add(face);
  // Металлическая челюсть-респиратор + шейное кольцо
  const matJaw = flatMat(0x9aa2ae, { metal: 0.75, rough: 0.3 });
  head.add(mesh(boxGeo(0.2, 0.07, 0.05), matJaw, 0, 0.045, 0.19));
  head.add(mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.05, 8), matJaw, -0.1, 0.05, 0.185));
  head.add(mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.05, 8), matJaw, 0.1, 0.05, 0.185));
  head.add(mesh(boxGeo(0.26, 0.045, 0.26), matJaw, 0, -0.005, 0)); // шейное кольцо
  head.add(mesh(boxGeo(0.05, 0.05, 0.02), matGlow, 0, 0.045, 0.215)); // красный огонёк респиратора
  // Ушки-рожки (светлые, с кристаллическими кончиками)
  const earL = mesh(coneGeo(0.085, 0.26, 4), matEar, -0.15, 0.5, 0);
  const earR = mesh(coneGeo(0.085, 0.26, 4), matEar, 0.15, 0.5, 0);
  earL.rotation.z = 0.28; earR.rotation.z = -0.28;
  head.add(earL, earR);
  head.add(mesh(coneGeo(0.035, 0.1, 4), matCrystal, -0.185, 0.63, 0));
  head.add(mesh(coneGeo(0.035, 0.1, 4), matCrystal, 0.185, 0.63, 0));
  // Чёлка
  head.add(mesh(boxGeo(0.44, 0.09, 0.4), matHair, 0, 0.36, 0.02));
  head.add(mesh(boxGeo(0.1, 0.16, 0.03), matHairLight, -0.08, 0.3, 0.2));
  head.add(mesh(boxGeo(0.1, 0.16, 0.03), matHairLight, 0.08, 0.3, 0.2));
  // Твинтейлы: две длинные пластины-конусы по бокам (платиновый блонд)
  const tailL = new THREE.Group();
  tailL.position.set(-0.26, 0.42, -0.04);
  const tlMesh = mesh(coneGeo(0.085, 0.78, 4), matHair, 0, -0.36, 0);
  tlMesh.rotation.x = Math.PI; // конусом вниз
  tailL.add(tlMesh);
  tailL.add(mesh(boxGeo(0.12, 0.07, 0.12), matCrystal, 0, 0.02, 0)); // кристалл-заколка
  const tailR = new THREE.Group();
  tailR.position.set(0.26, 0.42, -0.04);
  const trMesh = mesh(coneGeo(0.085, 0.78, 4), matHair, 0, -0.36, 0);
  trMesh.rotation.x = Math.PI;
  tailR.add(trMesh);
  tailR.add(mesh(boxGeo(0.12, 0.07, 0.12), matCrystal, 0, 0.02, 0));
  head.add(tailL, tailR);
  // Затылочная пластина волос
  const hairBack = mesh(boxGeo(0.4, 0.5, 0.08), matHair, 0, 0.05, -0.22);
  head.add(hairBack);

  // --- Механические руки (чёрный корпус, серебряные суставы) ---
  const makeArm = (side) => {
    const shoulder = new THREE.Group();
    shoulder.position.set(0.24 * side, 0.34, 0);
    torso.add(shoulder);
    shoulder.add(mesh(boxGeo(0.13, 0.13, 0.13), matSilver)); // плечо-шарнир
    shoulder.add(mesh(boxGeo(0.1, 0.26, 0.1), matSuit, 0, -0.16, 0));
    const elbow = new THREE.Group();
    elbow.position.y = -0.3;
    shoulder.add(elbow);
    elbow.add(mesh(boxGeo(0.11, 0.24, 0.11), matSuit, 0, -0.12, 0));
    elbow.add(mesh(boxGeo(0.13, 0.08, 0.13), matSilver, 0, -0.02, 0)); // кольцо-шарнир
    const hand = mesh(boxGeo(0.1, 0.1, 0.12), matSilver, 0, -0.28, 0.02);
    elbow.add(hand);
    return { shoulder, elbow, hand };
  };
  const armL = makeArm(-1);
  const armR = makeArm(1);

  // Автомат в правой руке (ствол — вперёд по +Z, на цель)
  const rifle = createRifleProp();
  rifle.position.set(0, -0.3, 0.06);
  rifle.rotation.x = Math.PI / 2 - 0.12; // ствол вперёд при опущенной руке
  armR.elbow.add(rifle);
  const rifleRef = rifle;

  // --- Механические ноги ---
  const makeLeg = (side) => {
    const hip = new THREE.Group();
    hip.position.set(0.12 * side, 0, 0);
    hips.add(hip);
    hip.add(mesh(boxGeo(0.13, 0.28, 0.13), matSuit, 0, -0.16, 0));
    const knee = new THREE.Group();
    knee.position.y = -0.32;
    hip.add(knee);
    knee.add(mesh(boxGeo(0.12, 0.26, 0.12), matSilver, 0, -0.13, 0));
    knee.add(mesh(boxGeo(0.13, 0.08, 0.22), matSuit, 0, -0.28, 0.04)); // стопа
    knee.add(mesh(boxGeo(0.14, 0.03, 0.1), matGlow, 0, -0.26, -0.05));
    return { hip, knee };
  };
  const legL = makeLeg(-1);
  const legR = makeLeg(1);

  // --- Хвост-кабель (цепочка сегментов) ---
  const tailSegs = [];
  let tailParent = torso;
  for (let i = 0; i < 5; i++) {
    const seg = new THREE.Group();
    seg.position.set(0, i === 0 ? 0.05 : 0, i === 0 ? -0.14 : -0.11);
    const s = 0.07 - i * 0.008;
    seg.add(mesh(boxGeo(s, s, 0.12), i === 4 ? matGlow : matSilver, 0, 0, -0.05));
    tailParent.add(seg);
    tailParent = seg;
    tailSegs.push(seg);
  }

  // Части для смерти-рассыпания (кэшируем мировые трансформы)
  const parts = [];
  root.traverse((o) => { if (o.isMesh) parts.push(o); });

  // ===== Процедурная анимация =====
  const state = {
    mode: 'idle', // idle|run|shoot|jump|dead
    t: 0, runPhase: 0, speedFactor: 0, shootT: 0,
  };

  function setMode(m) {
    if (state.mode === 'dead') return;
    state.mode = m;
    if (m === 'shoot') state.shootT = 0.25;
  }

  function update(dt, speed = 0) {
    state.t += dt;
    const t = state.t;
    if (state.mode === 'dead') return;

    state.speedFactor += ((speed > 0.5 ? Math.min(speed / 6, 1.4) : 0) - state.speedFactor) * Math.min(1, dt * 8);
    const sf = state.speedFactor;
    state.runPhase += dt * (6 + speed * 1.2);

    if (state.shootT > 0) state.shootT -= dt;
    const shooting = state.shootT > 0;

    // Бег: махи ног и рук
    const swing = Math.sin(state.runPhase) * (0.25 + sf * 0.65);
    const swing2 = Math.sin(state.runPhase + Math.PI) * (0.25 + sf * 0.65);
    legL.hip.rotation.x = swing;
    legR.hip.rotation.x = swing2;
    legL.knee.rotation.x = Math.max(0, -swing) * 1.2;
    legR.knee.rotation.x = Math.max(0, -swing2) * 1.2;

    if (shooting) {
      // Руки держат автомат вперёд (ствол на цель)
      armR.shoulder.rotation.x = -1.35;
      armL.shoulder.rotation.x = -1.15;
      armL.shoulder.rotation.y = 0.5;
      armR.elbow.rotation.x = -0.25;
      armL.elbow.rotation.x = -0.45;
      // Автомат горизонтально, ствол на цель (компенсация наклона руки)
      rifleRef.rotation.x = 0.35;
    } else {
      armL.shoulder.rotation.x = swing2 * 0.8;
      armR.shoulder.rotation.x = swing * 0.8;
      armL.shoulder.rotation.y = 0;
      armL.elbow.rotation.x = -0.2 - Math.max(0, swing2) * 0.4;
      armR.elbow.rotation.x = -0.2 - Math.max(0, swing) * 0.4;
      rifleRef.rotation.x = Math.PI / 2 - 0.12; // переноска стволом вниз-вперёд
    }

    // Прыжок: поджатые ноги
    if (state.mode === 'jump') {
      legL.hip.rotation.x = -0.6; legR.hip.rotation.x = -0.4;
      legL.knee.rotation.x = 1.1; legR.knee.rotation.x = 0.9;
    }

    // Idle-дыхание и покачивание
    const idle = Math.sin(t * 2.2) * 0.02 * (1 - sf);
    hips.position.y = 0.62 + Math.abs(Math.sin(state.runPhase)) * 0.06 * sf + idle;
    hips.rotation.z = Math.sin(state.runPhase) * 0.04 * sf;
    torso.rotation.x = 0.08 * sf + idle;
    head.rotation.z = Math.sin(t * 1.7) * 0.05;
    head.rotation.x = Math.sin(t * 2.3) * 0.04 - 0.05 * sf;

    // Хвост-кабель: волна
    for (let i = 0; i < tailSegs.length; i++) {
      tailSegs[i].rotation.x = Math.sin(t * 3 + i * 0.9) * (0.25 + sf * 0.2) + 0.15;
      tailSegs[i].rotation.y = Math.sin(t * 2.1 + i * 0.7) * 0.15;
    }
    // Твинтейлы: раскачивание
    tailL.rotation.z = 0.14 + Math.sin(t * 2.6) * 0.08 + sf * 0.15;
    tailR.rotation.z = -0.14 - Math.sin(t * 2.6 + 1.2) * 0.08 - sf * 0.15;
    tailL.rotation.x = Math.sin(t * 3.2) * 0.06 + sf * 0.35;
    tailR.rotation.x = Math.sin(t * 3.2 + 0.8) * 0.06 + sf * 0.35;
    hairBack.rotation.x = 0.1 + sf * 0.5 + Math.sin(t * 3.1) * 0.05;
  }

  // Смерть: рассыпание на части. Возвращает массив обломков {mesh, vel, angVel}
  function explode(scene) {
    state.mode = 'dead';
    root.updateMatrixWorld(true);
    const debris = [];
    const v = new THREE.Vector3();
    for (const p of parts) {
      const world = p.getWorldPosition(new THREE.Vector3());
      const clone = new THREE.Mesh(p.geometry, p.material);
      clone.position.copy(world);
      p.getWorldQuaternion(clone.quaternion);
      const s = p.getWorldScale(new THREE.Vector3());
      clone.scale.copy(s);
      scene.add(clone);
      v.set((Math.random() - 0.5) * 4, 2 + Math.random() * 4, (Math.random() - 0.5) * 4);
      debris.push({
        mesh: clone, vel: v.clone(),
        angVel: new THREE.Vector3(Math.random() * 8 - 4, Math.random() * 8 - 4, Math.random() * 8 - 4),
        life: 2.5,
      });
    }
    root.visible = false;
    return debris;
  }

  function reset() {
    state.mode = 'idle';
    root.visible = true;
  }

  return { root, update, setMode, explode, reset, state, parts };
}

// ============================================================
// 1б. АВТОМАТ в руках бота (компактный, чёрный)
// ============================================================
export function createRifleProp() {
  const g = new THREE.Group();
  g.name = 'rifleProp';
  const matBody = flatMat(0x14151a, { metal: 0.6, rough: 0.4 });
  const matSilver = flatMat(PALETTE.mechSilver, { metal: 0.7, rough: 0.35 });
  const matGlow = flatMat(PALETTE.crimson, { emissive: PALETTE.crimson, ei: 1.8 });
  g.add(mesh(boxGeo(0.055, 0.08, 0.4), matBody, 0, 0, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.22, 6), matSilver, 0, 0.012, 0.3)); // ствол
  g.add(mesh(boxGeo(0.04, 0.12, 0.06), matBody, 0, -0.08, 0.06)); // магазин
  g.add(mesh(boxGeo(0.045, 0.07, 0.12), matBody, 0, -0.01, -0.24)); // приклад
  g.add(mesh(boxGeo(0.02, 0.035, 0.02), matSilver, 0, 0.06, -0.02)); // мушка
  g.add(mesh(boxGeo(0.056, 0.014, 0.1), matGlow, 0, 0.005, 0.12)); // светящаяся вставка
  return g;
}

// ============================================================
// 1в. АНИМЕ-ДЕВУШКА (chibi, по референсам «Meow >:3» / HUD-мокап):
//     большая голова, AI-сгенерированное anime-лицо (декаль PNG,
//     assets/textures/face_*.png), твинтейлы, кошачьи ушки, ахоге,
//     чёрный боди + тактический жилет с подсумками, плиссированная
//     юбка, гетры + бронированные ботинки, автомат в руках.
//     3 командных варианта (цвет волос/свечения/глаз).
// API идентичен createNekoMech: { root, update, setMode, explode, reset, state }
// ============================================================
export const ANIME_GIRL_VARIANTS = [
  { // ALPHA — платиновый блонд, малиновое свечение, тёмные глаза
    hair: 0xecd9a0, hairLight: 0xf6ecc8, hairDark: 0xd8b878,
    accent: 0xff2d55, suit: 0x17181d,
    face: 'assets/textures/face_alpha.png',
  },
  { // BRAVO — серебристо-белые волосы, фиолетовое свечение/глаза
    hair: 0xdfe3ee, hairLight: 0xf4f6fc, hairDark: 0xb6bed0,
    accent: 0xa05cff, suit: 0x1b1a24,
    face: 'assets/textures/face_bravo.png',
  },
  { // CHARLIE — пепельно-голубые волосы, ледяное свечение/глаза
    hair: 0xaed4ec, hairLight: 0xd4eafa, hairDark: 0x8ab4d4,
    accent: 0x9adfff, suit: 0x151a21,
    face: 'assets/textures/face_charlie.png',
  },
];

// Скины на выбор (криповые варианты поверх командной базы).
// Применяются к девушкам ТВОЕЙ команды (боты-напарники) — выбор в меню.
export const CYBER_GIRL_SKINS = {
  ronin: { // РОНИН 浪人 — командные цвета без изменений
    name: 'РОНИН', jp: '浪人', desc: 'командные цвета',
  },
  doll: { // КУКЛА 人形 — фарфоровая бледность, чёрное свечение-швы
    name: 'КУКЛА', jp: '人形', desc: 'фарфор + чёрные швы',
    overrides: {
      hair: 0xf0ece2, hairLight: 0xfaf6ec, hairDark: 0xcfc6b4,
      accent: 0x131316, suit: 0x211f24,
    },
  },
  hollow: { // ПУСТАЯ 虚 — гуро-тень: пепел, кровавые швы, мёртвые глаза
    name: 'ПУСТАЯ', jp: '虚', desc: 'пепел + кровь',
    overrides: {
      hair: 0x3c3a44, hairLight: 0x585663, hairDark: 0x232129,
      accent: 0x8a0010, suit: 0x0e0d12,
    },
  },
};

export function createAnimeGirl({ team = 0 } = {}) {
  const v = ANIME_GIRL_VARIANTS[team % ANIME_GIRL_VARIANTS.length];
  const root = new THREE.Group();
  root.name = `animeGirl_${team}`;

  const matSkin = flatMat(PALETTE.skin, { rough: 0.9, metal: 0 });
  const matHair = flatMat(v.hair, { rough: 0.6, metal: 0.05 });
  const matHairLight = flatMat(v.hairLight, { rough: 0.55, metal: 0.05 });
  const matHairDark = flatMat(v.hairDark, { rough: 0.65, metal: 0.05 });
  const matSuit = flatMat(v.suit, { metal: 0.35, rough: 0.55 });
  const matVest = flatMat(0x101116, { metal: 0.4, rough: 0.5 });
  const matSilver = flatMat(PALETTE.mechSilver, { metal: 0.7, rough: 0.35 });
  const matDark = flatMat(0x3a3e48, { metal: 0.5, rough: 0.45 });
  const matGlow = flatMat(v.accent, { emissive: v.accent, ei: 1.8 });
  const matStocking = flatMat(0x22232b, { rough: 0.85, metal: 0.05 });
  const matEarIn = flatMat(0xffb3c1, { rough: 0.8, metal: 0 });

  // --- Таз (корень анимации) ---
  const hips = new THREE.Group();
  hips.position.y = 0.62;
  root.add(hips);

  // --- Плиссированная юбка (8 пластин вокруг талии) ---
  const skirt = new THREE.Group();
  skirt.position.y = 0.05;
  hips.add(skirt);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const plate = new THREE.Group();
    plate.rotation.y = a;
    const p = mesh(boxGeo(0.11, 0.15, 0.025), i % 2 ? matSuit : matVest, 0, -0.07, 0.185);
    p.rotation.x = 0.32;
    plate.add(p);
    // акцентная кромка пластин
    const trim = mesh(boxGeo(0.11, 0.018, 0.028), matGlow, 0, -0.135, 0.208);
    trim.rotation.x = 0.32;
    plate.add(trim);
    skirt.add(plate);
  }

  // --- Торс: боди + тактический жилет ---
  const torso = new THREE.Group();
  hips.add(torso);
  torso.add(mesh(boxGeo(0.30, 0.14, 0.20), matSuit, 0, 0.08, 0));   // талия
  torso.add(mesh(boxGeo(0.34, 0.18, 0.23), matSuit, 0, 0.25, 0));   // грудь
  torso.add(mesh(boxGeo(0.30, 0.20, 0.05), matVest, 0, 0.22, 0.115)); // жилет спереди
  // Подсумки жилета
  for (let i = -1; i <= 1; i++) {
    torso.add(mesh(boxGeo(0.07, 0.09, 0.045), matDark, i * 0.095, 0.11, 0.135));
    torso.add(mesh(boxGeo(0.07, 0.02, 0.048), matSilver, i * 0.095, 0.16, 0.135));
  }
  // Ремни жилета через плечо
  torso.add(mesh(boxGeo(0.05, 0.24, 0.245), matVest, -0.12, 0.25, 0));
  torso.add(mesh(boxGeo(0.05, 0.24, 0.245), matVest, 0.12, 0.25, 0));
  // Кристалл-ядро на груди (командный цвет)
  const core = mesh(boxGeo(0.09, 0.11, 0.04), matGlow, 0, 0.28, 0.135);
  torso.add(core);
  torso.add(mesh(boxGeo(0.26, 0.05, 0.22), matDark, 0, 0.36, 0)); // воротник
  // Ранец-модуль сзади + антенна
  torso.add(mesh(boxGeo(0.20, 0.22, 0.08), matVest, 0, 0.22, -0.15));
  torso.add(mesh(boxGeo(0.16, 0.05, 0.05), matGlow, 0, 0.30, -0.16));
  const antenna = mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.3, 5), matDark, 0.09, 0.42, -0.15);
  torso.add(antenna);
  torso.add(mesh(boxGeo(0.025, 0.05, 0.025), matGlow, 0.09, 0.58, -0.15));

  // --- Голова (большая, chibi) ---
  const head = new THREE.Group();
  head.position.y = 0.44;
  torso.add(head);
  head.add(mesh(boxGeo(0.42, 0.38, 0.38), matSkin, 0, 0.2, 0));
  // Anime-лицо: сразу canvas-версия, затем подмена на сгенерированную PNG-декаль
  const faceMat = new THREE.MeshStandardMaterial({
    map: createFaceTexture(256), roughness: 0.9, metalness: 0,
    transparent: true, alphaTest: 0.03,
  });
  _loadTexFile(v.face, true).then((tex) => {
    if (!tex) return; // offline/нет файла — остаётся canvas-лицо
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    faceMat.map = tex;
    faceMat.needsUpdate = true;
  });
  const face = mesh(new THREE.PlaneGeometry(0.42, 0.38), faceMat, 0, 0.2, 0.196);
  head.add(face);

  // Кошачьи ушки: внешний конус в цвет волос + розовая сердцевина
  const earL = new THREE.Group();
  earL.position.set(-0.15, 0.46, 0);
  earL.rotation.z = 0.38;
  earL.add(mesh(coneGeo(0.085, 0.19, 4), matHair, 0, 0.08, 0));
  earL.add(mesh(coneGeo(0.042, 0.11, 4), matEarIn, 0, 0.055, 0.028));
  const earR = new THREE.Group();
  earR.position.set(0.15, 0.46, 0);
  earR.rotation.z = -0.38;
  earR.add(mesh(coneGeo(0.085, 0.19, 4), matHair, 0, 0.08, 0));
  earR.add(mesh(coneGeo(0.045, 0.12, 4), matEarIn, 0, 0.055, 0.028));
  head.add(earL, earR);

  // Ахоге (две тонкие прядки-антенны на макушке)
  const ahoge = new THREE.Group();
  ahoge.position.set(0, 0.40, 0.02);
  ahoge.add(mesh(boxGeo(0.022, 0.15, 0.022), matHairLight, 0, 0.07, 0));
  const ahoge2 = mesh(boxGeo(0.018, 0.11, 0.018), matHairLight, 0.045, 0.16, 0);
  ahoge2.rotation.z = -0.55;
  ahoge.add(ahoge2);
  head.add(ahoge);

  // Чёлка: сплошная пластина + две косые пряди + центральная
  head.add(mesh(boxGeo(0.44, 0.10, 0.40), matHair, 0, 0.37, 0.01));
  head.add(mesh(boxGeo(0.44, 0.06, 0.06), matHairLight, 0, 0.345, 0.20));
  const bangL = mesh(boxGeo(0.10, 0.14, 0.05), matHair, -0.10, 0.35, 0.20);
  bangL.rotation.z = 0.14;
  const bangR = mesh(boxGeo(0.10, 0.14, 0.05), matHair, 0.10, 0.35, 0.20);
  bangR.rotation.z = -0.14;
  head.add(bangL, bangR);
  head.add(mesh(boxGeo(0.07, 0.10, 0.05), matHairLight, 0, 0.36, 0.205));
  // Пряди у лица
  head.add(mesh(boxGeo(0.07, 0.34, 0.09), matHair, -0.20, 0.08, 0.13));
  head.add(mesh(boxGeo(0.07, 0.34, 0.09), matHair, 0.20, 0.08, 0.13));
  // Затылочная масса волос
  const hairBack = mesh(boxGeo(0.42, 0.44, 0.10), matHairDark, 0, 0.10, -0.20);
  head.add(hairBack);

  // Твинтейлы: длинные, до колен (как у Nyave) — 4 сужающихся сегмента + лента
  const makeTail = (side) => {
    const g = new THREE.Group();
    g.position.set(0.285 * side, 0.40, -0.01);
    g.rotation.z = 0.12 * side;
    g.add(mesh(boxGeo(0.13, 0.26, 0.13), matHair, 0.03 * side, -0.12, 0));
    g.add(mesh(boxGeo(0.115, 0.24, 0.115), matHair, 0.05 * side, -0.36, 0));
    g.add(mesh(boxGeo(0.10, 0.22, 0.10), matHair, 0.06 * side, -0.58, 0));
    g.add(mesh(boxGeo(0.08, 0.22, 0.08), matHairLight, 0.07 * side, -0.79, 0));
    g.add(mesh(boxGeo(0.15, 0.06, 0.15), matGlow, 0, 0.01, 0)); // лента
    return g;
  };
  const tailL = makeTail(-1);
  const tailR = makeTail(1);
  head.add(tailL, tailR);

  // --- Руки: боди-рукава + броня плеча + наручи ---
  const makeArm = (side) => {
    const shoulder = new THREE.Group();
    shoulder.position.set(0.23 * side, 0.32, 0);
    torso.add(shoulder);
    // плечевая броня с акцентной кромкой
    shoulder.add(mesh(boxGeo(0.15, 0.10, 0.15), matSilver, 0.01 * side, 0.01, 0));
    shoulder.add(mesh(boxGeo(0.155, 0.02, 0.155), matGlow, 0.01 * side, -0.045, 0));
    shoulder.add(mesh(boxGeo(0.09, 0.22, 0.09), matSuit, 0, -0.14, 0)); // предплечье
    const elbow = new THREE.Group();
    elbow.position.y = -0.27;
    shoulder.add(elbow);
    elbow.add(mesh(boxGeo(0.10, 0.18, 0.10), matDark, 0, -0.09, 0)); // наруч
    elbow.add(mesh(boxGeo(0.105, 0.02, 0.105), matGlow, 0, -0.01, 0));
    const hand = mesh(boxGeo(0.08, 0.08, 0.10), matSkin, 0, -0.21, 0.01);
    elbow.add(hand);
    return { shoulder, elbow, hand };
  };
  const armL = makeArm(-1);
  const armR = makeArm(1);

  // Автомат в правой руке (ствол — вперёд по +Z)
  const rifle = createRifleProp();
  rifle.position.set(0, -0.24, 0.05);
  rifle.rotation.x = Math.PI / 2 - 0.12;
  armR.elbow.add(rifle);
  const rifleRef = rifle;

  // --- Ноги: гетры + бронированные ботинки ---
  const makeLeg = (side) => {
    const hip = new THREE.Group();
    hip.position.set(0.11 * side, 0, 0);
    hips.add(hip);
    hip.add(mesh(boxGeo(0.12, 0.24, 0.13), matSkin, 0, -0.14, 0)); // бедро
    const knee = new THREE.Group();
    knee.position.y = -0.30;
    hip.add(knee);
    knee.add(mesh(boxGeo(0.105, 0.24, 0.11), matStocking, 0, -0.13, 0)); // гетра
    knee.add(mesh(boxGeo(0.11, 0.02, 0.115), matGlow, 0, -0.02, 0)); // светящийся край гетры
    // ботинок: броня + напыление + акцентная полоса
    knee.add(mesh(boxGeo(0.12, 0.09, 0.21), matVest, 0, -0.295, 0.035));
    knee.add(mesh(boxGeo(0.125, 0.03, 0.22), matSilver, 0, -0.33, 0.035));
    knee.add(mesh(boxGeo(0.126, 0.012, 0.10), matGlow, 0, -0.27, -0.03));
    return { hip, knee };
  };
  const legL = makeLeg(-1);
  const legR = makeLeg(1);

  // --- Хвост-кабель (цепочка сегментов, командный наконечник) ---
  const tailSegs = [];
  let tailParent = torso;
  for (let i = 0; i < 5; i++) {
    const seg = new THREE.Group();
    seg.position.set(0, i === 0 ? 0.02 : 0, i === 0 ? -0.17 : -0.11);
    const s = 0.06 - i * 0.007;
    seg.add(mesh(boxGeo(s, s, 0.12), i === 4 ? matGlow : matSilver, 0, 0, -0.05));
    tailParent.add(seg);
    tailParent = seg;
    tailSegs.push(seg);
  }

  // Части для смерти-рассыпания
  const parts = [];
  root.traverse((o) => { if (o.isMesh) parts.push(o); });

  // ===== Процедурная анимация =====
  const state = {
    mode: 'idle', // idle|run|shoot|jump|dead
    t: Math.random() * 10, runPhase: 0, speedFactor: 0, shootT: 0,
  };

  function setMode(m) {
    if (state.mode === 'dead') return;
    state.mode = m;
    if (m === 'shoot') state.shootT = 0.25;
  }

  function update(dt, speed = 0) {
    state.t += dt;
    const t = state.t;
    if (state.mode === 'dead') return;

    state.speedFactor += ((speed > 0.5 ? Math.min(speed / 6, 1.4) : 0) - state.speedFactor) * Math.min(1, dt * 8);
    const sf = state.speedFactor;
    state.runPhase += dt * (6 + speed * 1.2);

    if (state.shootT > 0) state.shootT -= dt;
    const shooting = state.shootT > 0;

    // Бег: махи ног и рук
    const swing = Math.sin(state.runPhase) * (0.25 + sf * 0.65);
    const swing2 = Math.sin(state.runPhase + Math.PI) * (0.25 + sf * 0.65);
    legL.hip.rotation.x = swing;
    legR.hip.rotation.x = swing2;
    legL.knee.rotation.x = Math.max(0, -swing) * 1.2;
    legR.knee.rotation.x = Math.max(0, -swing2) * 1.2;

    if (shooting) {
      // Руки держат автомат вперёд (ствол на цель)
      armR.shoulder.rotation.x = -1.35;
      armL.shoulder.rotation.x = -1.15;
      armL.shoulder.rotation.y = 0.5;
      armR.elbow.rotation.x = -0.25;
      armL.elbow.rotation.x = -0.45;
      rifleRef.rotation.x = 0.35;
    } else {
      armL.shoulder.rotation.x = swing2 * 0.8;
      armR.shoulder.rotation.x = swing * 0.8;
      armL.shoulder.rotation.y = 0;
      armL.elbow.rotation.x = -0.2 - Math.max(0, swing2) * 0.4;
      armR.elbow.rotation.x = -0.2 - Math.max(0, swing) * 0.4;
      rifleRef.rotation.x = Math.PI / 2 - 0.12;
    }

    // Прыжок: поджатые ноги
    if (state.mode === 'jump') {
      legL.hip.rotation.x = -0.6; legR.hip.rotation.x = -0.4;
      legL.knee.rotation.x = 1.1; legR.knee.rotation.x = 0.9;
    }

    // Idle-дыхание и покачивание
    const idle = Math.sin(t * 2.2) * 0.02 * (1 - sf);
    hips.position.y = 0.62 + Math.abs(Math.sin(state.runPhase)) * 0.06 * sf + idle;
    hips.rotation.z = Math.sin(state.runPhase) * 0.04 * sf;
    torso.rotation.x = 0.08 * sf + idle;
    head.rotation.z = Math.sin(t * 1.7) * 0.05;
    head.rotation.x = Math.sin(t * 2.3) * 0.04 - 0.05 * sf;

    // Юбка: лёгкое развевание на бегу
    skirt.rotation.y = Math.sin(t * 2.0) * 0.03;
    for (let i = 0; i < skirt.children.length; i++) {
      const plate = skirt.children[i];
      plate.rotation.x = Math.sin(state.runPhase + i) * 0.10 * sf;
    }

    // Ушки: подёргивание
    earL.rotation.x = Math.sin(t * 3.1) * 0.06 - sf * 0.12;
    earR.rotation.x = Math.sin(t * 3.4 + 0.7) * 0.06 - sf * 0.12;
    // Ахоге: покачивание
    ahoge.rotation.z = Math.sin(t * 2.8) * 0.14 + sf * 0.2;
    ahoge.rotation.x = Math.sin(t * 3.3) * 0.10 + sf * 0.3;

    // Хвост-кабель: волна
    for (let i = 0; i < tailSegs.length; i++) {
      tailSegs[i].rotation.x = Math.sin(t * 3 + i * 0.9) * (0.25 + sf * 0.2) + 0.15;
      tailSegs[i].rotation.y = Math.sin(t * 2.1 + i * 0.7) * 0.15;
    }
    // Твинтейлы: раскачивание
    tailL.rotation.z = 0.10 + Math.sin(t * 2.6) * 0.08 + sf * 0.15;
    tailR.rotation.z = -0.10 - Math.sin(t * 2.6 + 1.2) * 0.08 - sf * 0.15;
    tailL.rotation.x = Math.sin(t * 3.2) * 0.06 + sf * 0.35;
    tailR.rotation.x = Math.sin(t * 3.2 + 0.8) * 0.06 + sf * 0.35;
    hairBack.rotation.x = 0.1 + sf * 0.5 + Math.sin(t * 3.1) * 0.05;
  }

  // Смерть: рассыпание на части. Возвращает массив обломков {mesh, vel, angVel}
  function explode(scene) {
    state.mode = 'dead';
    root.updateMatrixWorld(true);
    const debris = [];
    const v3 = new THREE.Vector3();
    for (const p of parts) {
      const world = p.getWorldPosition(new THREE.Vector3());
      const clone = new THREE.Mesh(p.geometry, p.material);
      clone.position.copy(world);
      p.getWorldQuaternion(clone.quaternion);
      const s = p.getWorldScale(new THREE.Vector3());
      clone.scale.copy(s);
      scene.add(clone);
      v3.set((Math.random() - 0.5) * 4, 2 + Math.random() * 4, (Math.random() - 0.5) * 4);
      debris.push({
        mesh: clone, vel: v3.clone(),
        angVel: new THREE.Vector3(Math.random() * 8 - 4, Math.random() * 8 - 4, Math.random() * 8 - 4),
        life: 2.5,
      });
    }
    root.visible = false;
    return debris;
  }

  function reset() {
    state.mode = 'idle';
    root.visible = true;
  }

  return { root, update, setMode, explode, reset, state, parts };
}

// ============================================================
// 1г. КИБЕР-ХОРРОР АНИМЕ-ДЕВУШКА (взрослые пропорции ~1.72м):
//     стройное тело, глянцевый чёрный боди со светящимися швами,
//     механический позвоночник, лезвия-наручи, шипастая броня,
//     рваная юбка, высокие бронеботинки, трещины-свечения на коже.
//     Лицо — та же AI anime-декаль (команды = ANIME_GIRL_VARIANTS).
// API идентичен createAnimeGirl/createNekoMech.
// ============================================================
export const CYBER_GIRL_DIMS = { height: 1.74, headY: 1.58, bodyTop: 1.32 };

export function createCyberGirl({ team = 0, skin = null } = {}) {
  const base = ANIME_GIRL_VARIANTS[team % ANIME_GIRL_VARIANTS.length];
  const sk = skin ? CYBER_GIRL_SKINS[skin] : null;
  const v = sk?.overrides ? { ...base, ...sk.overrides } : base;
  const root = new THREE.Group();
  root.name = `cyberGirl_${team}${sk ? '_' + skin : ''}`;

  // Cel-shaded материалы (toon + чёрный контур — аниме-look)
  const matSkin = toonMat(PALETTE.skin);
  const matHair = toonMat(v.hair);
  const matHairLight = toonMat(v.hairLight);
  const matHairDark = toonMat(v.hairDark);
  const matSuit = toonMat(v.suit);
  const matArmor = toonMat(0x14151c);
  const matDark = toonMat(0x23262f);
  const matSilver = flatMat(PALETTE.mechSilver, { metal: 0.8, rough: 0.28 });
  // matGlow — per-instance (noCache): эмоции (ярость) красят акценты только ЭТОГО бота
  const matGlow = flatMat(v.accent, { emissive: v.accent, ei: 2.0, noCache: true });
  const matGlowSoft = flatMat(v.accent, { emissive: v.accent, ei: 0.9 });
  const matEarIn = toonMat(0xffb3c1);

  // --- Таз (корень анимации) ---
  const hips = new THREE.Group();
  hips.position.y = 0.95;
  root.add(hips);
  // плавные бёдра
  const pelvis = mesh(sphGeo(0.155, 14, 12), matSuit, 0, -0.02, 0);
  pelvis.scale.set(1.08, 0.78, 0.90);
  addOutline(pelvis, 1.10);
  hips.add(pelvis);
  // свет-швы боди на бёдрах
  hips.add(mesh(boxGeo(0.016, 0.09, 0.016), matGlowSoft, -0.125, -0.02, 0.095));
  hips.add(mesh(boxGeo(0.016, 0.09, 0.016), matGlowSoft, 0.125, -0.02, 0.095));

  // --- Рваная юбка: 7 сужающихся пластин ---
  const skirt = new THREE.Group();
  skirt.position.y = 0.10;
  hips.add(skirt);
  const skirtLens = [0.26, 0.34, 0.22, 0.30, 0.24, 0.32, 0.20];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + 0.2;
    const plate = new THREE.Group();
    plate.rotation.y = a;
    const len = skirtLens[i];
    const p = new THREE.Mesh(cylGeo(0.038, 0.075, len, 4), i % 2 ? matSuit : matArmor);
    p.scale.z = 0.26;
    p.rotation.y = Math.PI / 4;
    p.position.set(0, -len / 2 - 0.02, 0.132);
    p.rotation.x = 0.22 + (i % 3) * 0.05;
    plate.add(p);
    // рваный светящийся край
    const trim = mesh(boxGeo(0.09, 0.014, 0.022), matGlow, 0, -len - 0.03, 0.132 + len * 0.22);
    trim.rotation.x = p.rotation.x;
    plate.add(trim);
    skirt.add(plate);
  }

  // --- Торс: гладкий женский силуэт (Lathe) + механический позвоночник ---
  const torso = new THREE.Group();
  hips.add(torso);
  const torsoProfile = [
    new THREE.Vector2(0.001, -0.02),
    new THREE.Vector2(0.135, 0.00),
    new THREE.Vector2(0.150, 0.06),
    new THREE.Vector2(0.116, 0.14),   // талия
    new THREE.Vector2(0.145, 0.22),
    new THREE.Vector2(0.165, 0.30),   // грудь
    new THREE.Vector2(0.148, 0.36),
    new THREE.Vector2(0.104, 0.42),   // ключица
    new THREE.Vector2(0.048, 0.455),  // шея
    new THREE.Vector2(0.001, 0.465),
  ];
  const torsoMesh = new THREE.Mesh(new THREE.LatheGeometry(torsoProfile, 14), matSuit);
  torsoMesh.scale.z = 0.78;
  addOutline(torsoMesh, 1.09);
  torso.add(torsoMesh);
  // грудь — мягкие формы поверх боди
  const bustL = mesh(sphGeo(0.080, 12, 10), matSuit, -0.070, 0.295, 0.090);
  const bustR = mesh(sphGeo(0.080, 12, 10), matSuit, 0.070, 0.295, 0.090);
  bustL.scale.set(1, 0.92, 0.85); bustR.scale.set(1, 0.92, 0.85);
  torso.add(bustL, bustR);
  // бандаж под грудью (торус)
  const band = mesh(new THREE.TorusGeometry(0.146, 0.015, 6, 18), matArmor, 0, 0.175, 0);
  band.rotation.x = Math.PI / 2;
  band.scale.y = 0.78;
  torso.add(band);
  // светящиеся швы боди (бока)
  torso.add(mesh(capGeo(0.006, 0.22, 6), matGlowSoft, -0.126, 0.22, 0.052));
  torso.add(mesh(capGeo(0.006, 0.22, 6), matGlowSoft, 0.126, 0.22, 0.052));
  // кристалл-ядро (командный)
  const core = mesh(boxGeo(0.06, 0.09, 0.028), matGlow, 0, 0.30, 0.132);
  core.rotation.z = Math.PI / 4;
  torso.add(core);
  // воротник-раструб + световое кольцо
  const collar = mesh(cylGeo(0.092, 0.122, 0.07, 12), matArmor, 0, 0.425, 0);
  collar.scale.z = 0.85;
  torso.add(collar);
  const collarRing = mesh(new THREE.TorusGeometry(0.100, 0.007, 6, 16), matGlow, 0, 0.460, 0);
  collarRing.rotation.x = Math.PI / 2;
  collarRing.scale.y = 0.85;
  torso.add(collarRing);
  // механический позвоночник (сегменты по спине)
  for (let i = 0; i < 5; i++) {
    torso.add(mesh(boxGeo(0.06, 0.04, 0.028), matSilver, 0, 0.08 + i * 0.085, -0.100 - (i % 2) * 0.005));
    if (i < 4) torso.add(mesh(boxGeo(0.018, 0.045, 0.018), matGlowSoft, 0, 0.12 + i * 0.085, -0.110));
  }
  // ранцевый блок + антенны-«рога»
  torso.add(mesh(boxGeo(0.16, 0.18, 0.06), matArmor, 0, 0.26, -0.130));
  const hornL = mesh(new THREE.CylinderGeometry(0.006, 0.010, 0.34, 5), matDark, -0.08, 0.46, -0.12);
  hornL.rotation.z = 0.35;
  const hornR = mesh(new THREE.CylinderGeometry(0.006, 0.010, 0.34, 5), matDark, 0.08, 0.46, -0.12);
  hornR.rotation.z = -0.35;
  torso.add(hornL, hornR);
  torso.add(mesh(boxGeo(0.02, 0.045, 0.02), matGlow, -0.135, 0.58, -0.12));
  torso.add(mesh(boxGeo(0.02, 0.045, 0.02), matGlow, 0.135, 0.58, -0.12));

  // --- Голова (аниме: сфера + подбородок, лицо-текстура) ---
  const head = new THREE.Group();
  head.position.y = 0.48;
  torso.add(head);
  const skull = mesh(sphGeo(0.152, 16, 14), matSkin, 0, 0.145, 0.005);
  skull.scale.set(0.92, 1.04, 0.96);
  addOutline(skull, 1.08);
  head.add(skull);
  const chin = mesh(sphGeo(0.082, 10, 8), matSkin, 0, 0.038, 0.035);
  chin.scale.set(0.78, 0.60, 0.78);
  head.add(chin);
  // AI anime-лицо
  const faceMat = new THREE.MeshStandardMaterial({
    map: createFaceTexture(256), roughness: 0.9, metalness: 0,
    transparent: true, alphaTest: 0.03,
  });
  _loadTexFile(v.face, true).then((tex) => {
    if (!tex) return;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    faceMat.map = tex;
    faceMat.needsUpdate = true;
  });
  head.add(mesh(new THREE.PlaneGeometry(0.25, 0.235), faceMat, 0, 0.132, 0.152));

  // Кошачьи ушки (мех-пластины с сердцевиной)
  const earL = new THREE.Group();
  earL.position.set(-0.11, 0.32, 0);
  earL.rotation.z = 0.36;
  earL.add(mesh(coneGeo(0.060, 0.15, 6), matHair, 0, 0.07, 0));
  earL.add(mesh(coneGeo(0.030, 0.08, 6), matEarIn, 0, 0.05, 0.018));
  const earR = new THREE.Group();
  earR.position.set(0.11, 0.32, 0);
  earR.rotation.z = -0.36;
  earR.add(mesh(coneGeo(0.060, 0.15, 6), matHair, 0, 0.07, 0));
  earR.add(mesh(coneGeo(0.030, 0.08, 6), matEarIn, 0, 0.05, 0.018));
  head.add(earL, earR);

  // Ахоге — изогнутая прядь
  const ahoge = new THREE.Group();
  ahoge.position.set(0, 0.295, 0.02);
  const ah1 = mesh(capGeo(0.008, 0.10, 5), matHairLight, 0, 0.05, 0);
  ah1.rotation.z = 0.25;
  const ah2 = mesh(capGeo(0.007, 0.08, 5), matHairLight, 0.032, 0.125, 0);
  ah2.rotation.z = 0.80;
  ahoge.add(ah1, ah2);
  head.add(ahoge);

  // Волосы: скальп, чёлка-пряди, пряди у лица, затылочная масса, твинтейлы
  const scalp = mesh(sphGeo(0.163, 14, 12), matHair, 0, 0.168, -0.028);
  scalp.scale.set(0.95, 1.0, 0.98);
  addOutline(scalp, 1.06);
  head.add(scalp);
  // чёлка — сплюснутые конусы остриём вниз
  const mkBang = (x, z, len, rz, m) => {
    const b = mesh(coneGeo(0.034, len, 6), m, x, 0.250, z);
    b.rotation.x = Math.PI;
    b.rotation.z = rz;
    b.scale.z = 0.42;
    head.add(b);
  };
  mkBang(-0.072, 0.122, 0.17, 0.10, matHair);
  mkBang(0, 0.132, 0.19, 0, matHairLight);
  mkBang(0.072, 0.122, 0.17, -0.10, matHair);
  // длинные пряди у лица (до груди)
  const strandL = mesh(capGeo(0.030, 0.32, 8), matHair, -0.142, -0.03, 0.090);
  const strandR = mesh(capGeo(0.030, 0.32, 8), matHair, 0.142, -0.03, 0.090);
  strandL.rotation.z = 0.06; strandR.rotation.z = -0.06;
  head.add(strandL, strandR);
  // затылочная масса (до лопаток)
  const hairBack = mesh(capGeo(0.075, 0.34, 10), matHairDark, 0, -0.05, -0.135);
  hairBack.scale.set(1.35, 1, 0.5);
  addOutline(hairBack, 1.07);
  head.add(hairBack);

  // Твинтейлы до колен: 5 сегментов-капсул + лента + коготь
  const makeTail = (side) => {
    const g = new THREE.Group();
    g.position.set(0.19 * side, 0.30, -0.03);
    g.rotation.z = 0.12 * side;
    const segs = [
      [0.050, 0.18, matHair, -0.10],
      [0.045, 0.17, matHair, -0.28],
      [0.040, 0.16, matHair, -0.44],
      [0.034, 0.16, matHairLight, -0.60],
      [0.027, 0.15, matHairLight, -0.75],
    ];
    for (let i = 0; i < segs.length; i++) {
      const [r, l, m, y] = segs[i];
      const s = mesh(capGeo(r, l, 8), m, (0.02 + i * 0.008) * side, y, 0);
      s.rotation.z = 0.05 * side;
      g.add(s);
    }
    const bandT = mesh(new THREE.TorusGeometry(0.055, 0.013, 6, 12), matGlow, 0, 0.02, 0);
    bandT.rotation.x = Math.PI / 2;
    g.add(bandT);
    const tip = mesh(coneGeo(0.028, 0.11, 6), matSilver, (0.02 + 4 * 0.008) * side, -0.86, 0);
    tip.rotation.x = Math.PI;
    g.add(tip);
    return g;
  };
  const tailL = makeTail(-1);
  const tailR = makeTail(1);
  head.add(tailL, tailR);

  // --- Руки: капсулы боди + шипастый наплечник + лезвия-наручи ---
  const makeArm = (side) => {
    const shoulder = new THREE.Group();
    shoulder.position.set(0.19 * side, 0.40, 0);
    torso.add(shoulder);
    // наплечник-полусфера + 3 шипа
    const pad = mesh(sphGeo(0.082, 10, 8), matArmor, 0.012 * side, 0.03, 0);
    pad.scale.set(1.05, 0.72, 1.05);
    shoulder.add(pad);
    for (let i = 0; i < 3; i++) {
      const spike = mesh(coneGeo(0.017, 0.085, 5), matSilver, (0.025 + i * 0.033) * side, 0.070, -0.03 + i * 0.03);
      spike.rotation.z = -0.30 * side;
      shoulder.add(spike);
    }
    const padRing = mesh(new THREE.TorusGeometry(0.072, 0.007, 6, 14), matGlow, 0.012 * side, -0.022, 0);
    padRing.rotation.x = Math.PI / 2;
    shoulder.add(padRing);
    // плечо — капсула боди
    const upper = mesh(capGeo(0.046, 0.20, 8), matSuit, 0, -0.15, 0);
    addOutline(upper, 1.11);
    shoulder.add(upper);
    const elbow = new THREE.Group();
    elbow.position.y = -0.31;
    shoulder.add(elbow);
    // предплечье-наруч
    const fore = mesh(capGeo(0.038, 0.18, 8), matDark, 0, -0.12, 0);
    addOutline(fore, 1.11);
    elbow.add(fore);
    const ringE = mesh(new THREE.TorusGeometry(0.045, 0.006, 6, 12), matGlow, 0, -0.03, 0);
    ringE.rotation.x = Math.PI / 2;
    elbow.add(ringE);
    // лезвия-наручи (клинок вдоль предплечья)
    const blade1 = mesh(boxGeo(0.012, 0.28, 0.040), matSilver, 0.048 * side, -0.16, -0.03);
    blade1.rotation.x = 0.06;
    elbow.add(blade1);
    elbow.add(mesh(boxGeo(0.016, 0.08, 0.016), matGlow, 0.048 * side, -0.33, -0.03));
    // кисть-перчатка
    const hand = mesh(sphGeo(0.048, 10, 8), matDark, 0, -0.265, 0.01);
    hand.scale.set(0.9, 1.15, 1.0);
    elbow.add(hand);
    return { shoulder, elbow, hand };
  };
  const armL = makeArm(-1);
  const armR = makeArm(1);

  // Автомат в правой руке
  const rifle = createRifleProp();
  rifle.position.set(0, -0.30, 0.05);
  rifle.rotation.x = Math.PI / 2 - 0.12;
  armR.elbow.add(rifle);
  const rifleRef = rifle;

  // --- Ноги: капсулы (бедро-кожа, голень-гетра) + бронеботинки ---
  const makeLeg = (side) => {
    const hip = new THREE.Group();
    hip.position.set(0.10 * side, 0, 0);
    hips.add(hip);
    // бедро
    const thigh = mesh(capGeo(0.070, 0.30, 10), matSkin, 0, -0.22, 0);
    thigh.scale.set(1, 1, 0.92);
    addOutline(thigh, 1.10);
    hip.add(thigh);
    // светящаяся «трещина» на бедре (хоррор-свечение)
    const crack = mesh(boxGeo(0.010, 0.14, 0.008), matGlow, 0.046 * side, -0.20, 0.058);
    crack.rotation.z = 0.18 * side;
    hip.add(crack);
    // ремешок на бедре (лев. нога)
    if (side < 0) {
      const strap = mesh(new THREE.TorusGeometry(0.072, 0.009, 6, 14), matArmor, 0, -0.13, 0);
      strap.rotation.x = Math.PI / 2;
      hip.add(strap);
    }
    const knee = new THREE.Group();
    knee.position.y = -0.47;
    hip.add(knee);
    // коленный сустав (закрывает разрыв бедро/голень)
    const kneeBall = mesh(sphGeo(0.056, 10, 8), matSuit, 0, 0, 0);
    kneeBall.scale.set(1, 1, 0.9);
    knee.add(kneeBall);
    // голень-гетра
    const shin = mesh(capGeo(0.053, 0.26, 10), matSuit, 0, -0.18, 0);
    shin.scale.set(1, 1, 0.90);
    addOutline(shin, 1.10);
    knee.add(shin);
    const kneeRing = mesh(new THREE.TorusGeometry(0.056, 0.007, 6, 12), matGlow, 0, -0.03, 0);
    kneeRing.rotation.x = Math.PI / 2;
    knee.add(kneeRing);
    // бронеботинок
    const boot = mesh(cylGeo(0.058, 0.072, 0.20, 10), matArmor, 0, -0.35, 0);
    addOutline(boot, 1.10);
    knee.add(boot);
    const bootRing = mesh(new THREE.TorusGeometry(0.062, 0.008, 6, 12), matSilver, 0, -0.26, 0);
    bootRing.rotation.x = Math.PI / 2;
    knee.add(bootRing);
    const toe = mesh(sphGeo(0.058, 10, 8), matArmor, 0, -0.435, 0.050);
    toe.scale.set(1.0, 0.55, 1.7);
    knee.add(toe);
    knee.add(mesh(boxGeo(0.095, 0.016, 0.19), matSilver, 0, -0.462, 0.045)); // подошва
    knee.add(mesh(boxGeo(0.080, 0.009, 0.018), matGlow, 0, -0.415, -0.058));
    return { hip, knee };
  };
  const legL = makeLeg(-1);
  const legR = makeLeg(1);

  // --- Хвост-кабель (7 сегментов-сфер) ---
  const tailSegs = [];
  let tailParent = torso;
  for (let i = 0; i < 7; i++) {
    const seg = new THREE.Group();
    seg.position.set(0, 0, i === 0 ? -0.10 : -0.105);
    const r = 0.028 - i * 0.003;
    const ball = mesh(sphGeo(r, 8, 6), i === 6 ? matGlow : matSilver, 0, 0, -0.045);
    ball.scale.z = 1.7;
    seg.add(ball);
    tailParent.add(seg);
    tailParent = seg;
    tailSegs.push(seg);
  }

  // Части для смерти-рассыпания (без контурных оболочек)
  const parts = [];
  root.traverse((o) => { if (o.isMesh && !o.userData.isOutline) parts.push(o); });

  // ===== Процедурная анимация (взрослая, уверенная) =====
  const state = {
    mode: 'idle', t: Math.random() * 10, runPhase: 0, speedFactor: 0, shootT: 0,
    // Боевая мимика/движение (управляется из bots.js):
    lean: 0, leanTarget: 0,        // наклон корпуса при стрейфе (-1..1)
    dodgeT: 0, dodgeDir: 1,        // уворот-рывок (сек, сторона)
    reloadT: 0,                    // перезарядка (~1.5с)
    aggro: 0, aggroTarget: 0,      // ярость: акценты/лицо краснеют (0..1)
    flinchT: 0,                    // флинч от попадания (Point Blank): дёрг корпуса
    crouch: 0, crouchTarget: 0,    // присед при стрельбе (0..1)
  };
  const baseAccent = new THREE.Color(v.accent);
  const rageColor = new THREE.Color(0xff1826);
  const faceBase = new THREE.Color(0xffffff);
  const faceRage = new THREE.Color(0xff7a66);

  function setMode(m) {
    if (state.mode === 'dead') return;
    state.mode = m;
    if (m === 'shoot') state.shootT = 0.25;
    if (m === 'dodge') state.dodgeT = 0.45;
    if (m === 'reload') state.reloadT = 1.5;
  }

  function update(dt, speed = 0) {
    state.t += dt;
    const t = state.t;
    if (state.mode === 'dead') return;

    state.speedFactor += ((speed > 0.5 ? Math.min(speed / 6, 1.4) : 0) - state.speedFactor) * Math.min(1, dt * 8);
    const sf = state.speedFactor;
    state.runPhase += dt * (6.0 + speed * 1.3);

    if (state.shootT > 0) state.shootT -= dt;
    const shooting = state.shootT > 0;

    const swing = Math.sin(state.runPhase) * (0.30 + sf * 0.55);
    const swing2 = Math.sin(state.runPhase + Math.PI) * (0.30 + sf * 0.55);
    legL.hip.rotation.x = swing;
    legR.hip.rotation.x = swing2;
    legL.knee.rotation.x = Math.max(0, -swing) * 1.25;
    legR.knee.rotation.x = Math.max(0, -swing2) * 1.25;

    if (shooting) {
      armR.shoulder.rotation.x = -1.35;
      armL.shoulder.rotation.x = -1.15;
      armL.shoulder.rotation.y = 0.55;
      armR.elbow.rotation.x = -0.25;
      armL.elbow.rotation.x = -0.45;
      rifleRef.rotation.x = 0.35;
    } else {
      armL.shoulder.rotation.x = swing2 * 0.7;
      armR.shoulder.rotation.x = swing * 0.7;
      armL.shoulder.rotation.y = 0;
      armL.elbow.rotation.x = -0.25 - Math.max(0, swing2) * 0.35;
      armR.elbow.rotation.x = -0.25 - Math.max(0, swing) * 0.35;
      rifleRef.rotation.x = Math.PI / 2 - 0.12;
    }

    if (state.mode === 'jump') {
      legL.hip.rotation.x = -0.7; legR.hip.rotation.x = -0.5;
      legL.knee.rotation.x = 1.15; legR.knee.rotation.x = 0.95;
    }

    // Idle: дыхание + уверенное покачивание бёдер при ходьбе
    const idle = Math.sin(t * 2.0) * 0.016 * (1 - sf);
    hips.position.y = 0.95 + Math.abs(Math.sin(state.runPhase)) * 0.032 * sf + idle;
    hips.rotation.z = Math.sin(state.runPhase) * 0.055 * sf;
    hips.rotation.y = Math.sin(state.runPhase) * 0.045 * sf;
    torso.rotation.x = 0.10 * sf + idle;
    // дыхание груди
    const br = 1 + Math.sin(t * 2.0) * 0.022 * (1 - sf);
    bustL.scale.set(br, 0.92 * br, 0.85 * br);
    bustR.scale.set(br, 0.92 * br, 0.85 * br);
    head.rotation.z = Math.sin(t * 1.6) * 0.030;
    head.rotation.x = Math.sin(t * 2.2) * 0.025 - 0.04 * sf;

    // Рваная юбка
    skirt.rotation.y = Math.sin(t * 1.8) * 0.03;
    for (let i = 0; i < skirt.children.length; i++) {
      skirt.children[i].rotation.x = Math.sin(state.runPhase * 0.9 + i * 1.3) * 0.12 * sf;
    }

    // Ушки/ахоге (сдержанно)
    earL.rotation.x = Math.sin(t * 3.0) * 0.05 - sf * 0.10;
    earR.rotation.x = Math.sin(t * 3.3 + 0.7) * 0.05 - sf * 0.10;
    ahoge.rotation.z = Math.sin(t * 2.7) * 0.08 + sf * 0.12;
    ahoge.rotation.x = Math.sin(t * 3.2) * 0.05 + sf * 0.18;

    // Хвост-кабель: волна
    for (let i = 0; i < tailSegs.length; i++) {
      tailSegs[i].rotation.x = Math.sin(t * 2.8 + i * 0.8) * (0.22 + sf * 0.2) + 0.14;
      tailSegs[i].rotation.y = Math.sin(t * 2.0 + i * 0.65) * 0.14;
    }
    // Твинтейлы
    tailL.rotation.z = 0.12 + Math.sin(t * 2.5) * 0.06 + sf * 0.12;
    tailR.rotation.z = -0.12 - Math.sin(t * 2.5 + 1.2) * 0.06 - sf * 0.12;
    tailL.rotation.x = Math.sin(t * 3.0) * 0.04 + sf * 0.28;
    tailR.rotation.x = Math.sin(t * 3.0 + 0.8) * 0.04 + sf * 0.28;
    hairBack.rotation.x = 0.08 + sf * 0.45 + Math.sin(t * 2.9) * 0.04;

    // ===== БОЕВОЙ СЛОЙ: ярость / наклон / уворот / перезарядка =====
    // Ярость (эмоция): акценты боди и лицо наливаются красным
    state.aggro += (state.aggroTarget - state.aggro) * Math.min(1, dt * 3);
    if (state.aggro > 0.01) {
      matGlow.emissive.copy(baseAccent).lerp(rageColor, state.aggro);
      matGlow.emissiveIntensity = 2.0 + state.aggro * 1.8;
      faceMat.color.lerpColors(faceBase, faceRage, state.aggro * 0.6);
    } else if (state.aggroTarget === 0 && matGlow.emissiveIntensity !== 2.0) {
      matGlow.emissive.copy(baseAccent);
      matGlow.emissiveIntensity = 2.0;
      faceMat.color.set(0xffffff);
    }

    // Наклон корпуса при стрейфе (leanTarget задаёт бот каждый кадр)
    state.lean += (state.leanTarget - state.lean) * Math.min(1, dt * 10);
    hips.rotation.z += state.lean * 0.22;
    torso.rotation.z = -state.lean * 0.12;

    // Уворот: резкий боковой присед + жёсткий наклон, ноги поджаты
    if (state.dodgeT > 0) {
      state.dodgeT -= dt;
      const dk = Math.max(0, state.dodgeT / 0.45);
      hips.position.y -= 0.17 * dk;
      hips.rotation.z += state.dodgeDir * 0.52 * dk;
      torso.rotation.x += 0.22 * dk;
      legL.hip.rotation.x = legL.hip.rotation.x * (1 - dk) + (-0.9) * dk;
      legR.hip.rotation.x = legR.hip.rotation.x * (1 - dk) + (0.5) * dk;
      legL.knee.rotation.x = Math.max(legL.knee.rotation.x, 1.3 * dk);
      legR.knee.rotation.x = Math.max(legR.knee.rotation.x, 0.9 * dk);
      head.rotation.z += state.dodgeDir * -0.3 * dk;
    }

    // Перезарядка: руки опускают автомат, ствол вверх, взгляд на магазин
    if (state.reloadT > 0) {
      state.reloadT -= dt;
      const rk = Math.min(1, Math.min((1.5 - state.reloadT) * 5, state.reloadT * 5 + 0.001));
      armR.shoulder.rotation.x = armR.shoulder.rotation.x * (1 - rk) + (-0.42) * rk;
      armL.shoulder.rotation.x = armL.shoulder.rotation.x * (1 - rk) + (-0.30) * rk;
      armL.shoulder.rotation.y = armL.shoulder.rotation.y * (1 - rk) + 0.75 * rk;
      armR.elbow.rotation.x = armR.elbow.rotation.x * (1 - rk) + (-0.85) * rk;
      armL.elbow.rotation.x = armL.elbow.rotation.x * (1 - rk) + (-1.05) * rk;
      rifleRef.rotation.x = rifleRef.rotation.x * (1 - rk) + 1.25 * rk;
      rifleRef.rotation.z = rk * 0.35;
      head.rotation.x += 0.38 * rk; // смотрит на автомат
      head.rotation.z += Math.sin(state.t * 14) * 0.02 * rk; // возня с магазином
    } else {
      rifleRef.rotation.z = 0;
    }

    // Флинч от попадания (Point Blank): резкий дёрг корпуса назад + голова
    if (state.flinchT > 0) {
      state.flinchT -= dt;
      const fk = Math.min(1, Math.max(0, state.flinchT / 0.22));
      const jolt = Math.sin(fk * Math.PI) * fk;
      torso.rotation.x -= jolt * 0.38;
      hips.rotation.x = -jolt * 0.14;
      head.rotation.x -= jolt * 0.5;
      head.rotation.z += jolt * (state.flinchT * 37 % 2 > 1 ? 0.3 : -0.3);
      hips.position.y -= jolt * 0.05;
    }

    // Присед при стрельбе (crouchTarget из bots.js): опускание + поджатые ноги
    state.crouch += (state.crouchTarget - state.crouch) * Math.min(1, dt * 8);
    if (state.crouch > 0.01) {
      const ck = state.crouch;
      hips.position.y -= 0.24 * ck;
      torso.rotation.x += 0.16 * ck;
      legL.hip.rotation.x = legL.hip.rotation.x * (1 - ck) + (-1.15) * ck;
      legR.hip.rotation.x = legR.hip.rotation.x * (1 - ck) + (-0.55) * ck;
      legL.knee.rotation.x = Math.max(legL.knee.rotation.x, 1.6 * ck);
      legR.knee.rotation.x = Math.max(legR.knee.rotation.x, 1.2 * ck);
      head.rotation.x -= 0.10 * ck;
    }
  }

  // Смерть: рассыпание на части
  function explode(scene) {
    state.mode = 'dead';
    root.updateMatrixWorld(true);
    const debris = [];
    const v3 = new THREE.Vector3();
    for (const p of parts) {
      const world = p.getWorldPosition(new THREE.Vector3());
      const clone = new THREE.Mesh(p.geometry, p.material);
      clone.position.copy(world);
      p.getWorldQuaternion(clone.quaternion);
      const s = p.getWorldScale(new THREE.Vector3());
      clone.scale.copy(s);
      scene.add(clone);
      v3.set((Math.random() - 0.5) * 4, 2 + Math.random() * 4, (Math.random() - 0.5) * 4);
      debris.push({
        mesh: clone, vel: v3.clone(),
        angVel: new THREE.Vector3(Math.random() * 8 - 4, Math.random() * 8 - 4, Math.random() * 8 - 4),
        life: 2.5,
      });
    }
    root.visible = false;
    return debris;
  }

  function reset() {
    state.mode = 'idle';
    root.visible = true;
  }

  return { root, update, setMode, explode, reset, state, parts };
}

// ============================================================
// 2. ОРУЖИЕ (вид от первого лица) — резной корпус, рукав с ремнями
// ============================================================
export function createViewmodel(kind = 'rifle') {
  const group = new THREE.Group();
  group.name = `viewmodel_${kind}`;
  // Резной корпус: canvas-орнамент как map+bump
  const engrTex = createEngravingTexture();
  const matBody = new THREE.MeshStandardMaterial({
    color: 0x8a92a2, flatShading: true, metalness: 0.3, roughness: 0.45,
    map: engrTex, bumpMap: engrTex, bumpScale: 0.6,
  });
  const matDark = flatMat(0x3a3e48, { metal: 0.3, rough: 0.5 });
  const matWood = flatMat(0x5a4632, { rough: 0.9, metal: 0 });
  const matGlow = flatMat(PALETTE.crimson, { emissive: PALETTE.crimson, ei: 2 });
  const matGrip = flatMat(PALETTE.coal, { rough: 0.95 });

  // Руки (механические) + рукав с ремнями (как на референсе)
  const matArm = flatMat(0x8a94a4, { metal: 0.4, rough: 0.5 });
  const matSleeve = flatMat(0x3a3f4a, { rough: 0.85, metal: 0.1 });
  const matStrap = flatMat(0x1c1e24, { rough: 0.9 });
  const armR = mesh(boxGeo(0.07, 0.07, 0.3), matArm, 0.05, -0.06, 0.12);
  const armL = mesh(boxGeo(0.07, 0.07, 0.24), matArm, -0.06, -0.05, -0.08);
  group.add(armR, armL);
  // Правый рукав с ремнями
  const sleeveR = mesh(boxGeo(0.1, 0.1, 0.2), matSleeve, 0.055, -0.055, 0.22);
  group.add(sleeveR);
  for (let i = 0; i < 3; i++) {
    group.add(mesh(boxGeo(0.108, 0.108, 0.018), matStrap, 0.055, -0.055, 0.16 + i * 0.05));
    group.add(mesh(boxGeo(0.02, 0.02, 0.02), flatMat(PALETTE.mechSilver, { metal: 0.8, rough: 0.3 }), 0.055, -0.11, 0.16 + i * 0.05));
  }
  // Левый рукав с одним ремнём
  group.add(mesh(boxGeo(0.095, 0.095, 0.12), matSleeve, -0.06, -0.05, -0.02));
  group.add(mesh(boxGeo(0.1, 0.1, 0.018), matStrap, -0.06, -0.05, -0.02));

  let muzzle, magazine;
  // Корпусные меши (заменяются скачанным бластером в upgradeViewmodel)
  const bodyParts = [];
  const bodyMesh = (geo, mat, x = 0, y = 0, z = 0) => {
    const m = mesh(geo, mat, x, y, z);
    group.add(m);
    bodyParts.push(m);
    return m;
  };
  if (kind === 'rifle') {
    // Резной корпус
    bodyMesh(boxGeo(0.07, 0.1, 0.5), matBody, 0, 0, -0.1);
    bodyMesh(boxGeo(0.05, 0.05, 0.34), matDark, 0, 0.035, -0.35); // ствол
    bodyMesh(new THREE.CylinderGeometry(0.014, 0.014, 0.1, 6), matDark, 0, 0.035, -0.56); // дульная часть
    bodyMesh(boxGeo(0.075, 0.02, 0.2), matBody, 0, -0.045, -0.3); // цевье резное
    bodyMesh(boxGeo(0.078, 0.03, 0.1), matGlow, 0, 0.01, -0.18);  // светящаяся вставка
    // Планка-прицел с кольцом
    bodyMesh(boxGeo(0.03, 0.02, 0.3), matDark, 0, 0.065, -0.12);
    // Магазин (отдельная группа для анимации перезарядки)
    magazine = new THREE.Group();
    magazine.position.set(0, -0.06, -0.02);
    magazine.add(mesh(boxGeo(0.05, 0.16, 0.09), matDark, 0, -0.06, 0));
    magazine.add(mesh(boxGeo(0.052, 0.03, 0.092), matGlow, 0, -0.13, 0));
    group.add(magazine);
    // Приклад и рукоять
    bodyMesh(boxGeo(0.06, 0.09, 0.16), matBody, 0, -0.01, 0.22);
    bodyMesh(boxGeo(0.05, 0.1, 0.05), matGrip, 0, -0.08, 0.1);
    // Прицел-кольцо
    bodyMesh(boxGeo(0.02, 0.05, 0.02), matDark, 0, 0.08, -0.05);
    bodyMesh(boxGeo(0.012, 0.02, 0.012), matGlow, 0, 0.095, -0.05);
    muzzle = new THREE.Object3D();
    muzzle.position.set(0, 0.035, -0.6);
    group.add(muzzle);
  } else if (kind === 'shotgun') {
    // Дробовик: толстый двойной ствол
    bodyMesh(boxGeo(0.09, 0.11, 0.42), matBody, 0, 0, -0.05);
    bodyMesh(boxGeo(0.045, 0.045, 0.3), matDark, -0.025, 0.04, -0.32);
    bodyMesh(boxGeo(0.045, 0.045, 0.3), matDark, 0.025, 0.04, -0.32);
    bodyMesh(boxGeo(0.09, 0.04, 0.22), matBody, 0, -0.05, -0.28);
    bodyMesh(boxGeo(0.092, 0.025, 0.08), flatMat(PALETTE.crystal, { emissive: PALETTE.crystal, ei: 1.5 }), 0, 0.0, -0.12);
    magazine = new THREE.Group();
    magazine.position.set(0, -0.07, 0.02);
    magazine.add(mesh(boxGeo(0.07, 0.1, 0.12), matDark, 0, -0.04, 0));
    group.add(magazine);
    bodyMesh(boxGeo(0.07, 0.1, 0.14), matBody, 0, -0.01, 0.2);
    muzzle = new THREE.Object3D();
    muzzle.position.set(0, 0.04, -0.5);
    group.add(muzzle);
  } else {
    // Профили новых стволов: smg (короткий), dmr (длинный тонкий),
    // lmg (толстый + короб), revolver (компактный + барабан)
    const PROF = {
      smg:      { body: [0.06, 0.09, 0.34], barrel: 0.22, muzzleZ: -0.42, magLen: 0.14 },
      dmr:      { body: [0.055, 0.08, 0.62], barrel: 0.4, muzzleZ: -0.72, magLen: 0.1 },
      lmg:      { body: [0.09, 0.12, 0.52], barrel: 0.3, muzzleZ: -0.55, magLen: 0.12 },
      revolver: { body: [0.05, 0.08, 0.24], barrel: 0.14, muzzleZ: -0.28, magLen: 0 },
      // Новые: AWP (длинная снайперка с сошкой), огнемёт (баллон+форсунка),
      // ракетница (толстая труба), гранатомёт (барабанный толстяк)
      awp:      { body: [0.05, 0.075, 0.72], barrel: 0.46, muzzleZ: -0.82, magLen: 0.09 },
      flamer:   { body: [0.09, 0.11, 0.5], barrel: 0.2, muzzleZ: -0.6, magLen: 0 },
      rocket:   { body: [0.11, 0.12, 0.62], barrel: 0.3, muzzleZ: -0.75, magLen: 0 },
      gl:       { body: [0.09, 0.11, 0.4], barrel: 0.18, muzzleZ: -0.5, magLen: 0 },
    };
    const p = PROF[kind] || PROF.smg;
    bodyMesh(boxGeo(...p.body), matBody, 0, 0, -0.08);                       // корпус
    bodyMesh(boxGeo(p.body[0] * 0.7, p.body[1] * 0.5, p.barrel), matDark, 0, p.body[1] * 0.35, -0.1 - p.body[2] / 2 - p.barrel / 2 + 0.05); // ствол
    bodyMesh(boxGeo(p.body[0] * 1.06, 0.024, 0.09), matGlow, 0, 0.005, -0.16); // светящаяся вставка
    if (kind === 'revolver' || kind === 'gl') {
      // барабан
      const drum = mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.05, 8), matDark, 0, 0, -0.06);
      drum.rotation.x = Math.PI / 2;
      group.add(drum); bodyParts.push(drum);
      if (kind === 'gl') drum.scale.setScalar(1.5); // у гранатомёта барабан здоровенный
    } else {
      magazine = new THREE.Group();
      magazine.position.set(0, -0.055, -0.04);
      if (p.magLen > 0) {
        magazine.add(mesh(boxGeo(p.body[0] * 0.8, p.magLen, 0.07), matDark, 0, -p.magLen / 2, 0));
        magazine.add(mesh(boxGeo(p.body[0] * 0.82, 0.024, 0.072), matGlow, 0, -p.magLen - 0.008, 0));
        if (kind === 'lmg') magazine.add(mesh(boxGeo(0.09, 0.1, 0.11), matDark, 0, -0.1, 0)); // короб ленты
      }
      group.add(magazine);
      // Уникальные детали новых стволов
      if (kind === 'flamer') {
        // топливный баллон сверху + форсунка
        const tank = mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.3, 8), flatMat(0x7a1a10, { metal: 0.5, rough: 0.4 }), 0, 0.075, -0.05);
        tank.rotation.x = Math.PI / 2; group.add(tank); bodyParts.push(tank);
        bodyMesh(new THREE.CylinderGeometry(0.02, 0.03, 0.08, 6), matGlow, 0, 0.03, -0.52);
      }
      if (kind === 'rocket') {
        // раструб трубы + боеголовка внутри
        bodyMesh(new THREE.CylinderGeometry(0.075, 0.06, 0.1, 8), matDark, 0, 0.01, -0.68);
        bodyMesh(new THREE.CylinderGeometry(0.02, 0.045, 0.12, 6), flatMat(0x8a1020, { emissive: 0x5a0810, ei: 0.9 }), 0, 0.01, -0.66);
      }
      if (kind === 'awp') {
        // сошки + длинный прицел
        bodyMesh(boxGeo(0.012, 0.07, 0.012), matDark, -0.03, -0.07, -0.5);
        bodyMesh(boxGeo(0.012, 0.07, 0.012), matDark, 0.03, -0.07, -0.5);
        bodyMesh(new THREE.CylinderGeometry(0.022, 0.022, 0.14, 8), matDark, 0, 0.07, -0.2);
      }
    }
    if (!magazine) { // револьверу — пустая группа-заглушка для startReload
      magazine = new THREE.Group();
      magazine.position.set(0, -0.05, 0);
      group.add(magazine);
    }
    bodyMesh(boxGeo(p.body[0] * 0.9, p.body[1], 0.13), matBody, 0, -0.01, 0.18); // приклад/рукоять
    bodyMesh(boxGeo(p.body[0] * 0.75, 0.09, 0.045), matGrip, 0, -0.075, 0.08);
    muzzle = new THREE.Object3D();
    muzzle.position.set(0, p.body[1] * 0.35, p.muzzleZ);
    group.add(muzzle);
  }

  // Поза покоя (относительно камеры)
  const restPos = new THREE.Vector3(0.22, -0.2, -0.42);
  const adsPos = new THREE.Vector3(0, -0.148, -0.35);
  group.position.copy(restPos);
  group.rotation.y = 0.03;

  // Состояние анимаций
  const st = {
    t: 0, bobPhase: 0, speedF: 0,
    recoil: 0, reloadT: 0, reloadDur: 0, ads: 0,
  };
  // Домашняя поза магазина (upgradeViewmodel может переназначить под магазин glb)
  const magHome = magazine.position.clone();

  function update(dt, { speed = 0, ads = false, grounded = true } = {}) {
    st.t += dt;
    const targetAds = ads ? 1 : 0;
    st.ads += (targetAds - st.ads) * Math.min(1, dt * 12);
    st.speedF += ((speed > 0.5 ? 1 : 0) - st.speedF) * Math.min(1, dt * 6);
    st.bobPhase += dt * (4 + speed * 0.9);

    // Позиция: rest <-> ads
    group.position.lerpVectors(restPos, adsPos, st.ads);

    // Idle-sway (дыхание)
    const sway = 1 - st.ads * 0.85;
    group.position.x += Math.sin(st.t * 1.4) * 0.0025 * sway;
    group.position.y += Math.sin(st.t * 2.3) * 0.003 * sway;

    // Бег-качание
    if (grounded) {
      const bob = st.speedF * (1 - st.ads * 0.7);
      group.position.x += Math.sin(st.bobPhase) * 0.012 * bob;
      group.position.y += Math.abs(Math.cos(st.bobPhase)) * 0.014 * bob;
      group.rotation.z = Math.sin(st.bobPhase) * 0.02 * bob;
    }

    // Отдача
    if (st.recoil > 0) {
      group.position.z += st.recoil * 0.06;
      group.rotation.x = st.recoil * 0.12;
      st.recoil = Math.max(0, st.recoil - dt * 6);
    } else {
      group.rotation.x *= 0.8;
    }

    // Перезарядка: УНИКАЛЬНАЯ хореография на ствол (st.reloadStyle):
    // spin — вертолёт вокруг Y; flip — кувырок вперёд; toss — подброс с вращением;
    // pump — помпа взад-вперёд; bolt — затворный крен; drum — вращение вокруг оси
    // ствола ×3; vent — тряска со сбросом пара; magflip — магазин вниз с кувырком.
    if (st.reloadT > 0) {
      st.reloadT -= dt;
      const p = 1 - st.reloadT / st.reloadDur; // 0..1
      const k = Math.sin(Math.min(1, Math.max(0, p)) * Math.PI); // 0→1→0
      const A = st._rlA || (st._rlA = { gx: 0, gy: 0, gz: 0, px: 0, py: 0, pz: 0, mrx: 0, mrz: 0 });
      // откат прошлого кадра (группа и магазин — к базовым позам)
      group.rotation.x -= A.gx; group.rotation.y -= A.gy; group.rotation.z -= A.gz;
      group.position.x -= A.px; group.position.y -= A.py; group.position.z -= A.pz;
      magazine.position.set(magHome.x, magHome.y, magHome.z);
      magazine.rotation.x = 0; magazine.rotation.z = 0;
      A.gx = A.gy = A.gz = A.px = A.py = A.pz = A.mrx = A.mrz = 0;

      const style = st.reloadStyle || 'magflip';
      if (style === 'spin') {
        A.gy = k * Math.PI * 2;                    // полный оборот «вертолёт»
        magazine.position.y -= k * 0.1;
      } else if (style === 'flip') {
        A.gx = k * Math.PI * 2;                    // кувырок вперёд
        A.py = k * 0.05;
      } else if (style === 'toss') {
        A.py = k * 0.26;                           // подброс
        A.gx = k * Math.PI * 2;
        A.gz = k * 0.4;
      } else if (style === 'pump') {
        A.pz = Math.sin(p * Math.PI * 4) * 0.05;   // два помповых движения
        A.gz = k * 0.35;
      } else if (style === 'bolt') {
        A.gz = k * 1.0;                            // крен на бок + микроподъём
        A.py = k * 0.06;
        A.pz = Math.sin(p * Math.PI * 2) * 0.03;   // затвор туда-сюда
      } else if (style === 'drum') {
        A.gx = k * Math.PI * 6;                    // вращение вокруг оси ствола ×3
        A.mrx = k * Math.PI * 8;                   // барабан раскручивается
        magazine.position.y -= k * 0.05;
      } else if (style === 'vent') {
        A.px = Math.sin(p * 46) * 0.012 * k;       // тряска сброса пара
        A.gz = k * 0.45;
        A.py = k * 0.03;
      } else { // magflip — классика: магазин вниз с кувырком
        const q = p < 0.35 ? p / 0.35 : p < 0.65 ? 1 : 1 - (p - 0.65) / 0.35;
        magazine.position.x -= q * 0.06;
        magazine.position.y -= q * 0.18;
        A.mrz = q * 0.5;
        A.mrx = q * Math.PI * 2;                   // магазин кувыркается
        A.gz = k * 0.25;
      }
      group.rotation.x += A.gx; group.rotation.y += A.gy; group.rotation.z += A.gz;
      group.position.x += A.px; group.position.y += A.py; group.position.z += A.pz;
      magazine.rotation.x += A.mrx; magazine.rotation.z += A.mrz;
    } else if (st._rlA) {
      // финальный откат после конца перезарядки
      const A = st._rlA;
      group.rotation.x -= A.gx; group.rotation.y -= A.gy; group.rotation.z -= A.gz;
      group.position.x -= A.px; group.position.y -= A.py; group.position.z -= A.pz;
      magazine.position.set(magHome.x, magHome.y, magHome.z);
      magazine.rotation.x = 0; magazine.rotation.z = 0;
      st._rlA = null;
    }
  }

  function kick(strength = 1) { st.recoil = Math.min(1.5, st.recoil + strength); }
  function startReload(dur, style = 'magflip') { st.reloadT = dur; st.reloadDur = dur; st.reloadStyle = style; }
  function isReloading() { return st.reloadT > 0; }

  const vmApi = { group, muzzle, magazine, bodyParts, magHome, update, kick, startReload, isReloading, st };
  return vmApi;
}

// ============================================================
// 3. СТРОИТЕЛЬНЫЕ БЛОКИ АРЕНЫ
// ============================================================

// Разрушаемая стена: сетка чанков cols×rows. Возвращает данные для destruction.js
// tex — необязательный PBR-набор из loadTextureSet (бетон/металл; нет — flat цвет).
export function createDestructibleWall({ width = 8, height = 4, cols = 8, rows = 4, depth = 0.5, color = PALETTE.concrete, tex = null }) {
  const group = new THREE.Group();
  const cw = width / cols, ch = height / rows;
  const geo = boxGeo(cw * 0.98, ch * 0.98, depth);
  const mat = flatMat(color, { noCache: true, rough: 0.85, metal: 0.05 });
  if (tex) applyTextureSet(mat, tex, { baseRough: 0.85, baseMetal: 0.05 });
  const chunks = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const m = new THREE.Mesh(geo, mat.clone());
      m.position.set(-width / 2 + cw * (c + 0.5), ch * (r + 0.5), 0);
      // Небольшая вариация оттенка
      m.material.color.offsetHSL(0, 0, (Math.random() - 0.5) * 0.06);
      group.add(m);
      chunks.push({
        mesh: m, col: c, row: r, hp: 30, maxHp: 30,
        alive: true, supported: true,
        // AABB заполняется после размещения стены в мире
        aabb: new THREE.Box3(),
      });
    }
  }
  return { group, chunks, cols, rows, cw, ch, depth };
}

// Колонна (белый камень)
export function createColumn(h = 6, r = 0.6) {
  const g = new THREE.Group();
  const mat = flatMat(PALETTE.concrete, { rough: 0.8 });
  const matTrim = flatMat(PALETTE.crystal, { emissive: PALETTE.crystal, ei: 0.9 });
  const col = mesh(new THREE.CylinderGeometry(r, r * 1.15, h, 6), mat, 0, h / 2, 0);
  g.add(col);
  g.add(mesh(boxGeo(r * 2.6, 0.3, r * 2.6), mat, 0, 0.15, 0));
  g.add(mesh(boxGeo(r * 2.4, 0.25, r * 2.4), mat, 0, h - 0.12, 0));
  g.add(mesh(boxGeo(r * 2.5, 0.08, 0.1), matTrim, 0, h * 0.7, r * 0.9));
  return g;
}

// Платформа (светлый камень; metalness низкий — без envmap высокий metal даёт чёрное)
export function createPlatform(w = 4, d = 4, h = 0.4) {
  const g = new THREE.Group();
  g.add(mesh(boxGeo(w, h, d), flatMat(0xd0d3dc, { metal: 0.1, rough: 0.6 }), 0, h / 2, 0));
  g.add(mesh(boxGeo(w, 0.06, 0.12), flatMat(PALETTE.crystal, { emissive: PALETTE.crystal, ei: 1.2 }), 0, h, d / 2 - 0.06));
  g.add(mesh(boxGeo(w, 0.06, 0.12), flatMat(PALETTE.crystal, { emissive: PALETTE.crystal, ei: 1.2 }), 0, h, -d / 2 + 0.06));
  return g;
}

// Контейнер-кешбокс (светящийся)
export function createCashbox() {
  const g = new THREE.Group();
  const matBody = flatMat(0x8a6a1a, { metal: 0.6, rough: 0.4 });
  const matGlow = flatMat(0xffc832, { emissive: 0xffc832, ei: 2.2 });
  g.add(mesh(boxGeo(0.7, 0.5, 0.5), matBody, 0, 0.25, 0));
  g.add(mesh(boxGeo(0.72, 0.08, 0.52), matGlow, 0, 0.42, 0));
  g.add(mesh(boxGeo(0.72, 0.08, 0.52), matGlow, 0, 0.1, 0));
  g.add(mesh(boxGeo(0.1, 0.52, 0.1), matGlow, 0, 0.25, 0.2));
  const light = new THREE.PointLight(0xffc832, 6, 8, 2);
  light.position.y = 0.6;
  g.add(light);
  return g;
}

// Кешаут-станция: пьедестал + голограмма
// tex — необязательный PBR-набор (металл-панель) для пьедестала.
export function createCashoutStation(letter = 'A', tex = null) {
  const g = new THREE.Group();
  const matBase = flatMat(0x8f94a4, { metal: 0.3, rough: 0.5 });
  if (tex) {
    applyTextureSet(matBase, tex, { baseRough: 0.5, baseMetal: 0.6 });
    matBase.color.setHex(0xd6dae4); // тёмная albedo-панель: не затемнять tint'ом
  }
  const matGlow = flatMat(PALETTE.crystal, { emissive: PALETTE.crystal, ei: 1.8 });
  g.add(mesh(new THREE.CylinderGeometry(1.3, 1.6, 0.35, 8), matBase, 0, 0.175, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.5, 0.7, 0.9, 6), matBase, 0, 0.8, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.08, 6), matGlow, 0, 1.28, 0));
  // Голограмма — вращающееся кольцо + парящий кристалл
  const holo = new THREE.Group();
  holo.position.y = 2.1;
  const ringMat = new THREE.MeshBasicMaterial({ color: PALETTE.crystal, transparent: true, opacity: 0.6, side: THREE.DoubleSide });
  const ring = mesh(new THREE.TorusGeometry(0.7, 0.03, 6, 24), ringMat);
  ring.rotation.x = Math.PI / 2;
  const crystal = mesh(new THREE.OctahedronGeometry(0.3), flatMat(PALETTE.crystal, { emissive: PALETTE.crystal, ei: 2.5 }));
  holo.add(ring, crystal);
  g.add(holo);
  const light = new THREE.PointLight(PALETTE.crystal, 5, 10, 2);
  light.position.y = 2;
  g.add(light);
  g.userData.holo = holo;
  g.userData.letter = letter;
  return g;
}

// Зона-объектив A/B/C: кольцо на земле + столб света + флажок
// panelTex — необязательный PBR-набор (металл-панель) для рамки зоны.
export function createObjectiveZone(letter, color = PALETTE.crimson, panelTex = null) {
  const g = new THREE.Group();
  // Рамка-портал зоны: два поста + перекладина (металл-панель, эмиссивная кромка)
  const frameMat = flatMat(0x6a7080, { noCache: true, metal: 0.5, rough: 0.45 });
  if (panelTex) {
    applyTextureSet(frameMat, panelTex, { baseRough: 0.45, baseMetal: 0.7 });
    frameMat.color.setHex(0xd0d5e0); // тёмная albedo-панель: не затемнять tint'ом
  }
  const postGeo = boxGeo(0.18, 3.4, 0.18);
  g.add(mesh(postGeo, frameMat, -2.5, 1.7, 0));
  g.add(mesh(postGeo, frameMat, 2.5, 1.7, 0));
  g.add(mesh(boxGeo(5.2, 0.18, 0.18), frameMat, 0, 3.4, 0));
  // Эмиссивная нить по перекладине (цвет зоны)
  g.add(mesh(boxGeo(5.0, 0.05, 0.06), flatMat(color, { emissive: color, ei: 1.6 }), 0, 3.28, 0.1));
  const ringMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, side: THREE.DoubleSide });
  const ring = mesh(new THREE.RingGeometry(2.2, 2.8, 32), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.03;
  g.add(ring);
  const beamMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  const beam = mesh(new THREE.CylinderGeometry(2.4, 2.4, 30, 16, 1, true), beamMat, 0, 15, 0);
  g.add(beam);
  // Флаг с буквой (canvas-текстура)
  const cv = document.createElement('canvas');
  cv.width = 128; cv.height = 128;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 90px monospace';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(letter, 64, 70);
  const tex = new THREE.CanvasTexture(cv);
  const flag = mesh(new THREE.PlaneGeometry(1.2, 1.2), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, transparent: true }), 0, 4.2, 0);
  g.add(flag);
  g.add(mesh(new THREE.CylinderGeometry(0.05, 0.05, 4.4, 5), flatMat(PALETTE.darkMetal), 0, 2.2, 0));
  g.userData.ring = ring;
  g.userData.flag = flag;
  return g;
}

// Небоскрёб-руина (фон): белый силуэт + хроматическая кромка (additive-обводка)
export function createRuinedTower(w = 8, h = 40, d = 8) {
  const g = new THREE.Group();
  const mat = flatMat(0xc9ccd8, { rough: 0.9, metal: 0.05 });
  const bodyGeo = boxGeo(w, h, d);
  const body = mesh(bodyGeo, mat, 0, h / 2, 0);
  g.add(body);
  // Хроматические кромки: два additive-силуэта чуть больше корпуса (малина/циан)
  const fringeM = new THREE.MeshBasicMaterial({
    color: 0xff2d55, side: THREE.BackSide, transparent: true, opacity: 0.16,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const fringeC = new THREE.MeshBasicMaterial({
    color: 0x2dd4ff, side: THREE.BackSide, transparent: true, opacity: 0.13,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const fM = mesh(bodyGeo, fringeM, 0, h / 2, 0);
  fM.scale.setScalar(1.02);
  const fC = mesh(bodyGeo, fringeC, 0.22, h / 2, 0);
  fC.scale.setScalar(1.035);
  g.add(fM, fC);
  // Излом сверху
  const break1 = mesh(coneGeo(w * 0.5, h * 0.2, 4), mat, 0, h + h * 0.08, 0);
  break1.rotation.y = Math.random() * Math.PI;
  g.add(break1);
  // Светящиеся окна — InstancedMesh (холодный белый свет)
  const winGeo = boxGeo(0.6, 0.9, 0.1);
  const winMat = new THREE.MeshBasicMaterial({ color: 0xdfe8ff });
  const cols = Math.floor(w / 1.4), rowsN = Math.floor(h / 2.2);
  const count = cols * rowsN;
  const inst = new THREE.InstancedMesh(winGeo, winMat, count);
  const dummy = new THREE.Object3D();
  let i = 0;
  for (let r = 0; r < rowsN; r++) {
    for (let c = 0; c < cols; c++) {
      if (Math.random() < 0.6 || i >= count) continue; // часть окон погасла
      dummy.position.set(-w / 2 + 0.8 + c * 1.4, 1.5 + r * 2.2, d / 2 + 0.06);
      dummy.updateMatrix();
      inst.setMatrixAt(i++, dummy.matrix);
    }
  }
  inst.count = i;
  g.add(inst);
  return g;
}

// Кристаллический шип
export function createCrystalSpike(h = 3) {
  const g = new THREE.Group();
  const mat = flatMat(PALETTE.crystalDark, { emissive: PALETTE.crystal, ei: 0.5, metal: 0.2, rough: 0.3 });
  const n = 2 + Math.floor(Math.random() * 3);
  for (let i = 0; i < n; i++) {
    const spike = mesh(coneGeo(0.3 + Math.random() * 0.35, h * (0.5 + Math.random() * 0.7), 5), mat,
      (Math.random() - 0.5) * 0.8, h * 0.25, (Math.random() - 0.5) * 0.8);
    spike.rotation.set((Math.random() - 0.5) * 0.5, Math.random() * Math.PI, (Math.random() - 0.5) * 0.5);
    g.add(spike);
  }
  return g;
}

// ============================================================
// 4. КРИСТАЛЛИЧЕСКИЙ ВЗРЫВ (центр арены, как на референсе):
//    радиальная композиция из вытянутых кристаллов (InstancedMesh),
//    фиолетово-лавандовый градиент, V-силуэт, пульс в бит,
//    медленное вращение внутреннего ядра.
// ============================================================
export function createCrystalExplosion({ count = 110, radius = 12 } = {}) {
  const group = new THREE.Group();
  group.name = 'crystalExplosion';

  const geo = new THREE.OctahedronGeometry(0.5, 0);
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff, flatShading: true,
    metalness: 0.25, roughness: 0.22,
    emissive: PALETTE.crystal, emissiveIntensity: 1.1,
    transparent: true, opacity: 0.96,
  });
  const inst = new THREE.InstancedMesh(geo, mat, count);
  const dummy = new THREE.Object3D();
  const up = new THREE.Vector3(0, 1, 0);
  const dir = new THREE.Vector3();
  const cA = new THREE.Color(PALETTE.crystalDark);
  const cB = new THREE.Color(PALETTE.crystalLight);
  const cTmp = new THREE.Color();
  for (let i = 0; i < count; i++) {
    // Направление: азимут случайный, элевация 18°..72° — веер-фонтан (V-силуэт)
    const az = Math.random() * Math.PI * 2;
    const el = (18 + Math.random() * 54) * (Math.PI / 180);
    dir.set(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el));
    // Длина кристалла: длинные ближе к вертикали (высокий V), короткие у основания
    const heightBias = Math.sin(el);
    const len = 1.6 + heightBias * (2.5 + Math.random() * 4.5) * (radius / 9);
    const thick = (0.16 + Math.random() * 0.3) * (radius / 9);
    dummy.position.copy(dir).multiplyScalar(len * 0.42);
    dummy.quaternion.setFromUnitVectors(up, dir);
    dummy.scale.set(thick, len, thick);
    dummy.updateMatrix();
    inst.setMatrixAt(i, dummy.matrix);
    // Градиент: высокие — лаванда, низкие — глубокий фиолет
    cTmp.copy(cA).lerp(cB, heightBias * (0.5 + Math.random() * 0.5));
    inst.setColorAt(i, cTmp);
  }
  inst.instanceMatrix.needsUpdate = true;
  if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
  group.add(inst);

  // Внутреннее ядро: плотный вертикальный пучок, медленно вращается
  const coreCount = 22;
  const coreMat = new THREE.MeshStandardMaterial({
    color: 0xffffff, flatShading: true,
    metalness: 0.2, roughness: 0.18,
    emissive: PALETTE.crystal, emissiveIntensity: 1.3,
    transparent: true, opacity: 0.95,
  });
  const core = new THREE.InstancedMesh(geo, coreMat, coreCount);
  for (let i = 0; i < coreCount; i++) {
    const az = (i / coreCount) * Math.PI * 2 + Math.random() * 0.4;
    const el = (45 + Math.random() * 40) * (Math.PI / 180);
    dir.set(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el));
    const len = 2.2 + Math.random() * 3.6;
    const thick = 0.2 + Math.random() * 0.25;
    dummy.position.copy(dir).multiplyScalar(len * 0.35);
    dummy.quaternion.setFromUnitVectors(up, dir);
    dummy.scale.set(thick, len, thick);
    dummy.updateMatrix();
    core.setMatrixAt(i, dummy.matrix);
    cTmp.copy(cB).lerp(cA, Math.random() * 0.5);
    core.setColorAt(i, cTmp);
  }
  core.instanceMatrix.needsUpdate = true;
  if (core.instanceColor) core.instanceColor.needsUpdate = true;
  group.add(core);

  // Свечение в эпицентре: additive-спрайт + точечный свет
  const glowTex = createSunGlareTexture(128);
  const glowSpr = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex, color: 0xb478ff, transparent: true, opacity: 0.85,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  glowSpr.scale.set(10, 10, 1);
  glowSpr.position.y = 0.8;
  group.add(glowSpr);
  const light = new THREE.PointLight(PALETTE.crystal, 60, 44, 2);
  light.position.y = 2.2;
  group.add(light);

  // Анимация: вращение ядра + пульс в бит
  function update(dt, t, beat = 0) {
    core.rotation.y += dt * 0.45;
    inst.rotation.y -= dt * 0.06;
    const pulse = 1 + beat * 0.05 + Math.sin(t * 1.3) * 0.012;
    group.scale.setScalar(pulse);
    mat.emissiveIntensity = 1.1 + beat * 1.2;
    coreMat.emissiveIntensity = 1.6 + beat * 1.8;
    light.intensity = 60 + beat * 90 + Math.sin(t * 2.1) * 10;
    glowSpr.material.opacity = 0.7 + beat * 0.3;
    const gs = 10 + beat * 3;
    glowSpr.scale.set(gs, gs, 1);
  }

  return { group, inst, core, mat, coreMat, light, update };
}

// Череп (декорация)
export function createSkull(s = 0.3) {
  const g = new THREE.Group();
  const mat = flatMat(PALETTE.bone, { rough: 0.9 });
  g.add(mesh(boxGeo(s, s * 0.85, s * 0.9), mat, 0, s * 0.55, 0));
  g.add(mesh(boxGeo(s * 0.7, s * 0.35, s * 0.7), mat, 0, s * 0.15, s * 0.05));
  const eyeMat = flatMat(0x111111);
  g.add(mesh(boxGeo(s * 0.22, s * 0.22, s * 0.1), eyeMat, -s * 0.2, s * 0.6, s * 0.42));
  g.add(mesh(boxGeo(s * 0.22, s * 0.22, s * 0.1), eyeMat, s * 0.2, s * 0.6, s * 0.42));
  return g;
}

// Прожектор (световой конус)
export function createSpotlightBeam(color = 0xffffff) {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.06, depthWrite: false, side: THREE.DoubleSide });
  const cone = mesh(new THREE.ConeGeometry(3, 25, 12, 1, true), mat, 0, -12.5, 0);
  g.add(cone);
  g.userData.cone = cone;
  return g;
}

// Красная БИОХАЗАРД-декаль на стену (в psy-break светится)
export function createBiohazardDecal(size = 6) {
  const tex = createBiohazardTexture(512);
  const mat = new THREE.MeshBasicMaterial({
    map: tex, transparent: true, depthWrite: false,
    color: 0xa01226, opacity: 0.92, side: THREE.DoubleSide,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
  m.userData.baseColor = new THREE.Color(0xa01226);
  m.userData.glowColor = new THREE.Color(0xff1830);
  return m;
}
