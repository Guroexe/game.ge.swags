// ===== GEN.SWAGS Rhythm =====
// Ритм-синк действий игрока: окна бита (perfect/good), комбо-стрик perfect,
// «ZE FLOW» на 8+ стрике (5с усиления), статистика perfect-% для мета-экрана.
// Чистая логика без DOM — тестируется в Node.
//
// Окна масштабируются под BPM: база ±80мс/±160мс при ~140 BPM,
// быстрее трек — окна чуть уже (но не меньше 75%), медленнее — шире (до 140%).

const REF_BEAT_INTERVAL = 60 / 140; // референс 140 BPM

// ============================
// GROOVE — непрерывная «сила в темп»
// ============================
// EMA качества действий (perfect=1.0, good=0.6, miss=−0.35 — miss штрафует),
// tau≈2.5с (окно интеграции ~6с). Значение 0..1 → шкала 0..100.
// Бездействие — мягкий дрейф к нейтрали 0.3 (не наказание).
// Значение groove непрерывно масштабирует СИЛУ всех действий (с капами):
//   урон 0.90→1.25 · shockwave 0.9→1.4 · дэш 0.9→1.3 · перезарядка 0.9→1.25
//   grapple 25→32м · бег 1.0→1.08 · кулдауны 1.0→0.85
// Точечные бонусы на бите (spread −50%, дэш +20% и т.д.) СТЕКАЮТСЯ поверх.
// Анти-абьюз: каждый тип действия учитывается не чаще 2/сек; у ботов groove
// нет (боты не создают RhythmSystem). В MP groove только локальный: урон
// авторитетен серверу, поэтому dmgMul в MP отключён (=1) — множитель виден
// лишь в HUD/анимациях; в соло — полный эффект.
export class GrooveMeter {
  constructor({ tau = 2.5, neutral = 0.3, maxPerSec = 2 } = {}) {
    this.tau = tau;            // постоянная EMA, сек
    this.neutral = neutral;    // точка мягкого дрейфа при бездействии
    this.maxPerSec = maxPerSec; // анти-спам: макс. учтённых действий типа в сек
    this.value = neutral;      // EMA качества 0..1
    this.mpMode = false;       // MP: урон авторитетен серверу — groove-dmg выкл
    this._time = 0;
    this._lastSampleT = null;  // время последнего УЧТЁННОГО семпла
    this._hits = new Map();    // type -> [t, ...] (rolling 1s)
    // Последнее действие (для HUD-всплывашки ×mult — даже если не учтено в метр)
    this.lastAction = null;    // { type, judge, mult }
  }

  static quality(j) { return j === 'perfect' ? 1.0 : j === 'good' ? 0.6 : -0.35; }

  // Семпл действия. Возвращает true, если действие учтено в метре.
  sample(type, j, t = this._time) {
    // Анти-спам: rolling-окно 1с на тип действия
    let arr = this._hits.get(type);
    if (!arr) { arr = []; this._hits.set(type, arr); }
    while (arr.length && t - arr[0] > 1) arr.shift();
    const counted = arr.length < this.maxPerSec;
    if (counted) {
      arr.push(t);
      // Время-aware EMA: alpha = 1 − e^(−gap/tau), gap капнут 2с, чтобы
      // одиночное действие после долгой тишины не доминировало мгновенно
      const gap = this._lastSampleT === null ? 0.25 : Math.min(2, Math.max(0, t - this._lastSampleT));
      const alpha = 1 - Math.exp(-gap / this.tau);
      this.value += (GrooveMeter.quality(j) - this.value) * alpha;
      this.value = Math.max(0, Math.min(1, this.value));
      this._lastSampleT = t;
    }
    this.lastAction = { type, judge: j, mult: this.mulForType(type) };
    return counted;
  }

  // Мягкий дрейф к нейтрали — только при БЕЗДЕЙСТВИИ (>1.5с без учтённых
  // действий); во время игры метр интегрирует действия без затухания.
  update(dt) {
    this._time += dt;
    const idle = this._lastSampleT === null || (this._time - this._lastSampleT) > 1.5;
    if (idle) {
      const k = 1 - Math.exp(-dt / (this.tau * 1.2)); // tau дрейфа ≈ 3с
      this.value += (this.neutral - this.value) * k;
      this.value = Math.max(0, Math.min(1, this.value));
    }
  }

