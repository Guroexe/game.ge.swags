// ===== GEN.SWAGS SOUND WAR =====
// Звуковая война: у каждой команды СВОЙ трек. Твой трек — основной поток,
// трек доминирующего врага — второй «поток личности» (MusicEngine.attachEnemy),
// слышный геймплейно:
//  • «Доминирующий звук»: перевес врага (счёт/FLOW/объективы) → его трек
//    просачивается: сначала lowpassed сквозь стены, при доминировании — явно.
//  • ЗОНЫ ЗВУКА: у вражеской станции/носителя кешбокса вражеский трек слышен
//    пространственно (пан по направлению, громкость по дистанции, lowpass при
//    окклюзии через raycast) — музыка врага = радар.
//  • SOUND CLASH: дроп у тебя и врага совпал по фазе (окно 2с) → 8с клэш:
//    микс 50/50, урон всех +10%, килл «крадёт голос» (трек жертвы тихнет на
//    4с, твой +3дБ на 8с).
//  • Килл = украсть энергию: на 1с lowpass вражеского трека закрывается
//    (подавление + bitcrush-шиммер).
// Логика без DOM/Web Audio — тестируется в Node (audio-параметры через мок).
//
// MP: сервер аддитивно ретранслирует {t:'soundwar', trackId, clash}; без
// ретрансля (старый сервер) — graceful fallback: треки команд назначаются
// детерминированно локально, клэши считаются по своим дропам.

// ---------- Встроенные боевые треки (метаданные для карточек/синка) ----------
// start/end — trim-сегмент (сек): трек играется внутри «самого жирного» куска.
export const TRACK_META = [
  { file: 'NO_TALK_FREE_DRINK_KLICKAUD.mp3', title: 'FREE DRINK', genre: 'HARDBASS', bpm: 150, start: 0, end: 95 },
  { file: 'голодный_волк_KLICKAUD.mp3', title: 'ГОЛОДНЫЙ ВОЛК', genre: 'DARK PHONK', bpm: 140, start: 8, end: 120 },
  { file: 'Кракен_hardtrekk_KLICKAUD.mp3', title: 'КРАКЕН', genre: 'HARDTEKK', bpm: 160, start: 0, end: 110 },
  { file: 'menu_ambient.mp3', title: 'HUB // ТЕМА МЕНЮ', genre: 'AMBIENT', bpm: 100 },
];


export function metaFor(name) {
  return TRACK_META.find((m) => m.file === name) || null;
}

// ---------- Чистые функции ----------
export function clamp01(v) { return Math.max(0, Math.min(1, v)); }

// Подгонка BPM врага rate'ом к твоему BPM (±10% — питч-компенсация не нужна)
export function computeSyncRate(myBpm, enemyBpm) {
  if (!myBpm || !enemyBpm || myBpm <= 0 || enemyBpm <= 0) return 1;
  return Math.max(0.9, Math.min(1.1, enemyBpm / myBpm));
}

// Кривая fisheye-анимации перехода: 0 → 1 → 0 (пик в середине)
export function fisheyeCurve(t) {
  const x = clamp01(t);
  const s = Math.sin(Math.PI * x);
  return s <= 1e-9 ? 0 : Math.pow(s, 0.75);
}

export function dbToGain(db) { return Math.pow(10, db / 20); }

// Окно совпадения фаз дропа для SOUND CLASH, сек
export const CLASH_WINDOW = 2;
export const CLASH_DURATION = 8;
export const VOICE_DUCK_TIME = 4;   // кража голоса: трек жертвы тихнет
export const VOICE_BOOST_TIME = 8;  // ...а твой +3дБ
export const VOICE_BOOST_DB = 3;
export const SUPPRESS_TIME = 1;     // килл: захват частот врага
export const CLASH_DAMAGE_MUL = 1.1;

