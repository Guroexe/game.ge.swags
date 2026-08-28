// ===== GEN.SWAGS Main =====
// Boot → Menu → Game. Связывает движок, мир, игрока, оружие,
// ботов (bots.js), режим (mode_cashout.js), FLOW (flow.js), HUD и меню.
// Hooks этапа 1 сохранены: game.registerBotsProvider, game.registerMode, window.__game.
import * as THREE from 'three';
import { Engine } from './engine/core.js';
import { Input } from './engine/input.js';
import { MusicEngine, SFX } from './engine/audio.js';
import { PhysicsWorld } from './engine/physics.js';
import { NetClient } from './engine/net.js';
import { Player } from './game/player.js';
import { WeaponSystem } from './game/weapons.js';
import { DestructionSystem } from './game/destruction.js';
import { buildArena, disposeArena } from './game/arena.js';
import { BotManager, TEAMS, ROSTER } from './game/bots.js';
import { SkullSwarm, loadSkullTemplate } from './game/skulls.js';
import { CashoutMode } from './game/mode_cashout.js';
import { FlowSystem } from './game/flow.js';
import { RhythmSystem } from './game/rhythm.js';
import { MetaLoop, TransitionFX, ARENA_NAMES } from './game/meta.js';
import { SoundWar, TRACK_META, metaFor } from './game/soundwar.js';
import { TrackSelect } from './game/trackselect.js';
import { SkinPreview } from './game/skinpreview.js';
import { HUD } from './game/hud.js';
import { Menu } from './game/menu.js';
import { GyroDebugOverlay } from './game/gyrodebug.js';
import { runGyroSelfTest } from './game/gyroselftest.js';
import { RemotePlayers, MPCashMirror } from './game/mp.js';
import { AssetLib } from './engine/assetlib.js';
import { preloadEnvTextures } from './engine/models.js';
import { preloadChars, instantiateGirl } from './engine/charlib.js';
import { createCyberGirl } from './engine/models.js';

// ============================
// State machine
// ============================
const State = { BOOT: 'BOOT', MENU: 'MENU', GAME: 'GAME' };
const BASE_GRAVITY = -22;

class Game {
  constructor() {
    this.state = State.BOOT;
    this.paused = false;
    this.matchEnded = false;
    this.canvas = document.getElementById('game-canvas');

    // Движок
    this.engine = new Engine(this.canvas);
    this.input = new Input(this.canvas);
    this.music = new MusicEngine();
    this.sfx = new SFX(this.music);
    this.physics = new PhysicsWorld();
    this.net = new NetClient();

    // Игровые системы (создаются при boot)
    this.player = null;
    this.weapons = null;
    this.destruction = null;
    this.arena = null;
    this.botsManager = null;
    this.hud = null;
    this.menu = null;
    this._botsProvider = null;   // hook: свои боты (этап 1 API)
    this._modeApi = null;        // hook: свой режим (этап 1 API)

    // Мультиплеер
    this.mpActive = false;       // идёт сетевой матч
    this.remotePlayers = null;   // RemotePlayers (создаётся в boot)
    this.mpMirror = null;        // MPCashMirror
    this.chatOpen = false;
    this._chatTeam = false;
    this._chatSendTimes = [];    // клиентский rate limit (4/сек как на сервере)
    this._speaking = new Map();  // id|'me' -> bool (голосовой чат)
    this._voiceAudio = new Map();// peerId -> HTMLAudioElement
    this._mpSentChunks = new Set();
    this._mpRespawnT = 0;
    this._mpPickupT = 0;

    // SOUND WAR — у каждой команды свой трек; вражеский слышен геймплейно
    this.soundWar = new SoundWar({ music: this.music, physics: this.physics });
    this.transition = new TransitionFX(this); // переходы «между мирами» (смерть/конец матча)
    this._trackSel = null;      // выбор на экране треков (сырой)
    this._playerTrack = null;   // боевой трек игрока {name,title,genre,bpm,buffer,isUser}
    this._skipTrackSelect = false;
    this.trackSelect = null;    // создаётся в boot (DOM)
    this.skinPreview = new SkinPreview(this);
    this.soundWar.onClashStart = (team) => {
      this.hud?.notify(`⚡ SOUND CLASH С ${TEAMS[team]?.name || 'ВРАГОМ'} — УРОН +10% ⚡`, 'drop');
      this.engine.fx.pulse(2);
      this.sfx.drop();
    };
    this.soundWar.onClashEnd = () => this.hud?.notify('SOUND CLASH ЗАВЕРШЁН', 'obj');
    this.soundWar.onVoiceSteal = () => this.hud?.notify('КРАЖА ГОЛОСА — ВРАГ НЕМЕЕТ, ТЫ +3ДБ', 'drop');
    this.soundWar.onEnemyDrop = (team) => {
      this.hud?.notify(`ВРАЖЕСКИЙ ДРОП — ${TEAMS[team]?.name || ''}`, 'bad');
      this.engine.fx.pulse(1.3);
    };

    // FLOW — музыкально-реактивный геймплей
    this.flow = new FlowSystem({ music: this.music });
    this._beatPulse = 0;
    this.flow.onBeat = (bass) => {
      this._beatPulse = 1;
      this.hud?.beat(0.5 + bass * 0.8);
      // В интермиссии, ZE FLOW и SOUND CLASH эффекты бьют сильнее в такт
      const boost = (this.meta?.intermission ? 1.8 : 1) * (this.rhythm?.zeFlow ? 1.6 : 1)
        * (this.soundWar?.clash.active ? 1.7 : 1);
      this.engine.fx.pulse((0.4 + bass * 0.7) * boost); // пульс постэффектов в бит
      this.arena?.lightShowBeat?.(); // спайк прожекторов светового шоу
    };
    this.flow.onDropStart = (k) => {
      this._applyDrop(true, k);
      // SOUND CLASH: наш дроп vs дроп врага (окно 2с)
      this.soundWar?.notifyDrop('you');
      if (this.mpActive && this.net?.connected) this.net.send({ t: 'soundwar', clashDrop: true });
    };
    this.flow.onDropEnd = () => this._applyDrop(false, 0);

    // Ритм-синк действий (окна бита, комбо-стрик, ZE FLOW)
    this.rhythm = new RhythmSystem({ music: this.music });
    this.rhythm.onZeFlowStart = () => {
      this.hud?.notify('⚡ ZE FLOW — ВСЁ УСИЛЕНО ⚡', 'drop');
      this.engine.fx.pulse(1.6);
    };
    this.rhythm.onZeFlowEnd = () => this.hud?.notify('ZE FLOW ЗАВЕРШЁН', 'obj');
    // КОМБО-ТИРЫ: музыка даёт нарастающие баффы (скорость/урон/реген/мандала)
    this.rhythm.onComboTier = (tier) => {
      if (tier >= 2) {
        const names = { 2: 'ГРУВ', 3: 'ZE FLOW', 4: 'МАНДАЛА' };
        this.hud?.notify(`♪ КОМБО ×${this.rhythm.streak} — ${names[tier]}: БАФФЫ УСИЛЕНЫ ♪`, 'drop');
        this.engine.fx.pulse(0.9 + tier * 0.25);
      }
    };

    // Структура трека: фазы intro/build/drop/breakdown → геймплей
    this.worldSlowMo = 1;      // BREAKDOWN: slow-mo мира ×0.9 (музыка не трогается)
    this._breakdownFx = false;
    this.music.onPhase((phase) => this._onTrackPhase(phase));

    // Мета-петля раундов: матч → экран итогов → PSY-BREAK интермиссия → новая арена
    this.gameMode = 'cashout'; // cashout|duel|ffa (карточки в меню)
    this._modeKind = null;     // собранный режим
    this._arenaVariant = 'eden';
    this._arenaSize = 60;
    this._matchStats = { kills: 0, deaths: 0 };
    this.meta = new MetaLoop(this);

    this._fx = []; // простые анимированные эффекты (кольца ударной волны)

    // Выбор трека перед матчем: старт из меню идёт через экран «ВЫБЕРИ СВОЙ ТРЕК»
    // (MP-старт, рестарт из интермиссии и ?autostart — напрямую).
    this._startGameDirect = this.startGame.bind(this);
    this.startGame = () => {
      if (this.state === State.MENU && !this.mpActive && !this._skipTrackSelect && this.trackSelect) {
        const goTracks = () => this.trackSelect.open((sel) => {
          if (!sel) return; // ?????? (Esc/?????) - ???????? ? ????
          this.applyTrackChoice(sel);
          // После выбора трека — экран выбора карты (РАЙ-7/ГЕЕННА/СЕКТОР-9/РУИНЫ/СЛУЧАЙНО)
          this._showArenaSelect((variant) => {
            if (variant) this._pendingArena = variant;
            this._startGameDirect();
          });
        });
        // ??????? ????? ????????? (3D-??????), ????? ????? ?????
        if (this.skinPreview) this.skinPreview.show(goTracks);
        else goTracks();
      } else {
        this._startGameDirect();
      }
    };
  }

  // ===== Экран выбора арены (после выбора трека) =====
  _showArenaSelect(onPick) {
    const old = document.getElementById('arena-select');
    if (old) old.remove();
    const ARENAS = [
      { id: 'eden', name: 'РАЙ-7', jp: '楽園', desc: 'Плавные кривые, неон, парк' },
      { id: 'hell', name: 'ГЕЕННА', jp: '地獄', desc: 'Лава, огонь, узкие проходы' },
      { id: 'sng', name: 'СЕКТОР-9', jp: '區', desc: 'Индустриальный лабиринт' },
      { id: 'ruins', name: 'РУИНЫ', jp: '廃墟', desc: 'Разрушенный город, обломки' },
      { id: 'dust2', name: 'ДАСТ-2', jp: '砂塵', desc: 'Легендарная CS-карта de_dust2' },
      { id: 'goldencity', name: 'ЗОЛОТОЙ ГОРОД', jp: '金城', desc: 'Неоновый мегаполис' },
      { id: null, name: 'СЛУЧАЙНО', jp: '乱', desc: 'Случайная арена из ротации' },
    ];
    const wrap = document.createElement('div');
    wrap.id = 'arena-select';
    wrap.style.cssText = 'position:fixed;inset:0;z-index:200;display:flex;align-items:center;justify-content:center;background:rgba(6,4,14,0.92);backdrop-filter:blur(6px);font-family:monospace;';
    const box = document.createElement('div');
    box.style.cssText = 'width:min(92vw,520px);max-height:90vh;overflow-y:auto;padding:24px 18px;background:linear-gradient(180deg,rgba(20,10,40,0.95),rgba(8,4,18,0.98));border:1px solid rgba(180,80,255,0.35);border-radius:12px;box-shadow:0 0 40px rgba(120,40,220,0.25);';
    box.innerHTML = `<div style="text-align:center;margin-bottom:18px;">
      <div style="font-size:22px;letter-spacing:4px;color:#e8d5ff;text-shadow:0 0 12px #a060ff;">ВЫБОР АРЕНЫ</div>
      <div style="font-size:11px;color:#9a7fb8;margin-top:4px;letter-spacing:1px;">КУДА ОТПРАВИМСЯ?</div>
    </div>`;
    const list = document.createElement('div');
    list.style.cssText = 'display:flex;flex-direction:column;gap:10px;';
    ARENAS.forEach((a) => {
      const btn = document.createElement('button');
      btn.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:14px 16px;background:rgba(30,15,55,0.6);border:1px solid rgba(160,100,255,0.25);border-radius:8px;color:#f0e6ff;cursor:pointer;transition:all 0.15s;text-align:left;font-family:monospace;';
      btn.innerHTML = `<div>
        <div style="font-size:16px;font-weight:bold;letter-spacing:2px;">${a.name} <span style="font-size:12px;color:#b48fd6;">${a.jp}</span></div>
        <div style="font-size:11px;color:#a08cc0;margin-top:2px;">${a.desc}</div>
      </div>
      <div style="font-size:18px;color:#c060ff;">▶</div>`;
      btn.onmouseenter = () => { btn.style.background = 'rgba(80,30,140,0.7)'; btn.style.borderColor = 'rgba(200,120,255,0.6)'; };
      btn.onmouseleave = () => { btn.style.background = 'rgba(30,15,55,0.6)'; btn.style.borderColor = 'rgba(160,100,255,0.25)'; };
      btn.onclick = () => { cleanup(); onPick(a.id); };
      list.appendChild(btn);
    });
    box.appendChild(list);
    const cancel = document.createElement('button');
    cancel.textContent = 'ОТМЕНА';
    cancel.style.cssText = 'margin-top:16px;width:100%;padding:10px;background:transparent;border:1px solid rgba(160,100,255,0.3);border-radius:6px;color:#b48fd6;cursor:pointer;font-family:monospace;letter-spacing:2px;';
    cancel.onclick = () => { cleanup(); onPick(null); };
    box.appendChild(cancel);
    wrap.appendChild(box);
    document.body.appendChild(wrap);
    const onKey = (e) => { if (e.key === 'Escape') { cleanup(); onPick(null); } };
    window.addEventListener('keydown', onKey);
    function cleanup() {
      window.removeEventListener('keydown', onKey);
      wrap.remove();
    }
  }

