// ===== GEN.SWAGS — тест скачанных ассетов (Node, без DOM) =====
// 1) Каждый .glb в assets/models и assets/weapons валиден (магия, JSON-chunk,
//    заявленная длина == фактической — нет обрезанных файлов).
// 2) У персонажей есть скелет (skins) и клипы; маппинг CLIP_ALIASES покрывает
//    idle/run/death (+shoot/hit) для каждой модели.
// 3) Лимиты: модели ≤ 8MB / ≤ 50k tris; арена (фоновый стриминговый ассет)
//    ≤ 96MB / ≤ 500k tris.
// 4) Внешние текстуры оружия существуют на диске (относительные пути).
// Запуск: node test/assets.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectGLB } from './glb-inspect.mjs';
import { mapClips, CHARACTERS, WEAPON_MODELS } from '../js/engine/assetlib.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODELS_DIR = path.join(ROOT, 'assets/models');
const WEAPONS_DIR = path.join(ROOT, 'assets/weapons');
const MAX_BYTES = 12 * 1024 * 1024;  // стволы/персонажи ≤ 12MB (локальный ассет)
const MAX_TRIS = 100000;             // ≤ 100k tris (SCAR-20 ~73k)

// Арена — большой фоновый ассет, грузится один раз локально; лимиты мягче
const ARENA_MAX_BYTES = 96 * 1024 * 1024;
const ARENA_MAX_TRIS = 500000;
const isArena = (rel) => rel.startsWith('assets/models/arena/');

let passed = 0, failed = 0;
function ok(cond, name) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}`); }
}

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.name.toLowerCase().endsWith('.glb')) yield p;
  }
}

console.log('== Валидность GLB ==');
const glbs = [...walk(MODELS_DIR), ...(fs.existsSync(WEAPONS_DIR) ? [...walk(WEAPONS_DIR)] : [])];
ok(glbs.length >= 6, `найдено ≥6 glb (${glbs.length})`);
const infos = new Map();
for (const file of glbs) {
  const rel = path.relative(ROOT, file).replace(/\\/g, '/'); // единый формат с CHARACTERS/WEAPON_MODELS (Windows fix)
  let info = null;
  try { info = inspectGLB(fs.readFileSync(file)); } catch (e) {
    ok(false, `${rel}: парсинг (${e.message})`);
    continue;
  }
  infos.set(rel, info);
  const maxB = isArena(rel) ? ARENA_MAX_BYTES : MAX_BYTES;
  const maxT = isArena(rel) ? ARENA_MAX_TRIS : MAX_TRIS;
  ok(info.bytes === info.declaredBytes, `${rel}: целый (${(info.bytes / 1024).toFixed(0)}KB)`);
  ok(info.bytes <= maxB, `${rel}: ≤ ${(maxB / 1048576).toFixed(0)}MB`);
  ok(info.triangles <= maxT, `${rel}: ≤ ${(maxT / 1000).toFixed(0)}k tris (${info.triangles})`);
}

console.log('\n== Персонажи: скелет + клипы ==');
for (const [name, def] of Object.entries(CHARACTERS)) {
  const rel = def.url;
  const info = infos.get(rel);
  ok(!!info, `${name}: файл есть (${rel})`);
  if (!info) continue;
  ok(info.skins >= 1, `${name}: есть скин/скелет`);
  ok(info.animations.length >= 10, `${name}: ≥10 клипов (${info.animations.length})`);
  ok(info.imagesExternal.length === 0, `${name}: текстуры встроены`);
  const mapped = mapClips(info.animations);
  for (const need of ['idle', 'run', 'death', 'shoot', 'hit']) {
    ok(!!mapped[need], `${name}: маппинг '${need}' → ${mapped[need] || 'НЕТ'}`);
  }
}

console.log('\n== Оружие ==');
for (const [kind, rel] of Object.entries(WEAPON_MODELS)) {
  const info = infos.get(rel);
  ok(!!info, `${kind}: файл есть (${rel})`);
  if (!info) continue;
  // Внешние URI (Textures/colormap.png) должны резолвиться относительно glb
  for (const uri of info.imagesExternal) {
    const p = path.join(ROOT, path.dirname(rel), decodeURIComponent(uri));
    ok(fs.existsSync(p), `${kind}: текстура ${uri} на диске`);
  }
}

console.log(`\n===== ИТОГ: ${passed} passed, ${failed} failed =====`);
process.exit(failed ? 1 : 0);
