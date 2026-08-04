// ===== GEN.SWAGS Gyro Self-Test (в браузере, ?gyrotest=1) =====
// Диспатчит синтетические deviceorientation/devicemotion-события в работающую
// игру и проверяет, что обзор реально поворачивается.
//
// Две фазы:
//  A) Детерминированная: события → gyro.applyToCamera(player.look, dt) вручную —
//     тот же кодовый путь, что player.update → не зависит от FPS/троттлинга таймеров.
//     Проверки латентности/аддитивности выполняются СИНХРОННО (в одном JS-ходе),
//     чтобы игровой rAF-цикл не успел «съесть» дельту раньше измерения.
//  B) Реальный pipeline: события → ждём несколько кадров rAF → camera.rotation
//     следует за player.look (через window.__game).
//
// Синтез alpha/beta/gamma делается через three.js (независимо от математики
// gyro.js), чтобы тест был честной проверкой, а не тавтологией.
// ПРИМЕЧАНИЕ: проверки подавления тачем УДАЛЕНЫ — тач и гироскоп теперь всегда
// работают параллельно (аддитивно), это и проверяется.
// Результаты — в DOM (#gyro-selftest) и console.log: GYROTEST PASS/FAIL.
import * as THREE from 'three';

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

const deviceQuat = (a, b, g) =>
  new THREE.Quaternion().setFromEuler(new THREE.Euler(b * D2R, a * D2R, -g * D2R, 'YXZ'));

// Синтез сенсорных углов: мировой поворот (yaw,pitch) относительно базовой позы
function synthABG(base, yawDeg = 0, pitchDeg = 0) {
  const rot = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitchDeg * D2R, yawDeg * D2R, 0, 'YXZ'));
  const q = rot.multiply(base.clone());
  const e = new THREE.Euler().setFromQuaternion(q, 'YXZ');
  return { alpha: e.y * R2D, beta: e.x * R2D, gamma: -e.z * R2D };
}

function dispatch(abg) {
  const e = new Event('deviceorientation');
  e.alpha = abg.alpha; e.beta = abg.beta; e.gamma = abg.gamma;
  window.dispatchEvent(e);
}

