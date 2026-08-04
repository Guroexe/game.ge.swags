// ===== GEN.SWAGS Track Select =====
// Экран «ВЫБЕРИ СВОЙ ТРЕК» перед матчем: 6 встроенных треков (BPM/жанр),
// «ЗАГРУЗИТЬ СВОЙ (MP3/WAV)» (file input + drag&drop, декод сразу, показ
// длительности и оценки BPM) и «СЛУЧАЙНЫЙ». ≤2 кликов до боя, последний
// выбор запоминается (localStorage). Выбранный трек = боевой трек на матч.
// DOM создаётся целиком из JS (инлайн-стили) — css/main.css не трогаем.
import { TRACK_META, metaFor } from './soundwar.js';

const LS_KEY = 'genswags.track.v1';

// ---------- Оценка BPM декодированного буфера ----------
// Спектральный флюкс по энергетической огибающей + автокорреляция.
// Диапазон 90..200 BPM, работает на первых ~32с микса.
export function estimateBpm(buffer, { minBpm = 90, maxBpm = 200 } = {}) {
  try {
    const sr = buffer.sampleRate;
    const ch = buffer.getChannelData(0);
    const hop = 512, frame = 1024;
    const maxSamples = Math.min(ch.length, sr * 32);
    const nFrames = Math.floor((maxSamples - frame) / hop);
    if (nFrames < 64) return 0;
    // Огибающая RMS
    const env = new Float32Array(nFrames);
    for (let i = 0; i < nFrames; i++) {
      let s = 0;
      const off = i * hop;
      for (let j = 0; j < frame; j += 4) { const v = ch[off + j]; s += v * v; }
      env[i] = Math.sqrt(s / (frame / 4));
    }
    // Флюкс (положительная разность), убрать среднее
    const flux = new Float32Array(nFrames);
    let mean = 0;
    for (let i = 1; i < nFrames; i++) {
      flux[i] = Math.max(0, env[i] - env[i - 1]);
      mean += flux[i];
    }
    mean /= nFrames;
    for (let i = 0; i < nFrames; i++) flux[i] -= mean;
    // Автокорреляция по лагам BPM-диапазона
    const envRate = sr / hop; // кадров/сек
    const lagMin = Math.max(2, Math.floor((envRate * 60) / maxBpm));
    const lagMax = Math.min(nFrames >> 1, Math.ceil((envRate * 60) / minBpm));
    let bestLag = 0, bestScore = -Infinity;
    for (let lag = lagMin; lag <= lagMax; lag++) {
      let s = 0;
      for (let i = lag; i < nFrames; i++) s += flux[i] * flux[i - lag];
      // Лёгкий штраф краям диапазона против октавных ошибок
      if (s > bestScore) { bestScore = s; bestLag = lag; }
    }
    if (!bestLag) return 0;
    let bpm = (60 * envRate) / bestLag;
    while (bpm < minBpm) bpm *= 2;
    while (bpm > maxBpm) bpm /= 2;
    return Math.round(bpm);
  } catch { return 0; }
}

