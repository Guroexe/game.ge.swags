// realguns.js — процедурные low-poly РЕАЛЬНЫЕ стволы (без бластеров):
// АК-47, УЗИ, SPAS-12, СВД, ПКМ, Магнум .44, AWP, РПГ-7, ГМ-94, огнемёт.
// Ствол смотрит в -Z, длина ~0.55м (viewmodel-масштаб). Именованные узлы:
//  - 'muzzle'   — Object3D на срезе ствола (вспышка)
//  - 'magazine' — магазин/барабан/баллон (перетаскивается в reload-анимацию)
// Материалы — canvas-текстуры: шлифованный оружейный металл, полимер,
// дерево, камуф, латунь (лениво; в node-тестах — без карты, чистый цвет).
import * as THREE from 'three';
import { flatMat } from './models.js';

let M_STEEL, M_DARK, M_POLY, M_WOOD, M_WOOD2, M_BRASS, M_GREEN;

function _tex(draw, rx = 2, ry = 2) {
  if (typeof document === 'undefined') return null; // node-тесты — без текстур
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  draw(ctx, 256);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const _rnd = (a, b) => a + Math.random() * (b - a);

// Шлифованный оружейный металл: тёмная основа + горизонтальная шлифовка + царапины
function _drawGunmetal(ctx, s, base = [58, 62, 70], amp = 26) {
  ctx.fillStyle = `rgb(${base[0]},${base[1]},${base[2]})`;
  ctx.fillRect(0, 0, s, s);
  for (let y = 0; y < s; y += 2) {
    const k = (Math.random() - 0.5) * amp;
    ctx.fillStyle = `rgba(${base[0] + k | 0},${base[1] + k | 0},${base[2] + k + 4 | 0},0.6)`;
    ctx.fillRect(0, y, s, 1);
  }
  for (let i = 0; i < 46; i++) { // царапины/потёртости
    const b = base[0] + _rnd(30, 90) | 0;
    ctx.strokeStyle = `rgba(${b},${b},${b + 8},${_rnd(0.05, 0.2)})`;
    ctx.lineWidth = _rnd(0.5, 1.4);
    const y = Math.random() * s, x = Math.random() * s, len = _rnd(8, 60);
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + len, y + _rnd(-3, 3)); ctx.stroke();
  }
  for (let i = 0; i < 10; i++) { // тёмные потёки
    ctx.fillStyle = `rgba(10,10,14,${_rnd(0.08, 0.2)})`;
    ctx.fillRect(Math.random() * s, Math.random() * s, _rnd(10, 60), _rnd(2, 6));
  }
}

// Мелкозернистый полимер/пластик
function _drawPolymer(ctx, s) {
  ctx.fillStyle = 'rgb(40,43,48)'; ctx.fillRect(0, 0, s, s);
  const img = ctx.getImageData(0, 0, s, s);
  for (let i = 0; i < img.data.length; i += 4) {
    const k = (Math.random() - 0.5) * 18;
    img.data[i] += k; img.data[i + 1] += k; img.data[i + 2] += k;
  }
  ctx.putImageData(img, 0, 0);
  for (let y = 0; y < s; y += 12) { // рёбра литья
    ctx.fillStyle = 'rgba(0,0,0,0.14)'; ctx.fillRect(0, y, s, 1);
  }
}

