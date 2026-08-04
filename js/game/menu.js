// ===== GEN.SWAGS Menu =====
// Главное меню, настройки (мышь/FOV/пиксель/звук/ГИРОСКОП), музыка
// (плейлист + свой трек), пауза, экран смерти, экран конца матча.
import { NetClient } from '../engine/net.js';
import { ROSTER } from './bots.js';
import { rankFor } from './rating.js';
import { TouchLayoutEditor, applyTouchLayout, clearTouchLayouts } from './touchlayout.js';
import { WeaponSystem } from './weapons.js';
import { CHAR_INFO, CHAR_IDS } from '../engine/charlib.js';

export const TRACK_NAMES = {
  'NO_TALK_FREE_DRINK_KLICKAUD.mp3': 'FREE DRINK — hardbass',
  'голодный_волк_KLICKAUD.mp3': 'ГОЛОДНЫЙ ВОЛК — dark phonk',
  'Кракен_hardtrekk_KLICKAUD.mp3': 'КРАКЕН — hardtekk',
  'menu_ambient.mp3': 'HUB // тема меню',
};

const SETTINGS_KEY = 'genswags.settings.v1';
const DEFAULTS = {
  sens: 1.0, fov: 120, pixel: 0.5,
  fxQuality: 'auto', // ЭФФЕКТЫ: auto|low|high
  volMusic: 0.55, volSfx: 0.7,
  weapon: 'rifle',   // стартовый ствол (ключи 1-6 в бою)
  skin: 'c1',        // скелетный скин команды: c1|c2|c3 (legacy ronin→c1 и т.д.)
  gyro: { enabled: false, sensX: 1.6, sensY: 1.6, invertX: false, invertY: false, response: 0.15, deadzone: 0, driftFix: false },
  stickFloat: false, // плавающий стик: палец на левой половине = центр стика
};


const $ = (id) => document.getElementById(id);

// ============================
// Визуальная калибровка гироскопа (оверлей #gyro-cal)
// Горизонт + точка-прицел живут по данным GyroController, живые цифры
// alpha/beta/gamma/yaw/pitch/Гц, отсчёт 3-2-1 → захват нуля, проверка 5 с.
// ============================
class GyroCalScreen {
  constructor(menu) {
    this.menu = menu;
    this.isOpen = false;
    this._raf = 0;
    this._timers = [];
    this._busy = false;
    this._test = null; // { t0, y0, p0, maxDev }
    $('gcal-close')?.addEventListener('click', () => { this.game.sfx?.ui?.(); this.close(); });
    $('gcal-start')?.addEventListener('click', () => { this.game.sfx?.ui?.(); this.startCountdown(); });
    $('gcal-test')?.addEventListener('click', () => { this.game.sfx?.ui?.(); this.startTest(); });
  }

  get game() { return this.menu.game; }

  open() {
    if (this.isOpen) return;
    this.isOpen = true;
    $('gyro-cal')?.classList.add('visible');
    // Слушаем датчик на время калибровки, даже если в настройках выключен
    // (на iOS без разрешения enable() вернёт false — статус это покажет)
    this.game.input.gyro.enable();
    this._setMsg('ДЕРЖИ УСТРОЙСТВО УДОБНО — ЭТО БУДЕТ «НОЛЬ»');
    this._render();
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = 0;
    this._cancelTimers();
    this._busy = false;
    this._test = null;
    $('gyro-cal')?.classList.remove('visible');
    $('gcal-progress')?.classList.remove('on');
    // Возвращаем состояние датчика к настройкам
    this.game.input.gyro.syncFromSettings();
    this.menu._refreshGyroStatus();
  }

  _cancelTimers() {
    for (const t of this._timers) clearTimeout(t);
    this._timers = [];
  }

  _setMsg(text, cls = '') {
    const el = $('gcal-msg');
    if (el) { el.textContent = text; el.className = `gcal-msg${cls ? ' ' + cls : ''}`; }
  }

  // «Держи устройство удобно» → 3-2-1 → захват нуля → вспышка
  startCountdown() {
    if (this._busy) return;
    this._busy = true;
    this._cancelTimers();
    this._test = null;
    ['3', '2', '1'].forEach((s, i) => {
      this._timers.push(setTimeout(() => this._setMsg(s, 'count'), i * 700));
    });
    this._timers.push(setTimeout(() => {
      this.game.input.gyro.calibrate();
      const ov = $('gyro-cal');
      if (ov) { ov.classList.remove('flash'); void ov.offsetWidth; ov.classList.add('flash'); }
      this._setMsg('КАЛИБРОВАН! НОЛЬ = ТЕКУЩАЯ ПОЗА', 'ok');
      this._busy = false;
    }, 3 * 700));
  }

  // 5 секунд живого режима: точка должна двигаться, прогресс «датчик жив»
  startTest() {
    if (this._busy) return;
    this._busy = true;
    this._cancelTimers();
    const dbg = this.game.input.gyro.getDebug();
    this._test = { t0: performance.now(), y0: dbg.rawYawDeg, p0: dbg.rawPitchDeg, maxDev: 0 };
    $('gcal-progress')?.classList.add('on');
    this._setMsg('ПРОВЕРКА: ПОВЕРНИ УСТРОЙСТВО — ТОЧКА ДОЛЖНА ДВИГАТЬСЯ…');
    this._timers.push(setTimeout(() => this._finishTest(), 5000));
  }

  _finishTest() {
    const t = this._test;
    this._test = null;
    this._busy = false;
    this._timers.push(setTimeout(() => $('gcal-progress')?.classList.remove('on'), 1200));
    if (!t) return;
    if (t.maxDev > 2.5) {
      this._setMsg(`ДАТЧИК ЖИВ ✓ ОТКЛОНЕНИЕ ±${t.maxDev.toFixed(1)}°`, 'ok');
    } else {
      this._setMsg('НЕТ РЕАКЦИИ — ПОВЕРНИ ТЕЛЕФОН ИЛИ ПРОВЕРЬ ДАТЧИК', 'err');
    }
  }