// ============================================================
export class SoundWar {
  constructor({ music = null, physics = null } = {}) {
    this.music = music;
    this.physics = physics;        // для окклюзии зон (raycast), опционально

    this.playerTeam = 0;
    this.assignments = new Map();  // team -> {name, title, genre, bpm, buffer, isUser}
    this.activeEnemyTeam = -1;     // чей трек сейчас во втором потоке
    this._enemyObjectId = null;    // buffer-идентичность, чтобы не переподключать

    // Состояние войны
    this.dominance = 0;            // -1..1 ( + = ты выигрываешь )
    this.zone = { gain: 0, pan: 0, lpHz: 14000, dist: 0, occluded: false, label: null };
    this.clash = { active: false, t: 0, withTeam: -1 };
    this.duckT = [0, 0, 0];        // кража голоса: затихание трека команды
    this.suppressT = [0, 0, 0];    // килл-подавление (lowpass закрыт)
    this.boostT = 0;               // +3дБ твоему треку
    this.playerDuckT = 0;          // твой трек приглушён (ты пал в клэше)
    this._lastDrops = new Map();   // 'you' | team -> время последнего дропа
    this._time = 0;

    // Сглаженные выходы к аудио
    this.presence = { gain: 0, lpHz: 800, pan: 0, crush: 0 };
    this._targets = { gain: 0, lpHz: 800, pan: 0, crush: 0 };
    this._playerGainMul = 1;       // сглаженный множитель твоего трека
    this._zoneTimer = 0;

    // Колбэки наружу (HUD/FX/MP)
    this.onClashStart = null;      // (enemyTeam)
    this.onClashEnd = null;
    this.onVoiceSteal = null;      // (victimTeam)
    this.onEnemyDrop = null;       // (enemyTeam) — дроп вражеского трека

    // Вражеский трек играет без analyser (половинное качество анализа), поэтому
    // его дропы отслеживаются детерминированным расписанием (как и реальный
    // трек: луп с дропом каждые ~38с). MP может подменять расписание синком.
    this.simulateEnemyDrops = true;
    this.enemyDropEvery = 38;
    this._nextEnemyDrop = 20;
  }

  // ---------- Назначение треков командам ----------
  // playerSel: {name, title, genre, bpm, buffer, isUser}
  // pickBotTrack(team) -> такой же объект (обязан отличаться от игрока/других)
  assignTracks(playerTeam, playerSel, pickBotTrack) {
    this.playerTeam = playerTeam;
    this.assignments.clear();
    this.assignments.set(playerTeam, { ...playerSel });
    for (let team = 0; team < 3; team++) {
      if (team === playerTeam) continue;
      const t = pickBotTrack?.(team);
      if (t) this.assignments.set(team, { ...t });
    }
    return this.assignments;
  }

  trackOf(team) { return this.assignments.get(team) || null; }

  // Идентификатор трека для MP-синка: имя файла или 'user:<name>'
  static trackIdOf(assignment) { return assignment ? assignment.name : null; }

  // MP: удалённая команда объявила свой трек (по trackId ищем буфер в плейлисте)
  applyRemoteTrack(team, trackId) {
    if (team == null || team === this.playerTeam || !trackId) return false;
    const pl = this.music?.playlist || [];
    const t = pl.find((x) => x.name === trackId);
    if (!t) return false; // user-трек чужого игрока у нас нет → fallback уже назначен
    const meta = metaFor(t.name);
    this.assignments.set(team, {
      name: t.name, title: meta?.title || t.name, genre: meta?.genre || '',
      bpm: meta?.bpm || 0, buffer: t.buffer, isUser: false,
    });
    return true;
  }

  // MP: сервер ретранслировал чужой дроп → clash-детект против своего
  remoteDrop(team) { return this.notifyDrop(team); }

  // ---------- Старт/стоп матча ----------
  startMatch() {
    this._time = 0;
    this.dominance = 0;
    this.clash = { active: false, t: 0, withTeam: -1 };
    this.duckT = [0, 0, 0];
    this.suppressT = [0, 0, 0];
    this.boostT = 0;
    this.playerDuckT = 0;
    this._lastDrops.clear();
    this._nextEnemyDrop = 20;
    this.presence = { gain: 0, lpHz: 800, pan: 0, crush: 0 };
    this.activeEnemyTeam = -1;
    this._enemyObjectId = null;
    this._syncEnemyStream(true);
  }

