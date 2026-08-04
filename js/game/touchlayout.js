// ===== GEN.SWAGS Touch Layout =====
// Редактор раскладки тач-кнопок + применение сохранённой раскладки к тач-UI.
//
// Модель данных (v1, per-ориентация, localStorage):
//   key: genswags.touchlayout.v1.portrait | .landscape
//   { v: 1, widgets: { "<id>": { nx, ny, s } } }
//   nx, ny — нормализованные (0..1) координаты ЛЕВОГО-ВЕРХНЕГО угла виджета
//            относительно viewport; s — масштаб 0.7..1.5.
// Позиции снапятся к сетке 8px и клампятся к экрану с учётом safe-area.
//
// Чистые функции (snap/clamp/serialize/parse/overlap/defaults) не зависят от
// DOM — покрыты test/touchlayout.test.mjs. DOM-часть: applyTouchLayout()
// (применяет раскладку к #touch-ui) и TouchLayoutEditor (drag&drop-редактор).

export const GRID = 8;
export const LAYOUT_KEY_PREFIX = 'genswags.touchlayout.v1.';
export const SCALE_MIN = 0.7;
export const SCALE_MAX = 1.5;

// Реестр редактируемых элементов тач-UI.
// w/h — базовые размеры (px) при scale=1; def — запасная позиция (фракции
// viewport), если живое измерение невозможно (элемент скрыт).
export const WIDGETS = [
  { id: 'stick-move', label: 'СТИК', w: 130, h: 130, def: { nx: 0.060, ny: 0.726, s: 1 } },
  { id: 'tbtn-fire', label: 'ОГОНЬ', w: 58, h: 58, def: { nx: 0.483, ny: 0.637, s: 1 } },
  { id: 'tbtn-jump', label: 'ПРЫЖОК', w: 58, h: 58, def: { nx: 0.652, ny: 0.637, s: 1 } },
  { id: 'tbtn-slide', label: 'СЛАЙД', w: 58, h: 58, def: { nx: 0.821, ny: 0.637, s: 1 } },
  { id: 'tbtn-dash', label: 'Q ДЭШ', w: 58, h: 58, def: { nx: 0.483, ny: 0.715, s: 1 } },
  { id: 'tbtn-shock', label: 'E ВОЛНА', w: 58, h: 58, def: { nx: 0.652, ny: 0.715, s: 1 } },
  { id: 'tbtn-grapple', label: 'F КРЮК', w: 58, h: 58, def: { nx: 0.821, ny: 0.715, s: 1 } },
  { id: 'tbtn-nade', label: 'G ГРАНАТА', w: 58, h: 58, def: { nx: 0.483, ny: 0.793, s: 1 } },
  { id: 'tbtn-reload', label: 'R ПЕРЕЗАР', w: 58, h: 58, def: { nx: 0.652, ny: 0.793, s: 1 } },
  { id: 'tbtn-weapon', label: '1/2 ОРУЖИЕ', w: 58, h: 58, def: { nx: 0.821, ny: 0.793, s: 1 } },
  { id: 'tbtn-ads', label: 'ADS', w: 58, h: 58, def: { nx: 0.483, ny: 0.871, s: 1 } },
  { id: 'tbtn-chat', label: 'ЧАТ', w: 58, h: 58, def: { nx: 0.652, ny: 0.871, s: 1 } },
  { id: 'tbtn-pause', label: 'ПАУЗА', w: 44, h: 44, def: { nx: 0.444, ny: 0.014, s: 1 } },
  { id: 'btn-mic-hud', label: 'МИКРО', w: 46, h: 46, def: { nx: 0.060, ny: 0.560, s: 1 } },
];

const WIDGET_BY_ID = Object.fromEntries(WIDGETS.map((w) => [w.id, w]));

// ============================
// Чистые функции (тестируются в Node)
// ============================

// Прилипание к сетке
export function snap(v, grid = GRID) {
  return Math.round(v / grid) * grid;
}