  _render() {
    if (!this.isOpen) return;
    this._raf = requestAnimationFrame(() => this._render());
    const gyro = this.game.input.gyro;
    const dbg = gyro.getDebug();
    const f1 = (v) => (v === null || v === undefined ? '—' : v.toFixed(1));
    const set = (id, txt) => { const el = $(id); if (el) el.textContent = txt; };

    // ВАЖНО: rawYaw/rawPitch — сглаженные yaw/pitch обновляются только в
    // applyToCamera() (игровой цикл), в меню они мертвы. Сырой угол живёт
    // прямо в обработчике событий датчика — его и показываем.
    const yawD = dbg.rawYawDeg, pitchD = dbg.rawPitchDeg;
    set('gcal-abg', `${f1(dbg.alpha)}° / ${f1(dbg.beta)}° / ${f1(dbg.gamma)}°`);
    set('gcal-yp', `${f1(yawD)}° / ${f1(pitchD)}°${dbg.calibrated ? '' : ' (НЕ КАЛИБРОВАН)'}`);
    set('gcal-hz', `${dbg.hz} Гц · ${dbg.source === 'fusion' ? 'FUSION' : dbg.source === 'motion' ? 'MOTION' : dbg.source === 'orientation' ? 'ORIENT' : '—'}`);

    // Статус датчика + совет при молчании
    const stEl = $('gcal-status');
    const advice = $('gcal-advice');
    const alive = dbg.hz > 0;
    if (stEl) {
      if (dbg.status === 'need-permission' || dbg.status === 'denied' || dbg.status === 'perm-error') {
        stEl.textContent = 'НУЖНО РАЗРЕШЕНИЕ iOS';
        stEl.className = 'gcal-val err';
      } else if (dbg.status === 'unsupported') {
        stEl.textContent = 'НЕ ПОДДЕРЖИВАЕТСЯ';
        stEl.className = 'gcal-val err';
      } else if (alive) {
        stEl.textContent = 'ДАТЧИК АКТИВЕН';
        stEl.className = 'gcal-val ok';
      } else {
        stEl.textContent = 'ДАТЧИК НЕ ОТВЕЧАЕТ';
        stEl.className = 'gcal-val err';
      }
    }
    if (advice) {
      let text;
      if (dbg.status === 'need-permission' || dbg.status === 'denied') {
        text = 'Нажми «РАЗРЕШИТЬ ДАТЧИКИ (iOS)» в настройках. Если отказано: Настройки iOS → Safari → Движение и ориентация → включить, затем перезагрузи вкладку.';
      } else if (!alive && dbg.status !== 'unsupported') {
        text = 'Датчик молчит (0 Гц / null). Проверь разрешение на движение, перезагрузи Safari, убедись что это не режим низкого энергопотребления.';
      } else if (dbg.status === 'unsupported') {
        text = 'Этот браузер/устройство не отдаёт датчики движения.';
      } else {
        text = '';
      }
      // Не дёргаем layout каждый кадр — только при реальном изменении
      if (text !== this._lastAdvice) { this._lastAdvice = text; advice.textContent = text; }
    }

    // Прогресс проверки
    if (this._test) {
      const t = this._test;
      const dev = Math.hypot(yawD - t.y0, pitchD - t.p0);
      t.maxDev = Math.max(t.maxDev, dev);
      const fill = $('gcal-progress-fill');
      if (fill) {
        fill.style.width = `${Math.min(100, ((performance.now() - t.t0) / 5000) * 100)}%`;
        fill.classList.toggle('dead', !alive);
      }
    }

    this._drawCanvas(dbg);
  }

  // Горизонт (наклон по gamma, сдвиг по beta) + точка-прицел (yaw/pitch от нуля)
  _drawCanvas(dbg) {
    const cv = $('gcal-canvas');
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const W = cv.width, H = cv.height, cx = W / 2, cy = H / 2;
    const D2R = Math.PI / 180;
    ctx.fillStyle = '#07070c';
    ctx.fillRect(0, 0, W, H);
    // Сетка
    ctx.strokeStyle = 'rgba(80,80,110,.25)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= W; x += 34) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (let y = 0; y <= H; y += 30) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    // Горизонт: наклон — крен (gamma), вертикальный сдвиг — тангаж (beta − 90°)
    const roll = (dbg.gamma ?? 0) * D2R;
    const offY = Math.max(-60, Math.min(60, ((dbg.beta ?? 90) - 90) * 1.2));
    ctx.save();
    ctx.translate(cx, cy + offY);
    ctx.rotate(-roll);
    ctx.strokeStyle = '#41ff9a';
    ctx.lineWidth = 2;
    ctx.shadowColor = 'rgba(65,255,154,.7)';
    ctx.shadowBlur = 8;
    ctx.beginPath(); ctx.moveTo(-W, 0); ctx.lineTo(W, 0); ctx.stroke();
    // «Крылышки» горизонта
    ctx.beginPath(); ctx.moveTo(-46, 0); ctx.lineTo(-46, 8); ctx.moveTo(46, 0); ctx.lineTo(46, 8); ctx.stroke();
    ctx.restore();
    ctx.shadowBlur = 0;
    // Неподвижный центр-прицел (ноль)
    ctx.strokeStyle = 'rgba(255,255,255,.8)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx - 14, cy); ctx.lineTo(cx - 5, cy); ctx.moveTo(cx + 5, cy); ctx.lineTo(cx + 14, cy);
    ctx.moveTo(cx, cy - 14); ctx.lineTo(cx, cy - 5); ctx.moveTo(cx, cy + 5); ctx.lineTo(cx, cy + 14);
    ctx.stroke();
    // Точка-прицел: отклонение от калиброванного нуля (2px на градус)
    const dx = Math.max(-cx + 12, Math.min(cx - 12, -(dbg.rawYawDeg || 0) * 2));
    const dy = Math.max(-cy + 12, Math.min(cy - 12, -(dbg.rawPitchDeg || 0) * 2));
    ctx.fillStyle = '#ff2d55';
    ctx.shadowColor = 'rgba(255,45,85,.9)';
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.arc(cx + dx, cy + dy, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }
}

export class Menu {
  constructor(game) {
    this.game = game;
    this.settings = this._load();
    this._settingsReturn = 'main';
    this._playlistKey = '';
  }

