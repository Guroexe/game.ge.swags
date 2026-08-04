// ===== GEN.SWAGS — тест скачанных PBR-текстур (Node, без DOM) =====
// 1) Все ожидаемые файлы assets/textures/*.jpg существуют.
// 2) Валидный JPEG: SOI (FFD8) + EOI (FFD9), разбор SOF → размеры ≤ 1024 (1K).
// 3) Размер файла > 20KB (не заглушка/не битый download).
// 4) Наборы из ENV_TEXTURE_SETS ссылаются на существующие файлы.
// Запуск: node test/textures.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENV_TEXTURE_SETS } from '../js/engine/models.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEX_DIR = path.join(ROOT, 'assets/textures');
const MIN_BYTES = 20 * 1024;
const MAX_DIM = 1024;

let passed = 0, failed = 0;
function ok(cond, name) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}`); }
}

// Размер JPEG из сегментов SOF0..SOF15 (без декодирования)
function jpegSize(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null; // SOI
  let off = 2;
  while (off + 9 < buf.length) {
    if (buf[off] !== 0xff) { off++; continue; }
    const marker = buf[off + 1];
    // SOF-маркеры (кроме DHT/DAC/RST)
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const h = buf.readUInt16BE(off + 5);
      const w = buf.readUInt16BE(off + 7);
      return { w, h };
    }
    const len = buf.readUInt16BE(off + 2);
    if (len < 2) return null;
    off += 2 + len;
  }
  return null;
}

console.log('== Файлы текстур: валидность и размеры ==');
const files = fs.existsSync(TEX_DIR)
  ? fs.readdirSync(TEX_DIR).filter((f) => f.toLowerCase().endsWith('.jpg'))
  : [];
ok(files.length >= 15, `найдено ≥15 jpg (${files.length})`);
for (const f of files) {
  const p = path.join(TEX_DIR, f);
  const buf = fs.readFileSync(p);
  ok(buf.length > MIN_BYTES, `${f}: >20KB (${(buf.length / 1024).toFixed(0)}KB)`);
  ok(buf[0] === 0xff && buf[1] === 0xd8, `${f}: JPEG SOI header`);
  ok(buf[buf.length - 2] === 0xff && buf[buf.length - 1] === 0xd9, `${f}: JPEG EOI (целый файл)`);
  const size = jpegSize(buf);
  ok(!!size, `${f}: SOF разобран (${size ? `${size.w}x${size.h}` : '—'})`);
  if (size) ok(size.w <= MAX_DIM && size.h <= MAX_DIM, `${f}: ≤1K (${size.w}x${size.h})`);
}

console.log('\n== Наборы ENV_TEXTURE_SETS → файлы на диске ==');
const sets = Object.entries(ENV_TEXTURE_SETS);
ok(sets.length >= 5, `≥5 наборов (${sets.length})`);
for (const [name, def] of sets) {
  ok(!!def.color, `${name}: есть albedo`);
  for (const [slot, rel] of Object.entries(def)) {
    const p = path.join(ROOT, rel);
    ok(fs.existsSync(p), `${name}.${slot}: ${rel} существует`);
  }
}
// У каждого набора хотя бы roughness или normal (PBR, не только albedo)
for (const [name, def] of sets) {
  ok(!!(def.roughness || def.normal), `${name}: есть roughness/normal карта`);
}

console.log(`\n== ИТОГ: ${passed} passed, ${failed} failed ==`);
process.exit(failed ? 1 : 0);
