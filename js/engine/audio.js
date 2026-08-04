// ===== GEN.SWAGS Audio =====
// MusicEngine: плейлист, анализатор (бас/мид/хай), детектор битов, BPM, дропы,
// классификатор фаз трека (intro/build/drop/breakdown).
// SFX: процедурные звуки через Web Audio (без внешних файлов).

// ===== DSP-хелперы (чистые функции — тестируются в Node) =====
// Кривая биткрашера: k=0 → ~прозрачно (256 уровней), k=1 → 4-бит (16 уровней)
export function bitcrushCurve(k = 0, n = 2048) {
  const levels = Math.max(4, Math.round(256 - 240 * Math.min(1, Math.max(0, k))));
  const curve = new Float32Array(n);
  const half = levels / 2;
  for (let i = 0; i < n; i++) {
    const v = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.round(v * half) / half;
  }
  return curve;
}

// Процедурный импульс реверба: экспоненциально затухающий шум (2 канала)
export function makeImpulse(ctx, dur = 1.9, decay = 3.4) {
  const len = Math.max(16, Math.floor(ctx.sampleRate * dur));
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
  }
  return buf;
}

// ===== Классификатор структуры трека =====
// Скользящие окна энергии/баса → фазы: intro → build → drop → breakdown.
// Эвристики: рост баса ≥2× за ~2с = drop; энергия <40% скользящего среднего
// 4с подряд = breakdown; устойчивый рост энергии = build.
// Чистая логика без Web Audio — тестируется в Node на синтетических данных.
export class PhaseClassifier {
  constructor() {
    this.phase = 'intro';
    this._t = 0;
    this._phaseT = 0;        // время в текущей фазе (гистерезис)
    this._bass = [];         // {t, v} за последние ~6с
    this._energy = [];       // {t, v}
    this._avgEnergy = 0;     // медленное скользящее среднее энергии
    this._lowT = 0;          // секунд подряд энергия < 40% среднего
    this._cbs = [];
    this.minPhaseTime = 2;   // минимальная длительность фазы
    this.dropHoldTime = 6;   // drop держится минимум столько
  }

  onPhase(cb) { this._cbs.push(cb); }

  _avgWin(arr, fromT, toT) {
    let s = 0, n = 0;
    for (const s2 of arr) {
      if (s2.t >= fromT && s2.t < toT) { s += s2.v; n++; }
    }
    return n ? s / n : 0;
  }

  _setPhase(p) {
    if (p === this.phase) return;
    this.phase = p;
    this._phaseT = 0;
    for (const cb of this._cbs) cb(p);
  }

  // Вызывать каждый апдейт с текущими энергиями (0..1) и dt, сек
  push(bass, energy, dt) {
    this._t += dt;
    this._phaseT += dt;
    this._bass.push({ t: this._t, v: bass });
    this._energy.push({ t: this._t, v: energy });
    while (this._bass.length && this._bass[0].t < this._t - 6) this._bass.shift();
    while (this._energy.length && this._energy[0].t < this._t - 6) this._energy.shift();
    // Медленное среднее энергии (τ ≈ 8с)
    const k = Math.min(1, dt / 8);
    this._avgEnergy = this._avgEnergy ? this._avgEnergy + (energy - this._avgEnergy) * k : energy;

    // BREAKDOWN: энергия < 40% среднего 4с подряд (в любой фазе, кроме intro-разгона)
    if (this._t > 4 && energy < this._avgEnergy * 0.4) this._lowT += dt;
    else this._lowT = 0;
    if (this._lowT >= 4) { this._setPhase('breakdown'); return; }

    if (this._phaseT < this.minPhaseTime) return;

    // DROP: бас сейчас (0.5с) ≥2× против баса ~2с назад
    const bassNow = this._avgWin(this._bass, this._t - 0.5, this._t);
    const bassPrev = this._avgWin(this._bass, this._t - 2.5, this._t - 2.0);
    if (bassPrev > 0.02 && bassNow >= bassPrev * 2 && this.phase !== 'drop') {
      this._setPhase('drop');
      return;
    }
    // Drop держится, пока энергия не упала заметно ниже среднего
    if (this.phase === 'drop') {
      if (this._phaseT >= this.dropHoldTime && energy < this._avgEnergy * 0.85) {
        this._setPhase('build');
      }
      return;
    }
    // BUILD: энергия выросла >1.3× за последние 2с
    const eNow = this._avgWin(this._energy, this._t - 0.5, this._t);
    const ePrev = this._avgWin(this._energy, this._t - 2.5, this._t - 2.0);
    if (ePrev > 0.02 && eNow >= ePrev * 1.3 && this.phase !== 'build') {
      this._setPhase('build');
    }
  }