// Ориентация по размерам viewport
export function orientationOf(w, h) {
  return w > h ? 'landscape' : 'portrait';
}

export function clampScale(s) {
  s = Number.isFinite(s) ? s : 1;
  return Math.min(SCALE_MAX, Math.max(SCALE_MIN, s));
}

// Кламп виджета в экран с учётом safe-area инсетов {top,right,bottom,left}.
// x,y — левый-верхний угол ВИЗУАЛЬНОЙ (уже отмасштабированной) рамки.
export function clampWidget(x, y, w, h, viewW, viewH, safe = {}) {
  const sl = safe.left || 0, sr = safe.right || 0, st = safe.top || 0, sb = safe.bottom || 0;
  const minX = sl;
  const maxX = Math.max(minX, viewW - sr - w);
  const minY = st;
  const maxY = Math.max(minY, viewH - sb - h);
  return {
    x: Math.min(Math.max(x, minX), maxX),
    y: Math.min(Math.max(y, minY), maxY),
  };
}

// Стандартная раскладка (фракции из CSS-позиций по умолчанию)
export function defaultLayout() {
  const out = {};
  for (const w of WIDGETS) out[w.id] = { nx: w.def.nx, ny: w.def.ny, s: 1 };
  return out;
}

// Сериализация: map id -> {nx,ny,s} → JSON
export function serializeLayout(map) {
  const widgets = {};
  for (const w of WIDGETS) {
    const p = map[w.id];
    if (!p) continue;
    widgets[w.id] = {
      nx: +(+p.nx).toFixed(4),
      ny: +(+p.ny).toFixed(4),
      s: +clampScale(p.s).toFixed(3),
    };
  }
  return JSON.stringify({ v: 1, widgets });
}

// Десериализация с валидацией: битый JSON/форма → null,
// битые отдельные записи отбрасываются, s клампится.
export function parseLayout(json) {
  if (!json || typeof json !== 'string') return null;
  let obj;
  try { obj = JSON.parse(json); } catch { return null; }
  if (!obj || obj.v !== 1 || !obj.widgets || typeof obj.widgets !== 'object') return null;
  const out = {};
  for (const id in obj.widgets) {
    if (!WIDGET_BY_ID[id]) continue;
    const p = obj.widgets[id];
    if (!p || !Number.isFinite(p.nx) || !Number.isFinite(p.ny)) continue;
    out[id] = {
      nx: Math.min(1.2, Math.max(-0.2, p.nx)),
      ny: Math.min(1.2, Math.max(-0.2, p.ny)),
      s: clampScale(p.s),
    };
  }
  return Object.keys(out).length ? out : null;
}

// Мягкая проверка перекрытий: rects — [{id,x,y,w,h}] → массив пар [idA, idB]
export function findOverlaps(rects) {
  const pairs = [];
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i], b = rects[j];
      const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (ox > 0 && oy > 0) pairs.push([a.id, b.id]);
    }
  }
  return pairs;
}

// localStorage-обёртки (storage инъецируется — в тестах мок)
export function loadLayout(storage, orient) {
  try { return parseLayout(storage.getItem(LAYOUT_KEY_PREFIX + orient)); } catch { return null; }
}

export function saveLayout(storage, orient, map) {
  try {
    storage.setItem(LAYOUT_KEY_PREFIX + orient, serializeLayout(map));
    return true;
  } catch { return false; }
}

export function clearTouchLayouts(storage) {
  try {
    storage.removeItem(LAYOUT_KEY_PREFIX + 'portrait');
    storage.removeItem(LAYOUT_KEY_PREFIX + 'landscape');
    return true;
  } catch { return false; }
}

