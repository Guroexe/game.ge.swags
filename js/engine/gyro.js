// ===== GEN.SWAGS GyroController =====
// Управление гироскопом для мобильного прицеливания.
//
// ===== АРХИТЕКТУРА: сенсорный фьюжн с приоритетом скорости =====
// Два канала сливаются в единую оценку позы _qEst (кватернион устройства):
//  * БЫСТРЫЙ: devicemotion.rotationRate (deg/s) — интегрируется в дельту
//    кватерниона КАЖДОЕ событие (dt по timestamp события). Это даёт отклик
//    в то же событие: обработчик сразу обновляет выходные yaw/pitch,
//    rAF (applyToCamera) только читает готовое состояние — 0 кадров задержки.
//  * МЕДЛЕННЫЙ: deviceorientation (абсолютная поза) — только анти-дрейф
//    коррекция интегрированной позы: комплиментарный фильтр с малым k
//    (FUSION_K=0.05), «подтягивания» не ощущается. Большая ошибка (>30°)
//    — мгновенный snap (первая поза, скачки сенсора).
// Если motion-канала нет — orientation становится первичным (прямое
// следование, как классический DeviceOrientationControls). Если нет
// orientation API вообще — fallback на чистую интеграцию rotationRate
// (с выравниванием мировой вертикали по гравитации, если она есть в событии).
//
// Конвенция интеграции проверена численно против three.js: rotationRate
// (beta→x, gamma→y, alpha→z) в body-frame, qEst ← qEst ⊗ dq(ω·dt), погрешность
// 0° за 5 с сложного движения @100 Гц (см. test/gyro.test.mjs, блок 12-13).
//
// Ключевые решения против известных iOS-ловушек:
// 1. ОРИЕНТАЦИЯ ЭКРАНА: оси alpha/beta/gamma меняют смысл в landscape.
//    Работаем через КВАТЕРНИОН устройства q(t) = EulerYXZ(beta, alpha, -gamma);
//    относительный поворот q_rel = qEst · q(t0)⁻¹ в МИРОВОМ пространстве
//    не зависит от screen.orientation.
// 2. alpha === null (десктоп/нет датчика) — честный статус 'no-data'.
// 3. iOS 13+ requestPermission — только из жеста пользователя.
// 4. ЛАТЕНТНОСТЬ: отклик по умолчанию почти сырой (EMA alpha≈0.87 @60 Гц).
//    Настройка response 0..1 (МГНОВЕННЫЙ↔ПЛАВНЫЙ), dead-zone по умолчанию 0.
// 5. ТАЧ + ГИРОСКОП ПАРАЛЛЕЛЬНО: никакого подавления — обе дельты аддитивно
//    суммируются в общий yaw/pitch аккумулятор (player.look). Палец не
//    сбрасывает калибровку, после отпускания — без рывков и «догона».
// 6. Анти-дрейф (опционально) работает ТОЛЬКО в покое — латентность не добавляет.
// 7. Защита от дубля listeners: enable() идемпотентен.
//
// Модуль не зависит от DOM/three — тестируется в Node (test/gyro.test.mjs).

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

// ---------- Минимальная кватернионная математика ----------
// quat — [x, y, z, w]

// Кватернион устройства из углов deviceorientation (градусы).
// Конвенция W3C (Z-X'-Y'' intrinsic) == three.js Euler(beta, alpha, -gamma, 'YXZ').
export function quatFromDeviceAngles(alphaDeg, betaDeg, gammaDeg) {
  const x = (betaDeg || 0) * D2R;   // beta
  const y = (alphaDeg || 0) * D2R;  // alpha
  const z = -(gammaDeg || 0) * D2R; // -gamma
  const c1 = Math.cos(x / 2), s1 = Math.sin(x / 2);
  const c2 = Math.cos(y / 2), s2 = Math.sin(y / 2);
  const c3 = Math.cos(z / 2), s3 = Math.sin(z / 2);
  // порядок 'YXZ'
  return [
    s1 * c2 * c3 + c1 * s2 * s3,
    c1 * s2 * c3 - s1 * c2 * s3,
    c1 * c2 * s3 - s1 * s2 * c3,
    c1 * c2 * c3 + s1 * s2 * s3,
  ];
}

