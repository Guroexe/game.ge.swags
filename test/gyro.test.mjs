// ===== GEN.SWAGS — юнит-тесты гироскопа (Node, без браузера) =====
// Покрытие:
//  0) кватернионная математика gyro.js совпадает с three.js (независимая проверка)
//  1) калибровка → поворот на 90° → ожидаемый yaw камеры
//  2) invertX/invertY
//  3) настройка ОТКЛИК (response): 0 = мгновенно, больше = плавнее; сходимость
//  4) sens scaling (2× sens = 2× поворот)
//  5) alpha === null → честный статус no-data (не молчаливый ноль)
//  6) enable()×3 → ровно 1 listener; disable() → 0; повторное enable → 1
//  7) landscape: поворот вокруг мировой вертикали маппится в yaw независимо
//     от ориентации экрана (quaternion-подход)
//  8) ТАЧ + ГИРОСКОП ПАРАЛЛЕЛЬНО: дельты аддитивны, после отпускания — без рывка.
//     (Подавление тачем УДАЛЕНО по требованию — старый блок «suppress(250)»
//     заменён этим; API suppress()/suppressed больше не существует.)
//  9) dead-zone: по умолчанию ВЫКЛ (шум проходит), при включении гасит дрожание
// 10) анти-дрейф: долгое неподвижное удержание → ноль подтягивается (drift-back)
// 11) iOS permission: granted / denied / error, повторный запрос
// 12) devicemotion fallback: rotationRate интегрируется; выравнивание по гравитации
// 13) ФЬЮЖН: (а) латентность — rotationRate меняет выход В ТОМ ЖЕ тике;
//     (б) orientation-коррекция ограничивает дрейф интеграции;
// 14) без двойной обработки: событие обновляет состояние сразу, rAF только читает
// 15) переход motion→fusion: перекалибровка без рывка камеры
// Запуск: node test/gyro.test.mjs
import * as THREE from 'three';
import {
  GyroController, quatFromDeviceAngles, quatMul, quatConj, eulerYXZ, wrapPi,
  quatFromAngularVelocity, quatFromUnitVectors,
} from '../js/engine/gyro.js';