// ============================
// DOM: safe-area probe
// ============================
let _safeCache = null;
export function getSafeArea(doc = document) {
  if (_safeCache) return _safeCache;
  const probe = doc.createElement('div');
  probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;'
    + 'padding-top:env(safe-area-inset-top);padding-right:env(safe-area-inset-right);'
    + 'padding-bottom:env(safe-area-inset-bottom);padding-left:env(safe-area-inset-left);';
  doc.body.appendChild(probe);
  const cs = doc.defaultView.getComputedStyle(probe);
  _safeCache = {
    top: parseFloat(cs.paddingTop) || 0,
    right: parseFloat(cs.paddingRight) || 0,
    bottom: parseFloat(cs.paddingBottom) || 0,
    left: parseFloat(cs.paddingLeft) || 0,
  };
  probe.remove();
  return _safeCache;
}

// ============================
// DOM: применение раскладки к реальному тач-UI
// ============================
// Без сохранённой раскладки — ничего не трогаем (штатный CSS-grid).
// С раскладкой — #touch-ui.custom + inline left/top/scale каждому виджету.
export function applyTouchLayout(doc = document, win = window) {
  const ui = doc.getElementById('touch-ui');
  if (!ui) return false;
  const vw = win.innerWidth, vh = win.innerHeight;
  const orient = orientationOf(vw, vh);
  const layout = loadLayout(win.localStorage, orient);
  const resetInline = (el) => {
    el.style.left = ''; el.style.top = ''; el.style.right = ''; el.style.bottom = '';
    el.style.width = ''; el.style.height = ''; el.style.transform = ''; el.style.transformOrigin = '';
  };
  if (!layout) {
    ui.classList.remove('custom');
    for (const w of WIDGETS) {
      const el = doc.getElementById(w.id);
      if (el) resetInline(el);
    }
    return false;
  }
  const safe = getSafeArea(doc);
  ui.classList.add('custom');
  for (const w of WIDGETS) {
    const el = doc.getElementById(w.id);
    if (!el) continue;
    const p = layout[w.id] || w.def;
    const s = clampScale(p.s);
    const pos = clampWidget(p.nx * vw, p.ny * vh, w.w * s, w.h * s, vw, vh, safe);
    el.style.left = `${pos.x}px`;
    el.style.top = `${pos.y}px`;
    el.style.right = 'auto';
    el.style.bottom = 'auto';
    el.style.width = `${w.w}px`;
    el.style.height = `${w.h}px`;
    el.style.transformOrigin = '0 0';
    el.style.transform = s !== 1 ? `scale(${s})` : '';
  }
  return true;
}

// ============================
// Редактор раскладки (оверлей с drag&drop)
// ============================
export class TouchLayoutEditor {
  /**
   * @param {object} opts
   *  doc, win — DOM (инъекция для тестов/автоматизации)
   *  sfx()    — звук UI (опционально)
   *  onClose(result) — 'save' | 'cancel'
   */
  constructor(opts = {}) {
    this._doc = opts.doc || document;
    this._win = opts.win || window;
    this._sfx = opts.sfx || (() => {});
    this._onClose = opts.onClose || (() => {});
    this.isOpen = false;
    this._map = null;        // id -> {x, y, s} в PX viewport
    this._els = {};          // id -> div.tle-widget
    this._sel = null;
    this._drag = null;
    this._cssDefaults = null; // id -> {nx,ny,s} — измеренная штатная раскладка
    // Панель (кнопки/слайдер) — постоянный DOM, биндим один раз
    this.$('tle-save')?.addEventListener('click', () => this._onSave());
    this.$('tle-cancel')?.addEventListener('click', () => { this._sfx(); this.close('cancel'); });
    this.$('tle-reset')?.addEventListener('click', () => this._onReset());
    this.$('tle-scale')?.addEventListener('input', () => this._onScale());
  }

  $(id) { return this._doc.getElementById(id); }