  stop() {
    this.music?.detachEnemy?.();
    this.activeEnemyTeam = -1;
    this._enemyObjectId = null;
    this.clash.active = false;
    this.presence.gain = 0;
    this._playerGainMul = 1;
    // Вернуть громкость твоего трека (могла остаться приглушена кражей голоса)
    if (this.music?.gainNode && this.music.ctx) {
      this.music.gainNode.gain.setTargetAtTime(1, this.music.ctx.currentTime, 0.05);
    }
  }

  // ---------- Доминирование ----------
  // scores [3], flowValue 0..100, objHoldTeam — кто держит кешбокс/депозит (-1)
  computeDominance(scores, playerTeam, flowValue = 0, objHoldTeam = -1) {
    const my = scores?.[playerTeam] ?? 0;
    let best = -1, enemy = 0;
    for (let t = 0; t < 3; t++) {
      if (t === playerTeam) continue;
      const s = scores?.[t] ?? 0;
      if (s > enemy) { enemy = s; best = t; }
    }
    // Нормировка: 3000$ — победный счёт кешаута; FLOW врага-лидера неизвестен,
    // поэтому зеркалим: свой FLOW работает на тебя, отставание по счёту — на врага.
    const scoreDom = clamp01((my - enemy) / 1500 + 0.5) * 2 - 1; // -1..1
    const flowDom = clamp01(flowValue / 100) * 0.3;
    const objDom = objHoldTeam === playerTeam ? 0.2 : (best >= 0 && objHoldTeam === best ? -0.2 : 0);
    return Math.max(-1, Math.min(1, scoreDom * 0.5 + flowDom + objDom));
  }

  // Лидер среди вражеских команд (чей трек в эфире)
  enemyLeader(scores, playerTeam) {
    let best = -1, bs = -Infinity;
    for (let t = 0; t < 3; t++) {
      if (t === playerTeam || !this.assignments.has(t)) continue;
      const s = scores?.[t] ?? 0;
      if (s > bs) { bs = s; best = t; }
    }
    return best;
  }

  // ---------- SOUND CLASH ----------
  // Сообщить о дропе: key 'you' (свой трек) или номер команды врага.
  // Если у другой стороны был дроп в окне 2с — стартует клэш. Возвращает true.
  notifyDrop(key) {
    const now = this._time;
    this._lastDrops.set(key, now);
    if (this.clash.active) return false;
    // Клэш возможен только с командой, чей трек сейчас в эфире
    if (key !== 'you' && key !== this.activeEnemyTeam) return false;
    const other = key === 'you' ? this.activeEnemyTeam : 'you';
    if (other == null || other < 0) return false;
    const tOther = this._lastDrops.get(other);
    if (tOther == null) return false;
    if (Math.abs(now - tOther) <= CLASH_WINDOW) {
      const withTeam = key === 'you' ? other : key;
      this.clash = { active: true, t: CLASH_DURATION, withTeam };
      this.onClashStart?.(withTeam);
      return true;
    }
    return false;
  }

  // ---------- Киллы ----------
  // Возвращает события {suppressed, stolen, playerDucked}
  registerKill(attackerTeam, victimTeam) {
    const ev = { suppressed: false, stolen: false, playerDucked: false };
    // Килл = украсть энергию: на 1с lowpass трека жертвы закрывается
    if (victimTeam != null && victimTeam >= 0 && victimTeam !== attackerTeam) {
      this.suppressT[victimTeam] = SUPPRESS_TIME;
      ev.suppressed = victimTeam === this.activeEnemyTeam;
    }
    // Кража голоса в клэше
    if (this.clash.active && victimTeam === this.clash.withTeam) {
      if (attackerTeam === this.playerTeam) {
        this.duckT[victimTeam] = VOICE_DUCK_TIME;
        this.boostT = VOICE_BOOST_TIME;
        ev.stolen = true;
        this.onVoiceSteal?.(victimTeam);
      }
    }
    if (this.clash.active && victimTeam === this.playerTeam) {
      this.playerDuckT = VOICE_DUCK_TIME;
      ev.playerDucked = true;
    }
    return ev;
  }

  get damageMul() { return this.clash.active ? CLASH_DAMAGE_MUL : 1; }