  reset() {
    this.phase = 'intro';
    this._t = 0; this._phaseT = 0;
    this._bass.length = 0; this._energy.length = 0;
    this._avgEnergy = 0; this._lowT = 0;
  }
}

export class MusicEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.analyser = null;
    this.source = null;
    this.gainNode = null;
    this.playlist = [];          // [{name, buffer}]
    this.trackIndex = -1;
    this.playing = false;
    this.bpm = 0;
    this._started = false;

    this._freq = null;           // Uint8Array частот
    this._beatCbs = [];
    this._dropCbs = [];
    this._bassHist = [];         // история басовой энергии (окно ~2с при 60fps)
    this._beatTimes = [];        // время ударов для BPM
    this._lastBeatAt = 0;
    this._beatThresh = 1.4;      // adaptive порог
    this.energies = { bass: 0, mid: 0, high: 0, total: 0 };

    // Структура трека: intro/build/drop/breakdown
    this.phases = new PhaseClassifier();
    this._phaseCbs = [];
    this._lastUpdateAt = 0;
    this.phases.onPhase((p) => { for (const cb of this._phaseCbs) cb(p); });

    // Автоплей-политика: старт по первому жесту
    const unlock = () => {
      this._ensureCtx();
      if (this.ctx.state === 'suspended') this.ctx.resume();
      if (this.playlist.length && !this.playing) this.play();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      window.removeEventListener('touchstart', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    window.addEventListener('touchstart', unlock);
  }

  _ensureCtx() {
    if (this.ctx) return;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.55;
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.78;
    this.gainNode = this.ctx.createGain();
    // Цепочка «перехода между мирами»: gain → duck → bitcrush → lowpass → analyser
    // (+ параллельный реверб-сенд с процедурным импульсом). В покое — прозрачна.
    this.transGain = this.ctx.createGain();
    this.transCrush = this.ctx.createWaveShaper();
    this.transCrush.oversample = 'none';
    this.transCrush.curve = bitcrushCurve(0);
    this.transLow = this.ctx.createBiquadFilter();
    this.transLow.type = 'lowpass';
    this.transLow.frequency.value = 18000;
    this.transLow.Q.value = 0.5;
    this.gainNode.connect(this.transGain);
    this.transGain.connect(this.transCrush);
    this.transCrush.connect(this.transLow);
    this.transLow.connect(this.analyser);
    // Реверб-всплеск перехода (слышен только когда transVerbGain > 0)
    this.transVerb = this.ctx.createConvolver();
    this.transVerb.buffer = makeImpulse(this.ctx, 1.9, 3.4);
    this.transVerbGain = this.ctx.createGain();
    this.transVerbGain.gain.value = 0;
    this.transLow.connect(this.transVerb);
    this.transVerb.connect(this.transVerbGain);
    this.transVerbGain.connect(this.master);
    this.analyser.connect(this.master);
    this.master.connect(this.ctx.destination);
    this._transRate = 1;      // множитель rate для перехода (×0.6 — «провал»)
    this._transCrushK = 0;
    // Вражеский поток SOUND WAR (создаётся attachEnemy)
    this.enemySource = null;
    this.enemyLow = null;
    this.enemyCrush = null;
    this.enemyGain = null;
    this.enemyPan = null;
    this._enemyRate = 1;
    this._enemyCrushK = 0;
    this._freq = new Uint8Array(this.analyser.frequencyBinCount);
  }

  // Загрузка встроенных треков; отсутствующие файлы тихо пропускаются
  async loadBuiltin(urls) {
    this._ensureCtx();
    const jobs = urls.map(async (url) => {
      try {
        const res = await fetch(url);
        if (!res.ok) return;
        const buf = await res.arrayBuffer();
        const audio = await this.ctx.decodeAudioData(buf);
        this.playlist.push({ name: url.split('/').pop(), buffer: audio });
      } catch { /* файла нет — молча пропускаем */ }
    });
    await Promise.all(jobs);
    return this.playlist.length;
  }

  // Пользовательский файл (input[type=file] / drag&drop)
  async loadUserFile(file) {
    this._ensureCtx();
    try {
      const buf = await file.arrayBuffer();
      const audio = await this.ctx.decodeAudioData(buf);
      this.playlist.push({ name: file.name, buffer: audio });
      if (!this.playing) { this.trackIndex = this.playlist.length - 2; this.next(); }
      return true;
    } catch { return false; }
  }

  play() {
    if (!this.ctx || !this.playlist.length) return;
    if (this.playing) return;
    if (this.trackIndex < 0) this.trackIndex = 0;
    this._startTrack(this.trackIndex);
  }

  _startTrack(i) {
    this.stopSource();
    const t = this.playlist[i];
    if (!t) return;
    const src = this.ctx.createBufferSource();
    src.buffer = t.buffer;
    src.loop = true;
    // Trim-сегмент: трек играет внутри «самого жирного» куска (meta.start/end, сек)
    const dur = t.buffer?.duration || 0;
    const segS = Math.max(0, t.segStart || 0);
    const segE = Math.min(dur, t.segEnd || dur);
    if (segE > segS + 0.5) {
      src.loopStart = segS;
      src.loopEnd = segE;
    }
    src.playbackRate.value = this._transRate || 1; // сохранить «провал» при смене трека
    src.connect(this.gainNode);
    src.start(0, segS); // начинаем с начала сегмента (иначе — тишина до loop)

    this._trackStartedAt = this.ctx.currentTime;
    this.source = src;
    this.playing = true;
    this.trackIndex = i;
    this._beatTimes.length = 0;
    this.bpm = 0;
    this.phases.reset();
    this._lastUpdateAt = 0;
  }

  stopSource() {
    if (this.source) { try { this.source.stop(); } catch {} this.source.disconnect(); this.source = null; }
    this.playing = false;
  }

  pause() {
    if (this.ctx && this.playing) { this.ctx.suspend(); this.playing = false; }
  }
  resume() {
    if (this.ctx && !this.playing && this.source) { this.ctx.resume(); this.playing = true; }
  }

  next() {
    if (!this.playlist.length) return;
    this._startTrack((this.trackIndex + 1) % this.playlist.length);
  }

  playTrack(i) {
    if (i < 0 || i >= this.playlist.length) return;
    this._startTrack(i);
  }

  // Громкость музыки 0..1
  setVolume(v) {
    this._vol = v;
    if (this.master) this.master.gain.value = v;
  }
  getVolume() { return this._vol ?? 0.55; }

  // Прогресс текущего трека 0..1 (луп — по длине буфера)
  trackProgress() {
    if (!this.ctx || !this.source || !this.playlist[this.trackIndex]) return 0;
    const dur = this.playlist[this.trackIndex].buffer.duration;
    if (!dur) return 0;
    return ((this.ctx.currentTime - (this._trackStartedAt || 0)) % dur) / dur;
  }

  // ===== Переход между мирами (смерть / конец матча) =====
  // Искажение боевого трека: rate вниз (питч ×0.6), bitcrush 4-bit,
  // lowpass sweep вниз, реверб-всплеск, duck («тишина»). Всё сглажено
  // setTargetAtTime — можно драйвить каждый кадр из TransitionFX.
  // v: {rate 0.05..1, lpHz, crush 0..1, verb 0..1, duck 0..1}
  setTransition(v = {}) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (v.rate != null && isFinite(v.rate)) {
      this._transRate = Math.max(0.05, Math.min(1.5, v.rate));
      if (this.source) this.source.playbackRate.setTargetAtTime(this._transRate, t, 0.06);
      // Вражеский поток проваливается вместе с основным
      if (this.enemySource) {
        this.enemySource.playbackRate.setTargetAtTime((this._enemyRate || 1) * this._transRate, t, 0.06);
      }
    }
    if (v.lpHz != null && this.transLow) {
      this.transLow.frequency.setTargetAtTime(Math.max(60, v.lpHz), t, 0.08);
    }
    if (v.crush != null && this.transCrush) {
      const k = Math.min(1, Math.max(0, v.crush));
      if (Math.abs(k - this._transCrushK) > 0.08) {
        this._transCrushK = k;
        this.transCrush.curve = bitcrushCurve(k);
      }
    }
    if (v.verb != null && this.transVerbGain) {
      this.transVerbGain.gain.setTargetAtTime(Math.min(1, Math.max(0, v.verb)) * 0.7, t, 0.1);
    }
    if (v.duck != null && this.transGain) {
      this.transGain.gain.setTargetAtTime(1 - Math.min(0.95, Math.max(0, v.duck)), t, 0.03);
    }
  }

  resetTransition() {
    this.setTransition({ rate: 1, lpHz: 18000, crush: 0, verb: 0, duck: 0 });
  }

  // «Тишина-удар»: суб-дроп + шумовой хлопок в момент провала между мирами
  transitionHit() {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(52, t);
    o.frequency.exponentialRampToValueAtTime(22, t + 0.85);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.9, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.95);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + 1);
    // Шумовой хлопок (широкая полоса, быстрый спад)
    const len = Math.floor(ctx.sampleRate * 0.4);
    const nb = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = nb.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 5);
    const ns = ctx.createBufferSource();
    ns.buffer = nb;
    const nf = ctx.createBiquadFilter();
    nf.type = 'lowpass'; nf.frequency.setValueAtTime(3000, t);
    nf.frequency.exponentialRampToValueAtTime(180, t + 0.4);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.5, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.42);
    ns.connect(nf); nf.connect(ng); ng.connect(this.master);
    ns.start(t); ns.stop(t + 0.45);
  }

  // ===== Вражеский аудио-поток «личности» (SOUND WAR) =====
  // Второй буфер через свою цепь lowpass → bitcrush → gain → pan → master.
  // БЕЗ analyser (половинное качество анализа): параметры геймплея считает
  // soundwar.js из счёта/FLOW/зон — аудио только исполняет.
  attachEnemy(buffer, { rate = 1 } = {}) {
    if (!this.ctx || !buffer) return false;
    this.detachEnemy();
    const ctx = this.ctx;
    this.enemyLow = ctx.createBiquadFilter();
    this.enemyLow.type = 'lowpass';
    this.enemyLow.frequency.value = 800;
    this.enemyLow.Q.value = 0.6;
    this.enemyCrush = ctx.createWaveShaper();
    this.enemyCrush.oversample = 'none';
    this.enemyCrush.curve = bitcrushCurve(0);
    this._enemyCrushK = 0;
    this.enemyGain = ctx.createGain();
    this.enemyGain.gain.value = 0;
    this.enemyPan = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    this._enemyRate = rate;
    src.playbackRate.value = rate * (this._transRate || 1);
    src.connect(this.enemyLow);
    this.enemyLow.connect(this.enemyCrush);
    this.enemyCrush.connect(this.enemyGain);
    this.enemyGain.connect(this.enemyPan);
    this.enemyPan.connect(this.master);
    src.start();
    this.enemySource = src;
    return true;
  }

  detachEnemy() {
    if (this.enemySource) { try { this.enemySource.stop(); } catch {} this.enemySource.disconnect(); }
    for (const n of ['enemySource', 'enemyLow', 'enemyCrush', 'enemyGain', 'enemyPan']) {
      if (this[n] && n !== 'enemySource') { try { this[n].disconnect(); } catch {} }
      this[n] = null;
    }
  }

  get enemyActive() { return !!this.enemySource; }

  // Подгонка темпа врага: базовый rate хранится отдельно, переходный множитель общий
  setEnemyRate(rate) {
    if (!isFinite(rate) || rate <= 0) return;
    this._enemyRate = rate;
    if (this.ctx && this.enemySource) {
      this.enemySource.playbackRate.setTargetAtTime(rate * (this._transRate || 1), this.ctx.currentTime, 0.15);
    }
  }

  // Геймплейный микс вражеского потока (вызывать каждый кадр — сглажено)
  setEnemyMix({ gain, lpHz, crush, pan } = {}) {
    if (!this.ctx || !this.enemySource) return;
    const t = this.ctx.currentTime;
    if (gain != null && this.enemyGain) {
      this.enemyGain.gain.setTargetAtTime(Math.max(0, Math.min(1, gain)), t, 0.09);
    }
    if (lpHz != null && this.enemyLow) {
      this.enemyLow.frequency.setTargetAtTime(Math.max(80, lpHz), t, 0.09);
    }
    if (crush != null && this.enemyCrush) {
      const k = Math.min(1, Math.max(0, crush));
      if (Math.abs(k - this._enemyCrushK) > 0.08) {
        this._enemyCrushK = k;
        this.enemyCrush.curve = bitcrushCurve(k);
      }
    }
    if (pan != null && this.enemyPan && this.enemyPan.pan) {
      this.enemyPan.pan.setTargetAtTime(Math.max(-1, Math.min(1, pan)), t, 0.09);
    }
  }

  onBeat(cb) { this._beatCbs.push(cb); }
  onDrop(cb) { this._dropCbs.push(cb); }
  // Фазы трека: 'intro' | 'build' | 'drop' | 'breakdown'
  onPhase(cb) { this._phaseCbs.push(cb); }
  get phase() { return this.phases.phase; }

  // Текущие энергии (0..1)
  energy() { return this.energies; }

  // ===== STUTTER/CHOP («как в эдитах») =====
  // Резкие провалы гейна на 1/16 долях (2-4 чопа) + опциональный питч-дип
  // (tape-stop микро). Вызывается автоматически на битах — ОЧЕНЬ часто —
  // и вручную на киллах/дропах. Гейн возвращается к исходному значению.
  stutter(intensity = 1, { pitchDip = false } = {}) {
    if (!this.ctx || !this.playing || !this.source) return;
    const t = this.ctx.currentTime;
    if (t - (this._lastStutterAt || 0) < 0.18) return; // не наслаиваем друг на друга
    this._lastStutterAt = t;
    const bpm = this.bpm || 140;
    const s16 = 60 / bpm / 4;
    const chops = 2 + ((Math.random() * 3) | 0); // 2..4 чопа
    const g = this.gainNode.gain;
    const cur = Math.max(0.0001, g.value);
    g.cancelScheduledValues(t);
    g.setValueAtTime(cur, t);
    let tt = t;
    const lo = Math.max(0.008, 0.07 - intensity * 0.055);
    for (let i = 0; i < chops * 2; i++) {
      tt += s16;
      const on = i % 2 === 1;
      g.linearRampToValueAtTime(on ? cur : lo, tt);
    }
    g.linearRampToValueAtTime(cur, tt + s16);
    if (pitchDip) {
      const pr = this.source.playbackRate;
      const base = this._transRate || 1;
      pr.cancelScheduledValues(t);
      pr.setValueAtTime(Math.max(0.05, base), t);
      pr.exponentialRampToValueAtTime(Math.max(0.05, base * 0.5), t + s16 * 1.5);
      pr.exponentialRampToValueAtTime(Math.max(0.05, base), t + s16 * (chops * 2 + 1));
    }
  }

  // Вызывать каждый кадр
  update() {
    if (!this.ctx || !this.analyser || !this.playing) {
      // Затухание энергий при паузе
      const e = this.energies;
      e.bass *= 0.95; e.mid *= 0.95; e.high *= 0.95; e.total *= 0.95;
      return;
    }
    this.analyser.getByteFrequencyData(this._freq);
    const sr = this.ctx.sampleRate;
    const binHz = sr / this.analyser.fftSize;
    const bandAvg = (lo, hi) => {
      const a = Math.max(1, Math.floor(lo / binHz));
      const b = Math.min(this._freq.length - 1, Math.ceil(hi / binHz));
      let s = 0;
      for (let i = a; i <= b; i++) s += this._freq[i];
      return s / ((b - a + 1) * 255);
    };
    const e = this.energies;
    e.bass = bandAvg(20, 150);
    e.mid = bandAvg(150, 2000);
    e.high = bandAvg(2000, 12000);
    e.total = (e.bass + e.mid + e.high) / 3;

    // --- Структура трека: фазы intro/build/drop/breakdown ---
    const nowU = this.ctx.currentTime;
    const dtU = this._lastUpdateAt ? Math.min(0.25, nowU - this._lastUpdateAt) : 1 / 60;
    this._lastUpdateAt = nowU;
    this.phases.push(e.bass, e.total, dtU);

    // --- Детектор битов: adaptive decay порог по басу ---
    const now = this.ctx.currentTime;
    this._bassHist.push(e.bass);
    if (this._bassHist.length > 120) this._bassHist.shift();
    const avg = this._bassHist.reduce((a, v) => a + v, 0) / this._bassHist.length;
    this._beatThresh = Math.max(1.15, this._beatThresh * 0.998); // decay
    if (e.bass > avg * this._beatThresh && now - this._lastBeatAt > 0.22 && e.bass > 0.18) {
      this._lastBeatAt = now;
      this._beatThresh = Math.min(2.2, this._beatThresh + 0.25);
      this._beatTimes.push(now);
      if (this._beatTimes.length > 24) this._beatTimes.shift();
      for (const cb of this._beatCbs) cb(e.bass);
      this._estimateBpm();
      // АВТО-СТАТТЕР «как в эдитах»: очень часто, плотность растёт с энергией,
      // на дропе — почти каждый второй-третий бит. 25% — с питч-дипом.
      if (this.bpm) {
        const e1 = Math.min(1, e.total * 1.4);
        let p = 0.10 + e1 * 0.22;
        if (this.phases.phase === 'drop') p += 0.18;
        if (Math.random() < p) this.stutter(0.6 + e1 * 0.4, { pitchDip: Math.random() < 0.25 });
      }
    }

    // --- Детектор дропа: резкий рост баса >1.6× среднего окна ---
    if (this._bassHist.length > 60) {
      const win = this._bassHist.slice(-60, -5);
      const winAvg = win.reduce((a, v) => a + v, 0) / win.length;
      if (winAvg > 0.05 && e.bass > winAvg * 1.6 && now - (this._lastDropAt || 0) > 4) {
        this._lastDropAt = now;
        for (const cb of this._dropCbs) cb(e.bass / winAvg);
      }
    }
  }

  // BPM: автокорреляция интервалов, диапазон 120-190
  _estimateBpm() {
    const t = this._beatTimes;
    if (t.length < 6) return;
    const intervals = [];
    for (let i = 1; i < t.length; i++) intervals.push(t[i] - t[i - 1]);
    let bestLag = 0, bestScore = -1;
    for (let bpm = 120; bpm <= 190; bpm += 1) {
      const period = 60 / bpm;
      let score = 0;
      for (const iv of intervals) {
        // Ближайшее кратное периоду
        const k = Math.max(1, Math.round(iv / period));
        const err = Math.abs(iv - k * period) / period;
        score += Math.exp(-err * err * 30);
      }
      if (score > bestScore) { bestScore = score; bestLag = bpm; }
    }
    // Сглаживание оценки
    this.bpm = this.bpm ? Math.round(this.bpm * 0.7 + bestLag * 0.3) : bestLag;
  }
}