  open() {
    if (this.isOpen) return;
    this.isOpen = true;
    const vw = this._win.innerWidth, vh = this._win.innerHeight;
    this._vw = vw; this._vh = vh;
    this._safe = getSafeArea(this._doc);
    this._cssDefaults = this._captureCssDefaults();

    // Рабочая копия: сохранённая раскладка ИЛИ штатная (измеренная/дефолтная)
    const orient = orientationOf(vw, vh);
    const saved = loadLayout(this._win.localStorage, orient);
    const base = saved || this._cssDefaults || defaultLayout();
    this._map = {};
    for (const w of WIDGETS) {
      const p = base[w.id] || w.def;
      const s = clampScale(p.s);
      const pos = clampWidget(p.nx * vw, p.ny * vh, w.w * s, w.h * s, vw, vh, this._safe);
      this._map[w.id] = { x: pos.x, y: pos.y, s };
    }
    this._renderStage();
    this._select(null);
    this._refreshOverlaps();
    this.$('touch-layout-editor')?.classList.add('visible');
  }

  close(result = 'cancel') {
    if (!this.isOpen) return;
    this.isOpen = false;
    this._drag = null;
    this.$('touch-layout-editor')?.classList.remove('visible');
    this._onClose(result);
  }

  // Измерить штатные CSS-позиции реальных элементов (временно сняв custom-раскладку)
  _captureCssDefaults() {
    const doc = this._doc;
    const ui = this.$('touch-ui');
    if (!ui) return null;
    const vw = this._win.innerWidth, vh = this._win.innerHeight;
    const els = WIDGETS.map((w) => doc.getElementById(w.id));
    const stash = els.map((el) => (el ? el.getAttribute('style') : null));
    const hadCustom = ui.classList.contains('custom');
    ui.classList.remove('custom');
    ui.classList.add('tle-measure'); // принудительный показ для замера (CSS)
    for (const el of els) if (el) el.removeAttribute('style');
    const map = {};
    for (const w of WIDGETS) {
      const el = doc.getElementById(w.id);
      if (!el) { map[w.id] = { ...w.def }; continue; }
      const r = el.getBoundingClientRect();
      map[w.id] = (r.width >= 2 && r.height >= 2)
        ? { nx: r.left / vw, ny: r.top / vh, s: 1 }
        : { ...w.def };
    }
    els.forEach((el, i) => {
      if (!el) return;
      if (stash[i] === null) el.removeAttribute('style');
      else el.setAttribute('style', stash[i]);
    });
    ui.classList.toggle('custom', hadCustom);
    ui.classList.remove('tle-measure');
    return map;
  }

  _renderStage() {
    const stage = this.$('tle-stage');
    if (!stage) return;
    stage.innerHTML = '';
    this._els = {};
    for (const w of WIDGETS) {
      const p = this._map[w.id];
      const el = this._doc.createElement('div');
      el.className = 'tle-widget';
      el.dataset.id = w.id;
      el.innerHTML = `<span class="tle-key">${w.label}</span><span class="tle-cap">${w.id.replace('tbtn-', '').replace('btn-mic-hud', 'mic').replace('stick-move', 'stick')}</span>`;
      stage.appendChild(el);
      this._els[w.id] = el;
      this._placeWidget(w.id);
      el.addEventListener('pointerdown', (e) => this._onPointerDown(e, w.id));
      el.addEventListener('pointermove', (e) => this._onPointerMove(e, w.id));
      el.addEventListener('pointerup', (e) => this._onPointerUp(e, w.id));
      el.addEventListener('pointercancel', (e) => this._onPointerUp(e, w.id));
    }
  }

  _placeWidget(id) {
    const w = WIDGET_BY_ID[id];
    const p = this._map[id];
    const el = this._els[id];
    if (!w || !p || !el) return;
    el.style.left = `${p.x}px`;
    el.style.top = `${p.y}px`;
    el.style.width = `${w.w * p.s}px`;
    el.style.height = `${w.h * p.s}px`;
    el.style.fontSize = `${Math.max(9, 12 * p.s)}px`;
  }