  // ---------- Зоны звука ----------
  // sources: [{x, z, team, label}] — вражеские станции/носитель кешбокса
  // playerPos {x,y,z}, playerYaw — радианы (forward = -sin, -cos)
  computeZone(sources, playerPos, playerYaw, playerTeam) {
    const out = { gain: 0, pan: 0, lpHz: 14000, dist: 0, occluded: false, label: null };
    if (!playerPos) return out;
    let best = null, bd = Infinity;
    for (const s of sources || []) {
      if (s.team == null || s.team === playerTeam) continue;
      const d = Math.hypot(s.x - playerPos.x, s.z - playerPos.z);
      if (d < bd) { bd = d; best = s; }
    }
    if (!best || bd > 30) return out;
    // Панорама: знак угла между взглядом и направлением на источник
    const dx = best.x - playerPos.x, dz = best.z - playerPos.z;
    const ang = Math.atan2(dx, dz);         // мировой азимут источника
    const rel = ang - (playerYaw + Math.PI); // forward = -sin,-cos → азимут взгляда yaw+π
    out.pan = Math.max(-1, Math.min(1, -Math.sin(rel)));
    out.dist = bd;
    out.gain = clamp01(1.15 - bd / 26);
    // Окклюзия: луч от ушей к источнику — стена глушит в lowpass
    if (this.physics?.raycast && bd > 2) {
      const from = { x: playerPos.x, y: (playerPos.y || 0) + 1.5, z: playerPos.z };
      const dir = { x: dx / bd, y: 0, z: dz / bd };
      const hit = this.physics.raycast(from, dir, bd - 1.5);
      out.occluded = !!hit;
    }
    if (out.occluded) { out.gain *= 0.55; out.lpHz = 700; }
    out.label = best.label || null;
    return out;
  }

  // ---------- Целевые аудио-параметры (чистый расчёт — тесты) ----------
  computeTargets() {
    const t = { gain: 0, lpHz: 800, pan: 0, crush: 0 };
    const enemy = this.activeEnemyTeam;
    if (enemy < 0 || !this.assignments.has(enemy)) return t;
    const enemyAhead = Math.max(0, -this.dominance); // 0..1

    if (this.clash.active) {
      // SOUND CLASH: микс 50/50, частоты открыты
      t.gain = 0.5;
      t.lpHz = 14000;
    } else {
      // Просачивание от доминирования: тихо+lowpassed → явно
      t.gain = 0.04 + enemyAhead * 0.55;
      t.lpHz = 700 + clamp01(enemyAhead * 1.4) * 13000;
    }
    // Зона звука перекрывает фоновое просачивание (музыка врага = радар)
    if (this.zone.gain > 0.08 && this.zone.gain > t.gain * 0.9) {
      t.gain = Math.max(t.gain, this.zone.gain * 0.8);
      t.pan = this.zone.pan;
      t.lpHz = Math.min(t.lpHz, this.zone.lpHz);
      if (!this.zone.occluded) t.lpHz = Math.max(t.lpHz, 9000);
    }
    // Килл-подавление: частоты врага захвачены — lowpass закрыт + шиммер
    if (this.suppressT[enemy] > 0) {
      t.lpHz = Math.min(t.lpHz, 320);
      t.gain *= 0.7;
      t.crush = 0.55;
    }
    // Кража голоса: трек убитого затихает
    if (this.duckT[enemy] > 0) t.gain *= 0.12;
    t.gain = clamp01(t.gain);
    return t;
  }

  // Множитель громкости ТВОЕГО трека (кража голоса/награда)
  playerGainTarget() {
    let g = 1;
    if (this.boostT > 0) g *= dbToGain(VOICE_BOOST_DB);
    if (this.playerDuckT > 0) g *= 0.25;
    return g;
  }