  reset() {
    this.value = this.neutral;
    this._lastSampleT = null;
    this._hits.clear();
    this.lastAction = null;
  }

  // --- Непрерывные множители силы (линейны по g, плавны, с капами) ---
  get g() { return this.value; }
  get percent() { return Math.round(this.value * 100); }     // шкала 0..100
  get dmgMul() { return this.mpMode ? 1 : 0.90 + 0.35 * this.value; } // 0.90→1.25 (MP: сервер авторитетен)
  get shockMul() { return 0.90 + 0.50 * this.value; }        // 0.9→1.4 (радиус/урон E)
  get dashMul() { return 0.90 + 0.40 * this.value; }         // 0.9→1.3 (дальность Q)
  get reloadMul() { return 0.90 + 0.35 * this.value; }       // 0.9→1.25 (время ÷ mult)
  get grappleRangeMul() { return 1.00 + 0.28 * this.value; } // 25м→32м
  get runMul() { return 1.00 + 0.08 * this.value; }          // 1.0→1.08 (тонко)
  get cooldownMul() { return 1.00 - 0.15 * this.value; }     // 1.0→0.85 (быстрее откат)

  // Множитель, применённый к конкретному действию (для всплывашки «×1.18»)
  mulForType(type) {
    switch (type) {
      case 'shoot': case 'kill': case 'grenade': return this.dmgMul;
      case 'shockwave': return this.shockMul;
      case 'dash': return this.dashMul;
      case 'reload_end': return this.reloadMul;
      case 'grapple': return this.grappleRangeMul;
      case 'jump': case 'double_jump': case 'slide': return this.runMul;
      default: return this.dmgMul;
    }
  }
}

// Активный GrooveMeter игрока (один на игру; боты не создают RhythmSystem —
// groove есть только у локального игрока). weapons/player/hud читают его
// через этот реестр без изменения сигнатур main.js.
let _activeGroove = null;
export function activeGroove() { return _activeGroove; }

export class RhythmSystem {
  constructor({ music = null } = {}) {
    this._time = 0;
    this._lastBeatAt = -100;
    this._beatInterval = 0.5;

    // Комбо-стрик perfect-действий
    this.streak = 0;
    this.bestStreak = 0;
    // ZE FLOW
    this.zeFlow = false;
    this.zeFlowT = 0;
    this.zeFlowDuration = 5;
    this.zeFlowAt = 8; // стрик для активации

    // Статистика матча
    this.counts = { perfect: 0, good: 0, miss: 0 };

    // КОМБО-ТИРЫ: 2/4/8/16 стрика — нарастающие баффы от музыки
    // ×2 РИТМ (+скорость, микро-реген) → ×4 ГРУВ (+урон, реген) →
    // ×8 ZE FLOW (существующий супер-режим) → ×16 МАНДАЛА (макс. визуал+реген)
    this._lastTier = 0;
    this.onComboTier = null; // (tier 0..4) — HUD/FX реагируют на смену тира

    // GROOVE: непрерывный метр «силы в темп» (см. GrooveMeter)
    this.groove = new GrooveMeter();
    _activeGroove = this.groove;

    // Колбэки наружу
    this.onZeFlowStart = null;
    this.onZeFlowEnd = null;
    this.onJudge = null; // (type, judgement)

    if (music) this.attachMusic(music);
  }

  attachMusic(music) {
    this.music = music;
    music.groove = this.groove; // доп. путь доступа (flow/HUD через music)
    music.onBeat(() => {
      this._lastBeatAt = this._time;
      if (music.bpm) this._beatInterval = 60 / music.bpm;
    });
  }

  // Масштаб окон под BPM (быстрый трек — чуть жёстче)
  get windowScale() {
    return Math.max(0.75, Math.min(1.4, this._beatInterval / REF_BEAT_INTERVAL));
  }
  get perfectWindow() { return 0.08 * this.windowScale; }
  get goodWindow() { return 0.16 * this.windowScale; }