  _select(id) {
    this._sel = id;
    for (const wid in this._els) this._els[wid].classList.toggle('sel', wid === id);
    const slider = this.$('tle-scale');
    const val = this.$('tle-scale-val');
    const s = id ? this._map[id].s : 1;
    if (slider) slider.value = s;
    if (val) val.textContent = `×${s.toFixed(2)}`;
  }

  _onPointerDown(e, id) {
    if (!this.isOpen) return;
    this._select(id);
    const el = this._els[id];
    const p = this._map[id];
    try { el.setPointerCapture(e.pointerId); } catch {}
    this._drag = { id, pid: e.pointerId, offX: e.clientX - p.x, offY: e.clientY - p.y, moved: false };
    el.classList.add('drag');
    e.preventDefault();
  }

  _onPointerMove(e, id) {
    const d = this._drag;
    if (!d || d.id !== id || e.pointerId !== d.pid) return;
    const w = WIDGET_BY_ID[id];
    const p = this._map[id];
    let x = snap(e.clientX - d.offX);
    let y = snap(e.clientY - d.offY);
    const pos = clampWidget(x, y, w.w * p.s, w.h * p.s, this._vw, this._vh, this._safe);
    if (pos.x !== p.x || pos.y !== p.y) {
      p.x = pos.x; p.y = pos.y;
      d.moved = true;
      this._placeWidget(id);
      this._refreshOverlaps();
    }
    e.preventDefault();
  }

  _onPointerUp(e, id) {
    const d = this._drag;
    if (!d || d.id !== id || e.pointerId !== d.pid) return;
    this._drag = null;
    this._els[id]?.classList.remove('drag');
    if (d.moved) this._sfx();
  }

  _onScale() {
    const slider = this.$('tle-scale');
    if (!slider || !this._sel) return;
    const w = WIDGET_BY_ID[this._sel];
    const p = this._map[this._sel];
    p.s = clampScale(parseFloat(slider.value));
    const val = this.$('tle-scale-val');
    if (val) val.textContent = `×${p.s.toFixed(2)}`;
    // После изменения размера — доклампить позицию
    const pos = clampWidget(p.x, p.y, w.w * p.s, w.h * p.s, this._vw, this._vh, this._safe);
    p.x = pos.x; p.y = pos.y;
    this._placeWidget(this._sel);
    this._refreshOverlaps();
  }

  _onReset() {
    this._sfx();
    const base = this._cssDefaults || defaultLayout();
    for (const w of WIDGETS) {
      const src = base[w.id] || w.def;
      const pos = clampWidget(src.nx * this._vw, src.ny * this._vh, w.w, w.h, this._vw, this._vh, this._safe);
      this._map[w.id] = { x: pos.x, y: pos.y, s: 1 };
      this._placeWidget(w.id);
    }
    this._select(null);
    this._refreshOverlaps();
  }

  _onSave() {
    this._sfx();
    // px → нормализованные
    const out = {};
    for (const w of WIDGETS) {
      const p = this._map[w.id];
      out[w.id] = { nx: p.x / this._vw, ny: p.y / this._vh, s: p.s };
    }
    const orient = orientationOf(this._vw, this._vh);
    saveLayout(this._win.localStorage, orient, out);
    applyTouchLayout(this._doc, this._win);
    this.close('save');
  }

  _refreshOverlaps() {
    const rects = WIDGETS.map((w) => {
      const p = this._map[w.id];
      return { id: w.id, x: p.x, y: p.y, w: w.w * p.s, h: w.h * p.s };
    });
    const pairs = findOverlaps(rects);
    const hot = new Set(pairs.flat());
    for (const w of WIDGETS) this._els[w.id]?.classList.toggle('overlap', hot.has(w.id));
    const warn = this.$('tle-warn');
    if (warn) {
      warn.textContent = pairs.length
        ? `ПЕРЕКРЫТИЕ: ${[...hot].map((id) => WIDGET_BY_ID[id].label).join(' + ')}`
        : '';
    }
    return pairs;
  }
}