// ===== Процедурные SFX =====
export class SFX {
  constructor(musicEngine) {
    this._music = musicEngine; // делим AudioContext
    this.master = null;
    this._noiseBuf = null;
    this._oneShots = null;     // {key: AudioBuffer} — mp3-одношоты
  }

  // Загрузка mp3-одношотов (fetch+decode). Отсутствующие файлы тихо пропускаются —
  // соответствующие методы упадут на процедурный fallback.
  async loadOneShots(map) {
    this._music._ensureCtx();
    this._oneShots = this._oneShots || {};
    const jobs = Object.entries(map).map(async ([key, url]) => {
      try {
        const res = await fetch(url);
        if (!res.ok) return;
        const buf = await res.arrayBuffer();
        this._oneShots[key] = await this._music.ctx.decodeAudioData(buf);
      } catch { /* нет файла — процедурный fallback */ }
    });
    await Promise.all(jobs);
  }

  // Проиграть одношот; false, если буфер не загружен (вызывающий делает fallback)
  _playOneShot(key, gain = 0.8, rate = 1) {
    const buf = this._oneShots?.[key];
    if (!buf) return false;
    this._ensureMaster();
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    src.connect(g); g.connect(this.master);
    src.start();
    return true;
  }

  get ctx() { this._music._ensureCtx(); return this._music.ctx; }