  // ============================
  // Выбор трека / SOUND WAR
  // ============================

  // Применить выбор с экрана треков → боевой трек игрока на матч
  applyTrackChoice(sel) {
    this._trackSel = sel;
    this._playerTrack = null;
    if (!sel || sel.kind === 'random') return; // random разрешится при старте
    const t = this.music.playlist[sel.index]
      || this.music.playlist.find((x) => x.name === sel.name);
    if (!t) return;
    const meta = metaFor(t.name);
    this._playerTrack = {
      name: t.name,
      title: sel.title || meta?.title || t.name,
      genre: meta?.genre || 'СВОЙ ТРЕК',
      bpm: sel.bpm || meta?.bpm || t.userBpm || 0,
      buffer: t.buffer,
      isUser: sel.kind === 'user',
    };
  }

  // Назначить треки командам и запустить вражеский поток (в startGame)
  _setupSoundWar() {
    const sw = this.soundWar;
    if (!sw) return;
    sw.stop();
    // MP: если выбора не было — тихо применить последний (без экрана)
    if (!this._playerTrack) {
      const last = this.trackSelect?.lastChoice?.();
      if (last) this.applyTrackChoice(last);
    }
    // random/нет выбора → боевой трек = тот, что реально играет
    if (!this._playerTrack) {
      const t = this.music.playlist[this.music.trackIndex];
      if (t && t.name !== 'menu_ambient.mp3') {
        const meta = metaFor(t.name);
        this._playerTrack = {
          name: t.name, title: meta?.title || t.name, genre: meta?.genre || 'СВОЙ ТРЕК',
          bpm: meta?.bpm || t.userBpm || 0, buffer: t.buffer, isUser: !meta,
        };
      }
    }
    if (!this._playerTrack?.buffer) return;
    const used = new Set([this._playerTrack.name, 'menu_ambient.mp3']);
    // Боты-команды получают РАЗНЫЕ треки из плейлиста (детерминированно —
    // совпадает у всех клиентов MP как fallback до прихода soundwar-синка)
    const pickBotTrack = (team) => {
      const free = TRACK_META.filter((m) => !used.has(m.file));
      const meta = free[(team * 2 + 1) % Math.max(1, free.length)] || TRACK_META[0];
      used.add(meta.file);
      const t = this.music.playlist.find((x) => x.name === meta.file);
      if (!t) return null;
      return { name: meta.file, title: meta.title, genre: meta.genre, bpm: meta.bpm, buffer: t.buffer, isUser: false };
    };
    sw.assignTracks(this.mode?.playerTeam ?? 0, this._playerTrack, pickBotTrack);
    sw.startMatch();
    sw.refreshRate(this.music.bpm || this._playerTrack.bpm);
    // MP: объявить свой трек комнате (аддитивный протокол; старый сервер проигнорирует)
    if (this.mpActive && this.net?.connected) {
      this.net.send({ t: 'soundwar', trackId: SoundWar.trackIdOf(this._playerTrack) });
    }
  }

  // Контекст апдейта звуковой войны (счёт/FLOW/зоны/поза игрока)
  _soundWarCtx() {
    const mode = this.mode;
    const sources = [];
    if (mode?.cashEnabled !== false) {
      for (const st of mode?.stations || []) {
        const team = st.team >= 0 ? st.team : (mode.channelStation === st ? mode.carrierTeam : -1);
        if (team >= 0) sources.push({ x: st.pos.x, z: st.pos.z, team, label: `СТАНЦИЯ ${st.letter}` });
      }
      if (mode?.carrierTeam >= 0 && (mode.carrier || mode.state === 'CHANNEL')) {
        sources.push({ x: mode.boxPos.x, z: mode.boxPos.z, team: mode.carrierTeam, label: 'КЕШБОКС' });
      }
    }
    let objHoldTeam = -1;
    if (mode) {
      if (mode.carrierTeam >= 0 && mode.state !== 'IDLE') objHoldTeam = mode.carrierTeam;
      else if (mode.state === 'DEPOSIT') objHoldTeam = mode.channelStation?.team ?? -1;
    }
    return {
      scores: mode?.scores,
      flowValue: this.flow?.value || 0,
      objHoldTeam,
      zoneSources: sources,
      playerPos: this.player?.body.pos,
      playerYaw: this.player?.look?.yaw || 0,
      playerAlive: this.player?.alive,
    };
  }

  // MP: сервер ретранслировал soundwar (trackId команды / вражеский дроп для клэша)
  _mpOnSoundWar(m) {
    if (!this.mpActive || m.id === this.net.playerId) return;
    if (m.trackId) this.soundWar?.applyRemoteTrack(m.team, m.trackId);
    if (m.clashDrop) this.soundWar?.remoteDrop(m.team);
  }

  // ===== Ритм-синк: судейство действия + визуал/звук =====
  _rhythmAction(type) {
    const j = this.rhythm.judge(type);
    if (j !== 'miss') {
      this.hud?.rhythmJudge(j);
      this.sfx?.beatAccent(j);
    }
    return j;
  }

  // ===== Цепочка убийств (соло): серия в окне 3.5с → попап 二連殺 ×N =====
  // + анонсер Quake/Dota: DOUBLE/TRIPLE/ULTRA/MONSTER KILL, 6+ — RAMPAGE
  _registerChainKill() {
    const now = performance.now() / 1000;
    if (!this._chain) this._chain = { count: 0, lastAt: 0 };
    this._chain.count = (now - this._chain.lastAt < 3.5) ? this._chain.count + 1 : 1;
    this._chain.lastAt = now;
    const n = this._chain.count;
    if (n >= 2) {
      this.hud?.chainPopup(n);
      const ANN = { 2: 'double', 3: 'triple', 4: 'ultra', 5: 'monster' };
      this.sfx?.announcer?.(ANN[n] || 'rampage');
    }
    return n;
  }

  // ===== Фазы трека → геймплей =====
  _onTrackPhase(phase) {
    // Фазовые тона фона: build — молочно-белый, breakdown — почти чёрный фиолет,
    // intro — вернуть базовый. Лерпится в render-цикле (drop/psy-break перекрывают).
    if (phase === 'build') this._phaseTint = 0xcfc8e0;
    else if (phase === 'breakdown') this._phaseTint = 0x0a0618;
    else if (phase === 'intro') this._phaseTint = null;
    if (phase === 'breakdown') {
      // «вдох» перед дропом: лёгкий slow-mo мира + слабый warp
      this.worldSlowMo = 0.9;
      if (!this.engine.fx.psyBreak) this.engine.fx.set({ warp: 0.18, rgbSplit: 0.003 });
      this._breakdownFx = true;
      if (this.state === State.GAME) this.hud?.notify('BREAKDOWN — ВДОХ…', 'obj');
      return;
    }
    this.worldSlowMo = 1;
    if (this._breakdownFx) {
      this._breakdownFx = false;
      if (!this.engine.fx.psyBreak && !this.flow.dropActive) {
        this.engine.fx.set({ warp: 0, rgbSplit: 0 });
      }
    }
    // Реальный дроп любого загруженного трека триггерит DROP-режим
    // (авто-триггер по расписанию в flow.js остаётся fallback'ом)
    if (phase === 'drop' && this.state === State.GAME) this.flow.triggerDrop(1.5);
  }

  // Статы матча для мета-экрана/рейтинга
  collectMatchStats() {
    return {
      kills: this._matchStats.kills,
      deaths: this._matchStats.deaths,
      perfectPct: this.rhythm.perfectPct,
      flowMax: this.flow.maxSeen || 0,
    };
  }

  // ===== Hooks для расширений (API этапа 1) =====
  registerBotsProvider(fn) { this._botsProvider = fn; }
  registerMode(api) { this._modeApi = api; }
  get mode() { return this._modeApi; }
  get bots() { return this.botsManager ? this.botsManager.bots : []; }