let passed = 0, failed = 0;
function ok(cond, name) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}`); }
}
const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

// ---------- Моки ----------
class MockTarget {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }
  removeEventListener(type, fn) {
    const a = this.listeners.get(type);
    if (a) { const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); }
  }
  listenerCount(type) { return (this.listeners.get(type) || []).length; }
  emit(type, ev) { for (const fn of [...(this.listeners.get(type) || [])]) fn(ev); }
}

let clock = 0;
const makeClock = () => { clock = 0; return () => clock; };

// Синтез alpha/beta/gamma через three.js (НЕ через gyro.js — честная проверка).
// base — кватернион позы калибровки; yawDeg/pitchDeg — мировой поворот от неё.
const deviceQuat = (a, b, g) =>
  new THREE.Quaternion().setFromEuler(new THREE.Euler(b * D2R, a * D2R, -g * D2R, 'YXZ'));
function synthABG(base, yawDeg = 0, pitchDeg = 0, rollDeg = 0) {
  const rot = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(pitchDeg * D2R, yawDeg * D2R, rollDeg * D2R, 'YXZ'));
  const q = rot.multiply(base.clone());
  const e = new THREE.Euler().setFromQuaternion(q, 'YXZ');
  return { alpha: e.y * R2D, beta: e.x * R2D, gamma: -e.z * R2D };
}
// Синтез для вращения вокруг оси ТЕЛА (body-frame): q = base ⊗ rot(axis, ang).
// Соответствует физике rotationRate (угловая скорость в СК устройства).
function synthABGbody(base, axis, angDeg) {
  const rot = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(...axis).normalize(), angDeg * D2R);
  const q = base.clone().multiply(rot);
  const e = new THREE.Euler().setFromQuaternion(q, 'YXZ');
  return { alpha: e.y * R2D, beta: e.x * R2D, gamma: -e.z * R2D };
}

// Моки sensor-классов (в Node их нет): orientation без requestPermission (не-iOS)
class MockDOE {}
class MockDME {}

function makeGyro(extraSettings = {}, opts = {}) {
  const target = new MockTarget();
  const now = makeClock();
  const gyro = new GyroController({
    target, now,
    DeviceOrientationEvent: MockDOE,
    DeviceMotionEvent: MockDME,
    settings: Object.assign({ enabled: true, sensX: 1, sensY: 1 }, extraSettings),
    ...opts,
  });
  return { gyro, target };
}

// Прогон применения: N кадров по dt, часы двигаются вместе
function applyFrames(gyro, look, frames, dt = 1 / 60) {
  for (let i = 0; i < frames; i++) { clock += dt * 1000; gyro.applyToCamera(look, dt); }
}

// Эмит orientation-событий: от позы base к мировому (yaw,pitch) за steps шагов
function emitSeq(target, base, yaw, pitch, steps = 10, dtMs = 16) {
  for (let i = 1; i <= steps; i++) {
    clock += dtMs;
    target.emit('deviceorientation', synthABG(base, (yaw * i) / steps, (pitch * i) / steps));
  }
}

// Эмит motion-события (rotationRate deg/s); по умолчанию с event.timeStamp
// (точный dt быстрого канала), без timeStamp — часы контроллера
function emitMotion(target, rr, dtMs = 16.7, { gravity = null, timeStamp = true } = {}) {
  clock += dtMs;
  const ev = { rotationRate: rr };
  if (timeStamp) ev.timeStamp = clock;
  if (gravity) ev.accelerationIncludingGravity = gravity;
  target.emit('devicemotion', ev);
}

// ============================
console.log('0) Кватернионная математика ≡ three.js');
{
  let maxErr = 0;
  let rngState = 42;
  const rnd = () => (rngState = (rngState * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = 0; i < 200; i++) {
    const a = rnd() * 360, b = rnd() * 360 - 180, g = rnd() * 360 - 180;
    const mine = quatFromDeviceAngles(a, b, g);
    const ref = deviceQuat(a, b, g);
    const dot = Math.abs(mine[0] * ref.x + mine[1] * ref.y + mine[2] * ref.z + mine[3] * ref.w);
    maxErr = Math.max(maxErr, 1 - Math.min(1, dot));
  }
  ok(maxErr < 1e-12, `quatFromDeviceAngles ≡ three.setFromEuler(YXZ) (err ${maxErr.toExponential(2)})`);

  // world-relative: q_rel = q1·q0^-1, извлечение yaw/pitch ≡ three
  let maxErr2 = 0;
  for (let i = 0; i < 200; i++) {
    const a0 = rnd() * 360, b0 = rnd() * 180 - 90, g0 = rnd() * 360 - 180;
    const wy = rnd() * 360 - 180, wp = rnd() * 90 - 45;
    const base = deviceQuat(a0, b0, g0);
    const abg = synthABG(base, wy, wp);
    const q0 = quatFromDeviceAngles(a0, b0, g0);
    const q1 = quatFromDeviceAngles(abg.alpha, abg.beta, abg.gamma);
    const { yaw, pitch } = eulerYXZ(quatMul(q1, quatConj(q0)));
    // three reference
    const q0t = deviceQuat(a0, b0, g0);
    const q1t = deviceQuat(abg.alpha, abg.beta, abg.gamma);
    const relT = q1t.multiply(q0t.invert());
    const eT = new THREE.Euler().setFromQuaternion(relT, 'YXZ');
    maxErr2 = Math.max(maxErr2, Math.abs(wrapPi(yaw - eT.y)), Math.abs(wrapPi(pitch - eT.x)));
  }
  ok(maxErr2 < 1e-9, `world-relative yaw/pitch ≡ three (err ${maxErr2.toExponential(2)})`);

  // quatFromAngularVelocity ≡ three.setFromAxisAngle
  let maxErr3 = 0;
  for (let i = 0; i < 200; i++) {
    const wx = rnd() * 4 - 2, wy = rnd() * 4 - 2, wz = rnd() * 4 - 2, dt = rnd() * 0.05;
    const mine = quatFromAngularVelocity(wx, wy, wz, dt);
    const len = Math.hypot(wx, wy, wz);
    const ref = len < 1e-9
      ? new THREE.Quaternion()
      : new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(wx, wy, wz).normalize(), len * dt);
    const dot = Math.abs(mine[0] * ref.x + mine[1] * ref.y + mine[2] * ref.z + mine[3] * ref.w);
    maxErr3 = Math.max(maxErr3, 1 - Math.min(1, dot));
  }
  ok(maxErr3 < 1e-12, `quatFromAngularVelocity ≡ three.setFromAxisAngle (err ${maxErr3.toExponential(2)})`);

  // quatFromUnitVectors ≡ three.setFromUnitVectors
  let maxErr4 = 0;
  for (let i = 0; i < 200; i++) {
    const v1 = new THREE.Vector3(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1).normalize();
    const v2 = new THREE.Vector3(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1).normalize();
    const mine = quatFromUnitVectors([v1.x, v1.y, v1.z], [v2.x, v2.y, v2.z]);
    const ref = new THREE.Quaternion().setFromUnitVectors(v1, v2);
    const dot = Math.abs(mine[0] * ref.x + mine[1] * ref.y + mine[2] * ref.z + mine[3] * ref.w);
    maxErr4 = Math.max(maxErr4, 1 - Math.min(1, dot));
  }
  ok(maxErr4 < 1e-9, `quatFromUnitVectors ≡ three.setFromUnitVectors (err ${maxErr4.toExponential(2)})`);
}

// ============================
console.log('1) Калибровка → поворот 90° → yaw камеры');
{
  const { gyro, target } = makeGyro();
  gyro.enable();
  const base = deviceQuat(0, 60, 0); // portrait, наклон 60°
  for (let i = 0; i < 5; i++) { clock += 16; target.emit('deviceorientation', synthABG(base)); }
  ok(gyro.active && gyro.calibrated, 'активен и откалиброван');
  ok(gyro.getStatus() === 'active', 'статус active');

  const look = { yaw: 0, pitch: 0 };
  emitSeq(target, base, 90, 0); // мировой yaw +90 (влево CCW, alpha растёт)
  applyFrames(gyro, look, 120);
  ok(Math.abs(look.yaw * R2D - 90) < 2, `yaw +90° → look.yaw = ${(look.yaw * R2D).toFixed(1)}° (ожид. +90)`);
  ok(Math.abs(look.pitch * R2D) < 1, `pitch не тронут (${(look.pitch * R2D).toFixed(2)}°)`);

  // И наклон: мировой pitch +20 → look.pitch +20
  const look2 = { yaw: look.yaw, pitch: 0 };
  emitSeq(target, base, 90, 20);
  applyFrames(gyro, look2, 120);
  ok(Math.abs(look2.pitch * R2D - 20) < 2, `pitch +20° → look.pitch = ${(look2.pitch * R2D).toFixed(1)}° (ожид. +20)`);
}

// ============================
console.log('2) Инверсия осей');
{
  const { gyro, target } = makeGyro({ invertX: true, invertY: true });
  gyro.enable();
  const base = deviceQuat(0, 60, 0);
  for (let i = 0; i < 5; i++) { clock += 16; target.emit('deviceorientation', synthABG(base)); }
  const look = { yaw: 0, pitch: 0 };
  emitSeq(target, base, 90, 20);
  applyFrames(gyro, look, 120);
  ok(Math.abs(look.yaw * R2D + 90) < 2, `invertX: look.yaw = ${(look.yaw * R2D).toFixed(1)}° (ожид. -90)`);
  ok(Math.abs(look.pitch * R2D + 20) < 2, `invertY: look.pitch = ${(look.pitch * R2D).toFixed(1)}° (ожид. -20)`);
}

// ============================
console.log('3) ОТКЛИК (response): 0 = мгновенно, больше = плавнее, сходимость');
{
  const run = (response, frames) => {
    const { gyro, target } = makeGyro({ response });
    gyro.enable();
    const base = deviceQuat(0, 60, 0);
    for (let i = 0; i < 5; i++) { clock += 16; target.emit('deviceorientation', synthABG(base)); }
    // мгновенный скачок на 90°
    clock += 16; target.emit('deviceorientation', synthABG(base, 90, 0));
    const look = { yaw: 0, pitch: 0 };
    applyFrames(gyro, look, frames);
    return look.yaw * R2D;
  };
  const instant1 = run(0, 1);
  ok(Math.abs(instant1 - 90) < 1e-9, `response=0 → ПОЛНЫЙ поворот за 1 кадр (${instant1.toFixed(2)}°)`);
  const fast2 = run(0.1, 2), slow2 = run(0.9, 2);
  ok(fast2 > slow2 + 20, `за 2 кадра response 0.1 (${fast2.toFixed(1)}°) намного быстрее, чем 0.9 (${slow2.toFixed(1)}°)`);
  const conv = run(0.15, 600); // 10 секунд — должно сойтись
  ok(Math.abs(conv - 90) < 1, `дефолт 0.15: после 10 с сходится к 90° (факт ${conv.toFixed(2)}°)`);
  const d15 = run(0.15, 1);
  ok(d15 > 0.8 * 90, `дефолт 0.15: уже за 1 кадр ≥80% поворота (${d15.toFixed(1)}°)`);
}

// ============================
console.log('4) Масштаб чувствительности');
{
  const run = (sensX) => {
    const { gyro, target } = makeGyro({ sensX });
    gyro.enable();
    const base = deviceQuat(0, 60, 0);
    for (let i = 0; i < 5; i++) { clock += 16; target.emit('deviceorientation', synthABG(base)); }
    emitSeq(target, base, 45, 0);
    const look = { yaw: 0, pitch: 0 };
    applyFrames(gyro, look, 300);
    return look.yaw * R2D;
  };
  const y1 = run(1), y2 = run(2);
  ok(Math.abs(y1 - 45) < 2 && Math.abs(y2 - 90) < 3,
    `sens 1 → ${y1.toFixed(1)}°, sens 2 → ${y2.toFixed(1)}° (2×)`);
}

// ============================
console.log('5) alpha === null → честный no-data');
{
  const { gyro, target } = makeGyro();
  gyro.enable();
  clock += 16;
  target.emit('deviceorientation', { alpha: null, beta: null, gamma: null });
  ok(!gyro.active, 'null-событие не активирует гироскоп');
  ok(gyro.getStatus() === 'no-data', `статус no-data (факт: ${gyro.getStatus()})`);
  const look = { yaw: 1, pitch: 1 };
  applyFrames(gyro, look, 10);
  ok(look.yaw === 1 && look.pitch === 1, 'камера не двигается при null-данных');
}

// ============================
console.log('6) Нет дубля listeners');
{
  const { gyro, target } = makeGyro();
  gyro.enable(); gyro.enable(); gyro.enable();
  ok(target.listenerCount('deviceorientation') === 1,
    `enable()×3 → 1 listener (факт: ${target.listenerCount('deviceorientation')})`);
  gyro.disable();
  ok(target.listenerCount('deviceorientation') === 0, 'disable() → 0 listeners');
  gyro.enable();
  ok(target.listenerCount('deviceorientation') === 1, 'повторное enable() → 1 listener');
}

// ============================
console.log('7) Landscape: мировой yaw не зависит от ориентации экрана');
{
  // Поза «устройство повернуто в landscape-left»: gamma=90
  const { gyro, target } = makeGyro();
  gyro.enable();
  const baseL = deviceQuat(0, 60, 90); // landscape-left хват
  for (let i = 0; i < 5; i++) { clock += 16; target.emit('deviceorientation', synthABG(baseL)); }
  const look = { yaw: 0, pitch: 0 };
  // Физический поворот вокруг мировой вертикали на +90 (сенсор при этом меняет
  // gamma/alpha вперемешку — синтез через three честно воспроизводит это)
  emitSeq(target, baseL, 90, 0);
  applyFrames(gyro, look, 120);
  ok(Math.abs(look.yaw * R2D - 90) < 2,
    `landscape: мировой yaw +90 → look.yaw ${(look.yaw * R2D).toFixed(1)}° (ожид. +90)`);
  ok(Math.abs(look.pitch * R2D) < 1.5, `landscape: pitch чист (${(look.pitch * R2D).toFixed(2)}°)`);
}

// ============================
console.log('8) ТАЧ + ГИРОСКОП ПАРАЛЛЕЛЬНО (подавление УДАЛЕНО по требованию)');
{
  ok(typeof GyroController.prototype.suppress === 'undefined',
    'API подавления (suppress/suppressed) удалён — гироскоп всегда параллелен тачу');
  const { gyro, target } = makeGyro({ response: 0 });
  gyro.enable();
  const base = deviceQuat(0, 60, 0);
  for (let i = 0; i < 5; i++) { clock += 16; target.emit('deviceorientation', synthABG(base)); }

  // Симулируем цикл player.update: тач-дельты пишутся в тот же look-аккумулятор
  const look = { yaw: 0, pitch: 0 };
  const touchStep = 2 * D2R;   // палец: +2°/кадр
  let touchTotal = 0;
  for (let i = 1; i <= 20; i++) {
    look.yaw += touchStep; touchTotal += touchStep;          // тач-обзор активен
    clock += 16;
    target.emit('deviceorientation', synthABG(base, 1.5 * i, 0)); // + гиро одновременно
    gyro.applyToCamera(look, 1 / 60);
  }
  const gyroContrib = (look.yaw - touchTotal) * R2D;
  ok(Math.abs(gyroContrib - 30) < 1.5,
    `во время тача гиро-дельты применяются ПОЛНОСТЬЮ (+30° → ${gyroContrib.toFixed(1)}°)`);
  ok(Math.abs(look.yaw * R2D - (40 + 30)) < 2,
    `сумма тач+гиро аддитивна (ожид. 70°, факт ${(look.yaw * R2D).toFixed(1)}°)`);

  // Отпускание пальца: гиро продолжается с текущей позы — без рывка/догона
  const yawAtRelease = look.yaw;
  let maxStep = 0, prev = look.yaw;
  for (let i = 21; i <= 40; i++) {
    clock += 16;
    target.emit('deviceorientation', synthABG(base, 1.5 * i, 0)); // та же скорость гиро
    gyro.applyToCamera(look, 1 / 60);
    maxStep = Math.max(maxStep, Math.abs(look.yaw - prev));
    prev = look.yaw;
  }
  ok(maxStep < 3 * D2R, `после отпускания нет рывка (макс. шаг ${(maxStep * R2D).toFixed(2)}° < 3°)`);
  const gyroAfter = (look.yaw - yawAtRelease) * R2D;
  ok(Math.abs(gyroAfter - 30) < 1.5,
    `гиро продолжает плавно (+30° за 20 кадров → ${gyroAfter.toFixed(1)}°)`);
  ok(Math.abs(look.yaw * R2D - (40 + 60)) < 2,
    `итог = тач 40° + гиро 60° (факт ${(look.yaw * R2D).toFixed(1)}°)`);
}

// ============================
console.log('9) Dead-zone: ВЫКЛ по умолчанию, включается для шумных датчиков');
{
  // По умолчанию deadzone = 0: микродрожание проходит (осцилляция видна)
  const { gyro: g0, target: t0 } = makeGyro({ response: 0 });
  g0.enable();
  const base = deviceQuat(0, 60, 0);
  ok(g0.settings.deadzone === 0, 'deadzone по умолчанию = 0 (выкл)');
  for (let i = 0; i < 5; i++) { clock += 16; t0.emit('deviceorientation', synthABG(base)); }
  const look0 = { yaw: 0, pitch: 0 };
  let maxDev0 = 0;
  for (let i = 0; i < 100; i++) {
    clock += 16;
    t0.emit('deviceorientation', synthABG(base, i % 2 ? 0.02 : -0.02, 0));
    g0.applyToCamera(look0, 1 / 60);
    maxDev0 = Math.max(maxDev0, Math.abs(look0.yaw * R2D));
  }
  ok(maxDev0 > 0.01, `deadzone=0: дрожание ±0.02° проходит (осцилляция ${maxDev0.toFixed(3)}°)`);

  // Включённый dead-zone гасит дрожание, но пропускает реальный поворот
  const { gyro, target } = makeGyro({ response: 0, deadzone: 0.03 * D2R });
  gyro.enable();
  for (let i = 0; i < 5; i++) { clock += 16; target.emit('deviceorientation', synthABG(base)); }
  const look = { yaw: 0, pitch: 0 };
  for (let i = 0; i < 100; i++) {
    clock += 16;
    target.emit('deviceorientation', synthABG(base, i % 2 ? 0.02 : -0.02, 0));
    gyro.applyToCamera(look, 1 / 60);
  }
  ok(Math.abs(look.yaw * R2D) < 0.005, `включённый dead-zone съедает дрожание (${(look.yaw * R2D).toFixed(3)}°)`);
  emitSeq(target, base, 30, 0);
  applyFrames(gyro, look, 200);
  ok(Math.abs(look.yaw * R2D - 30) < 2, `реальный поворот 30° проходит (${(look.yaw * R2D).toFixed(1)}°)`);
}

// ============================
console.log('10) Анти-дрейф (drift-back при неподвижном удержании)');
{
  const { gyro, target } = makeGyro({ driftFix: true });
  gyro.enable();
  const base = deviceQuat(0, 60, 0);
  for (let i = 0; i < 5; i++) { clock += 16; target.emit('deviceorientation', synthABG(base)); }
  // Смещение на 10° и держим неподвижно 12 секунд
  const look = { yaw: 0, pitch: 0 };
  clock += 16; target.emit('deviceorientation', synthABG(base, 10, 0));
  applyFrames(gyro, look, 30); // доезжаем до 10°
  const yawBeforeDrift = look.yaw * R2D;
  for (let s = 0; s < 12 * 60; s++) {
    clock += 16;
    target.emit('deviceorientation', synthABG(base, 10, 0)); // поза не меняется
    gyro.applyToCamera(look, 1 / 60);
  }
  ok(yawBeforeDrift > 8, `сначала доехали до ~10° (факт ${yawBeforeDrift.toFixed(1)}°)`);
  ok(Math.abs(look.yaw * R2D) < 1.5,
    `после 12 с неподвижности дрейф скомпенсирован (yaw ${(look.yaw * R2D).toFixed(2)}°)`);
  // Без driftFix — остаётся
  const { gyro: g2, target: t2 } = makeGyro({ driftFix: false });
  g2.enable();
  for (let i = 0; i < 5; i++) { clock += 16; t2.emit('deviceorientation', synthABG(base)); }
  const look2 = { yaw: 0, pitch: 0 };
  clock += 16; t2.emit('deviceorientation', synthABG(base, 10, 0));
  for (let s = 0; s < 8 * 60; s++) {
    clock += 16;
    t2.emit('deviceorientation', synthABG(base, 10, 0));
    g2.applyToCamera(look2, 1 / 60);
  }
  ok(Math.abs(look2.yaw * R2D - 10) < 2, `без анти-дрейфа смещение держится (${(look2.yaw * R2D).toFixed(1)}°)`);
}

// ============================
console.log('11) iOS permission: granted / denied / error / retry');
{
  // granted
  let mode = 'granted';
  class MockDOE { static requestPermission() { return Promise.resolve(mode); } }
  const mk = () => {
    const target = new MockTarget();
    const now = makeClock();
    const gyro = new GyroController({
      target, now, DeviceOrientationEvent: MockDOE,
      settings: { enabled: true },
    });
    return { gyro, target };
  };
  {
    const { gyro } = mk();
    ok(gyro.permissionNeeded, 'requestPermission обнаружен → permissionNeeded');
    ok(gyro.getStatus() === 'need-permission', 'статус need-permission до жеста');
    ok(!gyro.enable(), 'enable() без разрешения отклонён');
    const res = await gyro.requestPermission();
    ok(res === true && gyro.permissionState === 'granted', 'granted → true');
    ok(gyro.enabled, 'после granted контроллер включился (settings.enabled=true)');
  }
  {
    mode = 'denied';
    const { gyro } = mk();
    const res = await gyro.requestPermission();
    ok(res === false && gyro.getStatus() === 'denied', 'denied → false + статус denied');
    // Повторный запрос (пользователь передумал / включил в настройках Safari)
    mode = 'granted';
    const res2 = await gyro.requestPermission();
    ok(res2 === true && gyro.permissionState === 'granted', 'retry после denied → granted');
  }
  {
    class ThrowDOE { static requestPermission() { return Promise.reject(new Error('NotAllowedError')); } }
    const target = new MockTarget();
    const gyro = new GyroController({
      target, now: makeClock(), DeviceOrientationEvent: ThrowDOE, settings: { enabled: true },
    });
    const res = await gyro.requestPermission();
    ok(res === false && gyro.getStatus() === 'perm-error', 'throw → perm-error (не падаем)');
  }
}

// ============================
console.log('12) devicemotion fallback (rotationRate, без orientation API)');
{
  const target = new MockTarget();
  const now = makeClock();
  const gyro = new GyroController({
    target, now,
    DeviceOrientationEvent: undefined, // нет orientation API
    DeviceMotionEvent: class MockDME {},
    settings: { enabled: true, sensX: 1, sensY: 1 },
  });
  ok(gyro.motionAvailable && !gyro.available, 'только motion доступен');
  ok(gyro.getStatus() === 'motion-only' || gyro.getStatus() === 'idle' || gyro.getStatus() === 'waiting',
    `статус без orientation API (${gyro.getStatus()})`);
  gyro.enable();
  // portrait: rotationRate.gamma = вращение вокруг вертикали устройства = мировой yaw
  // (без гравитации в событии — допущение «устройство перед лицом», как раньше)
  for (let i = 0; i < 60; i++) { // 1 секунда @ 90°/с
    clock += 16.7;
    target.emit('devicemotion', { rotationRate: { alpha: 0, beta: 0, gamma: 90 } });
  }
  ok(gyro.source === 'motion' && gyro.active, 'fallback активен (source=motion)');
  ok(gyro.getStatus() === 'active-motion', `статус active-motion (факт: ${gyro.getStatus()})`);
  const look = { yaw: 0, pitch: 0 };
  applyFrames(gyro, look, 300);
  ok(Math.abs(look.yaw * R2D - 90) < 6, `rotationRate 90°/с × 1с → yaw ${(look.yaw * R2D).toFixed(1)}° (ожид. ~90)`);

  // Выравнивание по гравитации: устройство в landscape (мировая вертикаль = -X
  // устройства) — вращение вокруг device X маппится в мировой yaw, а не pitch
  const target2 = new MockTarget();
  const now2 = makeClock();
  const g2 = new GyroController({
    target: target2, now: now2,
    DeviceOrientationEvent: undefined,
    DeviceMotionEvent: class MockDME {},
    settings: { enabled: true, sensX: 1, sensY: 1, response: 0 },
  });
  g2.enable();
  for (let i = 0; i < 60; i++) {
    emitMotion(target2, { alpha: 0, beta: 90, gamma: 0 }, 16.7,
      { gravity: { x: 9.8, y: 0, z: 0 } });
  }
  const look2 = { yaw: 0, pitch: 0 };
  applyFrames(g2, look2, 60);
  ok(Math.abs(Math.abs(look2.yaw * R2D) - 90) < 8,
    `гравитация: ось device-X = вертикаль → yaw ${(look2.yaw * R2D).toFixed(1)}° (|ожид.| ~90)`);
  ok(Math.abs(look2.pitch * R2D) < 4, `гравитация: pitch чист (${(look2.pitch * R2D).toFixed(2)}°)`);
}

// ============================
console.log('13) ФЬЮЖН: латентность (тот же тик) + анти-дрейф коррекция');
{
  // --- (а) ЛАТЕНТНОСТЬ: событие rotationRate меняет выход В ТОМ ЖЕ тике ---
  const { gyro, target } = makeGyro({ response: 0 });
  gyro.enable();
  const base = deviceQuat(0, 60, 0);
  for (let i = 0; i < 5; i++) { clock += 16; target.emit('deviceorientation', synthABG(base)); }
  // Прайминг motion-канала (первое событие: dt=0, только метка времени)
  emitMotion(target, { alpha: 0, beta: 0, gamma: 0 });
  ok(gyro.source === 'fusion', `оба канала живы → source=fusion (факт: ${gyro.source})`);

  const look = { yaw: 0, pitch: 0 };
  gyro.applyToCamera(look, 1 / 60); // выровнять applied
  const rawBefore = gyro.getDebug().rawYawDeg;
  // Одно событие rotationRate: 90°/с вокруг device-Y за 10 мс = 0.9°
  emitMotion(target, { alpha: 0, beta: 0, gamma: 90 }, 10);
  const rawAfter = gyro.getDebug().rawYawDeg;
  ok(Math.abs(rawAfter - rawBefore) > 0.2,
    `обработчик обновил состояние СРАЗУ (Δraw ${(rawAfter - rawBefore).toFixed(3)}° ещё до кадра)`);
  // Ноль кадров задержки: ОДИН applyToCamera в том же тике применяет ВСЮ дельту
  const yawBefore = look.yaw;
  gyro.applyToCamera(look, 1 / 60);
  const applied = (look.yaw - yawBefore) * R2D;
  ok(Math.abs(applied - (rawAfter - rawBefore)) < 1e-9,
    `0 кадров задержки: дельта применена в том же тике полностью (${applied.toFixed(3)}°)`);
  ok(gyro.latencyMs === 0, `латентность событие→применение = ${gyro.latencyMs} мс`);

  // С дефолтным откликом (0.15) — ≥80% дельты в том же тике
  const { gyro: gD, target: tD } = makeGyro(); // response default 0.15
  gD.enable();
  for (let i = 0; i < 5; i++) { clock += 16; tD.emit('deviceorientation', synthABG(base)); }
  emitMotion(tD, { alpha: 0, beta: 0, gamma: 0 });
  const lookD = { yaw: 0, pitch: 0 };
  gD.applyToCamera(lookD, 1 / 60);
  const rawB2 = gD.getDebug().rawYawDeg;
  emitMotion(tD, { alpha: 0, beta: 0, gamma: 90 }, 10);
  const rawD = gD.getDebug().rawYawDeg - rawB2;
  const yawB2 = lookD.yaw;
  gD.applyToCamera(lookD, 1 / 60);
  const appliedD = (lookD.yaw - yawB2) * R2D;
  ok(appliedD >= 0.8 * rawD,
    `дефолтный отклик 0.15: ≥80% дельты в том же тике (${appliedD.toFixed(3)}° из ${rawD.toFixed(3)}°)`);

  // --- (б) Orientation-коррекция ограничивает дрейф интеграции ---
  // Правда: вращение 90°/с вокруг device-Y (body-frame). Гироскоп «врёт»: 94.5°/с (+5%).
  // Метрика — fusionErrDeg: угол между интегрированной оценкой и абсолютной позой.
  const runFusion = (extraSettings) => {
    const { gyro: gF, target: tF } = makeGyro(extraSettings);
    gF.enable();
    const b = deviceQuat(10, 25, -10); // малый наклон: device-Y ≈ мировая вертикаль
    clock += 16; tF.emit('deviceorientation', synthABGbody(b, [0, 1, 0], 0));
    emitMotion(tF, { alpha: 0, beta: 0, gamma: 0 }); // прайминг dt
    let t = 0;
    for (let s = 0; s < 180; s++) { // 4.5 секунды
      clock += 16.7; t += 16.7;
      tF.emit('deviceorientation', synthABGbody(b, [0, 1, 0], 90 * (t / 1000)));
      clock += 8.3; t += 8.3;
      tF.emit('devicemotion', { rotationRate: { alpha: 0, beta: 0, gamma: 94.5 }, timeStamp: clock });
    }
    return gF.getDebug().fusionErrDeg;
  };
  const errCorrected = runFusion({});
  ok(errCorrected < 4,
    `коррекция k=0.05: ошибка интеграции ограничена (${errCorrected.toFixed(2)}° < 4°, дрейф 4.5°/с)`);
  const errDrifted = runFusion({ fusionK: 0 });
  ok(errDrifted > 12,
    `без коррекции (k=0): дрейф накапливается (${errDrifted.toFixed(1)}° > 12° за 4.5 с)`);
}

// ============================
console.log('14) Без двойной обработки: событие → состояние сразу, rAF читает');
{
  const { gyro, target } = makeGyro({ response: 0 });
  gyro.enable();
  const base = deviceQuat(0, 60, 0);
  for (let i = 0; i < 5; i++) { clock += 16; target.emit('deviceorientation', synthABG(base)); }
  emitMotion(target, { alpha: 0, beta: 0, gamma: 0 });
  const look = { yaw: 0, pitch: 0 };
  gyro.applyToCamera(look, 1 / 60);
  // 5 событий подряд ДО кадра — суммируются в состоянии без промежуточных apply
  for (let i = 0; i < 5; i++) emitMotion(target, { alpha: 0, beta: 0, gamma: 90 }, 8);
  const rawDelta = gyro.getDebug().rawYawDeg;
  const y0 = look.yaw;
  gyro.applyToCamera(look, 1 / 60);
  const d1 = (look.yaw - y0) * R2D;
  ok(Math.abs(d1 - rawDelta) < 1e-9,
    `5 событий @8мс суммировались в один отклик кадра (${d1.toFixed(2)}°)`);
  const d2before = look.yaw;
  gyro.applyToCamera(look, 1 / 60); // повторный apply в том же тике — НЕ двойное применение
  ok(Math.abs(look.yaw - d2before) < 1e-12, 'повторный applyToCamera в том же тике = 0 (нет дубля)');
}

// ============================
console.log('15) Переход motion→fusion: перекалибровка без рывка камеры');
{
  const { gyro, target } = makeGyro({ response: 0 });
  gyro.enable();
  // Работаем только на motion (orientation молчит): yaw ~44°
  for (let i = 0; i < 60; i++) {
    clock += 16.7;
    target.emit('devicemotion', { rotationRate: { alpha: 0, beta: 0, gamma: 45 } });
  }
  ok(gyro.source === 'motion', 'пока orientation молчит — source=motion');
  ok(gyro.getStatus() === 'active-motion', `статус active-motion (факт: ${gyro.getStatus()})`);
  const look = { yaw: 0, pitch: 0 };
  applyFrames(gyro, look, 30);
  const yawAfterMotion = look.yaw * R2D;
  ok(yawAfterMotion > 30, `motion-интеграция дала yaw ${yawAfterMotion.toFixed(1)}°`);
  // Orientation оживает (пользователь дал разрешение / датчик проснулся)
  const pose = synthABG(deviceQuat(30, 45, 10));
  for (let i = 0; i < 3; i++) { clock += 16; target.emit('deviceorientation', pose); }
  ok(gyro.source === 'fusion', `ожил orientation → source=fusion (факт: ${gyro.source})`);
  applyFrames(gyro, look, 30);
  ok(Math.abs(look.yaw * R2D - yawAfterMotion) < 0.5,
    `переход без рывка камеры (Δ ${Math.abs(look.yaw * R2D - yawAfterMotion).toFixed(2)}°)`);
  // Новые повороты применяются с новой позы
  const y1 = look.yaw;
  for (let i = 0; i < 10; i++) {
    clock += 16.7;
    target.emit('devicemotion', { rotationRate: { alpha: 0, beta: 0, gamma: 45 } });
  }
  applyFrames(gyro, look, 10);
  ok((look.yaw - y1) * R2D > 3, `после перехода гиро работает (+${((look.yaw - y1) * R2D).toFixed(1)}°)`);
}

// ============================
console.log('');
console.log('ПРИМЕЧАНИЕ: тесты подавления тачем (бывший блок 8, suppress 250 мс)');
console.log('УДАЛЕНЫ по требованию: тач и гироскоп всегда работают параллельно.');
console.log('');
if (failed) { console.error(`GYRO UNIT: ${passed} passed, ${failed} FAILED`); process.exit(1); }
console.log(`GYRO UNIT: ALL ${passed} PASSED`);