  setVolume(v) {
    this._vol = v;
    if (this.master) this.master.gain.value = v;
  }

  _ensureMaster() {
    if (this.master) return;
    this.master = this.ctx.createGain();
    this.master.gain.value = this._vol ?? 0.7;
    this.master.connect(this.ctx.destination);
    // Шумовой буфер 1с
    const len = this.ctx.sampleRate;
    this._noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this._noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  _noise(dur, { freq = 2000, q = 0.8, gain = 0.5, type = 'bandpass', decay = 12 } = {}) {
    this._ensureMaster();
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + dur);
  }

  _tone(dur, { freq = 440, freqEnd = null, type = 'square', gain = 0.3, decay = 14 } = {}) {
    this._ensureMaster();
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur);
  }

  // Ритм-акцент: «хорус» из двух расстроенных осцилляторов (±9 центов).
  // perfect — выше и ярче, good — ниже и тише.
  beatAccent(quality = 'perfect') {
    const perfect = quality === 'perfect';
    this._chorus(perfect ? 0.16 : 0.1, {
      freq: perfect ? 880 : 620,
      gain: perfect ? 0.2 : 0.12,
    });
  }
  _chorus(dur, { freq = 880, gain = 0.2 } = {}) {
    this._ensureMaster();
    const t = this.ctx.currentTime;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    for (const det of [-9, 9]) {
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = freq;
      o.detune.value = det;
      o.connect(g);
      o.start(t); o.stop(t + dur);
    }
    g.connect(this.master);
  }

  shoot() { this.shot('rifle'); }
  shotgun() { this.shot('shotgun'); }
  // Реалистичный выстрел: СНАЧАЛА сэмпл реального выстрела (Wikimedia
  // Commons, PCM WAV — работает и на iOS), поверх — лёгкий синтез
  // (механика затвора + хвост отражения). Нет сэмпла — полный синтез:
  // crack + body + mech + tail. Без sci-fi бластеров.
  shot(kind = 'rifle') {
    // Сэмпл реального 9мм выстрела: тон под ствол (rate) + громкость
    const SMP = {
      smg: 1.18, rifle: 1.0, lmg: 0.92, dmr: 0.82,
      revolver: 0.88, shotgun: 0.68, awp: 0.58,
    }[kind];
    const sampled = SMP
      ? this._playOneShot('gun_rifle', 0.8, SMP * (0.97 + Math.random() * 0.06))
      : false;
    const P = {
      smg:      { crack: 3400, crackG: 0.55, body: 150, bodyG: 0.42, tail: 0.14, tailG: 0.20, mech: 2200 },
      rifle:    { crack: 2600, crackG: 0.60, body: 115, bodyG: 0.50, tail: 0.24, tailG: 0.26, mech: 1700 },
      lmg:      { crack: 2300, crackG: 0.62, body: 100, bodyG: 0.55, tail: 0.28, tailG: 0.30, mech: 1500 },
      shotgun:  { crack: 1400, crackG: 0.70, body: 70,  bodyG: 0.70, tail: 0.38, tailG: 0.40, mech: 900, pump: true },
      dmr:      { crack: 2100, crackG: 0.65, body: 90,  bodyG: 0.55, tail: 0.42, tailG: 0.34, mech: 1300, bolt: true },
      revolver: { crack: 1800, crackG: 0.68, body: 80,  bodyG: 0.62, tail: 0.40, tailG: 0.36, mech: 1100 },
      awp:      { crack: 1600, crackG: 0.75, body: 55,  bodyG: 0.78, tail: 0.60, tailG: 0.46, mech: 1000, bolt: true, echo: true },
      rocket:   { crack: 900,  crackG: 0.50, body: 60,  bodyG: 0.60, tail: 0.50, tailG: 0.40, mech: 700, whoosh: true },
      gl:       { crack: 700,  crackG: 0.45, body: 95,  bodyG: 0.55, tail: 0.22, tailG: 0.25, mech: 800, thump: true },
      flamer:   { crack: 600,  crackG: 0.22, body: 120, bodyG: 0.20, tail: 0.18, tailG: 0.22, mech: 500, whoosh: true },
    }[kind] || { crack: 2600, crackG: 0.6, body: 115, bodyG: 0.5, tail: 0.24, tailG: 0.26, mech: 1700 };
    const jit = 0.94 + Math.random() * 0.12;
    // Если сэмпл играет — синтез только дополняет (тише)
    const k = sampled ? 0.45 : 1;
    // 1) щелчок пороховых газов — короткий высокочастотный всплеск
    this._noise(0.035, { freq: P.crack * jit, gain: P.crackG * k, q: 0.7, type: 'highpass' });
    this._noise(0.02, { freq: P.crack * 2.1, gain: P.crackG * 0.5 * k, q: 1, type: 'highpass' });
    // 2) тело выстрела — низкий удар с падением тона
    this._tone(0.09, { freq: P.body * 2, freqEnd: P.body * 0.5, type: 'triangle', gain: P.bodyG * k });
    this._tone(0.12, { freq: P.body, freqEnd: Math.max(24, P.body * 0.35), type: 'sine', gain: P.bodyG * 0.9 * k });
    // 3) механика: щелчок затвора чуть позже
    setTimeout(() => this._noise(0.012, { freq: P.mech * jit, gain: 0.16, q: 2, type: 'bandpass' }), 26 + Math.random() * 10);
    // 4) хвост-отражение от окружения
    this._noise(P.tail, { freq: 500 + P.crack * 0.12, gain: P.tailG * (sampled ? 0.7 : 1), q: 0.4, type: 'lowpass' });
    if (P.echo) setTimeout(() => this._noise(0.3, { freq: 380, gain: 0.18, q: 0.5, type: 'lowpass' }), 130);
    if (P.whoosh) this._noise(0.28, { freq: 1600, gain: 0.24, q: 0.8, type: 'bandpass' });
    if (P.thump) this._tone(0.14, { freq: 130, freqEnd: 45, type: 'sine', gain: 0.5 });
    if (P.pump) setTimeout(() => { // шум передергивания помпы
      this._noise(0.04, { freq: 1200, gain: 0.2, q: 1.2 });
      setTimeout(() => this._noise(0.04, { freq: 1500, gain: 0.22, q: 1.2 }), 120);
    }, 260);
    if (P.bolt) setTimeout(() => { // лязг затвора
      this._noise(0.03, { freq: 2000, gain: 0.2, q: 1.5 });
      setTimeout(() => this._noise(0.03, { freq: 2400, gain: 0.18, q: 1.5 }), 90);
    }, 420);
  }
  weaponChange() {
    if (this._playOneShot('weapon_change', 0.6)) return;
    this._tone(0.04, { freq: 600, freqEnd: 900, type: 'square', gain: 0.14 });
    setTimeout(() => this._tone(0.04, { freq: 900, freqEnd: 1200, type: 'square', gain: 0.12 }), 60);
  }
  hit(head = false) {
    if (this._playOneShot('enemy_hurt', head ? 0.55 : 0.4, head ? 1.3 : 1.0)) return;
    this._tone(0.06, { freq: head ? 1400 : 900, freqEnd: head ? 900 : 600, type: 'square', gain: 0.25 });
  }
  kill() {
    if (this._playOneShot('enemy_destroy', 0.7, 0.95 + Math.random() * 0.1)) return;
    this._tone(0.25, { freq: 600, freqEnd: 1200, type: 'square', gain: 0.3 });
    this._tone(0.3, { freq: 220, freqEnd: 40, type: 'sawtooth', gain: 0.4 });
    this._noise(0.2, { freq: 3000, gain: 0.25 });
  }
  // Анонсер киллстриков (Quake/Dota): низкий демонический голос + саб-румбл.
  // name: firstblood | double | triple | ultra | monster | rampage |
  //       humiliation | headshot. Буферы грузятся в boot (ann_*).
  announcer(name) {
    const ok = this._playOneShot(`ann_${name}`, 1.05, 0.94 + Math.random() * 0.05);
    if (!ok) return false;
    // саб-подбой под голос — вес арены
    this._ensureMaster();
    const t0 = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(58, t0);
    osc.frequency.exponentialRampToValueAtTime(34, t0 + 0.55);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.34, t0 + 0.04);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.0);
    osc.connect(g); g.connect(this.master);
    osc.start(t0); osc.stop(t0 + 1.05);
    return true;
  }
  skullScreech() {
    // Визг летающего черепа перед пикированием (расстроенные пилы вверх)
    this._chorus(0.28, { freq: 1240, gain: 0.16 });
    this._tone(0.3, { freq: 800, freqEnd: 1900, type: 'sawtooth', gain: 0.12 });
  }
  explosion() {
    this._noise(0.7, { freq: 300, gain: 0.9, q: 0.3, type: 'lowpass' });
    this._noise(0.18, { freq: 2500, gain: 0.4, q: 0.8, type: 'highpass' }); // звон осколков
    this._tone(0.5, { freq: 90, freqEnd: 25, type: 'sine', gain: 0.8 });
    this._tone(0.9, { freq: 55, freqEnd: 18, type: 'sine', gain: 0.6 });   // саб-хвост
  }
  reload() {
    this._tone(0.05, { freq: 500, type: 'square', gain: 0.15 });
    setTimeout(() => this._tone(0.05, { freq: 700, type: 'square', gain: 0.18 }), 140);
    setTimeout(() => this._noise(0.05, { freq: 2500, gain: 0.2 }), 300);
  }
  step() {
    this._noise(0.05, { freq: 400 + Math.random() * 300, gain: 0.12, q: 1.5, type: 'lowpass' });
  }
  jump() {
    if (this._playOneShot('jump_a', 0.35, 1.0 + Math.random() * 0.15)) return;
    this._tone(0.08, { freq: 300, freqEnd: 500, type: 'triangle', gain: 0.15 });
  }
  dash() { this._noise(0.25, { freq: 1200, gain: 0.3, q: 2, type: 'highpass' }); }
  slide() { this._noise(0.3, { freq: 600, gain: 0.18, type: 'lowpass' }); }
  hurt() { this._tone(0.12, { freq: 200, freqEnd: 90, type: 'sawtooth', gain: 0.3 }); }
  collapse() {
    this._noise(0.5, { freq: 250, gain: 0.5, type: 'lowpass' });
  }
  ui() {
    if (this._playOneShot('ui', 0.7)) return;
    this._tone(0.05, { freq: 800, freqEnd: 1000, type: 'square', gain: 0.12 });
  }
  cashout() {
    if (this._playOneShot('cashout', 0.9)) return;
    this.kill();
  }
  drop() {
    if (this._playOneShot('drop', 0.9)) return;
    this.explosion();
  }
}