  // ---------- Главный апдейт ----------
  // ctx: {scores, flowValue, objHoldTeam, zoneSources, playerPos, playerYaw, playerAlive}
  update(dt, ctx = {}) {
    this._time += dt;
    // Таймеры
    this.boostT = Math.max(0, this.boostT - dt);
    this.playerDuckT = Math.max(0, this.playerDuckT - dt);
    for (let i = 0; i < 3; i++) {
      this.duckT[i] = Math.max(0, this.duckT[i] - dt);
      this.suppressT[i] = Math.max(0, this.suppressT[i] - dt);
    }
    if (this.clash.active) {
      this.clash.t -= dt;
      if (this.clash.t <= 0) {
        this.clash = { active: false, t: 0, withTeam: -1 };
        this.onClashEnd?.();
      }
    }

    // Доминирование и лидер врага
    this.dominance = this.computeDominance(
      ctx.scores, this.playerTeam, ctx.flowValue || 0, ctx.objHoldTeam ?? -1);
    const leader = this.enemyLeader(ctx.scores, this.playerTeam);
    if (leader !== this.activeEnemyTeam) {
      this.activeEnemyTeam = leader;
      this._syncEnemyStream();
    }

    // Дропы вражеского трека (детерминированное расписание — MP может слать свои)
    if (this.simulateEnemyDrops && this.activeEnemyTeam >= 0 && this._time >= this._nextEnemyDrop) {
      this._nextEnemyDrop += this.enemyDropEvery;
      this.onEnemyDrop?.(this.activeEnemyTeam);
      this.notifyDrop(this.activeEnemyTeam);
    }

    // Зоны звука (раз в ~100мс — raycast не каждый кадр)
    this._zoneTimer -= dt;
    if (this._zoneTimer <= 0) {
      this._zoneTimer = 0.1;
      this.zone = ctx.playerAlive === false
        ? { gain: 0, pan: 0, lpHz: 14000, dist: 0, occluded: false, label: null }
        : this.computeZone(ctx.zoneSources, ctx.playerPos, ctx.playerYaw || 0, this.playerTeam);
    }

    // Цели → сглаживание → аудио
    this._targets = this.computeTargets();
    const k = Math.min(1, dt * 4);
    const p = this.presence, tg = this._targets;
    p.gain += (tg.gain - p.gain) * k;
    p.lpHz += (tg.lpHz - p.lpHz) * k;
    p.pan += (tg.pan - p.pan) * k;
    p.crush += (tg.crush - p.crush) * k;
    this._playerGainMul += (this.playerGainTarget() - this._playerGainMul) * k;

    if (this.music?.ctx && this.music.enemyActive) {
      this.music.setEnemyMix({ gain: p.gain * 0.85, lpHz: p.lpHz, crush: p.crush, pan: p.pan });
    }
    if (this.music?.gainNode) {
      this.music.gainNode.gain.setTargetAtTime(
        this._playerGainMul, this.music.ctx.currentTime, 0.08);
    }
  }

  // Подключить/переподключить вражеский поток под activeEnemyTeam
  _syncEnemyStream(force = false) {
    const team = this.activeEnemyTeam;
    const a = team >= 0 ? this.assignments.get(team) : null;
    if (!a?.buffer || !this.music?.ctx) return;
    if (!force && this._enemyObjectId === a.buffer) return;
    this._enemyObjectId = a.buffer;
    const myBpm = this.trackOf(this.playerTeam)?.bpm || this.music.bpm || 0;
    this.music.attachEnemy(a.buffer, { rate: computeSyncRate(myBpm, a.bpm) });
  }

  // BPM твоего трека уточнился (детектор) — переподогнать rate врага
  refreshRate(myBpm) {
    const a = this.trackOf(this.activeEnemyTeam);
    if (a?.bpm && this.music?.enemyActive) {
      this.music.setEnemyRate(computeSyncRate(myBpm, a.bpm));
    }
  }

  // ---------- Состояние для HUD ----------
  state() {
    const mine = this.trackOf(this.playerTeam);
    const enemy = this.trackOf(this.activeEnemyTeam);
    return {
      yourTitle: mine?.title || mine?.name || '—',
      enemyTitle: enemy?.title || enemy?.name || null,
      enemyNorm: clamp01(this.presence.gain / 0.6), // 0..1 для индикатора
      enemyDominant: this.dominance < -0.12,
      dominance: this.dominance,                     // -1..1
      clash: this.clash.active,
      clashT: this.clash.t,
      boost: this.boostT > 0,
      ducked: this.playerDuckT > 0,
      zoneLabel: this.zone.label,
      pan: this.presence.pan,
    };
  }
}
