// ===== GEN.SWAGS Unified Input =====
// Клавиатура/мышь + Pointer Lock, тач-стики, гироскоп (GyroController: сенсорный
// фьюжн rotationRate+orientation, iOS permission, отклик EMA, dead-zone по запросу,
// анти-дрейф в покое). Тач-обзор и гироскоп работают ПАРАЛЛЕЛЬНО (дельты аддитивны).
import { GyroController } from './gyro.js';
import { applyTouchLayout } from '../game/touchlayout.js';

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = Object.create(null);       // code -> bool
    this.mouse = { dx: 0, dy: 0, buttons: 0, wheel: 0 };
    this.pointerLocked = false;

    // Мобильность: touch + userAgent
    const ua = navigator.userAgent || '';
    this.isMobile = ('ontouchstart' in window || navigator.maxTouchPoints > 0) &&
      /Android|iPhone|iPad|iPod|Mobile|webOS/i.test(ua);
    this.isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

    this.settings = {
      sensX: 0.0022, sensY: 0.0022, invertY: false,
      stickFloat: false, // плавающий стик: левая половина = центр стика
      gyro: {
        enabled: false, sensX: 1.6, sensY: 1.6,
        invertX: false, invertY: false, response: 0.15,
        deadzone: 0, driftFix: false,
      },
    };


    // Тач-состояние
    this.touch = {
      moveX: 0, moveY: 0,        // -1..1 со стика
      lookId: -1, lookLastX: 0, lookLastY: 0,
      moveId: -1,
      fire: false, fireId: -1, fireLastX: 0, fireLastY: 0,
      jump: false, dash: false, reload: false, weapon: false,
      shock: false, grapple: false, nade: false, pause: false,
      ads: false, // ADS — переключатель (тап), не hold
    };

    // Гироскоп — полноценный контроллер (см. gyro.js)
    this.gyro = new GyroController({ settings: this.settings.gyro });

    this._bindKeyboard();
    this._bindMouse();
    if (this.isTouch) this._bindTouch();
    // Если гироскоп включён в сохранённых настройках и разрешение не нужно — слушаем сразу
    if (this.settings.gyro.enabled) this.gyro.syncFromSettings();
  }

  // ---------- Клавиатура ----------
  _bindKeyboard() {
    window.addEventListener('keydown', (e) => {
      // Печатаем в чате/полях меню — игровой ввод не трогаем
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.repeat) return;
      this.keys[e.code] = true;
      if (['Space', 'Tab', 'KeyQ'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => {
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      this.keys[e.code] = false;
    });
    window.addEventListener('blur', () => { this.keys = Object.create(null); this.mouse.buttons = 0; });
  }

  // ---------- Мышь ----------
  _bindMouse() {
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.canvas;
    });
    this.canvas.addEventListener('mousemove', (e) => {
      if (!this.pointerLocked) return;
      this.mouse.dx += e.movementX;
      this.mouse.dy += e.movementY;
    });
    this.canvas.addEventListener('mousedown', (e) => {
      this.mouse.buttons |= (1 << e.button);
    });
    window.addEventListener('mouseup', (e) => {
      this.mouse.buttons &= ~(1 << e.button);
    });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('wheel', (e) => { this.mouse.wheel += Math.sign(e.deltaY); }, { passive: true });
  }

  requestPointerLock() {
    if (!this.isTouch && document.pointerLockElement !== this.canvas) {
      this.canvas.requestPointerLock?.();
    }
  }
  exitPointerLock() { document.exitPointerLock?.(); }

  // Считать и обнулить дельту мыши/тач-обзора (применяет чувствительность)
  consumeLookDelta() {
    let dx = this.mouse.dx * this.settings.sensX;
    let dy = this.mouse.dy * this.settings.sensY;
    this.mouse.dx = 0; this.mouse.dy = 0;
    const hadTouchLook = !!(this._touchLookDX || this._touchLookDY);
    if (hadTouchLook) {
      dx += (this._touchLookDX || 0) * this.settings.sensX * 2.2;
      dy += (this._touchLookDY || 0) * this.settings.sensY * 2.2;
      this._touchLookDX = 0; this._touchLookDY = 0;
    }
    // Гироскоп НЕ подавляется: его дельты аддитивно суммируются с тач-дельтами
    // в общий аккумулятор look.yaw/look.pitch (см. player.update).
    if (this.settings.invertY) dy = -dy;
    return { dx, dy };
  }

  // Ось движения: клавиатура + стик. x — стрейф (право+), z — вперёд+
  getMoveAxes() {
    let x = 0, z = 0;
    if (this.keys['KeyW'] || this.keys['ArrowUp']) z += 1;
    if (this.keys['KeyS'] || this.keys['ArrowDown']) z -= 1;
    if (this.keys['KeyA'] || this.keys['ArrowLeft']) x -= 1;
    if (this.keys['KeyD'] || this.keys['ArrowRight']) x += 1;
    x += this.touch.moveX; z -= this.touch.moveY;
    const len = Math.hypot(x, z);
    if (len > 1) { x /= len; z /= len; }
    return { x, z };
  }

  isDown(code) { return !!this.keys[code]; }
  get firing() { return !!(this.mouse.buttons & 1) || this.touch.fire; }
  get aiming() { return !!(this.mouse.buttons & 2) || !!this.touch.ads; }

  // ---------- Тач ----------
  _bindTouch() {
    const ui = document.getElementById('touch-ui');
    if (ui) ui.classList.add('visible');
    const stick = document.getElementById('stick-move');
    const knob = stick?.querySelector('.stick-knob');

    // Левый стик — движение.
    // Режимы: ФИКС (стик на месте, слушает только сам стик) и ПЛАВАЮЩИЙ
    // (палец касается любой точки левой половины — стик перепрыгивает туда).
    this._stickHome = null;  // {left, top} исходной позиции (для возврата)
    if (stick) {
      stick.addEventListener('touchstart', (e) => {
        const t = e.changedTouches[0];
        this.touch.moveId = t.identifier;
        e.preventDefault();
      }, { passive: false });

      // Плавающий стик: touchstart на левой половине экрана (не по кнопке/стику)
      window.addEventListener('touchstart', (e) => {
        if (!this.settings.stickFloat || this.touch.moveId !== -1) return;
        for (const t of e.changedTouches) {
          if (t.clientX > window.innerWidth * 0.45) continue; // только левая половина
          const el = document.elementFromPoint(t.clientX, t.clientY);
          if (el && (el.closest('button') || el.closest('.touch-btn') || el.closest('#stick-move'))) continue;
          // Запоминаем дом и переносим стик под палец
          if (!this._stickHome) {
            this._stickHome = { left: stick.style.left, top: stick.style.top, right: stick.style.right, bottom: stick.style.bottom };
          }
          const r = stick.getBoundingClientRect();
          const halfW = r.width / 2, halfH = r.height / 2;
          stick.style.left = `${t.clientX - halfW}px`;
          stick.style.top = `${t.clientY - halfH}px`;
          stick.style.right = 'auto'; stick.style.bottom = 'auto';
          this.touch.moveId = t.identifier;
          e.preventDefault();
          break;
        }
      }, { passive: false, capture: true });
    }


    const onMove = (e) => {
      let handled = false;
      for (const t of e.changedTouches) {
        if (t.identifier === this.touch.moveId && stick) {
          const r = stick.getBoundingClientRect();
          const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
          let dx = (t.clientX - cx) / (r.width / 2);
          let dy = (t.clientY - cy) / (r.height / 2);
          const len = Math.hypot(dx, dy);
          if (len > 1) { dx /= len; dy /= len; }
          this.touch.moveX = dx; this.touch.moveY = dy;
          if (knob) { knob.style.left = `${45 + dx * 40}px`; knob.style.top = `${45 + dy * 40}px`; }
          handled = true;
        } else if (t.identifier === this.touch.lookId) {
          this._touchLookDX = (this._touchLookDX || 0) + (t.clientX - this.touch.lookLastX);
          this._touchLookDY = (this._touchLookDY || 0) + (t.clientY - this.touch.lookLastY);
          this.touch.lookLastX = t.clientX; this.touch.lookLastY = t.clientY;
          handled = true;
        } else if (t.identifier === this.touch.fireId) {
          // Драг по зажатой кнопке огня крутит камеру (прицеливание на ходу)
          this._touchLookDX = (this._touchLookDX || 0) + (t.clientX - (this.touch.fireLastX ?? t.clientX));
          this._touchLookDY = (this._touchLookDY || 0) + (t.clientY - (this.touch.fireLastY ?? t.clientY));
          this.touch.fireLastX = t.clientX; this.touch.fireLastY = t.clientY;
          handled = true;
        }
      }
      // ВАЖНО: preventDefault ТОЛЬКО для игровых жестов (стик/обзор).
      // Безусловный preventDefault на window блокировал скролл меню/настроек.
      if (handled && e.cancelable) e.preventDefault();
    };
    const onEnd = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === this.touch.moveId) {
          this.touch.moveId = -1; this.touch.moveX = 0; this.touch.moveY = 0;
          if (knob) { knob.style.left = '45px'; knob.style.top = '45px'; }
          // Плавающий стик: возвращаем на исходную позицию
          if (this._stickHome && stick) {
            stick.style.left = this._stickHome.left;
            stick.style.top = this._stickHome.top;
            stick.style.right = this._stickHome.right;
            stick.style.bottom = this._stickHome.bottom;
            this._stickHome = null;
          }
        }
        if (t.identifier === this.touch.lookId) this.touch.lookId = -1;
      }
    };

    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onEnd);
    window.addEventListener('touchcancel', onEnd);

    // Правая половина экрана — обзор (кроме кнопок)
    this.canvas.addEventListener('touchstart', (e) => {
      for (const t of e.changedTouches) {
        if (t.clientX > window.innerWidth * 0.4 && this.touch.lookId === -1) {
          this.touch.lookId = t.identifier;
          this.touch.lookLastX = t.clientX; this.touch.lookLastY = t.clientY;
        }
      }
    }, { passive: true });

    // Кнопки
    const bindBtn = (id, prop) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('touchstart', (e) => { this.touch[prop] = true; e.preventDefault(); e.stopPropagation(); }, { passive: false });
      el.addEventListener('touchend', (e) => { this.touch[prop] = false; e.preventDefault(); }, { passive: false });
    };
    // ОГОНЬ: зажатая кнопка одновременно работает как зона обзора —
    // палец на кнопке можно двигать и крутить камеру (стандарт мобильных FPS)
    const fireBtn = document.getElementById('tbtn-fire');
    if (fireBtn) {
      fireBtn.addEventListener('touchstart', (e) => {
        const t = e.changedTouches[0];
        this.touch.fire = true;
        this.touch.fireId = t.identifier;
        this.touch.fireLastX = t.clientX; this.touch.fireLastY = t.clientY;
        e.preventDefault(); e.stopPropagation();
      }, { passive: false });
      const fireEnd = (e) => {
        for (const t of e.changedTouches) {
          if (t.identifier === this.touch.fireId) {
            this.touch.fire = false; this.touch.fireId = -1;
          }
        }
        e.preventDefault();
      };
      fireBtn.addEventListener('touchend', fireEnd, { passive: false });
      fireBtn.addEventListener('touchcancel', fireEnd, { passive: false });
    }
    bindBtn('tbtn-jump', 'jump');
    bindBtn('tbtn-dash', 'dash');
    bindBtn('tbtn-reload', 'reload');
    bindBtn('tbtn-weapon', 'weapon');
    bindBtn('tbtn-shock', 'shock');
    bindBtn('tbtn-grapple', 'grapple');
    bindBtn('tbtn-nade', 'nade');
    bindBtn('tbtn-pause', 'pause');

    // СЛАЙД — эмулируем ControlLeft, чтобы сработала штатная логика player.js
    const slideBtn = document.getElementById('tbtn-slide');
    if (slideBtn) {
      slideBtn.addEventListener('touchstart', (e) => { this.keys['ControlLeft'] = true; e.preventDefault(); e.stopPropagation(); }, { passive: false });
      slideBtn.addEventListener('touchend', (e) => { this.keys['ControlLeft'] = false; e.preventDefault(); }, { passive: false });
      slideBtn.addEventListener('touchcancel', () => { this.keys['ControlLeft'] = false; });
    }
    // ADS — тап-переключатель (hold на тач-кнопке неудобен)
    const adsBtn = document.getElementById('tbtn-ads');
    if (adsBtn) {
      adsBtn.addEventListener('touchstart', (e) => {
        this.touch.ads = !this.touch.ads;
        adsBtn.classList.toggle('on', this.touch.ads);
        e.preventDefault();
        e.stopPropagation();
      }, { passive: false });
    }

    // Кастомная раскладка кнопок (редактор в настройках) — применяем, если сохранена
    applyTouchLayout();
    let _layoutRszT = 0;
    const reapply = () => {
      clearTimeout(_layoutRszT);
      _layoutRszT = setTimeout(() => applyTouchLayout(), 120);
    };
    window.addEventListener('resize', reapply);
    window.addEventListener('orientationchange', reapply);
  }

}