  // ============================
  // Настройки
  // ============================
  _load() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return structuredClone(DEFAULTS);
      const s = JSON.parse(raw);
      // миграция старых скинов-палитр на скелетные GLB
      const legacy = { ronin: 'c1', doll: 'c2', hollow: 'c3' };
      if (s.skin && legacy[s.skin]) s.skin = legacy[s.skin];
      if (s.skin && !CHAR_IDS.includes(s.skin)) s.skin = 'c1';
      return { ...structuredClone(DEFAULTS), ...s, gyro: { ...DEFAULTS.gyro, ...(s.gyro || {}) } };
    } catch { return structuredClone(DEFAULTS); }
  }

  save() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings)); } catch {}
  }

  apply() {
    const g = this.game;
    const s = this.settings;
    // Мышь
    g.input.settings.sensX = 0.0022 * s.sens;
    g.input.settings.sensY = 0.0022 * s.sens;
    // FOV: 60..180 — напрямую в камеру; 181..360 — остаток докидываем
    // fisheye-дисторсией (псевдо-360, камера three.js больше 180 не тянет)
    const camFov = Math.min(180, Math.max(60, s.fov));
    if (g.player) g.player.baseFov = camFov;
    if (g.engine) { g.engine.camera.fov = camFov; g.engine.camera.updateProjectionMatrix(); }
    if (g.engine?.fx) g.engine.fx.baseFisheye = s.fov > 180 ? Math.min(1.0, (s.fov - 180) / 180) : 0;
    // Пиксель-скейл
    g.engine?.setPixelScale(s.pixel);
    // Качество эффектов (auto/low/high)
    g.engine?.setFxQuality(s.fxQuality);
    // Громкость
    g.music?.setVolume(s.volMusic);
    g.sfx?.setVolume(s.volSfx);
    // Гироскоп
    Object.assign(g.input.settings.gyro, s.gyro);
    // enabled мог прийти из localStorage после конструктора Input — синхронизируем
    // (на iOS без разрешения enable() вернёт false — статус покажет need-permission)
    g.input.gyro?.syncFromSettings?.();
    // Плавающий стик: левая половина экрана = центр стика
    g.input.settings.stickFloat = s.stickFloat;
    // Боевой комплект: стартовый ствол + скин своей команды

    g.weapons?.switchToKind?.(s.weapon);
    g.botsManager?.setPlayerSkin?.(s.skin);
  }

  // ============================
  // Инициализация UI
  // ============================
  init() {
    const g = this.game;

    // --- Главная ---
    $('btn-play')?.addEventListener('click', async () => {
      g.sfx.ui();
      // iOS: разрешение гироскопа ТОЛЬКО из жеста — клик «ИГРАТЬ» идеален.
      // Если гироскоп включён в настройках, но разрешения нет — запросим прямо сейчас.
      const gyro = g.input?.gyro;
      if (gyro?.permissionNeeded && gyro.permissionState !== 'granted' && this.settings?.gyro?.enabled) {
        await this._gyroPermissionFlow();
      }
      g.startGame();
    });
    $('btn-multi')?.addEventListener('click', () => { g.sfx.ui(); this.showPage('mp'); this._mpOpen(); });
    $('btn-settings')?.addEventListener('click', () => { g.sfx.ui(); this._settingsReturn = 'main'; this.showPage('settings'); });
    $('btn-help')?.addEventListener('click', () => { g.sfx.ui(); this.showPage('help'); });
    $('btn-help-back')?.addEventListener('click', () => { g.sfx.ui(); this.showPage('main'); });
    $('btn-help-close')?.addEventListener('click', () => { g.sfx.ui(); this.showPage('main'); });
    $('btn-music')?.addEventListener('click', () => { g.sfx.ui(); this.showPage('music'); });
    $('btn-rating')?.addEventListener('click', () => { g.sfx.ui(); this.showPage('rating'); });
    $('btn-rating-back')?.addEventListener('click', () => { g.sfx.ui(); this.showPage('main'); });

    // --- Карточки режимов игры ---
    const MODE_LABELS = { cashout: 'ИГРАТЬ HUB_1', duel: 'НАЧАТЬ ДУЭЛЬ', ffa: 'НАЧАТЬ FFA-3' };
    for (const card of document.querySelectorAll('.mode-card')) {
      card.addEventListener('click', () => {
        g.sfx.ui();
        g.gameMode = card.dataset.mode || 'cashout';
        for (const c of document.querySelectorAll('.mode-card')) c.classList.toggle('selected', c === card);
        const play = $('btn-play');
        if (play) play.textContent = MODE_LABELS[g.gameMode] || 'ИГРАТЬ';
      });
    }

    this._initMp();

    // --- Назад со страниц ---
    const closeSettings = () => {
      g.sfx.ui();
      if (this._settingsReturn === 'pause') { this.showPage('none'); this.openPause(); }
      else this.showPage('main');
    };
    $('btn-set-back')?.addEventListener('click', closeSettings);
    $('btn-set-close')?.addEventListener('click', closeSettings); // липкий ✕ в хедере
    $('btn-mus-back')?.addEventListener('click', () => { g.sfx.ui(); this.showPage('main'); });

    // --- Пауза ---
    $('btn-resume')?.addEventListener('click', () => { g.sfx.ui(); g.resumeGame(); });
    $('btn-pause-settings')?.addEventListener('click', () => {
      g.sfx.ui();
      this._settingsReturn = 'pause';
      this.closePause();
      g.showMenuOverlay('settings');
    });
    $('btn-quit')?.addEventListener('click', () => { g.sfx.ui(); g.quitToMenu(); });

    // --- Конец матча ---
    $('btn-again')?.addEventListener('click', () => {
      g.sfx.ui();
      if (g.mpActive) { this.hideEnd(); g.restartMPMatch(); } // в MP остаёмся в матче
      else if (g.meta?.startIntermission()) { /* PSY-BREAK интермиссия → следующая арена */ }
      else { this.hideEnd(); g.startGame(); }
    });
    $('btn-tomenu')?.addEventListener('click', () => { g.sfx.ui(); this.hideEnd(); g.quitToMenu(); });

    // --- Слайдеры настроек ---
    this._bindSlider('set-sens', 'sens', (v) => v.toFixed(2), 0.3, 3);
    this._bindSlider('set-fov', 'fov', (v) => `${Math.round(v)}°`);
    this._bindSlider('set-pixel', 'pixel', (v) => `${Math.round(v * 100)}%`);
    this._bindSlider('set-vol-music', 'volMusic', (v) => `${Math.round(v * 100)}%`);
    this._bindSlider('set-vol-sfx', 'volSfx', (v) => `${Math.round(v * 100)}%`);

    // --- Качество эффектов: АВТО/НИЗК/ВЫСК (циклическая кнопка) ---
    const FX_LABELS = { auto: 'АВТО', low: 'НИЗК', high: 'ВЫСК' };
    const FX_ORDER = ['auto', 'low', 'high'];
    const fxBtn = $('btn-fx-quality');
    if (fxBtn) {
      fxBtn.textContent = FX_LABELS[this.settings.fxQuality] || 'АВТО';
      fxBtn.addEventListener('click', () => {
        g.sfx.ui();
        const i = FX_ORDER.indexOf(this.settings.fxQuality);
        this.settings.fxQuality = FX_ORDER[(i + 1) % FX_ORDER.length];
        fxBtn.textContent = FX_LABELS[this.settings.fxQuality];
        this.save();
        this.apply();
      });
    }

    // --- Гироскоп ---
    const gs = this.settings.gyro;
    const gyroOn = $('set-gyro-on');
    if (gyroOn) {
      gyroOn.checked = gs.enabled;
      gyroOn.addEventListener('change', async () => {
        const v = gyroOn.checked;
        // Включение — это жест пользователя: можно запросить iOS-разрешение
        if (v && g.input.gyro.permissionNeeded && g.input.gyro.permissionState !== 'granted') {
          gyroOn.checked = false; // вернём, если получим разрешение
          const ok = await this._gyroPermissionFlow();
          if (!ok) { this._refreshGyroStatus(); return; }
        }
        gs.enabled = v;
        this.save();
        this.apply();
        g.input.gyro.syncFromSettings();
        this._refreshGyroStatus();
      });
    }
    this._bindSlider('set-gyro-x', null, (v) => v.toFixed(1), 0.2, 4, () => gs.sensX, (v) => { gs.sensX = v; });
    this._bindSlider('set-gyro-y', null, (v) => v.toFixed(1), 0.2, 4, () => gs.sensY, (v) => { gs.sensY = v; });
    this._bindCheck('set-gyro-inv-x', gs.invertX, (v) => { gs.invertX = v; this.save(); this.apply(); });
    this._bindCheck('set-gyro-inv-y', gs.invertY, (v) => { gs.invertY = v; this.save(); this.apply(); });
    // Отклик: 0 = МГНОВЕННЫЙ (сырой), 1 = ПЛАВНЫЙ (сильное сглаживание)
    const RESP_LABELS = (v) => v <= 0.001 ? 'МГНОВЕННЫЙ' : v >= 0.999 ? 'ПЛАВНЫЙ' : `${Math.round(v * 100)}%`;
    this._bindSlider('set-gyro-response', null, RESP_LABELS, 0, 1, () => gs.response, (v) => { gs.response = v; });
    // Dead-zone — только для шумных датчиков (по умолчанию выкл)
    this._bindCheck('set-gyro-deadz', (gs.deadzone || 0) > 0, (v) => {
      gs.deadzone = v ? 0.03 * Math.PI / 180 : 0;
      this.save(); this.apply();
    });
    this._bindCheck('set-gyro-drift', gs.driftFix, (v) => { gs.driftFix = v; this.save(); this.apply(); });
    // Визуальная калибровка: оверлей с горизонтом/точкой и живыми данными
    this._gyroCal = new GyroCalScreen(this);
    $('btn-gyro-cal')?.addEventListener('click', () => {
      g.sfx.ui();
      this._gyroCal.open();
    });
    $('btn-gyro-test')?.addEventListener('click', () => {
      g.sfx.ui();
      g.gyroDebug?.open();
    });
    const permBtn = $('btn-gyro-perm');
    if (permBtn) {
      permBtn.style.display = (g.input.gyro.permissionNeeded || g.input.isTouch) ? 'inline-block' : 'none';
      permBtn.addEventListener('click', () => this._gyroPermissionFlow());
    }
    $('btn-gyro-reload')?.addEventListener('click', () => {
      try { location.reload(); } catch { /* noop */ }
    });
    $('btn-gyro-reload2')?.addEventListener('click', () => {
      try { location.reload(); } catch { /* noop */ }
    });
    // Большая кнопка перехода на HTTPS-версию (тот же хост, порт 8343).
    // fetch к самоподписанному сертификату ВСЕГДА падает (TLS-ошибка раньше
    // HTTP-ответа), поэтому проверка недостоверна. Просто переходим — если
    // сервер мёртв, браузер покажет свою ошибку (понятнее, чем «зависание»).
    const httpsBtn = $('btn-gyro-https');
    if (httpsBtn) {
      // Уже на HTTPS — кнопка бессмысленна
      if (location.protocol === 'https:') {
        httpsBtn.style.display = 'none';
      } else {
        httpsBtn.addEventListener('click', () => {
          this._cancelGyroHttpsCountdown?.();
          try { location.href = this._gyroHttpsUrl(); } catch { /* noop */ }
        });
      }
    }

    this._refreshGyroStatus();

    // --- Боевой комплект: выбор оружия (6) и скина команды (3) ---
    this._buildPickGrids();

    // --- Тач-раскладка: редактор кнопок ---
    this._layoutEditor = new TouchLayoutEditor({
      sfx: () => g.sfx.ui(),
      onClose: (res) => {
        if (res === 'save') this._flashBtn('btn-touch-layout', 'СОХРАНЕНО ✓', 'НАСТРОИТЬ КНОПКИ');
      },
    });
    const tlBtn = $('btn-touch-layout');
    if (tlBtn && !g.input.isTouch) {
      // Секция тач-управления бессмысленна без тач-экрана — скрываем целиком
      const grid = tlBtn.closest('.set-grid');
      const sub = grid?.previousElementSibling;
      if (grid) grid.style.display = 'none';
      if (sub?.classList.contains('page-sub')) sub.style.display = 'none';
    }
    tlBtn?.addEventListener('click', () => { g.sfx.ui(); this._layoutEditor.open(); });
    // Плавающий стик: левая половина экрана = центр стика при касании
    this._bindCheck('set-stick-float', this.settings.stickFloat, (v) => {
      this.settings.stickFloat = v;
      this.save(); this.apply();
    });
    $('btn-touch-layout-reset')?.addEventListener('click', () => {

      g.sfx.ui();
      clearTouchLayouts(localStorage);
      applyTouchLayout();
      this._flashBtn('btn-touch-layout-reset', 'СБРОШЕНО ✓', 'СБРОС РАСКЛАДКИ');
    });

    // --- Музыка ---
    const fileInput = $('music-file-input');
    $('btn-music-file')?.addEventListener('click', () => fileInput?.click());
    fileInput?.addEventListener('change', async (e) => {
      const f = e.target.files?.[0];
      if (f) { await g.music.loadUserFile(f); g.sfx.ui(); this._renderPlaylist(); }
    });
    // Drag & drop на весь экран
    const dz = $('drop-zone');
    window.addEventListener('dragover', (e) => { e.preventDefault(); dz?.classList.add('visible'); });
    window.addEventListener('dragleave', (e) => { if (e.target === document.body || e.clientX <= 0 || e.clientY <= 0) dz?.classList.remove('visible'); });
    window.addEventListener('drop', async (e) => {
      e.preventDefault();
      dz?.classList.remove('visible');
      const f = e.dataTransfer?.files?.[0];
      if (f && (f.type.startsWith('audio') || /\.(mp3|ogg|wav|m4a)$/i.test(f.name))) {
        await g.music.loadUserFile(f);
        g.sfx.ui();
        this._renderPlaylist();
      }
    });

    // --- Esc ---
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'Escape') return;
      if (g.state === 'GAME') {
        if (g.paused) g.resumeGame();
        // выход из pointer lock сам вызовет pause через pointerlockchange
      }
    });
    document.addEventListener('pointerlockchange', () => {
      if (g.state === 'GAME' && !g.input.pointerLocked && !g.input.isTouch && !g.paused && !g.matchEnded && !g.chatOpen) {
        g.pauseGame();
      }
    });

    this._syncSettingsUi();
    this.apply();
    this.refreshRank();
  }

  _bindSlider(id, key, fmt, min, max, getter = null, setter = null) {
    const el = $(id);
    const label = $(`${id}-val`);
    if (!el) return;
    const get = getter || (() => this.settings[key]);
    const set = setter || ((v) => { this.settings[key] = v; });
    el.value = get();
    if (label) label.textContent = fmt(get());
    el.addEventListener('input', () => {
      const v = parseFloat(el.value);
      set(v);
      if (label) label.textContent = fmt(v);
      this.save();
      this.apply();
    });
  }

  _bindCheck(id, initial, cb) {
    const el = $(id);
    if (!el) return;
    el.checked = initial;
    el.addEventListener('change', () => cb(el.checked));
  }

  // Временная подпись на кнопке («СОХРАНЕНО ✓» → исходная)
  _flashBtn(id, tempText, origText) {
    const b = $(id);
    if (!b) return;
    b.textContent = tempText;
    clearTimeout(this._flashT?.[id]);
    (this._flashT = this._flashT || {})[id] = setTimeout(() => { b.textContent = origText; }, 1400);
  }

  // Запрос iOS-разрешения на датчики (вызывается только из жеста пользователя).
  // Повторный вызов разрешён: после отказа кнопка предлагает повторить.
  async _gyroPermissionFlow() {
    const g = this.game;
    const permBtn = $('btn-gyro-perm');
    this._gyroPermTried = true;
    const ok = await g.input.gyro.requestPermission();
    if (permBtn) {
      permBtn.textContent = ok ? 'РАЗРЕШЕНИЕ ПОЛУЧЕНО ✓' : 'ОТКАЗАНО — ПОВТОРИТЬ';
    }
    if (ok) {
      this.settings.gyro.enabled = true;
      this.save();
      this.apply();
      g.input.gyro.syncFromSettings();
      this._syncSettingsUi();
    }
    this._refreshGyroStatus();
    return ok;
  }

  // Честный статус гироскопа в настройках (включая «недоступно» при null-данных)
  // URL HTTPS-версии игры (serve_https.py / start.bat, порт 8343)
  _gyroHttpsUrl() {
    return `https://${location.hostname}:8343${location.pathname}${location.search}`;
  }

  // Проверка, что HTTPS-сервер жив (fetch с таймаутом 3с). Самоподписанный
  // сертификат — ок (mode: 'no-cors' не даёт прочитать ответ, но факт
  // ответа = сервер жив). Любая ошибка/таймаут → false (не «зависаем»).
  async _probeHttps(url) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 3000);
      await fetch(url, { mode: 'no-cors', cache: 'no-store', signal: ctrl.signal });
      clearTimeout(t);
      return true;
    } catch {
      return false;
    }
  }

  _cancelGyroHttpsCountdown() {
    clearTimeout(this._gyroHttpsT);
    clearInterval(this._gyroHttpsI);
    this._gyroHttpsT = this._gyroHttpsI = null;
    this._gyroHttpsCancelled = true;
    const auto = $('gyro-https-auto');
    if (auto) auto.style.display = 'none';
  }

  _refreshGyroStatus() {
    const el = $('gyro-status');
    if (!el) return;
    const dbg = this.game.input.gyro.getDebug();
    const map = {
      'unsupported': 'НЕ ПОДДЕРЖИВАЕТСЯ ЭТИМ БРАУЗЕРОМ',
      'motion-only': 'ТОЛЬКО MOTION (fallback-режим)',
      'need-permission': 'НУЖНО РАЗРЕШЕНИЕ iOS — НАЖМИТЕ КНОПКУ НИЖЕ',
      'denied': 'ОТКАЗАНО iOS — ИНСТРУКЦИЯ НИЖЕ',
      'perm-error': `ОШИБКА ЗАПРОСА: ${dbg.permError || 'НЕИЗВЕСТНАЯ'}`,
      'idle': 'ВЫКЛЮЧЕН (доступен)',
      'waiting': 'ОЖИДАНИЕ ДАННЫХ ДАТЧИКА…',
      'active': `АКТИВЕН · ${dbg.hz} Гц · ${dbg.source === 'fusion' ? 'FUSION' : dbg.source === 'motion' ? 'MOTION' : 'ORIENTATION'}`,
      'active-motion': `АКТИВЕН · ${dbg.hz} Гц · MOTION (fallback)`,
      'no-data': 'ДАТЧИК НЕДОСТУПЕН (данных нет — десктоп/эмулятор?)',
    };
    el.textContent = map[dbg.status] || dbg.status.toUpperCase();
    el.className = `gyro-status st-${dbg.status}`;
    // HTTP (небезопасный контекст): iOS МОЛЧА блокирует датчики — это причина №1
    // «гироскоп не работает» при игре по локальной сети. Показываем HTTPS-инструкцию.
    const httpsHelp = $('gyro-https-help');
    const insecure = !window.isSecureContext && location.protocol === 'http:'
      && !['localhost', '127.0.0.1'].includes(location.hostname);
    if (httpsHelp) httpsHelp.style.display = insecure ? 'block' : 'none';
    // iPhone + включённый гироскоп: авто-переход на HTTPS через 6 секунд
    // (тап по строке отменяет). Десктоп/Android не трогаем.
    if (insecure) {
      const isiOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
        || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      if (isiOS && this.settings?.gyro?.enabled && !this._gyroHttpsT && !this._gyroHttpsCancelled) {
        const auto = $('gyro-https-auto');
        let left = 6;
        const tick = () => {
          if (auto) auto.textContent = `АВТО-ПЕРЕХОД НА HTTPS ЧЕРЕЗ ${left} СЕК… (тапни, чтобы отменить)`;
        };
        if (auto) { auto.style.display = 'block'; auto.onclick = () => this._cancelGyroHttpsCountdown(); }
        tick();
        this._gyroHttpsI = setInterval(() => { left--; tick(); }, 1000);
        this._gyroHttpsT = setTimeout(() => {
          try { location.href = this._gyroHttpsUrl(); } catch { /* noop */ }
        }, 6500);
      }
    } else if (this._gyroHttpsT) {
      this._cancelGyroHttpsCountdown();
    }
    if (insecure && !this._gyroHttpsNotified && this.settings?.gyro?.enabled) {
      this._gyroHttpsNotified = true;
      this.game.hud?.notify('ГИРОСКОП ТРЕБУЕТ HTTPS — ИНСТРУКЦИЯ В НАСТРОЙКАХ', 'bad');
    }
    // Блок восстановления: iOS заблокировал датчики → пошаговая инструкция
    const help = $('gyro-denied-help');
    if (help) {
      const blocked = !insecure && (dbg.status === 'denied' || dbg.status === 'perm-error'
        || (dbg.status === 'need-permission' && this._gyroPermTried));
      help.style.display = blocked ? 'block' : 'none';
    }
    // Одноразовый совет в HUD, если гироскоп включён в настройках, но iOS молчит
    if ((dbg.status === 'denied' || dbg.status === 'perm-error') && this.settings?.gyro?.enabled
        && !this._gyroDeniedNotified) {
      this._gyroDeniedNotified = true;
      this.game.hud?.notify('ГИРОСКОП ЗАБЛОКИРОВАН iOS — ИНСТРУКЦИЯ В НАСТРОЙКАХ', 'bad');
    }
  }

  // Сетки выбора оружия (6 стволов) и скина команды (3 варианта)
  _buildPickGrids() {
    const g = this.game;
    const wBox = $('weapon-select');
    if (wBox && !wBox.children.length) {
      WeaponSystem.slotOrder.forEach((kind, i) => {
        const def = WeaponSystem.catalog[kind];
        const b = document.createElement('button');
        b.className = 'pick-card';
        b.dataset.kind = kind;
        b.innerHTML = `<span class="pk-num">${i + 1}</span> <b>${def.name}</b> <span class="jp pk-jp">${def.jp}</span>` +
          `<span class="pk-desc">УРН ${def.damage}${def.pellets > 1 ? '×' + def.pellets : ''} · ТЕМП ${def.rpm} · МАГ ${def.mag}</span>`;
        b.addEventListener('click', () => {
          g.sfx.ui();
          this.settings.weapon = kind;
          this.save(); this.apply();
          this._syncPickGrids();
        });
        wBox.appendChild(b);
      });
    }
    const sBox = $('skin-select');
    if (sBox && !sBox.children.length) {
      for (const key of CHAR_IDS) {
        const sk = CHAR_INFO[key];
        const b = document.createElement('button');
        b.className = 'pick-card';
        b.dataset.kind = key;
        b.innerHTML = `<b>${sk.name}</b> <span class="jp pk-jp">${sk.jp}</span>` +
          `<span class="pk-desc">${sk.desc}</span>`;
        b.addEventListener('click', () => {
          g.sfx.ui();
          this.settings.skin = key;
          this.save(); this.apply();
          this._syncPickGrids();
        });
        sBox.appendChild(b);
      }
      // 3D-превью скелетных моделей
      const pv = document.createElement('button');
      pv.className = 'pick-card pk-preview';
      pv.innerHTML = `<b>3D-ПРЕВЬЮ</b> <span class="jp pk-jp">立体</span>` +
        `<span class="pk-desc">посмотреть модели в объёме и выбрать</span>`;
      pv.addEventListener('click', () => { g.sfx.ui(); g.skinPreview?.show(); });
      sBox.appendChild(pv);
    }
    this._syncPickGrids();
  }

  _syncPickGrids() {
    for (const b of document.querySelectorAll('#weapon-select .pick-card')) {
      b.classList.toggle('sel', b.dataset.kind === this.settings.weapon);
    }
    for (const b of document.querySelectorAll('#skin-select .pick-card')) {
      b.classList.toggle('sel', b.dataset.kind === this.settings.skin);
    }
  }

  _syncSettingsUi() {
    const s = this.settings;
    const set = (id, v) => { const el = $(id); if (el) el.value = v; };
    set('set-sens', s.sens); set('set-fov', s.fov); set('set-pixel', s.pixel);
    set('set-vol-music', s.volMusic); set('set-vol-sfx', s.volSfx);
    set('set-gyro-x', s.gyro.sensX); set('set-gyro-y', s.gyro.sensY);
    set('set-gyro-response', s.gyro.response);
    const chk = (id, v) => { const el = $(id); if (el) el.checked = v; };
    chk('set-gyro-on', s.gyro.enabled);
    chk('set-gyro-inv-x', s.gyro.invertX);
    chk('set-gyro-inv-y', s.gyro.invertY);
    chk('set-gyro-deadz', (s.gyro.deadzone || 0) > 0);
    chk('set-gyro-drift', s.gyro.driftFix);
    chk('set-stick-float', s.stickFloat);
    const fxBtn = $('btn-fx-quality');

    if (fxBtn) fxBtn.textContent = { auto: 'АВТО', low: 'НИЗК', high: 'ВЫСК' }[s.fxQuality] || 'АВТО';
  }

  // ============================
  // Страницы меню
  // ============================
  showPage(name) {
    for (const p of ['main', 'settings', 'music', 'mp', 'rating', 'help']) {
      const el = $(`menu-${p}`);
      el?.classList.toggle('visible', p === name);
      if (p === name && el) el.scrollTop = 0; // всегда открываем с верха (мобильный скролл)
    }
    if (name === 'music') this._renderPlaylist();
    if (name === 'settings') this._refreshGyroStatus();
    if (name === 'rating') this._renderRating();
    if (name === 'main') this.refreshRank();
  }

  // Ранг/рейтинг на главной странице
  refreshRank() {
    const r = this.game.meta?.rating;
    if (!r) return;
    const nameEl = $('menu-rank-name');
    const valEl = $('menu-rank-rating');
    if (nameEl) nameEl.textContent = r.rank;
    if (valEl) valEl.textContent = r.rating;
  }

  // Таблица рейтинга: соло — игрок + боты; MP — топ сервера
  _renderRating() {
    const g = this.game;
    const meEl = $('rating-me');
    const table = $('rating-table');
    const hint = $('rating-hint');
    if (!table) return;
    if (g.net?.connected) {
      // MP: просим топ у сервера; ответ придёт событием 'rating'
      if (meEl) meEl.textContent = 'ЗАПРОС СЕРВЕРНОГО РЕЙТИНГА…';
      if (hint) hint.textContent = 'Серверный рейтинг: +16 за кешаут команды, −8 за чужой';
      g.net.requestRating?.();
      this._renderRatingRows(g.net.ratingTop || null);
      return;
    }
    // Соло: игрок + боты (у ботов стабильные псевдо-рейтинги)
    const rs = g.meta?.rating;
    if (meEl) meEl.textContent = rs ? `ВАШ РАНГ: ${rs.rank} · ${rs.rating} · МАТЧЕЙ ${rs.matches} · ПОБЕД ${rs.wins}` : '';
    if (hint) hint.textContent = 'Соло: ELO по итогам матчей (место команды + личная статистика)';
    const rows = ROSTER.map((b) => ({ name: b.name, rating: 900 + (this._hashName(b.name) % 480) }));
    rows.push({ name: 'ВЫ', rating: rs?.rating ?? 1000, me: true });
    rows.sort((a, b) => b.rating - a.rating);
    this._renderRatingRows({ top: rows });
  }

  _hashName(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h;
  }

  _renderRatingRows(data) {
    const table = $('rating-table');
    if (!table) return;
    const top = data?.top || [];
    table.innerHTML = top.map((p, i) => {
      const me = p.me || (data?.me && p.name === data.me.name);
      const rating = p.rating ?? 1000;
      return `<div class="rt-row${me ? ' me' : ''}">
        <span class="rt-pos">#${i + 1}</span>
        <span class="rt-name">${p.name}</span>
        <span class="rt-rank">${rankFor(rating)}</span>
        <span class="rt-val">${rating}</span>
      </div>`;
    }).join('') || '<div class="rt-row"><span class="rt-name" style="color:#666">ПУСТО</span></div>';
    if (data?.me) {
      const meEl = $('rating-me');
      if (meEl) meEl.textContent = `ВАШ РАНГ: ${rankFor(data.me.rating)} · ${data.me.rating}`;
    }
  }

  // ============================
  // МУЛЬТИПЛЕЕР: подключение, комнаты, лобби, друзья
  // ============================
  _initMp() {
    const g = this.game;
    const net = g.net;
    this._lobby = null;        // {name, players: Map(id -> player)}
    this._readyOn = false;

    // --- Кнопки ---
    $('btn-mp-back')?.addEventListener('click', () => { g.sfx.ui(); this.showPage('main'); });
    $('btn-mp-connect')?.addEventListener('click', () => { g.sfx.ui(); this._mpConnect(); });
    $('btn-mp-refresh')?.addEventListener('click', () => { g.sfx.ui(); net.listRooms(); });
    $('btn-mp-create')?.addEventListener('click', () => {
      g.sfx.ui();
      const name = $('mp-room-name')?.value.trim();
      net.createRoom(name || undefined);
    });
    $('btn-mp-leave')?.addEventListener('click', () => { g.sfx.ui(); net.leaveRoom(); });
    $('btn-mp-ready')?.addEventListener('click', () => {
      g.sfx.ui();
      this._readyOn = !this._readyOn;
      net.setReady(this._readyOn);
      this._syncReadyBtn();
    });
    $('btn-mp-mic')?.addEventListener('click', () => { g.sfx.ui(); g.toggleMic(); });
    const sendLobbyChat = () => {
      const inp = $('mp-lobby-chat-input');
      const text = inp?.value.trim();
      if (text) net.sendChat(text, false);
      if (inp) inp.value = '';
    };
    $('btn-mp-chat-send')?.addEventListener('click', () => { g.sfx.ui(); sendLobbyChat(); });
    $('mp-lobby-chat-input')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') sendLobbyChat();
      e.stopPropagation();
    });

    // --- Вкладки ---
    $('mp-tab-game')?.addEventListener('click', () => { g.sfx.ui(); this._mpTab('game'); });
    $('mp-tab-friends')?.addEventListener('click', () => {
      g.sfx.ui();
      this._mpTab('friends');
      if (net.connected) net.listFriends();
    });

    // --- Друзья ---
    $('btn-fr-add')?.addEventListener('click', () => {
      g.sfx.ui();
      const name = $('fr-name')?.value.trim();
      if (name) net.friendAdd(name);
      if ($('fr-name')) $('fr-name').value = '';
    });
    $('fr-name')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') $('btn-fr-add')?.click();
      e.stopPropagation();
    });

    // --- Сетевые события лобби ---
    net.on('rooms', () => this._renderRooms());
    net.on('roomJoined', (m) => {
      this._lobby = {
        name: m.room?.name || 'HUB',
        players: new Map((m.room?.players || []).map((p) => [p.id, p])),
      };
      this._readyOn = false;
      this._syncReadyBtn();
      this._mpShowAppropriate();
      this._renderLobby();
      const chat = $('mp-lobby-chat');
      if (chat) chat.innerHTML = '';
    });
    net.on('roomLeft', () => {
      this._lobby = null;
      this._readyOn = false;
      this._mpShowAppropriate();
      if (net.connected) net.listRooms();
    });
    net.on('playerJoined', (m) => {
      if (this._lobby && m.player) this._lobby.players.set(m.player.id, m.player);
      this._renderLobby();
    });
    net.on('playerLeft', (m) => {
      this._lobby?.players.delete(m.id);
      this._renderLobby();
    });
    net.on('ready', (m) => {
      const p = this._lobby?.players.get(m.id);
      if (p) p.ready = m.ready;
      this._renderLobby();
    });
    net.on('lobby', (m) => {
      // Комната вернулась в лобби (после матча)
      if (m.room) {
        this._lobby = {
          name: m.room.name,
          players: new Map((m.room.players || []).map((p) => [p.id, p])),
        };
      }
      this._readyOn = false;
      this._syncReadyBtn();
      this._mpShowAppropriate();
      this._renderLobby();
    });
    net.on('friends', (m) => this._renderFriends(m));
    // Серверный рейтинг: обновление таблицы/уведомление о дельте
    net.on('rating', (m) => {
      if (m.top) this._renderRatingRows(m);
      if (m.ratings) {
        const mine = m.ratings[net.playerName];
        if (mine && this.game.state === 'GAME') {
          this.game.hud?.notify(`РЕЙТИНГ ${mine.rating} (${mine.delta >= 0 ? '+' : ''}${mine.delta})`, mine.delta >= 0 ? 'good' : 'bad');
        }
      }
    });
    net.on('friendRequest', () => {
      $('fr-badge')?.classList.remove('hidden');
      net.listFriends();
    });
    net.on('friendAccepted', () => net.listFriends());
    net.on('friendRequested', (m) => this._frStatus(`ЗАЯВКА ОТПРАВЛЕНА: ${m.name}`));
    net.on('error', (m) => {
      // Ошибки, релевантные MP-меню
      const map = {
        name_taken: 'НИК ЗАНЯТ', bad_name: 'НИК: 2-20 СИМВОЛОВ',
        room_full: 'КОМНАТА ЗАПОЛНЕНА', no_room: 'КОМНАТА НЕ НАЙДЕНА',
        friend_dup: 'УЖЕ В ДРУЗЬЯХ', friend_self: 'НЕЛЬЗЯ ДОБАВИТЬ СЕБЯ',
        not_ready: 'НЕ ВСЕ ИГРОКИ ГОТОВЫ',
      };
      if (map[m.code]) this._frStatus(map[m.code]);
    });
  }

  _mpTab(which) {
    $('mp-tab-game')?.classList.toggle('active', which === 'game');
    $('mp-tab-friends')?.classList.toggle('active', which === 'friends');
    $('mp-pane-game')?.classList.toggle('hidden', which !== 'game');
    $('mp-pane-friends')?.classList.toggle('hidden', which !== 'friends');
    if (which === 'friends') $('fr-badge')?.classList.add('hidden');
  }

  // Открытие страницы MP: подстановка полей и показ нужного блока
  _mpOpen() {
    const g = this.game;
    const net = g.net;
    const nameEl = $('mp-name');
    const srvEl = $('mp-server');
    if (nameEl && !nameEl.value) {
      nameEl.value = localStorage.getItem('genswags.name') || `PLAYER${Math.floor(Math.random() * 900 + 100)}`;
    }
    if (srvEl && !srvEl.value) {
      srvEl.value = NetClient.resolveServerUrl() || '';

    }
    this._mpConnStatus(net.connected ? `ПОДКЛЮЧЕНО: ${net._url}` : '', net.connected);
    this._mpShowAppropriate();
    if (net.connected) {
      if (net.room) this._renderLobby();
      else net.listRooms();
    }
  }

  _mpShowAppropriate() {
    const net = this.game.net;
    const inLobby = net.connected && !!net.room;
    $('mp-connect')?.classList.toggle('hidden', net.connected);
    $('mp-rooms-block')?.classList.toggle('hidden', !net.connected || inLobby);
    $('mp-lobby')?.classList.toggle('hidden', !inLobby);
  }

  async _mpConnect() {
    const g = this.game;
    const net = g.net;
    const name = ($('mp-name')?.value || '').trim() || 'PLAYER';
    const url = ($('mp-server')?.value || '').trim() || NetClient.resolveServerUrl() || `ws://${window.location.hostname}:7777`;
    try { localStorage.setItem('genswags.name', name); } catch {}
    if (net.connected) { this._mpShowAppropriate(); return; }
    this._mpConnStatus('ПОДКЛЮЧЕНИЕ…', null);
    const ok = await net.connect(url, { room: null, name });
    if (ok) {
      this._mpConnStatus(`ПОДКЛЮЧЕНО: ${url}`, true);
      net.listRooms();
      net.listFriends();
    } else {
      this._mpConnStatus('НЕ УДАЛОСЬ ПОДКЛЮЧИТЬСЯ — ПРОВЕРЬТЕ АДРЕС', false);
    }
    this._mpShowAppropriate();
  }

  _mpConnStatus(text, ok) {
    const el = $('mp-conn-status');
    if (!el) return;
    el.textContent = text;
    el.className = ok === true ? 'ok' : ok === false ? 'err' : '';
  }

  _syncReadyBtn() {
    const b = $('btn-mp-ready');
    if (b) b.textContent = this._readyOn ? 'ГОТОВ ✓' : 'ГОТОВ';
  }

  _renderRooms() {
    const g = this.game;
    const box = $('mp-rooms');
    if (!box) return;
    const rooms = g.net.rooms || [];
    box.innerHTML = rooms.length ? '' : '<div class="mp-room-row"><span class="grow" style="color:#666">НЕТ КОМНАТ — СОЗДАЙТЕ</span></div>';
    for (const r of rooms) {
      const row = document.createElement('div');
      row.className = 'mp-room-row';
      row.innerHTML = `<span class="grow">${r.name}</span>
        <span class="cnt">${r.players}/${r.max}</span>
        ${r.state === 'playing' ? '<span class="playing">В МАТЧЕ</span>' : ''}`;
      const btn = document.createElement('button');
      btn.className = 'menu-btn tiny';
      btn.textContent = 'ВОЙТИ';
      btn.disabled = r.players >= r.max;
      btn.addEventListener('click', () => { g.sfx.ui(); g.net.joinRoom(r.id); });
      row.appendChild(btn);
      box.appendChild(row);
    }
  }

  _renderLobby() {
    const g = this.game;
    const box = $('mp-players');
    if (!box || !this._lobby) return;
    const nameEl = $('mp-lobby-name');
    if (nameEl) nameEl.textContent = `${this._lobby.name} — ЛОББИ (${this._lobby.players.size}/9)`;
    box.innerHTML = '';
    for (const p of this._lobby.players.values()) {
      const row = document.createElement('div');
      row.className = 'mp-player-row' + (p.id === g.net.playerId ? ' me' : '');
      row.dataset.pid = p.id;
      row.innerHTML = `<span class="team-dot t${p.team % 3}"></span>
        <span class="grow">${p.name}${p.id === g.net.playerId ? ' (ВЫ)' : ''}</span>
        <span class="spk">🔊</span>
        ${p.voice ? '<span>🎤</span>' : ''}
        <span class="${p.ready ? 'rdy' : 'nrdy'}">${p.ready ? 'ГОТОВ' : 'ЖДЁТ'}</span>`;
      box.appendChild(row);
    }
  }

  addLobbyChat(msg) {
    const box = $('mp-lobby-chat');
    if (!box) return;
    const div = document.createElement('div');
    div.className = 'cm';
    const me = msg.from === this.game.net.playerId;
    div.innerHTML = `<span class="cn${me ? ' me' : ''}">${msg.name}:</span> `;
    div.appendChild(document.createTextNode(msg.text));
    box.appendChild(div);
    while (box.children.length > 50) box.firstChild.remove();
    box.scrollTop = box.scrollHeight;
  }

  _frStatus(text) {
    const el = $('fr-status');
    if (el) {
      el.textContent = text;
      clearTimeout(this._frStatusT);
      this._frStatusT = setTimeout(() => { el.textContent = ''; }, 3000);
    }
  }

  _renderFriends(m) {
    const g = this.game;
    const reqBox = $('fr-requests');
    const listBox = $('fr-list');
    if (!reqBox || !listBox) return;
    reqBox.innerHTML = '';
    for (const name of m.requests || []) {
      const row = document.createElement('div');
      row.className = 'fr-row req';
      row.innerHTML = `<span class="grow">ЗАЯВКА: ${name}</span>`;
      const ok = document.createElement('button');
      ok.className = 'menu-btn tiny';
      ok.textContent = '✓';
      ok.addEventListener('click', () => { g.sfx.ui(); g.net.friendAccept(name); });
      const no = document.createElement('button');
      no.className = 'menu-btn tiny';
      no.textContent = '✗';
      no.addEventListener('click', () => { g.sfx.ui(); g.net.friendDecline(name); });
      row.append(ok, no);
      reqBox.appendChild(row);
    }
    listBox.innerHTML = (m.list || []).length ? '' : '<div class="fr-row"><span class="grow" style="color:#666">ПУСТО — ДОБАВЬТЕ ПО НИКУ</span></div>';
    for (const f of m.list || []) {
      const row = document.createElement('div');
      row.className = 'fr-row';
      row.innerHTML = `<span class="grow">${f.name}</span>
        <span class="${f.online ? 'online' : 'offline'}">${f.online ? 'В СЕТИ' : 'НЕ В СЕТИ'}</span>`;
      const del = document.createElement('button');
      del.className = 'menu-btn tiny';
      del.textContent = 'УДАЛИТЬ';
      del.addEventListener('click', () => { g.sfx.ui(); g.net.friendRemove(f.name); });
      row.appendChild(del);
      listBox.appendChild(row);
    }
  }

  // Индикатор говорящего в списке лобби
  updateSpeaking({ id, speaking }) {
    if (id === 'me') id = this.game.net.playerId;
    const row = $('mp-players')?.querySelector(`[data-pid="${id}"]`);
    row?.classList.toggle('speaking', !!speaking);
  }

  // ============================
  // Пауза / смерть / конец
  // ============================
  openPause() { $('pause-screen')?.classList.add('visible'); }
  closePause() { $('pause-screen')?.classList.remove('visible'); }

  showDeath() { $('death-screen')?.classList.add('visible'); }
  hideDeath() { $('death-screen')?.classList.remove('visible'); }
  updateDeathTimer(t) {
    const el = $('death-timer');
    if (el) el.textContent = Math.ceil(t);
  }

  showEnd({ scores, winner, playerWon, stats = null, rating = null, nextArena = null }) {
    this.game.matchEnded = true;
    const title = $('end-title');
    if (title) {
      title.textContent = playerWon ? 'ПОБЕДА' : 'ПОРАЖЕНИЕ';
      title.className = playerWon ? 'win' : 'lose';
    }
    const names = ['ALPHA', 'BRAVO', 'CHARLIE'];
    const cls = ['a', 'b', 'c'];
    const box = $('end-scores');
    if (box) {
      box.innerHTML = scores.map((s, i) =>
        `<div class="end-row ${cls[i]} ${i === winner ? 'winner' : ''}">
           <span>${names[i]}${i === winner ? ' ☠' : ''}</span><b>${s}$</b>
         </div>`).join('');
    }
    // Соло мета-данные: статы матча + дельта рейтинга
    const stEl = $('end-stats');
    if (stEl) {
      stEl.innerHTML = stats
        ? `<span>КИЛЛЫ<b>${stats.kills}</b></span><span>СМЕРТИ<b>${stats.deaths}</b></span>
           <span>PERFECT<b>${Math.round((stats.perfectPct || 0) * 100)}%</b></span>
           <span>FLOW-MAX<b>${Math.round(stats.flowMax || 0)}</b></span>`
        : '';
    }
    const rEl = $('end-rating');
    if (rEl) {
      rEl.innerHTML = rating
        ? `${rating.oldRank} ${rating.oldRating} → <b>${rating.rank} ${rating.rating}</b>
           <span class="delta ${rating.delta >= 0 ? 'up' : 'down'}">${rating.delta >= 0 ? '+' : ''}${rating.delta}</span>`
        : '';
    }
    // Кнопка продолжения: в MP — рестарт, соло — PSY-BREAK интермиссия
    const again = $('btn-again');
    if (again) {
      again.textContent = this.game.mpActive
        ? 'ЕЩЁ РАЗ'
        : `PSY-BREAK → ${nextArena || 'СЛЕДУЮЩАЯ АРЕНА'}`;
    }
    $('end-screen')?.classList.add('visible');
  }
  hideEnd() {
    this.game.matchEnded = false;
    $('end-screen')?.classList.remove('visible');
  }

  // ============================
  // Плейлист
  // ============================
  _renderPlaylist() {
    const g = this.game;
    const box = $('playlist');
    if (!box) return;
    const key = g.music.playlist.map((t, i) => `${i}:${t.name}:${i === g.music.trackIndex}`).join('|');
    if (key === this._playlistKey) return;
    this._playlistKey = key;
    box.innerHTML = '';
    g.music.playlist.forEach((t, i) => {
      const btn = document.createElement('button');
      btn.className = 'track' + (i === g.music.trackIndex && g.music.playing ? ' playing' : '');
      btn.innerHTML = `<span class="tr-num">${String(i + 1).padStart(2, '0')}</span> ${TRACK_NAMES[t.name] || t.name}`;
      btn.addEventListener('click', () => {
        g.music.playTrack(i);
        g.sfx.ui();
        this._playlistKey = '';
        this._renderPlaylist();
      });
      box.appendChild(btn);
    });
  }

  // Вызывается из главного цикла (рендер)
  update(dt) {
    // Живой статус гироскопа на странице настроек (waiting → active / no-data)
    if ($('menu-settings')?.classList.contains('visible')) {
      this._gyroStatusT = (this._gyroStatusT || 0) - (dt || 0.016);
      if (this._gyroStatusT <= 0) {
        this._gyroStatusT = 0.5;
        this._refreshGyroStatus();
      }
    }
    // BPM/энергия на странице музыки
    if ($('menu-music')?.classList.contains('visible')) {
      const g = this.game;
      const bpmEl = $('mus-bpm');
      if (bpmEl) bpmEl.textContent = g.music.bpm ? `♪ ${g.music.bpm} BPM` : '♪ — BPM';
      const e = g.music.energy();
      const bar = $('mus-energy-fill');
      if (bar) bar.style.width = `${Math.round(e.total * 100)}%`;
      this._renderPlaylist(); // обновит playing-подсветку при смене трека
    }
    // Тач-кнопка паузы
    if (this.game.input.touch.pause) {
      this.game.input.touch.pause = false;
      if (this.game.state === 'GAME') {
        if (this.game.paused) this.game.resumeGame();
        else this.game.pauseGame();
      }
    }
  }
}
