// ===== GEN.SWAGS Meta =====
// Мета-петля раундов: МАТЧ → экран итогов (дельта рейтинга) →
// PSY-BREAK интермиссия 12с (полный psy-break, датамош, орбита камеры,
// статы матча) → пересборка СЛЕДУЮЩЕЙ АРЕНЫ под датамошем → новый матч.
// Логика состояния без DOM (headless-тест); DOM-вывод защищён проверками.
import { RatingSystem } from './rating.js';
import { fisheyeCurve, clamp01 } from './soundwar.js';

export const ARENA_ROTATION = ['eden', 'hell', 'sng', 'ruins', 'dust2', 'goldencity'];
export const ARENA_NAMES = {
  eden: '«РАЙ-7» 楽園',
  hell: '«ГЕЕННА» 地獄',
  sng: '«СЕКТОР-9» 區',
  ruins: '«РУИНЫ» 廃墟',
  dust2: '«ДАСТ-2» 砂塵',
  goldencity: '«ЗОЛОТОЙ ГОРОД» 金城',
  cathedral: 'HUB_1 «СОБОР» 聖堂',
  abyss: '«БЕЗДНА» 深淵',
  necro: '«НЕКРО-ЗАВОД» 死工場',
  shrine: '«ХРАМ ЖЕЛЕЗА» 鉄ノ社',
  desert: '«ПУСТЫНЯ ДАННЫХ» 砂漠',
};

const $ = (id) => (typeof document !== 'undefined' ? document.getElementById(id) : null);

// ============================================================
// TransitionFX — эффектный переход «между мирами».
// Две версии:
//  • death  (2.5с): дисторшн трека + fisheye + быстрый fade → респавн.
//  • match  (8-12с, конец матча): трек «проваливается» (rate ×0.6, 4-bit
//    bitcrush, lowpass sweep вниз, реверб-всплеск) → тишина-удар → трек
//    «втягивается» обратно уже в новой арене. Fisheye 0→1→0, warp ×1.5,
//    datamosh max, FOV-панч 90→120→90.
// Направление: победа/рейтинг+ = ВОЗВЫШЕНИЕ (камера вверх, светлеет),
// поражение = ПАДЕНИЕ (вниз, темнее/краснее). Headless-safe (всё защищено).
// ============================================================
export class TransitionFX {
  constructor(game) {
    this.g = game;
    this.active = false;
    this.kind = null;      // 'death' | 'match'
    this.t = 0;
    this.duration = 0;
    this.dir = -1;         // +1 возвышение / -1 падение
    this.banner = '';      // HUD-строка (▲ ВОЗВЫШЕНИЕ / ▼ ПАДЕНИЕ)
    this.camLift = 0;      // вертикальное смещение камеры (meta применяет к орбите)
    this._hitDone = false;
    this._resetDone = false;
    this._savedFx = null;
  }

  get progress() { return this.duration > 0 ? clamp01(this.t / this.duration) : 1; }

  // Короткая версия — смерть игрока (3.2с, синхронно с soul-cam)
  startDeath() {
    if (this.active) return false;
    this._begin('death', 3.2, -1, '▼ СИГНАЛ ПОТЕРЯН — ПЕРЕСБОРКА');
    return true;
  }

  // Полная версия — конец матча (синхронизирована с PSY-BREAK интермиссией)
  startMatch({ up = true, arenaName = '', duration = 12 } = {}) {
    if (this.active) return false;
    const banner = up ? `▲ ВОЗВЫШЕНИЕ: ${arenaName}` : `▼ ПАДЕНИЕ: ${arenaName}`;
    // Полная версия 8-12с (длительность интермиссии; отладочные короткие — как есть)
    this._begin('match', Math.min(12, Math.max(2.5, duration)), up ? 1 : -1, banner);
    return true;
  }

  _begin(kind, duration, dir, banner) {
    const g = this.g;
    this.active = true;
    this.kind = kind;
    this.t = 0;
    this.duration = duration;
    this.dir = dir;
    this.banner = banner;
    this.camLift = 0;
    this._hitDone = false;
    this._resetDone = false;
    // Сохранить текущие целевые FX, чтобы вернуть после перехода
    const fx = g.engine?.fx;
    this._savedFx = fx ? { ...fx.target } : null;
    // warp ×1.5 от psy-пресета + datamosh max — «провал сквозь пол»
    fx?.set({
      warp: Math.min(1.1, Math.max(0.5, (fx.target.warp || 0) * 1.5)),
      datamosh: 1,
      glitch: Math.min(1, (fx.target.glitch || 0) + 0.25),
    });
    fx?.pulse(1.6);
    g.sfx?.collapse?.();
  }