export function quatMul(a, b) {
  const [ax, ay, az, aw] = a, [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

export function quatConj(q) { return [-q[0], -q[1], -q[2], q[3]]; }

export function quatNormalize(q) {
  const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}

// Нормализованная линейная интерполяция (для малых шагов коррекции достаточно)
export function quatNlerp(a, b, t) {
  // кратчайший путь
  const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const s = dot < 0 ? -1 : 1;
  return quatNormalize([
    a[0] + (b[0] * s - a[0]) * t,
    a[1] + (b[1] * s - a[1]) * t,
    a[2] + (b[2] * s - a[2]) * t,
    a[3] + (b[3] * s - a[3]) * t,
  ]);
}

// Дельта-кватернион из угловой скорости (rad/s, body-frame) за dt секунд.
// Конвенция верифицирована против three.js (см. шапку файла).
export function quatFromAngularVelocity(wx, wy, wz, dt) {
  const wlen = Math.hypot(wx, wy, wz);
  const angle = wlen * dt;
  if (angle < 1e-12) return [0, 0, 0, 1];
  const s = Math.sin(angle / 2) / wlen;
  return [wx * s, wy * s, wz * s, Math.cos(angle / 2)];
}

// Кратчайшая дуга, поворачивающая единичный вектор a в единичный вектор b
// (эквивалент three.js Quaternion.setFromUnitVectors).
export function quatFromUnitVectors(a, b) {
  let r = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + 1;
  let x, y, z;
  if (r < 1e-8) {
    // противоположные векторы: любая ортогональная ось
    r = 0;
    if (Math.abs(a[0]) > Math.abs(a[2])) { x = -a[1]; y = a[0]; z = 0; }
    else { x = 0; y = -a[2]; z = a[1]; }
  } else {
    x = a[1] * b[2] - a[2] * b[1];
    y = a[2] * b[0] - a[0] * b[2];
    z = a[0] * b[1] - a[1] * b[0];
  }
  return quatNormalize([x, y, z, r]);
}

// Извлечение углов Эйлера 'YXZ' из кватерниона.
// Возвращает { yaw: вокруг мировой Y, pitch: вокруг X, roll: вокруг Z } в радианах.
export function eulerYXZ(q) {
  const [x, y, z, w] = q;
  const m11 = 1 - 2 * (y * y + z * z), m12 = 2 * (x * y - w * z), m13 = 2 * (x * z + w * y);
  const m21 = 2 * (x * y + w * z), m22 = 1 - 2 * (x * x + z * z), m23 = 2 * (y * z - w * x);
  const m31 = 2 * (x * z - w * y), m33 = 1 - 2 * (x * x + y * y);
  const pitch = Math.asin(Math.max(-1, Math.min(1, -m23)));
  let yaw, roll;
  if (Math.abs(m23) < 0.9999999) {
    yaw = Math.atan2(m13, m33);
    roll = Math.atan2(m21, m22);
  } else {
    yaw = Math.atan2(-m31, m11);
    roll = 0;
  }
  return { yaw, pitch, roll };
}

// Обернуть угол в (-PI, PI]
export function wrapPi(a) {
  a = a % (2 * Math.PI);
  if (a > Math.PI) a -= 2 * Math.PI;
  if (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

// ---------- Статусы ----------
export const GyroStatus = {
  UNSUPPORTED: 'unsupported',       // нет ни orientation, ни motion API
  MOTION_ONLY: 'motion-only',       // нет orientation API, но есть motion
  NEED_PERMISSION: 'need-permission', // iOS 13+: нужен жест + requestPermission
  DENIED: 'denied',                 // пользователь отказал
  PERM_ERROR: 'perm-error',         // ошибка запроса разрешения
  IDLE: 'idle',                     // доступен, но выключен
  WAITING: 'waiting',               // включён, ждём первые данные
  ACTIVE: 'active',                 // идут реальные данные orientation
  ACTIVE_MOTION: 'active-motion',   // работаем на devicemotion (fallback)
  NO_DATA: 'no-data',               // события идут с null или не идут вовсе
};

const STILL_DELAY_MS = 2000;     // сколько неподвижности до анти-дрейфа
const DRIFT_RATE = 0.25;         // доля пути калибровки к текущей позе в секунду
const STILL_EPS = 0.03 * D2R;    // порог «неподвижно» между сэмплами
const MOTION_RATE_EPS = 0.2;     // шумовой порог rotationRate, град/с (покомпонентно)
const DATA_TIMEOUT_MS = 2000;    // нет данных столько — статус no-data
const FUSION_K = 0.05;           // комплиментарная коррекция к абсолютной позе (0.02..0.08)
const FUSION_SNAP = 30 * D2R;    // ошибка больше — snap к абсолютной позе (не плывём)
const MOTION_LIVE_MS = 700;      // motion-канал «жив», если события были в этом окне
const ORIENT_LIVE_MS = 1000;     // orientation-канал «жив»

export class GyroController {
  /**
   * @param {object} opts
   *  settings  — живой объект настроек { enabled, sensX, sensY, invertX, invertY,
   *              response (0=мгновенный..1=плавный), deadzone (rad, 0=выкл),
   *              driftFix (bool), fusionK (опц. переопределение FUSION_K) }
   *  target    — EventTarget для listeners (window в браузере, мок в тестах)
   *  now       — () => ms (инъекция часов для тестов)
   *  DeviceOrientationEvent / DeviceMotionEvent — инъекция классов (тесты)
   *  getScreenAngle — () => градусы ориентации экрана (legacy, не используется фьюжном)
   */
  constructor(opts = {}) {
    // ЖИВАЯ ссылка на настройки (меню меняет их через Object.assign) —
    // не копируем объект, только дополняем дефолтами отсутствующие ключи
    this.settings = opts.settings || {};
    const defs = {
      enabled: false, sensX: 1.6, sensY: 1.6,
      invertX: false, invertY: false, response: 0.15,
      deadzone: 0, driftFix: false,
    };
    for (const k in defs) if (this.settings[k] === undefined) this.settings[k] = defs[k];
    this._target = opts.target || (typeof window !== 'undefined' ? window : null);
    this._now = opts.now || (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
    const g = typeof globalThis !== 'undefined' ? globalThis : {};
    this._DOE = opts.DeviceOrientationEvent !== undefined ? opts.DeviceOrientationEvent : g.DeviceOrientationEvent;
    this._DME = opts.DeviceMotionEvent !== undefined ? opts.DeviceMotionEvent : g.DeviceMotionEvent;

    // --- Публичное состояние ---
    this.available = typeof this._DOE === 'function' || typeof this._DOE === 'object' && !!this._DOE;
    this.motionAvailable = typeof this._DME === 'function' || typeof this._DME === 'object' && !!this._DME;
    this.permissionNeeded = !!(this._DOE && typeof this._DOE.requestPermission === 'function');
    this.permissionState = this.permissionNeeded ? 'required' : 'not-required'; // granted/denied/error
    this.active = false;        // идут реальные данные и гироскоп участвует в обзоре
    this.calibrated = false;
    this.source = null;         // 'fusion' | 'orientation' | 'motion'
    this.latencyMs = 0;         // мс от последнего события до применения (диагностика)

    // --- Внутреннее состояние ---
    this._enabled = false;
    this._bound = false;
    this._qEst = null;          // оценка кватерниона устройства (фьюжн)
    this._qCalInv = null;       // conj(q(t0)) — нулевая поза
    this._orientSnapped = false;// первая абсолютная поза принята как есть
    this._rawYaw = 0;           // непрерывный мировой yaw от калибровки (rad)
    this._rawPitch = 0;
    this._prevYawAbs = null;    // для unwrap
    this._prevPitchAbs = null;
    this.yaw = 0;               // отклик (после EMA)
    this.pitch = 0;
    this._appliedYaw = 0;
    this._appliedPitch = 0;
    this._lastABG = null;       // последние реальные alpha/beta/gamma (deg)
    this._evTimes = [];         // timestamps реальных событий (для Гц)
    this._enableTs = 0;
    this._lastRealTs = 0;       // последнее НЕ-null orientation событие
    this._lastNullTs = 0;       // последнее null orientation событие
    this._lastMotionTs = 0;     // последнее motion событие (данные), по часам _now
    this._lastMotionClock = 0;  // timestamp предыдущего motion события (для dt интеграции)
    this._lastEventTs = 0;      // последнее событие, реально изменившее состояние
    this._lastMoveTs = 0;       // последнее заметное движение (анти-дрейф)
    this._fusionErr = 0;        // последняя ошибка фьюжн-коррекции (rad, диагностика)
    this._permError = '';

    this._onOrientation = (e) => this._handleOrientation(e);
    this._onMotion = (e) => this._handleMotion(e);
  }

  // ============================
  // Включение / выключение (идемпотентно — защита от дубля listeners)
  // ============================
  enable() {
    if (!this.available && !this.motionAvailable) return false;
    if (this.permissionNeeded && this.permissionState !== 'granted') return false;
    this._enabled = true;
    if (!this._bound && this._target) {
      if (this.available) this._target.addEventListener('deviceorientation', this._onOrientation);
      if (this.motionAvailable) this._target.addEventListener('devicemotion', this._onMotion);
      this._bound = true;
    }
    if (!this._enableTs) this._enableTs = this._now();
    return true;
  }

  disable() {
    this._enabled = false;
    this.active = false;
    if (this._bound && this._target) {
      this._target.removeEventListener('deviceorientation', this._onOrientation);
      this._target.removeEventListener('devicemotion', this._onMotion);
      this._bound = false;
    }
    this._enableTs = 0;
  }

  get enabled() { return this._enabled; }

  // Синхронизация с settings.enabled (меню настроек)
  syncFromSettings() {
    if (this.settings.enabled) return this.enable();
    this.disable();
    return true;
  }

  // ============================
  // iOS 13+ разрешение (ВЫЗЫВАТЬ ТОЛЬКО ИЗ ЖЕСТА ПОЛЬЗОВАТЕЛЯ)
  // Повторный вызов разрешён (retry после denied/error).
  // ============================
  async requestPermission() {
    if (!this.available && !this.motionAvailable) return false;
    let granted = true;
    // Orientation
    if (this._DOE && typeof this._DOE.requestPermission === 'function') {
      try {
        const res = await this._DOE.requestPermission();
        if (res === 'granted') {
          this.permissionState = 'granted';
        } else {
          this.permissionState = 'denied';
          granted = false;
        }
      } catch (err) {
        this.permissionState = 'error';
        this._permError = String(err && err.message || err);
        granted = false;
      }
    }
    // Motion (для фьюжна/fallback): запрашиваем тоже, отказ не блокирует orientation
    if (this._DME && typeof this._DME.requestPermission === 'function') {
      try { await this._DME.requestPermission(); } catch { /* не критично */ }
    }
    if (granted) {
      this.permissionState = this.permissionNeeded ? this.permissionState : 'granted';
      if (this.settings.enabled) this.enable();
      return true;
    }
    return false;
  }

  // ============================
  // Калибровка: нулевая поза = ТЕКУЩАЯ
  // ============================
  calibrate() {
    this._qCalInv = this._qEst ? quatConj(this._qEst) : null;
    this._zeroAccumulators();
    this.calibrated = true;
  }

  _zeroAccumulators() {
    this._rawYaw = 0; this._rawPitch = 0;
    this._prevYawAbs = null; this._prevPitchAbs = null;
    this.yaw = 0; this.pitch = 0;
    this._appliedYaw = 0; this._appliedPitch = 0;
  }

  // Первый сэмпл после включения/калибровки = нулевая поза
  _ensureCalibrated(now) {
    if (this._qCalInv || !this._qEst) return false;
    this._qCalInv = quatConj(this._qEst);
    this._zeroAccumulators();
    this.calibrated = true;
    this._lastMoveTs = now;
    return true;
  }

  // ============================
  // Обработчики событий
  // ============================
  _handleOrientation(e) {
    const now = this._now();
    if (e.alpha === null || e.alpha === undefined) {
      // Нет настоящего датчика (десктоп и т.п.) — НЕ молчаливый ноль, а статус
      this._lastNullTs = now;
      return;
    }
    this._lastRealTs = now;
    this._evTimes.push(now);
    if (this._evTimes.length > 240) this._evTimes.splice(0, this._evTimes.length - 240);
    this._lastABG = { alpha: e.alpha, beta: e.beta ?? 0, gamma: e.gamma ?? 0 };

    const q = quatFromDeviceAngles(e.alpha, e.beta ?? 0, e.gamma ?? 0);
    // Неподвижность меряем по СЫРОМУ сенсорному кватерниону (а не по оценке),
    // иначе анти-дрейф сам себя будил бы через коррекции оценки
    if (this._prevQOrient) {
      const dq = quatMul(q, quatConj(this._prevQOrient));
      const ang = 2 * Math.acos(Math.min(1, Math.abs(dq[3])));
      if (ang > STILL_EPS) this._lastMoveTs = now;
    }
    this._prevQOrient = q;

    const motionLive = this._lastMotionTs && now - this._lastMotionTs < MOTION_LIVE_MS;
    if (!this._qEst || !this._orientSnapped || !motionLive) {
      // Первая абсолютная поза, переход с motion-fallback или отсутствие
      // motion-канала → абсолютная поза принимается напрямую (минимальный лаг)
      this._qEst = q;
      this._orientSnapped = true;
    } else {
      // Фьюжн: абсолютная поза — только медленная анти-дрейф коррекция
      // интегрированной оценки (комплиментарный фильтр, малый k)
      const dq = quatMul(q, quatConj(this._qEst));
      const ang = 2 * Math.acos(Math.min(1, Math.abs(dq[3])));
      this._fusionErr = ang;
      if (ang > FUSION_SNAP) {
        this._qEst = q; // большой разнос (скачок сенсора) — не плывём, snap
      } else {
        const k = this.settings.fusionK ?? FUSION_K;
        this._qEst = quatNlerp(this._qEst, q, Math.max(0, Math.min(0.5, k)));
      }
    }

    this._updateSource(now);
    if (this._ensureCalibrated(now)) return;
    this._updateOutput(now);
  }

  // Быстрый канал: rotationRate (deg/s) интегрируется в дельту кватерниона
  // КАЖДОЕ событие — выходное состояние обновляется сразу, без ожидания кадра.
  _handleMotion(e) {
    const rr = e.rotationRate;
    if (!rr || rr.alpha === null || rr.alpha === undefined) return;
    const now = this._now();
    // dt по timestamp события (точный), fallback — инъецированные часы
    const ts = (typeof e.timeStamp === 'number' && e.timeStamp > 0) ? e.timeStamp : now;
    const dtRaw = this._lastMotionClock ? (ts - this._lastMotionClock) / 1000 : 0;
    const dt = Math.min(0.1, Math.max(0, dtRaw));
    this._lastMotionClock = ts;
    this._lastMotionTs = now;
    this._evTimes.push(now);
    if (this._evTimes.length > 240) this._evTimes.splice(0, this._evTimes.length - 240);

    if (!this._qEst) {
      // Нет orientation-канала: стартовая поза — выравнивание вертикали по
      // гравитации (если есть), иначе «устройство перед лицом» (identity)
      this._qEst = this._alignFromGravity(e) || [0, 0, 0, 1];
    }
    // Канал жив сразу по факту данных (даже при dt=0 — прайминг частоты)
    this._updateSource(now);
    this._ensureCalibrated(now);
    if (!dt) return;

    // Шумовой порог скоростей (покомпонентно) — не путать с dead-zone выхода
    let wx = (rr.beta ?? 0), wy = (rr.gamma ?? 0), wz = (rr.alpha ?? 0);
    if (Math.abs(wx) < MOTION_RATE_EPS) wx = 0;
    if (Math.abs(wy) < MOTION_RATE_EPS) wy = 0;
    if (Math.abs(wz) < MOTION_RATE_EPS) wz = 0;
    if (!wx && !wy && !wz) return;

    // Интеграция в body-frame: qEst ← qEst ⊗ dq(ω·dt)
    const dq = quatFromAngularVelocity(wx * D2R, wy * D2R, wz * D2R, dt);
    this._qEst = quatNormalize(quatMul(this._qEst, dq));
    const ang = Math.hypot(wx, wy, wz) * D2R * dt;
    if (ang > STILL_EPS) this._lastMoveTs = now;

    if (!this._qCalInv) return;
    this._updateOutput(now);
  }

  // Выравнивание референс-вертикали по гравитации (только motion-fallback):
  // кратчайшая дуга device-up → мировая Y, без дополнительного крена.
  _alignFromGravity(e) {
    const g = e.accelerationIncludingGravity;
    if (!g || g.x === null || g.x === undefined) return null;
    const len = Math.hypot(g.x, g.y ?? 0, g.z ?? 0);
    if (len < 1e-3) return null;
    const up = [-g.x / len, -(g.y ?? 0) / len, -(g.z ?? 0) / len]; // «вверх» против гравитации
    return quatFromUnitVectors(up, [0, 1, 0]);
  }

  // Источник данных: оба канала живы → fusion, иначе кто один жив
  _updateSource(now) {
    const o = this._lastRealTs && now - this._lastRealTs < ORIENT_LIVE_MS;
    const m = this._lastMotionTs && now - this._lastMotionTs < MOTION_LIVE_MS;
    const next = o && m ? 'fusion' : o ? 'orientation' : m ? 'motion' : this.source;
    if (this.source === 'motion' && next !== 'motion' && o) {
      // Переход motion-fallback → orientation/fusion: фрейм позы меняется,
      // перекалибруем ноль на текущую позу (без рывка), как и раньше
      this._qCalInv = null;
    }
    this.source = next;
  }

  // Общий выход: q_rel = qEst · qCalInv → непрерывные мировые yaw/pitch.
  // Вызывается ИЗ ОБРАБОТЧИКОВ событий — отклик в то же событие, не в след. кадр.
  _updateOutput(now) {
    const qRel = quatMul(this._qEst, this._qCalInv);
    const { yaw, pitch } = eulerYXZ(qRel);
    // unwrap для непрерывности
    if (this._prevYawAbs === null) {
      this._prevYawAbs = yaw; this._prevPitchAbs = pitch;
    }
    this._rawYaw += wrapPi(yaw - this._prevYawAbs);
    this._rawPitch += wrapPi(pitch - this._prevPitchAbs);
    this._prevYawAbs = yaw; this._prevPitchAbs = pitch;
    this._lastEventTs = now;
    this.active = true;
  }

  // Пересчёт raw из обновлённой калибровки (анти-дрейф)
  _recalcRaw() {
    const qRel = quatMul(this._qEst, this._qCalInv);
    const { yaw, pitch } = eulerYXZ(qRel);
    this._rawYaw = yaw; this._rawPitch = pitch;
    this._prevYawAbs = yaw; this._prevPitchAbs = pitch;
  }

  // ============================
  // Применение к контроллеру обзора { yaw, pitch } (радианы).
  // Семантика AR-окна: поворот устройства в мире поворачивает камеру так же.
  // Дельты АДДИТИВНЫ с тач-обзором: тот же аккумулятор, никакого подавления.
  // rAF только читает состояние, обновлённое обработчиками событий.
  // ============================
  applyToCamera(look, dt) {
    const s = this.settings;
    if (!s.enabled || !this._enabled || !this.active || !this.calibrated) return;
    const now = this._now();
    // Диагностика латентности: сколько мс прошло от последнего события,
    // изменившего состояние, до этого применения
    this.latencyMs = this._lastEventTs ? Math.max(0, now - this._lastEventTs) : 0;

    // Анти-дрейф: долго держим неподвижно — ноль медленно подтягивается к
    // текущей позе. Работает ТОЛЬКО в покое → латентность не добавляет.
    if (s.driftFix && this._qEst && this._qCalInv && now - this._lastMoveTs > STILL_DELAY_MS) {
      const k = Math.min(0.5, DRIFT_RATE * dt);
      this._qCalInv = quatNlerp(this._qCalInv, quatConj(this._qEst), k);
      this._recalcRaw();
    }

    // Отклик: response 0 (МГНОВЕННЫЙ) → сырой выход, 1 (ПЛАВНЫЙ) → сильный EMA.
    // EMA с опорной alpha при 60 Гц: alpha60 = 1 - 0.85·response
    // (дефолт 0.15 → alpha≈0.87 — «почти сырой»), frame-rate independent.
    const r = Math.max(0, Math.min(1, s.response ?? 0.15));
    const alpha60 = 1 - 0.85 * r;
    const k = 1 - Math.pow(1 - alpha60, Math.min(0.1, Math.max(0, dt)) * 60);
    this.yaw += (this._rawYaw - this.yaw) * k;
    this.pitch += (this._rawPitch - this.pitch) * k;

    // Dead-zone против шума (по умолчанию ВЫКЛ, включается в настройках):
    // дельта меньше порога НЕ проглатывается, а накапливается (не трогаем
    // _applied*) — медленные реальные повороты и компенсация анти-дрейфа
    // проходят, а знакопеременный шум гасится.
    const dz = Math.max(0, s.deadzone || 0);
    let dYaw = (this.yaw - this._appliedYaw) * s.sensX * (s.invertX ? -1 : 1);
    if (Math.abs(dYaw) >= dz) {
      look.yaw += dYaw;
      this._appliedYaw = this.yaw;
    }
    let dPitch = (this.pitch - this._appliedPitch) * s.sensY * (s.invertY ? -1 : 1);
    if (Math.abs(dPitch) >= dz) {
      look.pitch += dPitch;
      this._appliedPitch = this.pitch;
    }
  }

  // ============================
  // Статус и диагностика
  // ============================
  getStatus(now = this._now()) {
    if (!this.available) {
      if (!this.motionAvailable) return GyroStatus.UNSUPPORTED;
      // Только motion: тоже честно показываем активность fallback'а
      if (this._enabled) {
        if (this._lastMotionTs && now - this._lastMotionTs < DATA_TIMEOUT_MS) return GyroStatus.ACTIVE_MOTION;
        if (this._enableTs && now - this._enableTs > DATA_TIMEOUT_MS) return GyroStatus.NO_DATA;
        return GyroStatus.WAITING;
      }
      return GyroStatus.MOTION_ONLY;
    }
    if (this.permissionNeeded && this.permissionState === 'denied') return GyroStatus.DENIED;
    if (this.permissionNeeded && this.permissionState === 'error') return GyroStatus.PERM_ERROR;
    if (this.permissionNeeded && this.permissionState !== 'granted') return GyroStatus.NEED_PERMISSION;
    if (!this._enabled) return GyroStatus.IDLE;
    if (this._lastRealTs && now - this._lastRealTs < DATA_TIMEOUT_MS) return GyroStatus.ACTIVE;
    if (this._lastMotionTs && now - this._lastMotionTs < DATA_TIMEOUT_MS) return GyroStatus.ACTIVE_MOTION;
    // События идут, но все null — датчика нет / настольный браузер
    if (this._lastNullTs) return GyroStatus.NO_DATA;
    // Вообще ничего не пришло за разумное время
    if (this._enableTs && now - this._enableTs > DATA_TIMEOUT_MS) return GyroStatus.NO_DATA;
    return GyroStatus.WAITING;
  }

  // Частота реальных событий, Гц
  getHz(now = this._now()) {
    const cutoff = now - 1000;
    let n = 0;
    for (let i = this._evTimes.length - 1; i >= 0; i--) {
      if (this._evTimes[i] >= cutoff) n++;
      else break;
    }
    return n;
  }

  getDebug(now = this._now()) {
    return {
      status: this.getStatus(now),
      available: this.available,
      motionAvailable: this.motionAvailable,
      permissionNeeded: this.permissionNeeded,
      permissionState: this.permissionState,
      permError: this._permError,
      enabled: this._enabled,
      active: this.active,
      calibrated: this.calibrated,
      source: this.source,          // 'fusion' | 'orientation' | 'motion'
      latencyMs: this.latencyMs,    // мс от последнего события до применения
      fusionErrDeg: this._fusionErr * R2D,
      hz: this.getHz(now),
      alpha: this._lastABG ? this._lastABG.alpha : null,
      beta: this._lastABG ? this._lastABG.beta : null,
      gamma: this._lastABG ? this._lastABG.gamma : null,
      yawDeg: this.yaw * R2D,
      pitchDeg: this.pitch * R2D,
      rawYawDeg: this._rawYaw * R2D,
      rawPitchDeg: this._rawPitch * R2D,
    };
  }
}