function fmtDur(sec) {
  const m = Math.floor(sec / 60), s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ============================================================
export class TrackSelect {
  constructor(game) {
    this.game = game;
    this._el = null;
    this._onDone = null;
    this._sel = null;       // {kind:'builtin'|'user'|'random', index?, name?, title?, bpm?, genre?}
    this._cards = [];
    this._visible = false;
  }

  get visible() { return this._visible; }

  // Последний выбор (localStorage), с валидацией против плейлиста
  lastChoice() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      if (s.kind === 'random') return s;
      if (s.kind === 'builtin' && this.game.music.playlist[s.index]) return s;
      if (s.kind === 'user') {
        const i = this.game.music.playlist.findIndex((t) => t.name === s.name);
        if (i >= 0) return { ...s, index: i };
      }
    } catch { /* ignore */ }
    return null;
  }

  _remember(sel) {
    try {
      const keep = sel.kind === 'user'
        ? { kind: 'user', name: sel.name, title: sel.title, bpm: sel.bpm }
        : { kind: sel.kind, index: sel.index, name: sel.name, title: sel.title, bpm: sel.bpm, genre: sel.genre };
      localStorage.setItem(LS_KEY, JSON.stringify(keep));
    } catch { /* ignore */ }
  }

  // Открыть экран; onDone(sel) вызывается по «В БОЙ» (sel=null — отмена не стартует)
  open(onDone) {
    this._onDone = onDone;
    this._build();
    // Предвыбор: последний выбор или «случайный»
    const last = this.lastChoice();
    this._select(last || { kind: 'random' });
    this._el.style.display = 'flex';
    this._visible = true;
  }

  close() {
    if (this._el) this._el.style.display = 'none';
    this._visible = false;
  }

  // ---------- DOM ----------
  _build() {
    if (this._el) { this._renderCards(); return; }
    const g = this.game;
    const el = document.createElement('div');
    el.id = 'track-select';
    el.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:210', 'display:none',
      'flex-direction:column', 'align-items:center', 'justify-content:center',
      'background:rgba(8,6,14,0.82)', 'backdrop-filter:blur(3px)',
      'font-family:inherit', 'color:#e8e8f0', 'user-select:none',
    ].join(';');

    const title = document.createElement('div');
    title.textContent = 'ВЫБЕРИ СВОЙ ТРЕК';
    title.style.cssText = 'font-size:30px;letter-spacing:6px;color:#ff2d55;text-shadow:0 0 18px rgba(255,45,85,.6);margin-bottom:6px;font-weight:700';
    el.appendChild(title);
    const sub = document.createElement('div');
    sub.textContent = 'ТВОЙ ТРЕК = ЗВУК ТВОЕЙ КОМАНДЫ. ВРАГ СЛЫШЕН СВОЙ — УСЛЫШЬ ЕГО ПЕРВЫМ.';
    sub.style.cssText = 'font-size:11px;letter-spacing:2px;opacity:.65;margin-bottom:22px';
    el.appendChild(sub);

    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(3,minmax(180px,220px));gap:12px;max-width:92vw';
    el.appendChild(grid);
    this._grid = grid;

    const status = document.createElement('div');
    status.style.cssText = 'margin-top:14px;font-size:12px;letter-spacing:1px;min-height:18px;color:#a05cff';
    el.appendChild(status);
    this._status = status;

    const row = document.createElement('div');
    row.style.cssText = 'margin-top:10px;display:flex;gap:12px';
    const fight = document.createElement('button');
    fight.textContent = '⚔ В БОЙ';
    fight.style.cssText = 'padding:12px 44px;font-size:16px;letter-spacing:4px;background:#ff2d55;border:none;color:#0a0610;font-weight:700;cursor:pointer;font-family:inherit';
    fight.addEventListener('click', () => this._confirm());
    const back = document.createElement('button');
    back.textContent = 'НАЗАД';
    back.style.cssText = 'padding:12px 26px;font-size:13px;letter-spacing:3px;background:transparent;border:1px solid #555;color:#aaa;cursor:pointer;font-family:inherit';
    back.addEventListener('click', () => { g.sfx?.ui?.(); this.close(); });
    row.appendChild(fight);
    row.appendChild(back);
    el.appendChild(row);

    // Скрытый file input для своего трека
    const fi = document.createElement('input');
    fi.type = 'file';
    fi.accept = 'audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/*';
    fi.style.display = 'none';
    fi.addEventListener('change', () => {
      if (fi.files?.[0]) this._loadUser(fi.files[0]);
      fi.value = '';
    });
    el.appendChild(fi);
    this._fileInput = fi;

    // Drag&drop на весь экран
    el.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      const f = e.dataTransfer?.files?.[0];
      if (f) this._loadUser(f);
    });

    // Esc — назад
    this._onKey = (e) => { if (e.code === 'Escape' && this._visible) { this.close(); } };
    window.addEventListener('keydown', this._onKey);

    document.body.appendChild(el);
    this._el = el;
    this._renderCards();
  }

  _card({ key, title, genre, bpm, extra }) {
    const c = document.createElement('button');
    c.dataset.key = key;
    c.style.cssText = [
      'display:flex', 'flex-direction:column', 'align-items:flex-start', 'gap:4px',
      'padding:14px 16px', 'background:rgba(20,14,30,0.85)', 'border:1px solid #3a2a55',
      'color:#e8e8f0', 'cursor:pointer', 'text-align:left', 'font-family:inherit',
      'transition:border-color .12s, background .12s',
    ].join(';');
    const t = document.createElement('div');
    t.textContent = title;
    t.style.cssText = 'font-size:15px;font-weight:700;letter-spacing:1px';
    const gline = document.createElement('div');
    gline.textContent = genre || '';
    gline.style.cssText = 'font-size:11px;letter-spacing:2px;color:#b388ff';
    const bline = document.createElement('div');
    bline.textContent = bpm ? `♪ ${bpm} BPM` : (extra || '');
    bline.style.cssText = 'font-size:11px;letter-spacing:1px;opacity:.7';
    c.append(t, gline, bline);
    c._bline = bline;
    c.addEventListener('click', () => this._onCardClick(key));
    c.addEventListener('dblclick', () => this._confirm());
    this._grid.appendChild(c);
    this._cards.push(c);
    return c;
  }

  _renderCards() {
    this._grid.innerHTML = '';
    this._cards.length = 0;
    const pl = this.game.music.playlist;
    // 6 встроенных треков (по TRACK_META, если загружены)
    TRACK_META.forEach((meta) => {
      const index = pl.findIndex((t) => t.name === meta.file);
      if (index < 0) return;
      this._card({
        key: `builtin:${index}`,
        title: meta.title,
        genre: meta.genre,
        bpm: meta.bpm,
      });
    });
    // Пользовательские треки (уже загруженные ранее)
    pl.forEach((t, i) => {
      if (metaFor(t.name)) return; // встроенные уже выше
      this._card({
        key: `user:${i}`,
        title: t.name.replace(/\.[^.]+$/, '').slice(0, 26).toUpperCase(),
        genre: 'СВОЙ ТРЕК',
        bpm: 0,
        extra: t.buffer ? fmtDur(t.buffer.duration) : '',
      });
    });
    // Загрузка своего
    const up = this._card({ key: 'upload', title: '＋ ЗАГРУЗИТЬ СВОЙ', genre: 'MP3 / WAV', extra: 'клик или перетащи файл' });
    up.style.borderStyle = 'dashed';
    // Случайный
    this._card({ key: 'random', title: '🎲 СЛУЧАЙНЫЙ', genre: 'СУДЬБА РЕШИТ', extra: 'любой боевой трек' });
    this._refreshSelection();
  }

  _onCardClick(key) {
    this.game.sfx?.ui?.();
    if (key === 'upload') { this._fileInput?.click(); return; }
    const [kind, idx] = key.split(':');
    if (kind === 'random') { this._select({ kind: 'random' }); return; }
    const index = parseInt(idx, 10);
    const pl = this.game.music.playlist;
    const t = pl[index];
    if (!t) return;
    const meta = metaFor(t.name);
    this._select({
      kind: meta ? 'builtin' : 'user',
      index,
      name: t.name,
      title: meta?.title || t.name,
      genre: meta?.genre || 'СВОЙ ТРЕК',
      bpm: meta?.bpm || 0,
    });
  }

  _select(sel) {
    this._sel = sel;
    this._refreshSelection();
  }

  _refreshSelection() {
    const selKey = this._sel
      ? (this._sel.kind === 'random' ? 'random' : `${this._sel.kind === 'builtin' ? 'builtin' : 'user'}:${this._sel.index}`)
      : null;
    for (const c of this._cards) {
      const on = c.dataset.key === selKey;
      c.style.borderColor = on ? '#ff2d55' : (c.style.borderStyle === 'dashed' ? '#3a2a55' : '#3a2a55');
      c.style.background = on ? 'rgba(60,16,34,0.95)' : 'rgba(20,14,30,0.85)';
      c.style.boxShadow = on ? '0 0 16px rgba(255,45,85,.35)' : 'none';
    }
    if (this._status && this._sel) {
      this._status.textContent = this._sel.kind === 'random'
        ? 'ВЫБРАНО: СЛУЧАЙНЫЙ ТРЕК'
        : `ВЫБРАНО: ${this._sel.title || this._sel.name}${this._sel.bpm ? ` · ♪ ${this._sel.bpm} BPM` : ''}`;
    }
  }

  // Декод своего файла сразу: длительность + оценка BPM на карточке
  async _loadUser(file) {
    const g = this.game;
    if (this._status) this._status.textContent = `ДЕКОДИРУЮ: ${file.name}…`;
    const before = g.music.playlist.length;
    const okLoad = await g.music.loadUserFile(file);
    if (!okLoad || g.music.playlist.length === before) {
      if (this._status) this._status.textContent = 'НЕ УДАЛОСЬ ДЕКОДИРОВАТЬ ФАЙЛ';
      return;
    }
    const index = g.music.playlist.length - 1;
    const t = g.music.playlist[index];
    const bpm = estimateBpm(t.buffer);
    t.userBpm = bpm; // используется soundwar для синка
    this._renderCards();
    this._select({
      kind: 'user', index, name: t.name,
      title: t.name.replace(/\.[^.]+$/, '').slice(0, 26).toUpperCase(),
      genre: 'СВОЙ ТРЕК', bpm,
    });
    if (this._status) {
      this._status.textContent =
        `ЗАГРУЖЕН: ${t.name} · ${fmtDur(t.buffer.duration)} · ♪ ~${bpm || '—'} BPM`;
    }
    g.sfx?.ui?.();
  }

  _confirm() {
    if (!this._sel) return;
    this.game.sfx?.ui?.();
    this._remember(this._sel);
    this.close();
    this._onDone?.(this._sel);
  }
}