  // Вызывать каждый фикс. шаг (до meta.update — camLift уже готов)
  update(dt) {
    if (!this.active) return;
    const g = this.g;
    this.t += dt;
    const p = this.progress;

    // --- Аудио-фазы: провал → тишина-удар → втягивание ---
    const A = this.kind === 'death' ? 0.4 : 0.35;   // конец фазы провала
    const H = this.kind === 'death' ? 0.46 : 0.42;  // момент удара
    const B = this.kind === 'death' ? 0.55 : 0.8;   // конец втягивания
    if (p < A) {
      const k = clamp01(p / A);
      g.music?.setTransition({
        rate: 1 - 0.4 * k,                 // ×0.6 питч вниз
        lpHz: 16000 - 15400 * k,           // sweep вниз до ~600 Гц
        crush: k * (this.kind === 'match' ? 1 : 0.8), // 4-bit на полной версии
        verb: k * (this.kind === 'match' ? 0.85 : 0.5),
      });
    } else if (p < B) {
      if (!this._hitDone) {
        this._hitDone = true;
        g.music?.transitionHit?.();        // тишина-удар
        g.engine?.fx?.pulse(2);
      }
      const k = clamp01((p - A) / (B - A)); // 0 в тишине → 1 обратно
      const duck = p < H + 0.06 ? 0.9 : Math.max(0, 0.9 - k * 1.4);
      g.music?.setTransition({
        rate: 0.6 + 0.4 * k,
        lpHz: 600 + 15400 * k * k,         // reverse sweep вверх
        crush: (1 - k) * (this.kind === 'match' ? 1 : 0.8),
        verb: (1 - k * 0.7) * (this.kind === 'match' ? 0.85 : 0.5),
        duck,
      });
    } else if (!this._resetDone) {
      this._resetDone = true;
      g.music?.resetTransition?.();
    }

    // --- Визуал: fisheye 0→1→0, FOV-панч 90→120→90, направление ---
    const curve = fisheyeCurve(p);
    g.engine?.fx?.set({ fisheye: curve });
    const cam = g.engine?.camera;
    if (cam) {
      const base = g.player?.baseFov || 75;
      const fov = base + curve * (120 - base); // панч к 120
      if (Math.abs(cam.fov - fov) > 0.05) {
        cam.fov = fov;
        cam.updateProjectionMatrix();
      }
      // Смерть: лёгкий крен камеры — «провал»
      if (this.kind === 'death') cam.rotation.z += curve * 0.14 * this.dir * -1;
    }
    // Направление перехода: камера вверх/вниз + экспозиция светлее/темнее
    this.camLift = curve * 20 * this.dir;
    if (g.engine?.renderer) {
      const exposure = 1.35 * (this.dir > 0 ? 1 + curve * 0.4 : 1 - curve * 0.45);
      g.engine.renderer.toneMappingExposure = Math.max(0.4, exposure);
    }

    if (p >= 1) this.stop();
  }

  stop() {
    if (!this.active) return;
    this.active = false;
    const g = this.g;
    this.banner = '';
    this.camLift = 0;
    g.music?.resetTransition?.();
    if (g.engine?.renderer) g.engine.renderer.toneMappingExposure = 1.35;
    if (g.engine?.camera) {
      const base = g.player?.baseFov || 75;
      g.engine.camera.fov = base;
      g.engine.camera.updateProjectionMatrix();
    }
    // Вернуть FX к сохранённым (psy-break/drop продолжают сами)
    if (g.engine?.fx && this._savedFx) g.engine.fx.set({ ...this._savedFx, fisheye: 0 });
  }
}

export class MetaLoop {
  constructor(game, { duration = 12, rating = null } = {}) {
    this.game = game;
    this.duration = duration;      // длина интермиссии, сек
    this.swapAt = duration / 2;    // момент пересборки арены (под датамошем)
    this.intermission = false;
    this.t = 0;
    this._swapped = false;
    this.arenaIndex = 0;           // индекс в ARENA_ROTATION
    this.lastResult = null;        // данные последнего матча (для экранов)
    // Рейтинг: снаружи можно подсунуть свой (тесты); иначе localStorage
    this.rating = rating || new RatingSystem({
      storage: (typeof localStorage !== 'undefined' ? localStorage : null),
    });
  }

  get arenaVariant() { return ARENA_ROTATION[this.arenaIndex]; }
  get nextArenaVariant() { return ARENA_ROTATION[(this.arenaIndex + 1) % ARENA_ROTATION.length]; }

  // ---------- Конец матча (соло): статы + рейтинг + экран итогов ----------
  onMatchEnd(data) {
    const g = this.game;
    const stats = g.collectMatchStats?.() || { kills: 0, deaths: 0, perfectPct: 0, flowMax: 0 };
    const scores = data?.scores || g.mode?.scores || [0, 0, 0];
    const playerTeam = g.mode?.playerTeam ?? 0;
    const place = RatingSystem.placeOf(scores, playerTeam);
    const rating = this.rating.recordMatch({ place, ...stats });
    this.lastResult = {
      ...data, stats, place, rating,
      nextArena: ARENA_NAMES[this.nextArenaVariant],
    };
    g.menu?.showEnd(this.lastResult);
    return this.lastResult;
  }