  // Секунды с последнего бита
  timeSinceBeat() { return this._time - this._lastBeatAt; }

  // Фаза внутри бита 0..1 (0 — сам бит) для пульс-ритмометра прицела
  beatPhase() {
    const dt = this.timeSinceBeat();
    if (dt < 0 || dt > 60) return 0.999; // битов ещё не было — кольцо в покое
    return Math.min(1, dt / Math.max(0.2, this._beatInterval));
  }

  // Дистанция до ближайшего бита (прошлого или следующего), сек
  _distToBeat() {
    const since = this.timeSinceBeat();
    if (since < 0) return Infinity;
    const toNext = this._beatInterval - (since % this._beatInterval);
    return Math.min(since % this._beatInterval, toNext);
  }

  // Оценка момента без регистрации
  peek() {
    const d = this._distToBeat();
    if (d <= this.perfectWindow) return 'perfect';
    if (d <= this.goodWindow) return 'good';
    return 'miss';
  }

  // Судейство действия: 'shoot'|'kill'|'dash'|'shockwave'|'grapple'|
  // 'grenade'|'jump'|'slide'|'reload_end'
  judge(type = 'action') {
    const j = this.peek();
    this.counts[j]++;
    if (j === 'perfect') {
      this.streak++;
      this.bestStreak = Math.max(this.bestStreak, this.streak);
      if (this.streak >= this.zeFlowAt && !this.zeFlow) this._startZeFlow();
    } else if (j === 'miss') {
      this.streak = 0;
    }
    // 'good' — стрик не растит и не рвёт
    // GROOVE: каждое действие — семпл в EMA (анти-спам внутри sample)
    this.groove.sample(type, j, this._time);
    this._syncTier();
    this.onJudge?.(type, j);
    return j;
  }

  // «на бите» = good или лучше
  static onBeat(j) { return j === 'perfect' || j === 'good'; }

  // --- КОМБО-ТИРЫ (баффы от музыки) ---
  get comboTier() {
    return this.streak >= 16 ? 4 : this.streak >= 8 ? 3 : this.streak >= 4 ? 2 : this.streak >= 2 ? 1 : 0;
  }
  get comboName() { return ['', 'РИТМ', 'ГРУВ', 'ZE FLOW', 'МАНДАЛА'][this.comboTier]; }
  get hpRegen() { return [0, 0.6, 1.6, 3.0, 5.0][this.comboTier]; }   // HP/сек сверх базового регена
  get tierSpeedMul() { return 1 + 0.02 * this.comboTier; }            // до +8% скорости
  get tierDmgMul() { // до +12% урона (в MP урон авторитетен серверу — выкл)
    return this.groove.mpMode ? 1 : 1 + 0.03 * this.comboTier;
  }
  get mandalaBoost() { return [0, 0.06, 0.12, 0.20, 0.34][this.comboTier]; } // усиление мандала-слоя

  _syncTier() {
    const t = this.comboTier;
    if (t !== this._lastTier) {
      this._lastTier = t;
      this.onComboTier?.(t);
    }
  }

  _startZeFlow() {
    this.zeFlow = true;
    this.zeFlowT = this.zeFlowDuration;
    this.onZeFlowStart?.();
  }

  // Доля perfect среди всех действий (0..1)
  get perfectPct() {
    const total = this.counts.perfect + this.counts.good + this.counts.miss;
    return total ? this.counts.perfect / total : 0;
  }

  // Сброс статистики между матчами (стрик сохраняем — комбо живёт через раунды)
  resetStats() {
    this.counts.perfect = 0;
    this.counts.good = 0;
    this.counts.miss = 0;
    this.groove.reset(); // новый матч — groove с нейтрали
  }

  update(dt) {
    this._time += dt;
    this.groove.update(dt); // дрейф к нейтрали + часы метра
    if (this.zeFlow) {
      this.zeFlowT -= dt;
      if (this.zeFlowT <= 0) {
        this.zeFlow = false;
        this.zeFlowT = 0;
        this.streak = 0; // после ZE FLOW стрик обнуляется
        this._syncTier();
        this.onZeFlowEnd?.();
      }
    }
  }
}