// Дерево (цевьё/приклад): вертикальные волокна двух тонов + сучки
function _drawWood(ctx, s) {
  ctx.fillStyle = 'rgb(104,66,32)'; ctx.fillRect(0, 0, s, s);
  for (let x = 0; x < s; x += 3) {
    const k = Math.sin(x * 0.11) * 14 + (Math.random() - 0.5) * 20;
    ctx.fillStyle = `rgba(${104 + k | 0},${66 + k * 0.7 | 0},${32 + k * 0.45 | 0},0.75)`;
    ctx.fillRect(x, 0, 2, s);
  }
  for (let i = 0; i < 26; i++) { // длинные волокна
    ctx.strokeStyle = `rgba(58,34,14,${_rnd(0.2, 0.5)})`;
    ctx.lineWidth = _rnd(0.6, 1.6);
    const x = Math.random() * s;
    ctx.beginPath(); ctx.moveTo(x, 0);
    ctx.bezierCurveTo(x + _rnd(-8, 8), s * 0.33, x + _rnd(-8, 8), s * 0.66, x + _rnd(-6, 6), s);
    ctx.stroke();
  }
  for (let i = 0; i < 4; i++) { // сучки
    const x = Math.random() * s, y = Math.random() * s;
    ctx.strokeStyle = 'rgba(46,26,10,0.6)';
    for (let r = 2; r < 9; r += 2) { ctx.beginPath(); ctx.ellipse(x, y, r * 1.6, r, 0.4, 0, Math.PI * 2); ctx.stroke(); }
  }
  ctx.fillStyle = 'rgba(150,104,56,0.12)'; ctx.fillRect(0, 0, s, s); // восковой блик
}

// Камуф (AWP/ПКМ/РПГ): олива + пятна
function _drawCamo(ctx, s) {
  ctx.fillStyle = 'rgb(66,76,60)'; ctx.fillRect(0, 0, s, s);
  const spots = [[44, 54, 40], [84, 92, 66], [34, 40, 30], [100, 98, 78], [58, 66, 48]];
  for (let i = 0; i < 22; i++) {
    const c = spots[i % spots.length];
    ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},0.85)`;
    const x = Math.random() * s, y = Math.random() * s, r = _rnd(12, 34);
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * _rnd(0.4, 0.8), _rnd(0, 3), 0, Math.PI * 2);
    ctx.fill();
  }
  for (let y = 0; y < s; y += 3) { // лёгкая шлифовка поверх
    ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.06})`; ctx.fillRect(0, y, s, 1);
  }
}

// Латунь (гильзы/патроны)
function _drawBrass(ctx, s) {
  _drawGunmetal(ctx, s, [168, 130, 58], 34);
  ctx.fillStyle = 'rgba(210,170,84,0.18)'; ctx.fillRect(0, 0, s, s);
}

function ensureMats() {
  if (M_STEEL) return;
  const tMetal = _tex((c, s) => _drawGunmetal(c, s));
  const tDark = _tex((c, s) => _drawGunmetal(c, s, [30, 32, 38], 18));
  const tPoly = _tex(_drawPolymer);
  const tWood = _tex(_drawWood);
  const tCamo = _tex(_drawCamo);
  const tBrass = _tex(_drawBrass);
  // Текстура несёт цвет → базовый цвет белый (map модулирует), без карты — старый тон
  M_STEEL = flatMat(tMetal ? 0xffffff : 0x2a2d33, { metal: 0.78, rough: 0.34, map: tMetal });
  M_DARK = flatMat(tDark ? 0xffffff : 0x14161a, { metal: 0.55, rough: 0.5, map: tDark });
  M_POLY = flatMat(tPoly ? 0xffffff : 0x1f2226, { metal: 0.1, rough: 0.9, map: tPoly });
  M_WOOD = flatMat(tWood ? 0xffffff : 0x503018, { metal: 0.05, rough: 0.85, map: tWood });
  M_WOOD2 = flatMat(tWood ? 0xd8c4a8 : 0x64401f, { metal: 0.05, rough: 0.8, map: tWood });
  M_BRASS = flatMat(tBrass ? 0xffffff : 0xb08a3e, { metal: 0.85, rough: 0.3, map: tBrass });
  M_GREEN = flatMat(tCamo ? 0xffffff : 0x3d4a38, { metal: 0.35, rough: 0.62, map: tCamo });
}