  // ---------- PSY-BREAK интермиссия ----------
  startIntermission() {
    if (this.intermission) return false;
    const g = this.game;
    this.intermission = true;
    this.t = 0;
    this._swapped = false;
    g.menu?.hideEnd();
    g.input?.exitPointerLock?.();
    // Полный psy-break + датамош
    g.engine.fx.setPsyBreak(true, 1);
    g.engine.fx.pulse(1.2);
    // Переход «между мирами»: ▲ возвышение (рейтинг+/победа) / ▼ падение
    const up = this.lastResult
      ? (this.lastResult.rating ? this.lastResult.rating.delta >= 0 : !!this.lastResult.playerWon)
      : true;
    g.transition?.startMatch?.({
      up,
      arenaName: ARENA_NAMES[this.nextArenaVariant],
      duration: this.duration,
    });
    const statsEl = $('inter-stats');
    if (statsEl) { delete statsEl.dataset.done; statsEl.innerHTML = ''; }
    this._renderIntermission(0);
    $('intermission-screen')?.classList.add('visible');
    return true;
  }

  // Главный апдейт (вызывать из игрового цикла каждый фикс. шаг)
  update(dt) {
    if (!this.intermission) return;
    this.t += dt;
    const g = this.game;

    // Медленная камера-орбита над ареной (+ вертикаль перехода: вверх/вниз)
    const a = this.t * 0.32;
    const lift = g.transition?.active ? g.transition.camLift : 0;
    g.engine.camera.position.set(
      Math.cos(a) * 30, 13 + Math.sin(this.t * 0.5) * 2.5 + lift, Math.sin(a) * 30);
    g.engine.camera.lookAt(0, 2 + lift * 0.6, 0);

    this._renderIntermission(dt);

    // Пересборка арены в середине — датамош-всплеск маскирует swap
    if (!this._swapped && this.t >= this.swapAt) {
      this._swapped = true;
      g.engine.fx.pulse(2); // усиленный смаз в момент пересборки
      this.nextArena();
    }
    if (this.t >= this.duration) this.finish();
  }

  // Пересборка следующей арены по ротации
  nextArena() {
    this.arenaIndex = (this.arenaIndex + 1) % ARENA_ROTATION.length;
    this.game.rebuildArena?.(this.arenaVariant);
    return this.arenaVariant;
  }

  // Конец интермиссии → следующий матч
  finish() {
    if (!this.intermission) return;
    this.intermission = false;
    const g = this.game;
    g.transition?.stop?.();
    g.engine.fx.setPsyBreak(false);
    $('intermission-screen')?.classList.remove('visible');
    g.startGame?.();
  }

  // Прерывание (выйти в меню посреди интермиссии)
  abort() {
    if (!this.intermission) return;
    this.intermission = false;
    this.game.transition?.stop?.();
    this.game.engine.fx.setPsyBreak(false);
    $('intermission-screen')?.classList.remove('visible');
  }

  // ---------- DOM-вывод (защищён для headless) ----------
  _renderIntermission(dt) {
    const res = this.lastResult;
    const arenaEl = $('inter-arena');
    if (arenaEl) arenaEl.textContent = `СЛЕДУЮЩАЯ АРЕНА: ${ARENA_NAMES[this.nextArenaVariant]}`;
    const timerEl = $('inter-timer');
    if (timerEl) timerEl.textContent = Math.max(0, Math.ceil(this.duration - this.t));
    if (!res) return;

    const statsEl = $('inter-stats');
    if (statsEl && !statsEl.dataset.done) {
      statsEl.dataset.done = '1';
      const s = res.stats;
      const scores = res.scores || [];
      statsEl.innerHTML = `
        <div class="ist"><span>КИЛЛЫ</span><b>${s.kills}</b></div>
        <div class="ist"><span>СМЕРТИ</span><b>${s.deaths}</b></div>
        <div class="ist"><span>PERFECT</span><b>${Math.round((s.perfectPct || 0) * 100)}%</b></div>
        <div class="ist"><span>FLOW-MAX</span><b>${Math.round(s.flowMax || 0)}</b></div>
        <div class="ist wide"><span>СЧЁТ</span><b>${scores.join(' : ')}</b></div>`;
    }
    // Анимированная дельта рейтинга: от старого значения к новому за ~2с
    const rEl = $('inter-rating-num');
    const dEl = $('inter-rating-delta');
    const rankEl = $('inter-rank');
    if (rEl && res.rating) {
      const k = Math.min(1, this.t / 2);
      const shown = Math.round(res.rating.oldRating + (res.rating.rating - res.rating.oldRating) * k);
      rEl.textContent = shown;
      if (dEl) {
        dEl.textContent = `${res.rating.delta >= 0 ? '+' : ''}${res.rating.delta}`;
        dEl.className = res.rating.delta >= 0 ? 'up' : 'down';
      }
      if (rankEl) rankEl.textContent = res.rating.rank;
    }
  }
}