  // ============================
  // BOOT
  // ============================
  async boot() {
    const status = (txt, pct) => {
      const s = document.getElementById('boot-status');
      const p = document.getElementById('boot-progress');
      if (s) s.textContent = txt;
      if (p) p.style.width = `${pct}%`;
    };

    // iOS-фриз при навигации HTTP↔HTTPS: Safari достаёт страницу из
    // back-forward cache с мёртвым WebGL-контекстом → картинка заморожена.
    // 1) pageshow из bfcache — жёсткий reload; 2) потеря контекста — оверлей
    // с кнопкой обновления (сам контекст iOS почти никогда не восстанавливает).
    if (!this._freezeGuard) {
      this._freezeGuard = true;
      window.addEventListener('pageshow', (e) => { if (e.persisted) location.reload(); });
      this.engine?.canvas?.addEventListener('webglcontextlost', (e) => {
        e.preventDefault();
        const ov = document.getElementById('gfx-lost');
        if (ov) ov.classList.add('show');
        console.warn('[gfx] WebGL context lost — требуется обновление страницы');
      });
      document.getElementById('gfx-lost-reload')?.addEventListener('click', () => location.reload());
    }

    // Шаг загрузки с жёстким таймаутом: ни аудио, ни модель, ни текстура
    // не могут повесить старт навсегда (iPhone Safari / медленная сеть).
    // Тап по экрану — мгновенный пропуск ожидания (загрузка догружается в фоне).
    this._skipBootResolvers = new Set();
    const guard = (p, ms, label) => {
      if (this._skipBoot) return Promise.resolve(); // тап уже был — не ждём вообще
      return Promise.race([
        Promise.resolve(p).catch((e) => console.warn(`[boot] ${label} — пропуск (ошибка):`, e)),
        new Promise((res) => setTimeout(() => {
          console.warn(`[boot] ${label} — пропуск (таймаут ${ms}мс)`);
          res();
        }, ms)),
        new Promise((res) => {
          if (this._skipBoot) return res(); // тап между созданием и race
          this._skipBootResolvers.add(res);
        }),
      ]);
    };
    const bootEl = document.getElementById('boot-screen');
    bootEl?.addEventListener('pointerdown', () => {
      this._skipBoot = true;
      for (const r of this._skipBootResolvers) r();
      this._skipBootResolvers.clear();
      status('ПРОПУСК ОЖИДАНИЯ — СБОРКА МИРА...', 40);
    }, { once: false });

    // ПАРАЛЛЕЛЬНАЯ загрузка: аудио + одношоты + модели + текстуры идут
    // одновременно (на iPhone по Wi-Fi — в 3-4 раза быстрее, чем цепочкой).
    status('ЗАГРУЗКА АУДИО И МОДЕЛЕЙ...', 15);
    const audioP = guard(this.music.loadBuiltin([
      'assets/audio/menu_ambient.mp3',
      'assets/audio/sound/NO_TALK_FREE_DRINK_KLICKAUD.mp3',
      'assets/audio/sound/голодный_волк_KLICKAUD.mp3',
      'assets/audio/sound/Кракен_hardtrekk_KLICKAUD.mp3',
    ]), 20000, 'аудио');


    const sfxP = guard(this.sfx.loadOneShots({
      ui: 'assets/audio/sfx_ui_click.mp3',
      cashout: 'assets/audio/sfx_cashout.mp3',
      drop: 'assets/audio/sfx_drop.mp3',
      // Kenney Starter-Kit-FPS (CC0) — на iOS Safari OGG не декодируется, сработает синтез
      blaster: 'assets/audio/sfx/blaster.ogg',
      blaster_repeater: 'assets/audio/sfx/blaster_repeater.ogg',
      enemy_hurt: 'assets/audio/sfx/enemy_hurt.ogg',
      enemy_destroy: 'assets/audio/sfx/enemy_destroy.ogg',
      jump_a: 'assets/audio/sfx/jump_a.ogg',
      weapon_change: 'assets/audio/sfx/weapon_change.ogg',
      // РЕАЛЬНЫЕ выстрелы (Wikimedia Commons, PD/CC BY-SA — CREDITS.md):
      // shot_9mm.wav — PCM WAV (работает и в iOS Safari), gunshots8.ogg — десктоп
      gun_rifle: 'assets/audio/guns/shot_9mm.wav',
      gun_multi: 'assets/audio/guns/gunshots8.ogg',
      // Анонсер киллстриков (Quake/Dota-стиль, сгенерировано — CREDITS.md)
      ann_firstblood: 'assets/audio/announcer/firstblood.mp3',
      ann_double: 'assets/audio/announcer/doublekill.mp3',
      ann_triple: 'assets/audio/announcer/triplekill.mp3',
      ann_ultra: 'assets/audio/announcer/ultrakill.mp3',
      ann_monster: 'assets/audio/announcer/monsterkill.mp3',
      ann_rampage: 'assets/audio/announcer/rampage.mp3',
      ann_humiliation: 'assets/audio/announcer/humiliation.mp3',
      ann_headshot: 'assets/audio/announcer/headshot.mp3',
    }), 12000, 'sfx');
    const modelsP = guard(AssetLib.preload((k) => status('ЗАГРУЗКА АУДИО И МОДЕЛЕЙ...', 15 + Math.round(k * 15))), 15000, 'модели');
    const texP = guard(preloadEnvTextures(), 15000, 'текстуры');
    const charsBgP = guard(preloadChars(), 25000, 'персонажи');
    const skullP = guard(loadSkullTemplate(), 8000, 'череп-змея');
    await Promise.all([audioP, sfxP, modelsP, texP, skullP]);
    // Trim-сегменты (start/end) из TRACK_META — играем самые бодрые куски треков
    for (const t of this.music.playlist) {
      const meta = metaFor(t.name);
      if (meta && meta.start != null) {
        t.segStart = meta.start;
        t.segEnd = meta.end != null ? meta.end : null;
      }
    }
    // В меню играет тема меню (ищем по имени — порядок загрузки не гарантирован)
    const menuIdx0 = this.music.playlist.findIndex((t) => t.name === 'menu_ambient.mp3');
    if (menuIdx0 >= 0) this.music.trackIndex = menuIdx0;
    const texLoaded = await texP;
    console.log(`[boot] PBR-текстуры ambientCG: ${texLoaded ?? 0}/6 наборов (0 = процедурный fallback)`);

    // Скелетные аниме-модели (GLB из Mixamo): если не успели к буту — боты
    // получат процедурный fallback, после загрузки startGame пересоздаст их.
    status('ЗАГРУЗКА ПЕРСОНАЖЕЙ...', 39);
    this._charsPromise = charsBgP.then((r) =>
      console.log('[boot] скелетные модели:', ((r || []).filter ? r : []).filter(Boolean).length + '/3'));

    status('ПОСТРОЕНИЕ АРЕНЫ...', 40);
    await nextFrame();
    this.destruction = new DestructionSystem(this.engine.scene, this.sfx);
    this.physics.chunkProvider = this.destruction.chunkProvider;
    this.arena = buildArena(this.engine.scene, this.physics, this.destruction, {
      reflector: this.engine.datamoshAvailable(), // на слабом тире — fake gloss
    });
    // Авто-качество: переключение отражения пола при смене тира
    this.engine.onQualityChange = (tier) => {
      this.arena?.setReflector(tier === 'high');
      if (this.state === State.GAME) {
        this.hud?.notify(tier === 'low' ? 'ЭФФЕКТЫ: ЭКОНОМ-РЕЖИМ' : 'ЭФФЕКТЫ: ПОЛНЫЕ', 'obj');
      }
    };
    // Синхронизация разрушений в MP: локально уничтоженный чанк → на сервер
    this.destruction.onChunkDestroyed = (c) => {
      if (!this.mpActive || !c.id || this._mpSentChunks.has(c.id)) return;
      this._mpSentChunks.add(c.id);
      this.net.sendChunk(c.id);
    };
    // Обрушение крыши: удар о землю — урон по радиусу (соло; в MP HP ведёт сервер)
    this.destruction.onRoofCollapse = (pos) => {
      this.engine?.fx?.pulse?.(1.4);
      this.hud?.notify('⚠ ОБРУШЕНИЕ КРЫШИ ⚠', 'bad');
      if (this.mpActive) return;
      const R = 5.2;
      // Игрок
      if (this.player?.alive) {
        const d = Math.hypot(this.player.pos.x - pos.x, this.player.pos.z - pos.z);
        if (d < R && this.player.pos.y < 3.5) {
          this.player.damage?.(Math.round(70 * (1 - d / R) + 20), 'collapse');
        }
      }
      // Боты (урон наносится через bot.damage(dmg, dir, attackerTeam))
      for (const bot of this.botsManager?.bots || []) {
        if (!bot.alive) continue;
        const d = Math.hypot(bot.pos.x - pos.x, bot.pos.z - pos.z);
        if (d < R && bot.pos.y < 3.5) {
          bot.damage(Math.round(90 * (1 - d / R) + 25), null, -1);
        }
      }
    };

    status('СБОРКА ИГРОКА...', 60);
    this.player = new Player({
      camera: this.engine.camera, input: this.input, physics: this.physics, sfx: this.sfx,
    });
    this.player.arenaHalf = (this._arenaSize || 60) / 2; // kill-объём за границей арены
    this.weapons = new WeaponSystem({
      scene: this.engine.scene, camera: this.engine.camera,
      player: this.player, physics: this.physics, sfx: this.sfx,
      destruction: this.destruction,
    });
    this.weapons.getMode = () => this.mode; // G с кешбоксом = бросок кешбокса
    this.engine.scene.add(this.engine.camera);

    status('СПАВН БОТОВ...', 75);
    if (this._botsProvider) {
      this._customBots = this._botsProvider(this) || [];
    } else {
      this.botsManager = new BotManager({
        scene: this.engine.scene, physics: this.physics, arena: this.arena,
        destruction: this.destruction, sfx: this.sfx, flow: this.flow,
        gore: this.weapons?.gore || null,
      });
      this.botsManager.bindPlayer(this.player, 0);
      this.botsManager.spawnAll();
      this._refreshTargets();
      this.botsManager.onKillEvent = (victim, attackerTeam) => {
        this.hud?.killFeed(`${victim.teamInfo.name} · ${victim.name} УНИЧТОЖЕН`);
        // Кровь/гибсы на месте гибели спавнит BotManager (стили смерти 18+)
        this.soundWar?.registerKill(attackerTeam ?? -1, victim.team);
        // FFA/дуэль: киллы ботов друг по другу дают очки атакующей команде
        // (киллы игрока считаются через weapons.onKill — без дабл-каунта)
        if (attackerTeam != null && attackerTeam >= 0 && attackerTeam !== this.mode?.playerTeam) {
          this.mode?.registerKill?.(attackerTeam);
        }
      };
    }

    // Змея-череп HYPER DEMON: хрупкий преследующий NPC (соло only), 40 HP,
    // респавн 8–12с в случайной точке
    this.skullSwarm = new SkullSwarm({
      scene: this.engine.scene, sfx: this.sfx, gore: this.weapons.gore,
      physics: this.physics,
    });
    this.skullSwarm.onKill = (skull) => {
      this.hud?.killFeed('ВЫ РАЗБИЛИ ЧЕРЕП');
      this.flow?.registerKill?.();
      this._rhythmAction?.('kill');
      this._registerChainKill(); // череп тоже идёт в цепочку
      this.weapons?.weapon?.vm.smokeNow?.(); // затяжка после килла
      if (skull?.pos) this.weapons?.gore?.gib({ x: skull.pos.x, y: skull.pos.y, z: skull.pos.z }, null, 3);
    };

    status('РЕЖИМ HUB_1...', 85);
    this._createMode('cashout');

    // Оружие → события
    this.weapons.onKill = (bot, opts) => {
      // Змея-череп (team -99) — свой обработчик skullSwarm.onKill (киллфид,
      // цепочка, гибсы); здесь не считаем, чтобы не было дабл-каунта
      if (bot.team === -99) return;
      this.weapons.weapon?.vm.smokeNow?.(); // затяжка после килла
      this.hud?.killFeed(`ВЫ УНИЧТОЖИЛИ ${bot.name}`);
      const mult = this.flow.registerKill(); // килл на бите = ×2 FLOW (внутри)
      if (mult > 1) this.hud?.notify('КИЛЛ НА БИТЕ ×2 FLOW', 'drop');
      this._rhythmAction('kill');
      // Анонсер: первая кровь матча → FIRST BLOOD; иначе цепочка 二連殺;
      // одиночный хедшот без серии — HEADSHOT
      let annPlayed = false;
      if (!this._firstBlood) {
        this._firstBlood = true;
        this.sfx?.announcer?.('firstblood');
        this.hud?.notify('ПЕРВАЯ КРОВЬ 初血', 'drop');
        annPlayed = true;
      }
      const chain = this._registerChainKill(); // цепочка убийств 二連殺
      if (chain >= 2) annPlayed = true;
      if (!annPlayed && opts?.part === 'head') this.sfx?.announcer?.('headshot');
      this.music?.stutter?.(Math.min(1.6, 0.9 + chain * 0.15), { pitchDip: Math.random() < 0.35 }); // эдит-чоп на килле
      // Гуро: гибсы летят по направлению взгляда
      if (bot?.pos) {
        const yaw = this.player?.look?.yaw ?? 0;
        this.weapons.gore?.gib(
          { x: bot.pos.x, y: bot.pos.y + 1.0, z: bot.pos.z },
          { x: -Math.sin(yaw), y: 0, z: -Math.cos(yaw) }, 5);
      }
      this._matchStats.kills++;
      this.weapons.grenades = Math.min(this.weapons.maxGrenades, this.weapons.grenades + 1);
      // SOUND WAR: килл = украсть энергию звука (подавление частот / кража голоса в клэше)
      const swEv = this.soundWar?.registerKill(this.mode?.playerTeam ?? 0, bot.team);
      if (swEv?.suppressed && !swEv?.stolen) this.hud?.notify('ЧАСТОТЫ ВРАГА ЗАХВАЧЕНЫ', 'obj');
      this.mode?.onKill(bot, 'ВЫ');
      this.mode?.registerKill?.(this.mode.playerTeam); // очки режимов дуэль/FFA
    };
    this.weapons.onHit = (target, part, dmg) => this.flow.registerHit(dmg);
    // Ритм-судья оружия: выстрел (perfect = −50% spread), граната, конец перезарядки
    this.weapons.onAction = (type) => this._rhythmAction(type);

    // Игрок → события
    this.player.onDamaged = () => this.mode?.onCarrierDamaged();
    this.player.onDeath = () => {
      this.hud?.killFeed('ВАС УНИЧТОЖИЛИ');
      // HUMILIATION: смерть от падения за арену (Quake — позорная смерть)
      if (this.player.lastDeathCause === 'fall') {
        this.player.lastDeathCause = null;
        this.sfx?.announcer?.('humiliation');
        this.hud?.notify('ПАДЕНИЕ В ПУСТОТУ 屈辱', 'obj');
      }
      this._matchStats.deaths++;
      if (this._chain) this._chain.count = 0; // смерть обрывает цепочку
      this.mode?.playerDied();
      // SOUND WAR: твоя смерть в клэше — твой трек приглушают
      this.soundWar?.registerKill(this.soundWar?.activeEnemyTeam ?? -1, this.mode?.playerTeam ?? 0);
      // Переход «между мирами»: мини-версия 2.5с → респавн
      this.transition?.startDeath();
      // SOUL CAM: душа вылетает из тела — слоу-мо, орбита вокруг трупа, дисторшн
      this._beginSoulCam();
      // Ствол из рук убитого — убрать (баг «оружие висит после смерти»)
      this.weapons?.setDead(true);
      // Дуэль: смерть игрока — очко единственному противнику
      if (this._modeKind === 'duel') this.mode?.registerKill?.(1);
    };
    // Ритм-хуки движения/скилов
    this.player.onDash = () => (RhythmSystem.onBeat(this._rhythmAction('dash')) ? 1.2 : 1);
    this.player.onJump = (dbl) => this._rhythmAction(dbl ? 'double_jump' : 'jump');
    this.player.onSlide = () => this._rhythmAction('slide');
    this.player.onShockwave = (pos, gMul = 1) => {
      const j = this._rhythmAction('shockwave');
      this._shockwave(pos, (RhythmSystem.onBeat(j) ? 1.3 : 1) * gMul); // на бите: +30% радиус; gMul — GROOVE-множитель радиуса
    };
    this.player.onGrapple = () => this._rhythmAction('grapple');

    // Крюк-верёвка
    this._rope = new THREE.Line(
      new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3)),
      new THREE.LineBasicMaterial({ color: 0xff2d55, transparent: true, opacity: 0.9 }),
    );
    this._rope.visible = false;
    this._rope.frustumCulled = false;
    this.engine.scene.add(this._rope);

    status('HUD И МЕНЮ...', 92);
    this.hud = new HUD(this);
    this.hud.build();
    this.menu = new Menu(this);
    this.menu.init();
    // Экран выбора боевого трека (перед стартом матча из меню)
    this.trackSelect = new TrackSelect(this);
    // Оверлей диагностики гироскопа (настройки → ТЕСТ ГИРОСКОПА или ?gyrodebug=1)
    this.gyroDebug = new GyroDebugOverlay(this);
    this._urlParams = new URLSearchParams(window.location.search);
    if (this._urlParams.get('gyrodebug')) this.gyroDebug.open(true);

    // MP-системы (рендер удалённых игроков + зеркало кеш-режима)
    this.remotePlayers = new RemotePlayers({
      scene: this.engine.scene, physics: this.physics, sfx: this.sfx, net: this.net,
    });
    this.remotePlayers.onTracer = (from, to, color) =>
      this.weapons._spawnTracer(from, to, color ?? 0xffe9b0, 0.04);
    this.mpMirror = new MPCashMirror(this);
    // Локальный выстрел → на сервер (чужие трассеры/звуки) + вспышка краевой мандалы
    this.weapons.onFire = (origin, dir, kind) => {
      if (this.mpActive) {
        this.net.sendShot([origin.x, origin.y, origin.z], [dir.x, dir.y, dir.z], kind);
      }
      // Выстрел драйвит психодел по краям: тяжёлые стволы пульсят сильнее
      const heavy = (kind === 'rocket' || kind === 'gl' || kind === 'awp' || kind === 'shotgun');
      this.engine.fx.pulse(heavy ? 0.5 : 0.25);
    };
    this._bindNet();
    this._bindChat();

    status('СЕТЬ...', 96);
    const serverUrl = NetClient.serverUrlFromLocation();
    if (serverUrl) {
      let name = 'PLAYER';
      try { name = localStorage.getItem('genswags.name') || name; } catch {}
      // Жёсткий таймаут: без WS-сервера (простой http/LAN/Telegram webview)
      // загрузка не должна висеть на «СЕТЬ...» — игра продолжается офлайн.
      await Promise.race([
        this.net.connect(serverUrl, { room: 'hub_1', name }).catch(() => {}),
        sleep(4000),
      ]);
    }

    // Клик по канвасу в игре — захват мыши
    this.canvas.addEventListener('click', () => {
      if (this.state === State.GAME && !this.paused && !this.matchEnded) this.input.requestPointerLock();
    });

    status('ГОТОВО', 100);
    this._setupLoops();
    await sleep(350);
    this._setState(State.MENU);
    // ?mode=duel|ffa|cashout — предвыбрать режим (отладка/скриншоты)
    if (this._urlParams?.get('mode')) this.gameMode = this._urlParams.get('mode');
    // Отладочный автостарт: ?autostart=1 — сразу в матч (без экрана треков)
    if (this._urlParams?.get('autostart') || this._urlParams?.get('gyrotest')) {
      this._skipTrackSelect = true;
      this.startGame();
    }
    // ?trackselect=1 — открыть экран выбора трека (отладка/скриншоты)
    if (this._urlParams?.get('trackselect')) {
      this.trackSelect?.open(() => {});
    }
    // ?clashdemo=1 — автостарт + форсированный SOUND CLASH (отладка/скриншоты)
    if (this._urlParams?.get('clashdemo')) {
      setTimeout(() => {
        if (this.state !== State.GAME) return;
        this.soundWar?.notifyDrop('you');
        this.soundWar?.notifyDrop(this.soundWar.activeEnemyTeam);
        // Поднять присутствие врага для кадра
        if (this.mode) this.mode.scores[this.soundWar?.activeEnemyTeam ?? 1] += 900;
      }, 4000);
    }
    // ?metadur=N — длительность интермиссии в секундах (отладка/скриншоты)
    if (this._urlParams?.get('metadur')) {
      const d = parseFloat(this._urlParams.get('metadur'));
      if (d > 0.5) { this.meta.duration = d; this.meta.swapAt = d / 2; }
    }
    // ?metademo=1 — форсированный конец матча → PSY-BREAK интермиссия (отладка)
    if (this._urlParams?.get('metademo')) {
      setTimeout(() => {
        if (this.state !== State.GAME) return;
        this._matchStats = { kills: 7, deaths: 3 };
        this.rhythm.counts.perfect = 12;
        this.rhythm.counts.good = 5;
        this.rhythm.counts.miss = 8;
        this.flow.maxSeen = 96;
        this.mode?._endMatch?.(0);
        setTimeout(() => this.meta?.startIntermission(), 1800);
      }, 3500);
    }
    // Браузерный самотест гироскопа: ?gyrotest=1 — синтетические события → PASS/FAIL
    if (this._urlParams?.get('gyrotest')) {
      runGyroSelfTest(this);
    }
    // ?fps=1 — оверлей с FPS/тиром качества/пиксель-скейлом
    if (this._urlParams?.get('fps')) {
      const el = document.createElement('div');
      el.style.cssText = 'position:fixed;top:4px;right:6px;z-index:9999;color:#0f0;background:rgba(0,0,0,0.5);font:12px monospace;padding:2px 6px;pointer-events:none';
      document.body.appendChild(el);
      this._fpsEl = el;
    }
    // ?psy=1 — отладочный триггер «психологического разрыва» (psy-break)
    if (this._urlParams?.get('psy')) {
      this.engine.fx.setPsyBreak(true, parseFloat(this._urlParams.get('psy')) || 1);
    }
    // ?fx=low|high|auto — принудительный тир качества эффектов (отладка)
    if (this._urlParams?.get('fx')) {
      this.engine.setFxQuality(this._urlParams.get('fx'));
    }
    // ?pixel=0.2..1 — принудительный пиксель-скейл (отладка/скриншоты)
    if (this._urlParams?.get('pixel')) {
      const px = parseFloat(this._urlParams.get('pixel'));
      if (px > 0.1 && px <= 1) this.engine.setPixelScale(px);
    }
    // ?cam=x,y,z,tx,ty,tz — фото-режим: жёстко пингует камеру каждый кадр (отладка)
    if (this._urlParams?.get('cam')) {
      const v = this._urlParams.get('cam').split(',').map(Number);
      if (v.length === 6 && v.every((n) => isFinite(n))) {
        this._debugCam = { pos: v.slice(0, 3), look: v.slice(3, 6) };
      }
    }
  }

  // ============================
  // События режима → HUD/меню
  // ============================
  _onModeEvent(type, data) {
    switch (type) {
      case 'notify': this.hud?.notify(data.text, data.cls); break;
      case 'kill': break; // kill feed делается в месте убийства
      case 'score': break; // HUD читает mode.scores сам
      case 'player_death': this.menu?.showDeath(); break;
      case 'death_tick': this.menu?.updateDeathTimer(data.time); break;
      case 'player_respawn': {
        this.menu?.hideDeath();
        // REENTRY: запоминаем, откуда летит душа (до пересборки арены)
        const hadSoul = !!this._soulCam;
        const fromPos = this.engine.camera.position.clone();
        const fromQuat = this.engine.camera.quaternion.clone();
        this._endSoulCam();
        // СМЕРТЬ = ПЕРЕНОС: в соло каждая гибель швыряет игрока на следующую
        // карту ротации (матч продолжается: очки/таймер сохраняет rebuildArena).
        if (!this.mpActive && !this.matchEnded && this.meta && !this.meta.intermission
            && this.state === State.GAME && this.mode?.running) {
          const variant = this.meta.nextArena();
          const team = this.mode?.playerTeam ?? 0;
          const sp = this.arena.spawns[team % this.arena.spawns.length];
          this.player.spawn(sp.pos, sp.yaw);
          const wKind = this.weapons?.randomizeLoadout?.(); // новый случайный ствол
          if (wKind) this.hud?.notify(`СТВОЛ: ${this.weapons.weapon.def.name}`, 'obj');
          this.engine.fx.pulse(1.6); // датамош-всплеск маскирует скачок
          this.hud?.notify(`ПЕРЕНОС: ${ARENA_NAMES[variant] || variant}`, 'obj');
          if (hadSoul) this._beginReentry(fromPos, fromQuat); // душа влетает в новое тело
        }
        break;
      }
      case 'match_end':
        this.input.exitPointerLock();
        this.soundWar?.stop(); // вражеский сигнал стихает вместе с матчем
        if (this.mpActive) this.menu?.showEnd(data);
        else this.meta?.onMatchEnd(data); // соло: статы + рейтинг + экран итогов
        break;
      case 'arena_rebuild': this.sfx.collapse(); break;
    }
  }

  // ============================
  // Режимы игры / пересборка арены (мета-петля)
  // ============================

  // Создать режим под текущую арену: cashout (3v3v3) / duel (1v1 до 7) / ffa (FFA-3, 5 мин)
  _createMode(kind = 'cashout') {
    this._modeKind = kind;
    this._firstBlood = false; // анонсер первой крови — с новым матчем
    const opts = kind === 'duel'
      ? { matchTime: 600, winCash: 7, killValue: 1, cashEnabled: false, rebuildEvery: Infinity }
      : kind === 'ffa'
        ? { matchTime: 300, winCash: Infinity, cashoutValue: 5, killValue: 1 }
        : {};
    const mode = new CashoutMode({
      arena: this.arena, destruction: this.destruction, sfx: this.sfx, ...opts,
    });
    mode.bind({ getPlayer: () => this.player, emit: (t, d) => this._onModeEvent(t, d) });
    mode.getEnemiesNear = (pos, r, excludeTeam) => this._enemiesNear(pos, r, excludeTeam);
    this.registerMode(mode);
    if (this.botsManager) this.botsManager.setMode(mode);
    return mode;
  }

  // Полная пересборка арены: очистка + построение варианта (боты/режим пересоздаются).
  // Размер по умолчанию — текущий (дуэль сохраняет уменьшенную арену при ротации).
  // Если матч ещё идёт (перенос на смерти игрока) — очки/таймер/команда сохраняются.
  rebuildArena(variant = 'eden', { size = this._arenaSize || 60 } = {}) {
    const keep = (this.mode?.running && !this.mpActive) ? {
      scores: [...this.mode.scores],
      timeLeft: this.mode.timeLeft,
      playerTeam: this.mode.playerTeam,
    } : null;
    if (this.arena) disposeArena(this.engine.scene, this.arena);
    this.physics.clear();
    this.destruction.reset();
    this.weapons?.gore?.reset(); // убрать сплаты/бурсты прошлой арены
    if (this.skullSwarm) this.skullSwarm.bounds = size / 2 - 2; // границы полёта черепов
    this._arenaVariant = variant;
    this._arenaSize = size;
    if (this.player) this.player.arenaHalf = size / 2; // kill-объём за границей
    this.arena = buildArena(this.engine.scene, this.physics, this.destruction, {
      reflector: this.engine.datamoshAvailable(), variant, size,
    });
    // Туман/фон варианта (engine.base* используется при выходе из DROP)
    const env = this.arena.env;
    this.engine.baseFogColor = env.fogColor;
    this.engine.baseFogDensity = env.fogDensity;
    if (!this.flow?.dropActive) {
      this.engine.scene.fog.color.setHex(env.fogColor);
      this.engine.scene.fog.density = env.fogDensity;
      this.engine.scene.background.setHex(env.fogColor);
    }
    // Боты: новая арена + респавн всех на новых точках
    if (this.botsManager) {
      this.botsManager.arena = this.arena;
      for (const b of this.botsManager.bots) this.botsManager._respawn(b);
    }
    // Режим пересоздаётся под новую арену (станции/кешбокс из новой арены)
    this._createMode(this._modeKind || 'cashout');
    // Перенос посреди матча: продолжаем с теми же очками и таймером (без «МАТЧ НАЧАЛСЯ»)
    if (keep) {
      this.mode.playerTeam = keep.playerTeam;
      this.mode.startMatch({ silent: true });
      this.mode.scores = keep.scores;
      this.mode.timeLeft = keep.timeLeft;
    }
  }

  // Применить выбранный в меню режим (соло): размер арены + состав ботов + правила
  _applyGameMode(kind) {
    this._modeKind = kind;
    const size = kind === 'duel' ? 34 : 60; // дуэль — уменьшенная арена (центр)
    if (size !== this._arenaSize) {
      this.rebuildArena(this.meta?.arenaVariant || 'eden', { size });
    }
    const roster = kind === 'duel' ? [{ team: 1, name: 'VEXA' }]
      : kind === 'ffa' ? [{ team: 1, name: 'KIRA' }, { team: 2, name: 'RENO' }]
        : ROSTER;
    this.botsManager?.setRoster(roster);
    this._refreshTargets();
    this._createMode(kind);
  }

  // Цели для оружия: боты + летающие черепа (в MP — удалённые игроки, ставит mp-код)
  _refreshTargets() {
    if (!this.weapons || this.mpActive) return;
    this.weapons.targets = [
      ...(this.botsManager?.bots || []),
      ...(this.skullSwarm?.targets || []),
    ];
  }

  // Враги команды excludeTeam рядом с точкой (для перехвата станции)
  _enemiesNear(pos, r, excludeTeam) {
    for (const b of this.bots) {
      if (!b.alive || b.team === excludeTeam) continue;
      if (Math.hypot(b.pos.x - pos.x, b.pos.z - pos.z) < r) return { team: b.team, bot: b };
    }
    if (this.player?.alive && this.mode && this.mode.playerTeam !== excludeTeam) {
      const pp = this.player.body.pos;
      if (Math.hypot(pp.x - pos.x, pp.z - pos.z) < r) return { team: this.mode.playerTeam, player: true };
    }
    return null;
  }

  // Кешбокс в руках игрока: перед камерой, с лёгким бобом от шага
  _updateCarryVisual(dt) {
    const mode = this.mode;
    const box = this.arena?.cashbox;
    if (!mode || !box || this.mpActive) return;
    if (mode.state !== 'CARRIED' || mode.carrier !== 'player' || !this.player?.alive) return;
    const cam = this.engine.camera;
    const fwd = new THREE.Vector3();
    cam.getWorldDirection(fwd);
    const right = new THREE.Vector3().crossVectors(fwd, cam.up).normalize();
    const sp = this.player.speed || 0;
    this._carryBob = (this._carryBob || 0) + dt * (2 + sp * 0.6);
    const bobY = Math.sin(this._carryBob * 2.2) * 0.035 * Math.min(1, sp * 0.3 + 0.25);
    box.position.copy(cam.position).addScaledVector(fwd, 0.62).addScaledVector(right, 0.24);
    box.position.y += -0.34 + bobY;
    box.rotation.set(0, -(this.player.look.yaw || 0), 0);
  }

  // ---------- Пикапы оружия (соло): подход = akimbo этого ствола ----------
  _updateWeaponPickups(dt) {
    const list = this.arena?.weaponPickups;
    if (!list?.length || this.mpActive) return;
    const pp = this.player?.body.pos;
    for (const p of list) {
      if (!p.available) {
        p.respawnT -= dt;
        if (p.respawnT <= 0) { p.available = true; p.root.visible = true; }
        continue;
      }
      if (!this.player?.alive || !pp) continue;
      const dx = pp.x - p.pos.x, dz = pp.z - p.pos.z;
      if (dx * dx + dz * dz < 1.6 * 1.6 && Math.abs(pp.y - p.pos.y) < 2.2) {
        p.available = false;
        p.respawnT = 20;
        p.root.visible = false;
        this.weapons.forceLoadout(p.kind, { dual: true });
        this.hud?.notify(`AKIMBO: ${this.weapons.weapon.def.name} ×2`, 'good');
        this.sfx?.weaponChange?.();
        this.engine.fx.pulse(0.8);
      }
    }
  }

  // ---------- Тело от первого лица: торс/ноги при взгляде вниз, слайде, прыжке ----------
  _ensureFPBody() {
    const skin = this.menu?.settings?.skin || 'c1';
    if (this._fpBody && this._fpBodySkin === skin) return;
    if (this._fpBody) { this.engine.scene.remove(this._fpBody.root); this._fpBody = null; }
    const team = this.mode?.playerTeam ?? 0;
    const inst = instantiateGirl(skin, { team }) || createCyberGirl({ team });
    // Прячем голову и руки: из первого лица видны только торс/ноги
    // (процедурная — по именам групп; GLB — схлопыванием костей рук/головы)
    inst.root.traverse((o) => {
      if (o.name === 'cg_head' || o.name === 'cg_armL' || o.name === 'cg_armR') o.visible = false;
      if (o.isBone && /(left|right)(shoulder|arm|forearm|hand)$/i.test(o.name)) o.scale.setScalar(0.001);
      if (o.isBone && /head$/i.test(o.name)) o.scale.setScalar(0.001);
    });
    inst.root.visible = false;
    this.engine.scene.add(inst.root);
    this._fpBody = inst;
    this._fpBodySkin = skin;
  }

  _updateFPBody(dt) {
    const fp = this._fpBody;
    if (!fp) return;
    const p = this.player;
    const show = !!p?.alive && !this.matchEnded
      && (p.look.pitch < -0.45 || p.sliding || !p.onGround);
    fp.root.visible = show;
    if (!show) return;
    fp.root.position.set(p.body.pos.x, p.body.pos.y, p.body.pos.z);
    fp.root.rotation.y = p.look.yaw + Math.PI; // модель смотрит в +Z — разворот по взгляду
    fp.update(dt, p.speed);
    fp.setMode?.(p.onGround ? (p.speed > 0.5 ? 'run' : 'idle') : 'jump');
    if (fp.state) fp.state.crouchTarget = p.sliding ? 1 : p.crouching ? 0.6 : 0;
  }

  // Джамп-пады: мощный вертикальный подброс (The Finals)
  _updateJumpPads() {
    const pads = this.arena?.jumpPads;
    if (!pads?.length || !this.player?.alive) return;
    const p = this.player.body.pos;
    const v = this.player.body.vel;
    for (const pad of pads) {
      const dx = p.x - pad.x, dz = p.z - pad.z;
      if (dx * dx + dz * dz < pad.r * pad.r && p.y < pad.y + 0.7 && v.y < 3) {
        v.y = pad.power;
        this.player.onGround = false;
        this.sfx?.jump?.();
        this.engine.fx?.pulse?.(0.9);
        this.hud?.notify?.('ДЖАМП-ПАД 跳', 'good');
        break;
      }
    }
  }

  // ============================
  // МУЛЬТИПЛЕЕР
  // ============================
  _bindNet() {
    const net = this.net;
    // Старт матча по событию сервера
    net.on('start', (m) => this.startMPMatch(m));
    // Чужие выстрелы → трассеры/звуки
    net.on('shot', (m) => {
      if (this.mpActive && m.id !== net.playerId) {
        this.remotePlayers.remoteShot(m, this.player?.body.pos);
      }
    });
    net.on('hit', (m) => this._mpOnHit(m));
    net.on('death', (m) => this._mpOnDeath(m));
    net.on('respawn', (m) => this._mpOnRespawn(m));
    // Разрушение чанков (идемпотентно)
    net.on('chunk', (m) => {
      if (this.mpActive) this.destruction.applyChunkId(m.chunkId);
    });
    // Кеш-режим: сервер авторитетен
    net.on('cash', (m) => {
      if (this.mpActive) this.mpMirror.onCash(m);
    });
    // SOUND WAR: trackId команд / дропы для клэша (аддитивный протокол)
    net.on('soundwar', (m) => this._mpOnSoundWar(m));
    net.on('chat', (m) => this._mpOnChat(m));
    // Комната вернулась в лобби посреди матча
    net.on('lobby', () => {
      if (this.mpActive && this.state === State.GAME) this.quitToMenu();
    });
    net.on('playerLeft', (m) => this.remotePlayers?.remove(m.id));
    net.on('reconnecting', (d) => this.hud?.notify(`ПЕРЕПОДКЛЮЧЕНИЕ (${d.attempt})…`, 'bad'));
    net.on('reconnected', () => this.hud?.notify('СОЕДИНЕНИЕ ВОССТАНОВЛЕНО', 'good'));
    net.on('error', (m) => {
      if (m.code === 'chat_rate') this.hud?.notify('ЧАТ: СЛИШКОМ ЧАСТО', 'bad');
    });

    // Голосовой чат: воспроизведение потоков + индикатор говорящего
    net.voice.on('stream', ({ id, stream }) => {
      let a = this._voiceAudio.get(id);
      if (!a) {
        a = new Audio();
        a.autoplay = true;
        this._voiceAudio.set(id, a);
      }
      a.srcObject = stream;
      a.play().catch(() => {});
    });
    net.voice.on('speaking', (d) => {
      this._speaking.set(d.id, d.speaking);
      this.menu?.updateSpeaking(d);
    });
    net.voice.on('enabled', () => this.updateMicUi());
    net.voice.on('disabled', () => this.updateMicUi());
    net.voice.on('error', () => {
      this.hud?.notify('МИКРОФОН НЕДОСТУПЕН', 'bad');
      this.updateMicUi();
    });
  }

  // Старт сетевого матча (событие 'start' от сервера)
  startMPMatch(msg) {
    this.mpActive = true;
    this._mpSentChunks.clear();
    this._mpRespawnT = 0;
    // Ботов в MP нет — прячем модели (соло восстановится при выходе)
    for (const b of this.botsManager?.bots || []) b.root.visible = false;
    // Пикапы оружия — только соло (в MP лута авторитетен серверу, поддержки нет)
    for (const p of this.arena?.weaponPickups || []) p.root.visible = false;
    if (this._fpBody) this._fpBody.root.visible = false;
    this.weapons.mpMode = true;
    if (this.rhythm?.groove) this.rhythm.groove.mpMode = true; // MP: сервер авторитетен по урону, groove — только визуал/движение
    this.remotePlayers.syncRoster(msg.players || [...this.net.remote.values()]);
    this.weapons.targets = this.remotePlayers.targets;
    this.mode.playerTeam = this.net.you?.team ?? 0;
    this.mode.mpControlled = true;
    this.mpMirror.attach(msg.cash);
    this.matchEnded = false;
    this.startGame();
    this.hud?.notify(`МАТЧ НАЧАЛСЯ — КОМАНДА ${TEAMS[this.mode.playerTeam]?.name || ''}`, 'obj');
    this.updateMicUi();
  }

  // «ЕЩЁ РАЗ» в MP: остаёмся в матче, сбрасываем косметический таймер
  restartMPMatch() {
    this.matchEnded = false;
    this.mpMirror.timeLeft = 480;
    this.mpMirror._ended = false;
    this.input.requestPointerLock();
  }

  // Косметический конец MP-матча (сервер матч не завершает)
  _mpEndLocal(winner) {
    this.matchEnded = true;
    this.input.exitPointerLock();
    this.menu?.showEnd({
      scores: [...(this.mode?.scores || [0, 0, 0])],
      winner,
      playerWon: winner === this.mode?.playerTeam,
    });
  }

  _mpTeardown() {
    this.mpActive = false;
    this.net.stopInputLoop();
    if (this.net.room) this.net.leaveRoom();
    this.remotePlayers.clear();
    this._refreshTargets();
    this.weapons.mpMode = false;
    // Пикапы оружия возвращаются (соло)
    for (const p of this.arena?.weaponPickups || []) p.root.visible = p.available;
    if (this.rhythm?.groove) this.rhythm.groove.mpMode = false;
    for (const b of this.botsManager?.bots || []) b.root.visible = true;
    if (this.mode) {
      this.mode.mpControlled = false;
      this.mode.playerTeam = 0;
    }
    this._closeChat(false);
    this.updateMicUi();
  }

  // Урон от сервера
  _mpOnHit(m) {
    const net = this.net;
    if (m.target === net.playerId) {
      // Сервер авторитетен: HP выставляем из события
      this.player.hp = m.hp;
      this.player._regenDelay = 3;
      this.sfx.hurt();
      const v = document.getElementById('damage-vignette');
      if (v) { v.style.opacity = '1'; setTimeout(() => { v.style.opacity = '0'; }, 200); }
    } else {
      const e = net.remote.get(m.target);
      if (e) e.hp = m.hp;
    }
  }

  _mpOnDeath(m) {
    const net = this.net;
    const nameOf = (id) => (id === net.playerId ? 'ВЫ' : (net.remote.get(id)?.name || 'ИГРОК'));
    if (m.id === net.playerId) {
      this.player.alive = false;
      this.player.hp = 0;
      this.hud?.killFeed(m.by ? `${nameOf(m.by)} УНИЧТОЖИЛ ВАС` : 'ВАС УНИЧТОЖИЛИ');
      this._mpRespawnT = 3;
      this.menu?.showDeath();
      this.transition?.startDeath(); // мини-переход 2.5с → респавн
    } else {
      this.hud?.killFeed(`${m.by ? nameOf(m.by) : '—'} ☠ ${nameOf(m.id)}`);
      const e = net.remote.get(m.id);
      if (e) { e.alive = false; e.hp = 0; }
    }
  }

  // ============================
  // SOUL CAM: при смерти душа вылетает из тела — камера уходит на орбиту
  // вокруг упавшего тела, мир в слоу-мо, fisheye/rgbSplit, музыка искажена
  // (дисторшн делает transition.startDeath).
  // ============================
  _beginSoulCam() {
    if (this._soulCam) this._endSoulCam();
    const cam = this.engine.camera;
    const deathPos = this.player.body.pos.clone();
    const eye = cam.position.clone();
    const fwd = new THREE.Vector3(-Math.sin(this.player.look.yaw), 0, -Math.cos(this.player.look.yaw));
    const sc = {
      t: 0, dur: 2.0, deathPos, eye, fwd,
      a0: Math.atan2(eye.x - deathPos.x, eye.z - deathPos.z),
      corpse: null, done: false,
    };
    // Труп на месте гибели — скелетная модель выбранного скина, лёжа на боку
    try {
      const skin = this.menu?.settings?.skin || 'c1';
      const corpse = instantiateGirl(skin, { team: this.mode?.playerTeam ?? 0 })
        || createCyberGirl({ team: this.mode?.playerTeam ?? 0 });
      corpse.root.position.set(deathPos.x, deathPos.y + 0.12, deathPos.z);
      corpse.root.rotation.y = Math.random() * Math.PI * 2;
      corpse.root.rotation.z = Math.PI / 2 * (Math.random() < 0.5 ? 1 : -1); // лёжа
      corpse.update?.(0.02, 0);
      this.engine.scene.add(corpse.root);
      sc.corpse = corpse;
    } catch (e) { console.warn('[soulcam] corpse fail', e); }
    this._soulCam = sc;
    this._slowMoPrev = this.worldSlowMo;
    this.worldSlowMo = 0.3; // мир почти замирает
    this.engine.fx?.set({ rgbSplit: 0.7, warp: 0.85 });
    this.sfx?.stinger?.();
  }

  _updateSoulCam(dt) {
    const sc = this._soulCam;
    if (!sc) return;
    sc.t += dt;
    const p = Math.min(1, sc.t / sc.dur);
    const e = p * p * (3 - 2 * p); // smoothstep
    const cam = this.engine.camera;
    // вылет из головы по дуге → широкая орбита вокруг тела (вид со стороны)
    const ang = sc.a0 + e * 1.45 + p * 0.35;
    const R = 0.5 + e * 4.6;
    const tx = sc.deathPos.x + Math.sin(ang) * R;
    const tz = sc.deathPos.z + Math.cos(ang) * R;
    const ty = sc.deathPos.y + 0.4 + e * 2.6 + Math.sin(p * Math.PI) * 0.8;
    cam.position.set(
      sc.eye.x + (tx - sc.eye.x) * e,
      sc.eye.y + (ty - sc.eye.y) * e,
      sc.eye.z + (tz - sc.eye.z) * e,
    );
    cam.lookAt(sc.deathPos.x, sc.deathPos.y + 0.25, sc.deathPos.z);
    cam.rotation.z += Math.sin(p * Math.PI * 2) * 0.07; // крен «призрака»
    // рыбий глаз дышит, расщепление цвета затухает к концу
    this.engine.fx?.set({
      fisheye: 0.5 + Math.sin(p * Math.PI) * 0.7,
      rgbSplit: 0.7 * (1 - p * 0.7),
    });
    // труп едва дышит в слоу-мо (крипово)
    sc.corpse?.update?.(dt * 0.3, 0);
    // слоу-мо — только первая часть, к концу разгон обратно (не растягиваем респавн)
    this.worldSlowMo = 0.3 + 0.7 * Math.max(0, (p - 0.65) / 0.35);
    if (sc.t >= sc.dur + 0.8) this._endSoulCam(); // держим 4с, дальше — обычный экран смерти
  }

  _endSoulCam() {
    const sc = this._soulCam;
    if (!sc) return;
    this._soulCam = null;
    this.worldSlowMo = this._slowMoPrev ?? 1;
    sc.corpse?.root?.removeFromParent?.();
    this.engine.fx?.set({ rgbSplit: 0, fisheye: 0, warp: 0 });
  }

  // ============================
  // REENTRY: душа влетает в новое тело. Камера с разгоном (p³) несётся
  // из точки орбиты в глаза нового тела; fisheye/warp/rgbSplit на пике
  // и гаснут на «входе»; FOV-удар + выхлоп viewmodel в конце.
  // ============================
  _beginReentry(fromPos, fromQuat) {
    this._reentry = { t: 0, dur: 0.85, fromPos, fromQuat };
    this.engine.fx?.set({ fisheye: 1.3, warp: 1.0, rgbSplit: 0.9 });
    this.engine.fx?.pulse?.(2.2);
    this.sfx?.dash?.();
  }

  _updateReentry(dt) {
    const r = this._reentry;
    if (!r) return;
    r.t += dt;
    const p = Math.min(1, r.t / r.dur);
    const e = p * p * p; // разгон: чем ближе к телу, тем быстрее
    const cam = this.engine.camera;
    const eye = this.player.eyePos;
    cam.position.set(
      r.fromPos.x + (eye.x - r.fromPos.x) * e,
      r.fromPos.y + (eye.y - r.fromPos.y) * e,
      r.fromPos.z + (eye.z - r.fromPos.z) * e,
    );
    // Поворот от взгляда души к взгляду тела
    if (!r._targetQ) {
      r._targetQ = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(this.player.look.pitch, this.player.look.yaw, 0, 'YXZ'));
    }
    cam.quaternion.slerpQuaternions(r.fromQuat, r._targetQ, e);
    // Искажение гаснет к «входу», FOV — удар посередине
    this.engine.fx?.set({
      fisheye: 1.3 * (1 - p),
      warp: 1.0 * (1 - p * 0.8),
      rgbSplit: 0.9 * (1 - p),
    });
    cam.fov = this.player.baseFov + Math.sin(p * Math.PI) * 24;
    cam.updateProjectionMatrix();
    if (p >= 1) {
      this._reentry = null;
      this.engine.fx?.set({ fisheye: 0, warp: 0, rgbSplit: 0 });
      cam.fov = this.player.baseFov;
      cam.updateProjectionMatrix();
      this.player.fovKick = 8; // выхлоп в руках после входа
    }
  }

  _mpOnRespawn(m) {
    const net = this.net;
    if (m.id === net.playerId) {
      this._mpRespawnT = 0;
      const hadSoul = !!this._soulCam;
      const fromPos = this.engine.camera.position.clone();
      const fromQuat = this.engine.camera.quaternion.clone();
      this.player.spawn(new THREE.Vector3(m.pos[0], m.pos[1], m.pos[2]), m.yaw || 0);
      this.weapons?.randomizeLoadout?.(); // MP: новый случайный ствол
      this.menu?.hideDeath();
      this._endSoulCam();
      if (hadSoul) this._beginReentry(fromPos, fromQuat); // душа влетает в новое тело
    } else {
      const e = net.remote.get(m.id);
      if (e) { e.alive = true; e.hp = m.hp ?? 100; }
    }
  }

  _mpOnChat(m) {
    if (this.state === State.GAME) this.hud?.addChatMsg(m);
    else this.menu?.addLobbyChat(m);
  }

  // Подбор кешбокса / загрузка на станции: клиент просит, сервер решает
  _mpPickupCheck(dt) {
    this._mpPickupT -= dt;
    if (this._mpPickupT > 0) return;
    const cash = this.mpMirror.cash;
    if (!cash || !this.player?.alive) return;
    const pp = this.player.body.pos;
    const holder = cash.cashbox?.holder ?? null;
    if (!holder) {
      const bp = cash.cashbox?.pos || [0, 0.4, -2];
      if (Math.hypot(bp[0] - pp.x, bp[2] - pp.z) < 2.0) {
        this.net.sendCash('pickup');
        this._mpPickupT = 0.5;
      }
    } else if (holder === this.net.playerId) {
      for (const st of cash.stations || []) {
        if (st.by) continue;
        if (Math.hypot(st.pos[0] - pp.x, st.pos[2] - pp.z) < 2.8) {
          this.net.sendCash('deposit', st.letter);
          this._mpPickupT = 0.5;
          break;
        }
      }
    }
  }

  // ---------- Голосовой чат: кнопка микрофона (OFF → ON → MUTE → OFF) ----------
  async toggleMic() {
    const v = this.net.voice;
    if (!v.enabled) await v.enable();
    else if (!v.muted) v.setMuted(true);
    else v.disable();
    this.updateMicUi();
  }

  updateMicUi() {
    const v = this.net.voice;
    const state = !v.enabled ? 'off' : v.muted ? 'muted' : 'on';
    const hudBtn = document.getElementById('btn-mic-hud');
    if (hudBtn) {
      hudBtn.className = `mic ${state}`;
      hudBtn.textContent = state === 'off' ? '🎤' : state === 'on' ? '🎤' : '🔇';
      hudBtn.title = state === 'off' ? 'Микрофон выкл' : state === 'on' ? 'Микрофон вкл' : 'MUTE';
    }
    const lobbyBtn = document.getElementById('btn-mp-mic');
    if (lobbyBtn) {
      lobbyBtn.className = `menu-btn small mic ${state}`;
      lobbyBtn.textContent = state === 'off' ? '🎤 ВЫКЛ' : state === 'on' ? '🎤 ВКЛ' : '🔇 MUTE';
    }
  }

  // ---------- Чат в матче (T — общий, Y — командный) ----------
  _bindChat() {
    window.addEventListener('keydown', (e) => {
      if (this.state !== State.GAME || this.paused || this.matchEnded) return;
      if (!this.net.connected || this.chatOpen) return;
      if (e.code === 'KeyT') { e.preventDefault(); this._openChat(false); }
      else if (e.code === 'KeyY') { e.preventDefault(); this._openChat(true); }
    });
    const input = document.getElementById('chat-input');
    input?.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        const text = input.value.trim();
        if (text) this._sendMatchChat(text);
        this._closeChat(true);
      } else if (e.key === 'Escape') {
        this._closeChat(true);
      }
    });
    input?.addEventListener('blur', () => {
      if (this.chatOpen) this._closeChat(false);
    });
    // Тач-кнопка чата
    const tbtn = document.getElementById('tbtn-chat');
    tbtn?.addEventListener('touchstart', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (this.net.connected && this.state === State.GAME && !this.chatOpen) this._openChat(false);
    }, { passive: false });
  }

  _openChat(team) {
    this.chatOpen = true;
    this._chatTeam = team;
    const wrap = document.getElementById('chat-input-wrap');
    const label = document.getElementById('chat-mode-label');
    wrap?.classList.add('visible');
    wrap?.classList.toggle('team', team);
    if (label) label.textContent = team ? 'КОМАНДЕ' : 'ВСЕМ';
    this.input.exitPointerLock();
    const input = document.getElementById('chat-input');
    setTimeout(() => input?.focus(), 30);
  }

  _closeChat(refocus) {
    if (!this.chatOpen) return;
    this.chatOpen = false;
    const wrap = document.getElementById('chat-input-wrap');
    const input = document.getElementById('chat-input');
    wrap?.classList.remove('visible');
    if (input) { input.value = ''; input.blur(); }
    if (refocus && this.state === State.GAME && !this.paused && !this.matchEnded) {
      this.input.requestPointerLock();
    }
  }

  // Клиентский rate limit (сервер тоже режет: 4 сообщ/сек)
  _sendMatchChat(text) {
    const now = performance.now();
    this._chatSendTimes = this._chatSendTimes.filter((t) => now - t < 1000);
    if (this._chatSendTimes.length >= 4) {
      this.hud?.notify('ЧАТ: СЛИШКОМ ЧАСТО', 'bad');
      return;
    }
    this._chatSendTimes.push(now);
    this.net.sendChat(text, this._chatTeam);
  }

  // ============================
  // DROP-эффекты
  // ============================
  _applyDrop(on, k) {
    const scene = this.engine.scene;
    if (on) {
      scene.fog.color.setHex(0x3a0a20);      // малиновый туман
      scene.background.setHex(0x3a0a20);
      scene.fog.density = 0.016;
      this.engine._postMat.uniforms.uCA.value = 0.02 * Math.min(k, 2);
      // DROP: сильный психодел — смаз + сплит + глитч + палитровый сдвиг (полный psy-break — отдельно)
      this.engine.fx.set({ rgbSplit: 0.012 * Math.min(k, 2), datamosh: 0.6, glitch: 0.2, psy: 0.42, warp: 0.12 });
      this.hud?.dropFlash(true);
      this.sfx.drop();
      // Дроп = агрессивный статтер-бёрст с питч-дипом («эдит»-стиль)
      this.music?.stutter?.(1.2, { pitchDip: true });
    } else {
      scene.fog.color.setHex(this.engine.baseFogColor);
      scene.background.setHex(this.engine.baseFogColor);
      scene.fog.density = this.engine.baseFogDensity;
      this.engine._postMat.uniforms.uCA.value = 0.012;
      if (!this.engine.fx.psyBreak) this.engine.fx.set({ rgbSplit: 0, datamosh: 0, glitch: 0, psy: 0, warp: 0 });
      this.hud?.dropFlash(false);
    }
  }

  // ============================
  // Скил E: ударная волна (урон + разрушение в радиусе 4м; на бите +30%)
  // ============================
  _shockwave(pos, radiusMul = 1) {
    this.sfx.explosion();
    const R = 4 * radiusMul;
    this.destruction.applyDamage(pos, R, 70);
    // Урон целям (боты в соло / удалённые игроки в MP)
    for (const b of this.weapons.targets) {
      if (!b.alive) continue;
      const d = Math.hypot(b.pos.x - pos.x, b.pos.z - pos.z);
      if (d < R) {
        const dir = new THREE.Vector3(b.pos.x - pos.x, 0, b.pos.z - pos.z).normalize();
        const killed = b.damage(50 * (1 - d / (R + 1)) * this.flow.damageMul, dir, 0);
        if (killed) this.weapons.onKill?.(b);
      }
    }
    // Визуал: расходящееся кольцо
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(1, 0.09, 6, 28),
      new THREE.MeshBasicMaterial({ color: 0xff2d55, transparent: true, opacity: 0.9 }),
    );
    ring.position.set(pos.x, pos.y + 0.5, pos.z);
    ring.rotation.x = Math.PI / 2;
    this.engine.scene.add(ring);
    this._fx.push({ mesh: ring, t: 0, kind: 'shockring' });
    // Камера-толчок
    this.player.fovKick = Math.min(this.player.fovKick + 6, 14);
  }

  // Драйв светового шоу арены (энергия/фаза трека/фаза бита/дроп/тир качества)
  _lightShowDrive() {
    return {
      energy: this.music?.energies?.total || 0,
      phase: this.music?.trackProgress?.() || 0,
      beatPhase: this.rhythm?.beatPhase?.() ?? 0.999,
      drop: this.flow?.dropActive ? 1 : 0,
      low: this.engine.qualityTier === 'low',
    };
  }

  _updateFx(dt) {
    for (let i = this._fx.length - 1; i >= 0; i--) {
      const f = this._fx[i];
      f.t += dt;
      if (f.kind === 'shockring') {
        const s = 1 + f.t * 14;
        f.mesh.scale.setScalar(s);
        f.mesh.material.opacity = Math.max(0, 0.9 - f.t * 2.2);
      }
      if (f.t > 0.5) {
        f.mesh.removeFromParent();
        f.mesh.geometry.dispose();
        f.mesh.material.dispose();
        this._fx.splice(i, 1);
      }
    }
    // Верёвка крюка
    const gr = this.player?.grapple;
    if (gr?.active) {
      const pos = this._rope.geometry.attributes.position;
      const p = this.player.body.pos;
      pos.setXYZ(0, p.x, p.y + 1.2, p.z);
      pos.setXYZ(1, gr.point.x, gr.point.y, gr.point.z);
      pos.needsUpdate = true;
      this._rope.visible = true;
    } else if (this._rope) {
      this._rope.visible = false;
    }
  }

  // ============================
  // Состояния / управление матчем
  // ============================
  _setState(s) {
    this.state = s;
    const boot = document.getElementById('boot-screen');
    const menu = document.getElementById('menu-screen');
    const hud = document.getElementById('hud');
    boot?.classList.toggle('visible', s === State.BOOT);
    menu?.classList.toggle('visible', s === State.MENU);
    hud?.classList.toggle('visible', s === State.GAME);
    hud?.classList.toggle('mp', this.mpActive); // показывает кнопку микрофона
  }

  showMenuOverlay(page) {
    // Настройки поверх паузы: прячем pause, показываем menu-screen со страницей
    document.getElementById('menu-screen')?.classList.add('visible');
    this.menu?.showPage(page);
  }

  startGame() {
    this.matchEnded = false;
    this.paused = false;
    // Экран выбора арены: игрок выбрал конкретную карту — пересобираем под неё
    // (синхронно с ротацией меты, чтобы смерть-перенос продолжал с этого места)
    if (!this.mpActive && this._pendingArena) {
      const v = this._pendingArena;
      this._pendingArena = null;
      if (v !== this._arenaVariant) {
        this.rebuildArena(v);
        const rot = ['eden', 'hell', 'sng', 'ruins', 'dust2', 'goldencity'];
        const ri = rot.indexOf(v);
        if (ri >= 0 && this.meta) this.meta.arenaIndex = ri;
      }
    }
    preloadChars().then(() => {
      // GLB подгрузились после спавна — пересоздаём ботов скелетными моделями
      if (this.botsManager && !this.botsManager._charsGLB && this.botsManager.bots.length && !this.mpActive) {
        this.botsManager._charsGLB = true;
        const defs = this.botsManager.bots.map((b) => ({ team: b.team, name: b.name }));
        this.botsManager.setRoster(defs);
        this.botsManager.bindPlayer(this.player, this.mode?.playerTeam ?? 0);
        this._refreshTargets?.();
      }
    }).catch(() => {});
    this.menu?.hideEnd();
    this.menu?.closePause();
    this.menu?.hideDeath();
    this._endSoulCam?.();
    this.menu?.apply?.(); // боевой комплект: стартовый ствол + скин своей команды
    // Скин применяется к моделям при создании — если выбор сменился, пересоздаём ботов
    const wantSkin = this.menu?.settings?.skin;
    if (this.botsManager && wantSkin !== this.botsManager._skinApplied) {
      this.botsManager.setPlayerSkin(wantSkin);
      this.botsManager._skinApplied = wantSkin;
      const defs = this.botsManager.bots.map((b) => ({ team: b.team, name: b.name }));
      if (defs.length && !this.mpActive) {
        this.botsManager.setRoster(defs);
        this.botsManager.bindPlayer(this.player, this.mode?.playerTeam ?? 0);
        this._refreshTargets?.();
      }
    }
    document.getElementById('menu-screen')?.classList.remove('visible');
    // Соло: применить выбранный режим (карточки в меню), если сменился
    if (!this.mpActive && this._modeKind !== this.gameMode) this._applyGameMode(this.gameMode);
    this._setState(State.GAME);
    // В MP спавн на точке своей команды (её назначил сервер)
    const myTeam = this.mpActive ? (this.net.you?.team ?? 0) : 0;
    if (this.mode) this.mode.playerTeam = myTeam;
    const sp = this.arena.spawns[myTeam % this.arena.spawns.length];
    this.player.spawn(sp.pos, sp.yaw);
    if (!this.mpActive) this._ensureFPBody(); // тело от первого лица (соло)
    // Респавн = ОДИН случайный ствол из арсенала (10 стволов)
    const startKind = this.weapons?.randomizeLoadout?.();
    if (startKind) this.hud?.notify(`СТВОЛ: ${this.weapons.weapon.def.name}`, 'obj');
    this.input.requestPointerLock();
    if (this.input.isTouch) this.input.gyro.calibrate();
    // Непрерывность музыки: боевой трек НЕ обрывается между раундами/матчами —
    // переключаемся только если игрок выбрал ДРУГОЙ трек, играет тема меню
    // или музыка остановлена. Выбор с экрана треков в приоритете.
    const cur = this.music.playlist[this.music.trackIndex];
    const combatPlaying = this.music.playing && cur && cur.name !== 'menu_ambient.mp3';
    const wantName = this._playerTrack?.name;
    if (wantName && cur?.name !== wantName) {
      const idx = this.music.playlist.findIndex((t) => t.name === wantName);
      if (idx >= 0) this.music.playTrack(idx);
      this.music.play();
    } else if (!combatPlaying) {
      const combat = this.music.playlist
        .map((_, i) => i)
        .filter((i) => this.music.playlist[i].name !== 'menu_ambient.mp3');
      if (combat.length) this.music.playTrack(combat[Math.floor(Math.random() * combat.length)]);
      this.music.play();
    }
    // Статы нового матча (рейтинг/мета-экран)
    this._matchStats = { kills: 0, deaths: 0 };
    this.flow.maxSeen = 0;
    this.rhythm.resetStats();
    this.worldSlowMo = 1;
    if (this.mpActive) {
      // В MP черепа не летают (авторитет сервера) — убираем с арены
      this.skullSwarm?.reset();
      // Сервер авторитетен: локальная логика режима не запускается,
      // локальный игрок шлёт input 15 Гц
      this.net.startInputLoop(() => {
        const p = this.player.body.pos;
        return {
          pos: [+p.x.toFixed(3), +p.y.toFixed(3), +p.z.toFixed(3)],
          yaw: this.player.look.yaw,
          pitch: this.player.look.pitch,
        };
      });
    } else {
      this.mode?.startMatch();
      // Летающие черепа (соло): спавн один раз, дальше живут/респавнятся сами
      if (this.skullSwarm) {
        if (!this.skullSwarm.targets.length) {
          this.skullSwarm.spawn(3, this.arena.size / 2 - 2);
        }
        this._refreshTargets();
      }
    }
    // SOUND WAR: треки команд + вражеский аудио-поток
    this._setupSoundWar();
  }

  pauseGame() {
    if (this.state !== State.GAME || this.matchEnded) return;
    this.paused = true;
    this.music.pause();
    this.menu?.openPause();
  }

  resumeGame() {
    this.paused = false;
    this.menu?.closePause();
    document.getElementById('menu-screen')?.classList.remove('visible');
    this.music.resume();
    this.input.requestPointerLock();
  }

  quitToMenu() {
    this.paused = false;
    this.matchEnded = false;
    this.meta?.abort(); // если были в интермиссии — гасим psy-break
    this.transition?.stop();
    this.soundWar?.stop(); // вражеский поток — только в матче
    if (this.mpActive) this._mpTeardown();
    this.mode?.stopMatch();
    this.menu?.closePause();
    this.menu?.hideEnd();
    this.menu?.hideDeath();
    if (this._fpBody) this._fpBody.root.visible = false;
    this.input.exitPointerLock();
    this._setState(State.MENU);
    this.menu?.showPage('main');
    // Тема меню (по имени, не по позиции)
    const mi = this.music.playlist.findIndex((t) => t.name === 'menu_ambient.mp3');
    if (mi >= 0) this.music.playTrack(mi);
    this.music.resume();
  }

  // ============================
  // Игровые циклы
  // ============================
  _setupLoops() {
    // Фиксированный шаг: симуляция
    this.engine.onUpdate((dt) => {
      if (this.state !== State.GAME) {
        // В меню — медленное вращение камеры вокруг арены
        const t = this.engine.time * 0.08;
        this.engine.camera.position.set(Math.cos(t) * 26, 10, Math.sin(t) * 26);
        this.engine.camera.lookAt(0, 2, 0);
        this.arena?.update(dt, 0, this._lightShowDrive());
        this.destruction?.update(dt);
        return;
      }
      if (this.paused) return;
      this.rhythm.update(dt);

      // PSY-BREAK интермиссия: мир заморожен, камера-орбита, музыка играет
      if (this.meta?.intermission) {
        this.transition?.update(dt); // переход «между мирами» (camLift для орбиты)
        this.meta.update(dt);
        this.arena?.update(dt, this.engine.fx.pulseV, this._lightShowDrive());
        this.destruction?.update(dt);
        this._updateFx(dt);
        this.hud?.update(dt);
        return;
      }

      // BREAKDOWN: лёгкий slow-mo мира ×0.9 (музыка в render-цикле — не трогается)
      const wdt = dt * this.worldSlowMo;

      // ZE FLOW (стрик 8+ perfect): всё усилено, экран дышит
      if (this.rhythm.zeFlow) {
        this.flow.value = this.flow.max;
        this.engine.fx.pulse(dt * 2.2);
      }

      // Модификаторы от FLOW и режима (+ SOUND CLASH: урон всех +10%,
      // + КОМБО-ТИРЫ ритма: урон/скорость растут со стриком)
      this.physics.gravity = BASE_GRAVITY * this.flow.gravityMul;
      this.weapons.dmgMul = this.flow.damageMul * (this.soundWar?.damageMul || 1) * this.rhythm.tierDmgMul;
      this.player.speedMul = (this.mode?.playerCarrying ? 0.85 : 1) * this.flow.speedMul * this.rhythm.tierSpeedMul;
      this.player.sprintLock = !!this.mode?.playerCarrying;
      // Комбо-реген от музыки (соло; в MP HP ведёт сервер)
      if (!this.mpActive && this.player.alive && this.rhythm.hpRegen > 0) {
        this.player.hp = Math.min(this.player.maxHp, this.player.hp + this.rhythm.hpRegen * dt);
      }

      this.player.update(wdt);
      this._updateJumpPads();
      this._updateSoulCam(dt); // при смерти: камера-душа вокруг тела (реальное время)
      this._updateReentry(dt); // после смерти: душа влетает в новое тело
      this.weapons.update(wdt, this.input);
      AssetLib.beginFrame(this.engine.camera); // frustum кадра: миксеры только для видимых
      this.arena.update(wdt, this.engine.fx.pulseV, this._lightShowDrive()); // кристалл/искры/шоу-свет пульсируют в бит
      this.destruction.update(wdt);
      if (this.mpActive) {
        // Сетевой матч: удалённые игроки + зеркало кеш-режима (сервер авторитетен)
        this.remotePlayers.update(wdt);
        this.mpMirror.update(wdt);
        this._mpPickupCheck(dt);
        // HP ведёт сервер — локальный реген не включается
        this.player._regenDelay = Math.max(this.player._regenDelay, 0.5);
        // Таймер респавна (сервер пришлёт 'respawn')
        if (this._mpRespawnT > 0) {
          this._mpRespawnT -= dt;
          this.menu?.updateDeathTimer(Math.max(0, this._mpRespawnT));
        }
      } else {
        this.botsManager?.update(wdt, this.player);
        this.skullSwarm?.update(wdt, this.player, this.botsManager?.bots);
        this.mode?.update(wdt);
        this._updateCarryVisual(wdt); // кешбокс в руках перед камерой
        this._updateWeaponPickups(wdt); // пикапы оружия → akimbo
        this._updateFPBody(wdt);      // тело от первого лица
      }
      this.flow.update(wdt, { moveSpeed: this.player.alive ? this.player.speed : 0 });
      if (this.flow.value > (this.flow.maxSeen || 0)) this.flow.maxSeen = this.flow.value;
      // SOUND WAR: доминирование/зоны/клэш → вражеский поток; BPM уточняет rate
      if (this.soundWar) {
        this.soundWar.update(dt, this._soundWarCtx());
        if (this.music.bpm && this.music.bpm !== this._swBpm) {
          this._swBpm = this.music.bpm;
          this.soundWar.refreshRate(this.music.bpm);
        }
      }
      // Переход «между мирами» (смерть: мини-версия)
      this.transition?.update(dt);
      this._updateFx(wdt);
      this.hud?.update(dt);
    });

    // Пер-кадр: музыка и аудио-реактивность
    this.engine.onRender((dt) => {
      this.music.update();
      this.menu?.update(dt);
      if (this._beatPulse > 0) this._beatPulse = Math.max(0, this._beatPulse - dt * 4);
      // FX 2.0: музыкальный драйв (энергия/бас/FLOW/фаза трека/фаза бита) + плавные переходы
      const e = this.music.energy();
      this.engine.fx.update(dt, {
        energy: e.total, bass: e.bass, high: e.high, flow: this.flow.flowNorm,
        phase: this.music.trackProgress(), bpm: this.music.bpm || 0,
        beatPhase: this.rhythm?.beatPhase?.() ?? 0.999,
      });
      // Мандала-слой: заметный фоновый вайб всегда; дроп 0.55, ZE FLOW 0.6,
      // psy-break 0.95, комбо-тиры до 0.34 (берётся максимум). На low-тире core глушит uniform сам.
      this.engine.fx.setMandala({
        strength: Math.max(
          0.16 + this.flow.flowNorm * 0.12,
          this.flow.dropActive ? 0.55 : 0,
          this.rhythm?.zeFlow ? 0.6 : 0,
          this.rhythm?.mandalaBoost || 0,
          this.engine.fx.psyBreak ? 0.95 : 0,
        ),
        speed: 0.45 + e.bass * 1.1, // вращение живее от баса
      });
      // Psy-break → свечение биохазард-декалей
      this.arena?.setPsy(this.engine.fx.current.psy);

      // ===== HYPER DEMON-СЛОЙ: сильные искажения камеры от музыки =====
      // Статтер-синк: каждый эдит-чоп музыки бьёт по камере и RGB-сплиту
      if (this.music._lastStutterAt && this.music._lastStutterAt !== this._lastStutterSeen) {
        this._lastStutterSeen = this.music._lastStutterAt;
        this.engine.fx.pulse(1.1);
        this.player.fovKick = Math.min(this.player.fovKick + 4, 14);
        this._camJolt = 0.55;
      }
      // Бас-кач камеры (roll через player.extraRoll — сглаживается его лерпом)
      const bass2 = e.bass;
      const tt = performance.now() / 1000;
      let roll = Math.sin(tt * 2.3) * 0.007 + Math.sin(tt * 3.9 + 1.7) * 0.005;
      roll *= 0.4 + bass2 * 1.7;
      if (this.flow.dropActive) roll *= 2.4; // на дропе камера «плывёт» сильно
      if (this._camJolt > 0) {
        roll += (Math.random() - 0.5) * 0.06 * this._camJolt;
        this._camJolt = Math.max(0, this._camJolt - dt * 2.6);
      }
      this.player.extraRoll = this.state === State.GAME ? roll : 0;

      // Фазовые тона фона (build — белый, breakdown — тёмно-фиолет): лерп к цели,
      // пока не идёт drop/psy-break (они красят фон сами)
      const scene3 = this.engine.scene;
      const tintActive = this._phaseTint != null && !this.flow.dropActive && !this.engine.fx.psyBreak;
      if (tintActive || this._bgLerp) {
        const target = tintActive ? this._phaseTint : this.engine.baseFogColor;
        if (!this._tmpColor) this._tmpColor = new THREE.Color();
        this._tmpColor.set(target);
        scene3.fog.color.lerp(this._tmpColor, Math.min(1, dt * 1.6));
        scene3.background.copy(scene3.fog.color);
        this._bgLerp = tintActive;
      }
      // Фото-режим (?cam=...): камера пингуется после симуляции, прямо перед рендером
      if (this._debugCam) {
        const c = this._debugCam;
        this.engine.camera.position.set(c.pos[0], c.pos[1], c.pos[2]);
        this.engine.camera.lookAt(c.look[0], c.look[1], c.look[2]);
      }
      // Отладочный FPS-оверлей (?fps=1)
      if (this._fpsEl && (this._fpsTick = (this._fpsTick || 0) + dt) > 0.25) {
        this._fpsTick = 0;
        this._fpsEl.textContent = `${Math.round(this.engine.fps)} FPS · ${this.engine.qualityTier.toUpperCase()} · ${Math.round(this.engine.pixelScale * 100)}%`;
      }
    });

    this.engine.start();
  }
}

// ============================
// Утилиты
// ============================
function nextFrame() { return new Promise((r) => requestAnimationFrame(r)); }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ============================
// Старт
// ============================
// Глобальный отлов ошибок: если модуль не загрузился / бут упал синхронно,
// покажем причину прямо на экране загрузки (иначе — «вечная ИНИЦИАЛИЗАЦИЯ»).
function _bootFail(msg) {
  const s = document.getElementById('boot-status');
  if (s) s.textContent = `ОШИБКА: ${msg} — коснись для пропуска`;
  console.error('[boot-fail]', msg);
}
window.addEventListener('error', (e) => {
  if (document.getElementById('boot-screen')?.classList.contains('visible')) {
    _bootFail(e.message || 'скрипт');
  }
});
window.addEventListener('unhandledrejection', (e) => {
  if (document.getElementById('boot-screen')?.classList.contains('visible')) {
    _bootFail(e.reason?.message || String(e.reason) || 'promise');
  }
});

let game;
try {
  game = new Game();
  window.__game = game; // hook для отладки
} catch (err) {
  _bootFail(`init: ${err.message}`);
  throw err;
}
game.boot().catch((err) => {
  console.error('[boot]', err);
  _bootFail(err.message);
});


