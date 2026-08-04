// ===== GEN.SWAGS GLB Arena Loader =====
// Загружает GLB-карту, масштабирует, извлекает коллизии, точки спавна.
// Работает как полная замена процедурной арены или как overlay.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const GLB_CACHE = new Map();

export async function loadGLBArena(url, targetSize = 70) {
  if (GLB_CACHE.has(url)) return GLB_CACHE.get(url);

  const loader = new GLTFLoader();
  const gltf = await new Promise((res, rej) => loader.load(url, res, undefined, rej));
  const scene = gltf.scene;

  // --- Анализируем bounding box ---
  const bbox = new THREE.Box3().setFromObject(scene);
  const size = bbox.getSize(new THREE.Vector3());
  const center = bbox.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.z, 0.001);

  // --- Масштабируем до targetSize ---
  const scale = targetSize / maxDim;
  scene.scale.setScalar(scale);

  // --- Центрируем по XZ, пол на Y=0 ---
  const bbox2 = new THREE.Box3().setFromObject(scene);
  const center2 = bbox2.getCenter(new THREE.Vector3());
  scene.position.sub(center2);
  scene.position.y = -bbox2.min.y; // пол на Y=0

  // --- Собираем коллизии: ВОКСЕЛЬНАЯ РАСТЕРИЗАЦИЯ РЕАЛЬНЫХ ТРЕУГОЛЬНИКОВ ---
  // Вместо «один AABB на меш» (дырявый для тонких стен и гигантский для
  // наклонных зданий) растеризуем каждый треугольник в сетку вокселей.
  // Каждый занятый воксель → точный AABB. Стена любой толщины и наклона
  // становится коллизией; невидимых «коробок по bbox» больше нет.
  const colliders = voxelizeScene(scene);

  // --- Точки спавна (3 шт, треугольник) ---
  const spawns = [];
  const R = targetSize * 0.35;
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + Math.PI / 2;
    spawns.push({
      team: i,
      pos: new THREE.Vector3(Math.cos(a) * R, 0.1, Math.sin(a) * R),
      yaw: Math.atan2(-Math.cos(a) * R, -Math.sin(a) * R),
    });
  }

  // --- Зоны A/B/C (по краям и в центре) ---
  const zones = [
    { letter: 'A', pos: new THREE.Vector3(-targetSize * 0.25, 0, targetSize * 0.2) },
    { letter: 'B', pos: new THREE.Vector3(0, 0, -targetSize * 0.1) },
    { letter: 'C', pos: new THREE.Vector3(targetSize * 0.25, 0, -targetSize * 0.2) },
  ];

  const arena = {
    scene, colliders, spawns, zones,
    bbox: bbox2, size: targetSize,
    dispose() {
      scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
      GLB_CACHE.delete(url);
    },
  };
  GLB_CACHE.set(url, arena);
  return arena;
}

// Растеризация треугольников сцены в воксельную сетку AABB-коллизий.
// VOXEL — размер ячейки (м). Пропускаем воксели, где треугольник есть.
// Мелкие объекты (все оси bbox < VOXEL) не коллидируют — это мусор/декаль.
function voxelizeScene(scene, VOXEL = 0.45) {
  const cells = new Set();
  const vA = new THREE.Vector3(), vB = new THREE.Vector3(), vC = new THREE.Vector3();
  const key = (x, y, z) => x + ',' + y + ',' + z;
  scene.updateMatrixWorld(true);
  scene.traverse((obj) => {
    if (!obj.isMesh) return;
    const geo = obj.geometry;
    const pos = geo?.attributes?.position;
    if (!pos || pos.count < 3) return;
    const idx = geo.index;
    const triCount = idx ? idx.count / 3 : pos.count / 3;
    for (let t = 0; t < triCount; t++) {
      const i0 = idx ? idx.getX(t * 3) : t * 3;
      const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
      const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
      vA.fromBufferAttribute(pos, i0).applyMatrix4(obj.matrixWorld);
      vB.fromBufferAttribute(pos, i1).applyMatrix4(obj.matrixWorld);
      vC.fromBufferAttribute(pos, i2).applyMatrix4(obj.matrixWorld);
      // bbox треугольника → диапазон ячеек
      const minx = Math.floor(Math.min(vA.x, vB.x, vC.x) / VOXEL), maxx = Math.floor(Math.max(vA.x, vB.x, vC.x) / VOXEL);
      const miny = Math.floor(Math.min(vA.y, vB.y, vC.y) / VOXEL), maxy = Math.floor(Math.max(vA.y, vB.y, vC.y) / VOXEL);
      const minz = Math.floor(Math.min(vA.z, vB.z, vC.z) / VOXEL), maxz = Math.floor(Math.max(vA.z, vB.z, vC.z) / VOXEL);
      // Сэмплим точки внутри треугольника + вершины: помечаем ячейки
      const S = 3; // сэмплов на ось барицентрических
      for (let a = 0; a <= S; a++) for (let b = 0; b <= S - a; b++) {
        const c = S - a - b;
        const px = (vA.x * a + vB.x * b + vC.x * c) / S;
        const py = (vA.y * a + vB.y * b + vC.y * c) / S;
        const pz = (vA.z * a + vB.z * b + vC.z * c) / S;
        cells.add(key(Math.floor(px / VOXEL), Math.floor(py / VOXEL), Math.floor(pz / VOXEL)));
      }
      // Для вытянутых треугольников (больше пары ячеек) добавляем заливку bbox,
      // иначе длинные диагональные полигоны оставляют прорехи между сэмплами
      if ((maxx - minx) + (maxy - miny) + (maxz - minz) > 2) {
        for (let x = minx; x <= maxx; x++) for (let y = miny; y <= maxy; y++) for (let z = minz; z <= maxz; z++) cells.add(key(x, y, z));
      }
    }
  });
  const out = [];
  for (const k of cells) {
    const [x, y, z] = k.split(',').map(Number);
    out.push({
      min: new THREE.Vector3(x * VOXEL, y * VOXEL, z * VOXEL),
      max: new THREE.Vector3((x + 1) * VOXEL, (y + 1) * VOXEL, (z + 1) * VOXEL),
    });
  }
  return out;
}

// Применяет GLB-арену к физике (AABB коллизии)
export function applyGLBPhysics(physics, arena) {
  for (const c of arena.colliders) {
    physics.addStatic(c.min, c.max, 'glb');
  }
}

// Определяет, лежит ли точка на GLB-полу (для спавна)
export function findFloorY(arena, x, z, startY = 50) {
  const ray = new THREE.Raycaster(
    new THREE.Vector3(x, startY, z),
    new THREE.Vector3(0, -1, 0),
    0, startY + 10
  );
  const meshes = [];
  arena.scene.traverse((o) => { if (o.isMesh) meshes.push(o); });
  const hits = ray.intersectObjects(meshes, true);
  return hits.length ? hits[0].point.y : 0;
}
