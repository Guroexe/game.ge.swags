// ===== GEN.SWAGS Gyro Debug Overlay =====
// Полупрозрачный оверлей поверх игры/меню: статус разрешения и API,
// live alpha/beta/gamma, применяемые yaw/pitch, частота событий (Гц), FPS,
// кнопка калибровки. Открывается из настроек («ТЕСТ ГИРОСКОПА») или
// параметром URL ?gyrodebug=1 (тогда поверх игры постоянно).
const $ = (id) => document.getElementById(id);

const STATUS_RU = {
  'unsupported': 'НЕ ПОДДЕРЖИВАЕТСЯ',
  'motion-only': 'ТОЛЬКО MOTION',
  'need-permission': 'НУЖНО РАЗРЕШЕНИЕ iOS',
  'denied': 'ОТКАЗАНО',
  'perm-error': 'ОШИБКА РАЗРЕШЕНИЯ',
  'idle': 'ВЫКЛЮЧЕН',
  'waiting': 'ОЖИДАНИЕ ДАННЫХ…',
  'active': 'АКТИВЕН',
  'active-motion': 'АКТИВЕН (MOTION)',
  'no-data': 'НЕТ ДАННЫХ ДАТЧИКА',
};

export class GyroDebugOverlay {
  constructor(game) {
    this.game = game;
    this.isOpen = false;
    this._sticky = false;     // ?gyrodebug=1 — не закрывать кнопкой
    this._raf = 0;
    this._frames = 0;
    this._fps = 0;
    this._fpsT = 0;
    this._onFrame = (t) => this._frame(t);

    $('gd-cal')?.addEventListener('click', () => {
      this.game.input.gyro.calibrate();
      const b = $('gd-cal');
      if (b) { b.textContent = 'ОТКАЛИБРОВАНО ✓'; setTimeout(() => { b.textContent = 'КАЛИБРОВКА'; }, 1200); }
    });
    $('gd-close')?.addEventListener('click', () => { if (!this._sticky) this.close(); });
  }

  open(sticky = false) {
    this._sticky = this._sticky || sticky;
    this.isOpen = true;
    $('gyro-debug')?.classList.add('visible');
    const closeBtn = $('gd-close');
    if (closeBtn) closeBtn.style.display = this._sticky ? 'none' : '';
    if (!this._raf) {
      this._fpsT = performance.now();
      this._frames = 0;
      this._raf = requestAnimationFrame(this._onFrame);
    }
  }

  close() {
    this.isOpen = false;
    $('gyro-debug')?.classList.remove('visible');
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = 0; }
  }

  _frame(t) {
    if (!this.isOpen) { this._raf = 0; return; }
    this._raf = requestAnimationFrame(this._onFrame);
    // FPS по rAF оверлея (совпадает с игровым циклом рендера)
    this._frames++;
    if (t - this._fpsT >= 500) {
      this._fps = Math.round((this._frames * 1000) / (t - this._fpsT));
      this._frames = 0;
      this._fpsT = t;
    }
    this._render();
  }

  _render() {
    const g = this.game.input.gyro;
    const dbg = g.getDebug();
    const set = (id, txt) => { const el = $(id); if (el) el.textContent = txt; };
    const f1 = (v) => (v === null || v === undefined ? '—' : v.toFixed(1));

    set('gd-status', STATUS_RU[dbg.status] || dbg.status);
    const st = $('gd-status');
    if (st) st.className = `gd-val st-${dbg.status}`;
    set('gd-perm', dbg.permissionNeeded
      ? `iOS: ${dbg.permissionState.toUpperCase()}`
      : (dbg.available ? 'НЕ ТРЕБУЕТСЯ' : 'НЕТ API'));
    set('gd-source', dbg.source === 'fusion' ? `FUSION (motion+orientation${dbg.fusionErrDeg >= 0.05 ? `, ошибка ${dbg.fusionErrDeg.toFixed(1)}°` : ''})`
      : dbg.source === 'motion' ? 'DEVICEMOTION (fallback)'
      : dbg.source === 'orientation' ? 'DEVICEORIENTATION' : '—');
    set('gd-abg', `${f1(dbg.alpha)}° / ${f1(dbg.beta)}° / ${f1(dbg.gamma)}°`);
    set('gd-yawpitch', `${f1(dbg.yawDeg)}° / ${f1(dbg.pitchDeg)}°`);
    set('gd-hz', `${dbg.hz}`);
    // Латентность: мс от последнего события датчика до применения к камере
    set('gd-latency', `${(dbg.latencyMs || 0).toFixed(1)} мс`);
    set('gd-fps', `${this._fps}`);
    const gs = this.game.menu?.settings?.gyro || {};
    set('gd-flags', [
      dbg.calibrated ? 'КАЛИБРОВАН' : 'НЕ КАЛИБРОВАН',
      dbg.enabled ? 'ВКЛ' : 'ВЫКЛ',
      `ОТКЛИК ${Math.round((gs.response ?? 0.15) * 100)}%`,
      (gs.deadzone || 0) > 0 ? 'DEAD-ZONE' : null,
      gs.driftFix ? 'АНТИ-ДРЕЙФ' : null,
    ].filter(Boolean).join(' · '));
  }
}