function box(w, h, d, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
}
function cyl(r1, r2, h, mat, x = 0, y = 0, z = 0, seg = 10) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h, seg), mat);
  m.rotation.x = Math.PI / 2; // ось вдоль Z
  m.position.set(x, y, z);
  return m;
}
function muzzleNode(z) {
  const o = new THREE.Object3D();
  o.name = 'muzzle';
  o.position.set(0, 0, z);
  return o;
}

export function createRealGun(kind = 'rifle') {
  ensureMats();
  const g = new THREE.Group();
  g.name = `realgun_${kind}`;
  let mag = null; // именуем в конце

  switch (kind) {
    // ---------------- АК-47 ----------------
    case 'rifle': {
      g.add(box(0.05, 0.075, 0.30, M_STEEL, 0, 0, 0.02));                 // ствольная коробка
      g.add(cyl(0.011, 0.011, 0.30, M_STEEL, 0, 0.012, -0.28));           // ствол
      g.add(cyl(0.016, 0.016, 0.055, M_DARK, 0, 0.012, -0.435));          // дульный тормоз
      g.add(box(0.052, 0.052, 0.17, M_WOOD, 0, 0.005, -0.20));            // цевьё дерево
      g.add(box(0.052, 0.05, 0.12, M_WOOD2, 0, -0.005, -0.085));          // накладка газоотвода
      g.add(cyl(0.007, 0.007, 0.13, M_STEEL, 0, 0.048, -0.095));          // газоотводная трубка
      g.add(box(0.045, 0.07, 0.20, M_WOOD, 0, -0.015, 0.24));             // приклад
      g.children[g.children.length - 1].rotation.x = 0.06;
      g.add(box(0.04, 0.11, 0.05, M_POLY, 0, -0.075, 0.10));              // пистолетная рукоять
      g.children[g.children.length - 1].rotation.x = 0.35;
      mag = box(0.038, 0.16, 0.062, M_STEEL, 0, -0.10, -0.02);            // рожок
      mag.rotation.x = -0.5;
      g.add(mag);
      g.add(box(0.006, 0.05, 0.01, M_STEEL, 0, 0.055, 0.045));            // мушка-целик
      g.add(box(0.008, 0.04, 0.008, M_STEEL, 0, 0.055, -0.40));           // мушка
      g.add(muzzleNode(-0.47));
      break;
    }
    // ---------------- УЗИ ----------------
    case 'smg': {
      g.add(box(0.052, 0.062, 0.26, M_STEEL, 0, 0, -0.02));               // корпус
      g.add(cyl(0.013, 0.013, 0.16, M_DARK, 0, 0.006, -0.20));            // ствол-гайка
      g.add(box(0.04, 0.14, 0.05, M_POLY, 0, -0.09, 0.02));               // рукоять (магазин внутри)
      g.children[g.children.length - 1].rotation.x = 0.12;
      mag = box(0.032, 0.13, 0.042, M_DARK, 0, -0.135, 0.02);             // магазин в рукояти
      mag.rotation.x = 0.12;
      g.add(mag);
      const stockF = box(0.008, 0.05, 0.20, M_STEEL, 0.028, -0.02, 0.13); // складной приклад (плечо)
      const stockR = box(0.008, 0.05, 0.20, M_STEEL, -0.028, -0.02, 0.13);
      stockF.rotation.x = -0.18; stockR.rotation.x = -0.18;
      g.add(stockF, stockR);
      g.add(box(0.05, 0.03, 0.05, M_DARK, 0, 0.042, 0.03));               // ручка взведения
      g.add(box(0.006, 0.035, 0.008, M_STEEL, 0, 0.05, -0.24));           // мушка
      g.add(muzzleNode(-0.29));
      break;
    }
    // ---------------- SPAS-12 ----------------
    case 'shotgun': {
      g.add(box(0.055, 0.08, 0.24, M_STEEL, 0, 0, 0.05));                 // ствольная коробка
      g.add(cyl(0.015, 0.015, 0.34, M_STEEL, 0, 0.018, -0.22));           // ствол
      g.add(cyl(0.013, 0.013, 0.30, M_DARK, 0, -0.022, -0.20));           // трубка магазина
      const pump = cyl(0.021, 0.021, 0.10, M_POLY, 0, -0.022, -0.26, 8);  // помпа
      pump.name = 'pump';
      g.add(pump);
      g.add(box(0.05, 0.075, 0.17, M_POLY, 0, -0.01, 0.235));             // приклад
      g.add(box(0.042, 0.10, 0.045, M_POLY, 0, -0.07, 0.10));             // рукоять
      g.children[g.children.length - 1].rotation.x = 0.3;
      g.add(box(0.008, 0.03, 0.01, M_STEEL, 0, 0.055, -0.36));            // мушка
      mag = cyl(0.013, 0.013, 0.05, M_BRASS, 0, -0.022, -0.06);           // патронник трубки (условно)
      g.add(mag);
      g.add(muzzleNode(-0.40));
      break;
    }
    // ---------------- СВД ----------------
    case 'dmr': {
      g.add(box(0.048, 0.07, 0.32, M_STEEL, 0, 0, 0.0));
      g.add(cyl(0.010, 0.010, 0.40, M_STEEL, 0, 0.01, -0.36));            // длинный ствол
      g.add(cyl(0.015, 0.015, 0.06, M_DARK, 0, 0.01, -0.545));            // пламегаситель
      g.add(box(0.05, 0.055, 0.20, M_WOOD, 0, -0.002, -0.245));           // цевьё
      g.add(box(0.046, 0.075, 0.19, M_WOOD, 0, -0.02, 0.235));            // приклад с отверстием
      g.children[g.children.length - 1].rotation.x = 0.05;
      g.add(box(0.04, 0.10, 0.046, M_POLY, 0, -0.072, 0.08));
      g.children[g.children.length - 1].rotation.x = 0.32;
      mag = box(0.034, 0.11, 0.055, M_STEEL, 0, -0.078, -0.04);
      mag.rotation.x = -0.25;
      g.add(mag);
      const scope = cyl(0.021, 0.021, 0.17, M_DARK, 0.0, 0.072, -0.02, 12); // ПСО-1
      g.add(scope);
      g.add(box(0.012, 0.035, 0.05, M_STEEL, 0, 0.038, -0.02));           // кронштейн
      g.add(muzzleNode(-0.58));
      break;
    }
    // ---------------- ПКМ ----------------
    case 'lmg': {
      g.add(box(0.062, 0.095, 0.34, M_STEEL, 0, 0, 0.02));
      g.add(cyl(0.014, 0.014, 0.36, M_STEEL, 0, 0.02, -0.32));
      g.add(cyl(0.022, 0.022, 0.07, M_DARK, 0, 0.02, -0.505));            // пламегаситель
      g.add(box(0.055, 0.06, 0.16, M_WOOD, 0, -0.005, -0.16));            // цевьё
      g.add(box(0.05, 0.09, 0.19, M_WOOD, 0, -0.025, 0.26));              // приклад
      g.children[g.children.length - 1].rotation.x = 0.07;
      g.add(box(0.042, 0.10, 0.05, M_POLY, 0, -0.085, 0.10));
      g.children[g.children.length - 1].rotation.x = 0.3;
      mag = box(0.075, 0.09, 0.11, M_GREEN, 0, -0.095, -0.03);            // короб-магазин ленты
      g.add(mag);
      const bipF = cyl(0.006, 0.006, 0.14, M_STEEL, 0.03, -0.075, -0.40, 6);
      bipF.rotation.set(Math.PI / 2 - 0.35, 0, 0.25);
      const bipR = bipF.clone(); bipR.position.x = -0.03; bipR.rotation.z = -0.25;
      g.add(bipF, bipR);                                                  // сошки
      g.add(box(0.006, 0.045, 0.01, M_STEEL, 0, 0.068, 0.06));
      g.add(muzzleNode(-0.545));
      break;
    }
    // ---------------- Магнум .44 ----------------
    case 'revolver': {
      g.add(box(0.045, 0.06, 0.16, M_STEEL, 0, 0.01, -0.02));             // рамка
      g.add(cyl(0.013, 0.013, 0.20, M_STEEL, 0, 0.02, -0.16));            // ствол
      g.add(box(0.02, 0.02, 0.20, M_STEEL, 0, -0.008, -0.15));            // штанга
      mag = new THREE.Group();                                            // барабан
      const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.045, 8), M_DARK);
      drum.rotation.x = Math.PI / 2;
      mag.add(drum);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const cart = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.048, 6), M_BRASS);
        cart.rotation.x = Math.PI / 2;
        cart.position.set(Math.cos(a) * 0.016, Math.sin(a) * 0.016, 0);
        mag.add(cart);
      }
      mag.position.set(0, 0.005, -0.01);
      g.add(mag);
      g.add(box(0.038, 0.085, 0.045, M_WOOD2, 0, -0.055, 0.055));         // рукоять дерево
      g.children[g.children.length - 1].rotation.x = 0.42;
      g.add(box(0.006, 0.028, 0.008, M_STEEL, 0, 0.048, -0.24));          // мушка
      g.add(muzzleNode(-0.265));
      break;
    }
    // ---------------- AWP ----------------
    case 'awp': {
      g.add(box(0.05, 0.07, 0.30, M_GREEN, 0, 0, 0.03));                  // шасси олива
      g.add(cyl(0.012, 0.012, 0.42, M_DARK, 0, 0.012, -0.34));            // тяжёлый ствол
      g.add(cyl(0.017, 0.017, 0.06, M_DARK, 0, 0.012, -0.56));            // дульный тормоз
      const scope = cyl(0.024, 0.026, 0.19, M_DARK, 0, 0.075, -0.05, 12); // большой прицел
      g.add(scope);
      g.add(box(0.014, 0.04, 0.06, M_GREEN, 0, 0.038, -0.05));
      mag = box(0.036, 0.085, 0.06, M_DARK, 0, -0.062, 0.0);
      g.add(mag);
      g.add(box(0.048, 0.08, 0.18, M_GREEN, 0, -0.03, 0.24));             // приклад
      g.children[g.children.length - 1].rotation.x = 0.08;
      g.add(box(0.04, 0.10, 0.045, M_GREEN, 0, -0.075, 0.09));
      g.children[g.children.length - 1].rotation.x = 0.3;
      const bolt = cyl(0.007, 0.007, 0.06, M_STEEL, 0.04, 0.02, 0.10, 6); // ручка затвора
      bolt.rotation.z = Math.PI / 2 - 0.5;
      g.add(bolt);
      const bipF = cyl(0.006, 0.006, 0.12, M_DARK, 0.028, -0.06, -0.46, 6);
      bipF.rotation.set(Math.PI / 2 - 0.4, 0, 0.3);
      const bipR = bipF.clone(); bipR.position.x = -0.028; bipR.rotation.z = -0.3;
      g.add(bipF, bipR);
      g.add(muzzleNode(-0.595));
      break;
    }
    // ---------------- РПГ-7 ----------------
    case 'rocket': {
      g.add(cyl(0.024, 0.024, 0.62, M_GREEN, 0, 0, -0.05, 12));           // труба
      g.add(cyl(0.055, 0.028, 0.10, M_GREEN, 0, 0, -0.40, 12));           // раструб
      g.add(box(0.05, 0.06, 0.10, M_WOOD, 0, -0.005, 0.10));              // накладки
      g.add(box(0.05, 0.06, 0.08, M_WOOD, 0, -0.005, -0.14));
      g.add(box(0.04, 0.09, 0.04, M_DARK, 0, -0.065, 0.06));              // рукоять
      g.children[g.children.length - 1].rotation.x = 0.3;
      g.add(box(0.04, 0.07, 0.04, M_DARK, 0, -0.055, -0.16));             // вторая рукоять
      g.add(box(0.01, 0.09, 0.02, M_STEEL, 0, 0.075, -0.02));             // мех. прицел
      mag = new THREE.Group();                                            // заряд с конусом БЧ
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.12, 10), M_GREEN);
      cone.rotation.x = -Math.PI / 2; cone.position.z = -0.06;
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.14, 8), M_BRASS);
      stem.rotation.x = Math.PI / 2; stem.position.z = 0.05;
      const fins = box(0.09, 0.002, 0.03, M_DARK, 0, 0, 0.10);
      const fins2 = box(0.002, 0.09, 0.03, M_DARK, 0, 0, 0.10);
      mag.add(cone, stem, fins, fins2);
      mag.position.set(0, 0, -0.46);
      g.add(mag);
      g.add(muzzleNode(-0.55));
      break;
    }
    // ---------------- ГМ-94 (гранатомёт) ----------------
    case 'gl': {
      g.add(box(0.058, 0.075, 0.28, M_DARK, 0, 0, 0.0));                  // корпус
      g.add(cyl(0.028, 0.028, 0.24, M_STEEL, 0, 0.008, -0.24, 12));       // ствол крупный
      mag = new THREE.Group();                                            // барабан на 4 гранаты
      const dr = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.042, 0.09, 8), M_STEEL);
      dr.rotation.x = Math.PI / 2;
      mag.add(dr);
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2;
        const gr = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.095, 8), M_GREEN);
        gr.rotation.x = Math.PI / 2;
        gr.position.set(Math.cos(a) * 0.027, Math.sin(a) * 0.027, 0);
        mag.add(gr);
      }
      mag.position.set(0, -0.01, -0.02);
      g.add(mag);
      g.add(box(0.05, 0.07, 0.15, M_POLY, 0, -0.02, 0.19));               // приклад
      g.add(box(0.042, 0.095, 0.045, M_POLY, 0, -0.07, 0.08));
      g.children[g.children.length - 1].rotation.x = 0.32;
      g.add(box(0.008, 0.04, 0.012, M_STEEL, 0, 0.058, -0.30));           // мушка
      g.add(muzzleNode(-0.37));
      break;
    }
    // ---------------- Огнемёт ----------------
    case 'flamer': {
      g.add(cyl(0.02, 0.02, 0.42, M_DARK, 0, 0.01, -0.12, 10));           // ствол-труба
      g.add(cyl(0.032, 0.024, 0.09, M_STEEL, 0, 0.01, -0.38, 10));        // насадок
      const pilot = new THREE.Mesh(
        new THREE.SphereGeometry(0.014, 8, 6),
        flatMat(0xff7722, { emissive: 0xff5500, ei: 2.4, noCache: true })
      );
      pilot.name = 'pilotFlame';
      pilot.position.set(0, 0.045, -0.40);                                // пилотный огонёк
      g.add(pilot);
      mag = new THREE.Group();                                            // баллон
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.048, 0.20, 12), M_GREEN);
      tank.rotation.x = Math.PI / 2;
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.048, 12, 8), M_STEEL);
      cap.position.z = 0.10;
      mag.add(tank, cap);
      mag.position.set(0, -0.075, 0.08);
      g.add(mag);
      const hosePts = [new THREE.Vector3(0, -0.03, 0.02), new THREE.Vector3(0.03, -0.02, -0.06), new THREE.Vector3(0, -0.005, -0.14)];
      const hose = new THREE.Mesh(
        new THREE.TubeGeometry(new THREE.CatmullRomCurve3(hosePts), 10, 0.007, 6, false),
        M_POLY
      );
      g.add(hose);                                                        // шланг
      g.add(box(0.04, 0.09, 0.04, M_POLY, 0, -0.06, -0.02));
      g.children[g.children.length - 1].rotation.x = 0.3;
      g.add(muzzleNode(-0.43));
      break;
    }
    default:
      return createRealGun('rifle');
  }

  if (mag) mag.name = 'magazine';
  g.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
  return g;
}