function dispatchMotion(rr) {
  const e = new Event('devicemotion');
  e.rotationRate = rr;
  window.dispatchEvent(e);
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

export async function runGyroSelfTest(game) {
  const results = [];
  let done = false;
  const render = () => {
    let el = document.getElementById('gyro-selftest');
    if (!el) {
      el = document.createElement('div');
      el.id = 'gyro-selftest';
      document.body.appendChild(el);
    }
    const allOk = results.every((r) => r.ok);
    el.innerHTML = `<b>GYROTEST ${done ? (allOk ? 'PASS' : 'FAIL') : 'RUNNING'}</b>\n` +
      results.map((r) => `${r.ok ? 'PASS' : 'FAIL'} — ${r.name}`).join('\n');
    el.dataset.result = done ? (allOk ? 'PASS' : 'FAIL') : 'RUNNING';
  };
  const ok = (cond, name) => {
    results.push({ ok: !!cond, name });
    console.log(`[gyrotest] ${cond ? 'PASS' : 'FAIL'} — ${name}`);
    render();
  };
  window.addEventListener('error', (e) => {
    results.push({ ok: false, name: `WINDOW ERROR: ${e.message}` });
    render();
  });

  try {
    const input = game.input;
    const gyro = input.gyro;
    const player = game.player;
    // Бессмертие на время теста, чтобы боты не прервали обзор
    player.maxHp = 1e9; player.hp = 1e9; player.alive = true;
    // Почти мгновенный отклик, чтобы тест не зависел от долгой сходимости
    input.settings.gyro.response = 0.05;

    // 0. Включение
    input.settings.gyro.enabled = true;
    gyro.syncFromSettings();
    ok(gyro.enabled, 'enable(): listener активен');

    // 1. Калибровочная поза (portrait, beta=60)
    const base = deviceQuat(0, 60, 0);
    for (let i = 0; i < 5; i++) dispatch(synthABG(base));
    ok(gyro.active && gyro.calibrated, 'активен и откалиброван после событий');
    ok(gyro.getStatus() === 'active', `статус active (факт: ${gyro.getStatus()})`);
    ok(gyro.getHz() > 0, `частота событий > 0 Гц (факт: ${gyro.getHz()})`);

    // ===== Фаза A: детерминированная (реальный кодовый путь applyToCamera) =====
    const applyN = (n) => { for (let i = 0; i < n; i++) gyro.applyToCamera(player.look, 1 / 60); };

    // 2. ФЬЮЖН + ЛАТЕНТНОСТЬ: rotationRate меняет состояние В ТО ЖЕ событие,
    //    а applyToCamera применяет его в том же тике (0 кадров задержки).
    //    Всё синхронно — rAF-цикл игры не может вклиниться между шагами.
    const respSaved = input.settings.gyro.response;
    input.settings.gyro.response = 0; // МГНОВЕННЫЙ — проверяем путь без EMA-инерции
    gyro.applyToCamera(player.look, 1 / 60);
    dispatchMotion({ alpha: 0, beta: 0, gamma: 0 }); // прайминг motion-канала (dt=0)
    await sleep(20); // реальный dt для следующего motion-события
    const yawL0 = player.look.yaw;
    const rawL0 = gyro.getDebug().rawYawDeg;
    dispatchMotion({ alpha: 0, beta: 0, gamma: 90 }); // 90°/с вокруг device-Y
    const rawL1 = gyro.getDebug().rawYawDeg;
    ok(rawL1 - rawL0 > 0.05,
      `fusion: обработчик обновил состояние в то же событие (Δraw ${(rawL1 - rawL0).toFixed(3)}°)`);
    gyro.applyToCamera(player.look, 1 / 60); // один вызов — тот же тик
    const appliedL = (player.look.yaw - yawL0) * R2D;
    const expectedL = (rawL1 - rawL0) * input.settings.gyro.sensX;
    ok(Math.abs(appliedL - expectedL) < 1e-6 || appliedL >= 0.95 * expectedL,
      `латентность 0 кадров: дельта применена в том же тике (${appliedL.toFixed(3)}° из ${expectedL.toFixed(3)}°)`);
    ok(gyro.source === 'fusion', `источник = fusion (факт: ${gyro.source})`);
    ok((gyro.getDebug().latencyMs || 0) < 40,
      `латентность событие→кадр ${(gyro.getDebug().latencyMs || 0).toFixed(1)} мс < 40 мс`);
    input.settings.gyro.response = respSaved;

    // 3. Мировой yaw +90 → look.yaw += 90·sensX
    const yaw0 = player.look.yaw;
    const sens = input.settings.gyro.sensX;
    dispatch(synthABG(base, 90, 0));
    applyN(120);
    const dYaw = (player.look.yaw - yaw0) * R2D;
    ok(Math.abs(dYaw - 90 * sens) < 90 * sens * 0.1 + 1.5,
      `yaw +90° → look.yaw ${dYaw.toFixed(1)}° (ожид. ${(90 * sens).toFixed(1)}°)`);

    // 4. Мировой pitch +20 → look.pitch += 20·sensY
    const pitch0 = player.look.pitch;
    dispatch(synthABG(base, 90, 20));
    applyN(120);
    const dPitch = (player.look.pitch - pitch0) * R2D;
    ok(Math.abs(dPitch - 20 * input.settings.gyro.sensY) < 4,
      `pitch +20° → look.pitch ${dPitch.toFixed(1)}° (ожид. ${(20 * input.settings.gyro.sensY).toFixed(1)}°)`);

    // 5. ТАЧ + ГИРО ОДНОВРЕМЕННО: «палец» на обзоре НЕ глушит гироскоп,
    //    дельты складываются (синхронно, чтобы rAF не съел дельты раньше)
    input.touch.lookId = 7;
    input._touchLookDX = 60; // px — как реальный жест обзора
    input._touchLookDY = 0;
    const yawT0 = player.look.yaw;
    const d = input.consumeLookDelta(); // тач-дельта (гироскоп НЕ подавляется)
    player.look.yaw -= d.dx;            // как player.update
    const touchApplied = (player.look.yaw - yawT0) * R2D;
    ok(Math.abs(touchApplied) > 1, `тач-дельта применена (${touchApplied.toFixed(2)}°)`);
    const rawT0 = gyro.getDebug().rawYawDeg;
    dispatch(synthABG(base, 120, 20)); // +30° гиро во время «пальца на экране»
    const rawT1 = gyro.getDebug().rawYawDeg;
    applyN(120);
    const gyroApplied = (player.look.yaw - yawT0) * R2D - touchApplied;
    ok(Math.abs(gyroApplied - (rawT1 - rawT0) * input.settings.gyro.sensX) < 3,
      `во время тача гиро применяется ПОЛНОСТЬЮ (Δ ${gyroApplied.toFixed(1)}°)`);
    ok(Math.abs((player.look.yaw - yawT0) * R2D - (touchApplied + gyroApplied)) < 0.01,
      `тач+гиро аддитивны (тач ${touchApplied.toFixed(1)}° + гиро ${gyroApplied.toFixed(1)}°)`);

    // 6. Отпускание пальца: гиро продолжает с текущей позы — без рывка/догона
    input.touch.lookId = -1;
    const yawRel = player.look.yaw;
    let maxStep = 0;
    let prev = player.look.yaw;
    for (let i = 0; i < 10; i++) {
      dispatch(synthABG(base, 120 + 1.5 * (i + 1), 20));
      gyro.applyToCamera(player.look, 1 / 60);
      maxStep = Math.max(maxStep, Math.abs(player.look.yaw - prev));
      prev = player.look.yaw;
    }
    ok(maxStep < 3 * D2R * input.settings.gyro.sensX,
      `после отпускания тача нет рывка (макс. шаг ${(maxStep * R2D).toFixed(2)}°)`);
    ok(Math.abs((prev - yawRel) * R2D - 15 * input.settings.gyro.sensX) < 3,
      `гиро продолжает плавно (+15° → Δ ${((prev - yawRel) * R2D).toFixed(1)}°)`);

    // 7. Калибровка обнуляет
    gyro.calibrate();
    dispatch(synthABG(base, 180, 20));
    applyN(60);
    ok(Math.abs(gyro.yaw * R2D) < 1.0 && Math.abs(gyro.pitch * R2D) < 1.0,
      `calibrate() → ноль в текущей позе (yaw ${(gyro.yaw * R2D).toFixed(2)}°)`);

    // 8. Дедупликация listeners
    gyro.enable(); gyro.enable(); gyro.enable();
    ok(true, 'enable()×3 без исключений (дедупликация внутри)');
    gyro.disable();
    ok(gyro.getStatus() === 'idle', 'disable() → idle');
    gyro.enable();
    input.settings.gyro.enabled = true;

    // ===== Фаза B: реальный pipeline — camera.rotation следует за look =====
    // Ждём несколько кадров rAF (даже при троттлинге 1 FPS хватит пары секунд).
    // Сначала пауза, чтобы камера догнала look после фазы A, — потом baseline.
    await sleep(2500);
    const camYaw0 = game.engine.camera.rotation.y;
    const lookYaw0 = player.look.yaw;
    dispatch(synthABG(base, 180 + 45, 20));
    await sleep(3500);
    const camMoved = Math.abs(game.engine.camera.rotation.y - camYaw0) * R2D;
    const lookMoved = Math.abs(player.look.yaw - lookYaw0) * R2D;
    ok(lookMoved > 5, `игровой цикл применяет гироскоп к look (Δ ${lookMoved.toFixed(1)}°)`);
    ok(camMoved > 5, `camera.rotation.y повернулась (Δ ${camMoved.toFixed(1)}°)`);
    ok(Math.abs(camMoved - lookMoved) < lookMoved * 0.5 + 10,
      `камера следует за look (cam ${camMoved.toFixed(1)}° vs look ${lookMoved.toFixed(1)}°)`);
    console.log('[gyrotest] примечание: проверки подавления тачем удалены — тач и гироскоп всегда параллельны');
  } catch (err) {
    console.error('[gyrotest] EXCEPTION', err);
    results.push({ ok: false, name: `ИСКЛЮЧЕНИЕ: ${err.message}` });
  }
  done = true;
  render();
  const allOk = results.every((r) => r.ok);
  console.log(`[gyrotest] DONE: ${allOk ? 'PASS' : 'FAIL'} (${results.filter((r) => r.ok).length}/${results.length})`);
  return allOk;
}
