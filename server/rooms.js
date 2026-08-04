// ===== GEN.SWAGS Room =====
// Комната HUB_x: лобби (готовность/старт) и авторитетный матч.
// Тикер 20 Гц: lerp позиций к заявленным клиентом, снапшот 'players',
// прогресс кешаут-станций, таймеры респавна.

export const TICK_HZ = 20;
export const MAX_PLAYERS = 9;
export const TEAM_COUNT = 3;
const RESPAWN_MS = 3000;
const CASHOUT_TIME_MS = 5000;
const CASHBOX_PICKUP_DIST = 2.5;
const STATION_USE_DIST = 3.5;
const MAX_SHOT_DIST = 130;
const MAX_HP = 100;
const SHOT_RATE_WINDOW_MS = 1000;
const SHOT_RATE_MAX = 25;

// Те же точки спавна, что и в js/game/arena.js (треугольник R=24)
function teamSpawn(team) {
  const a = (team / 3) * Math.PI * 2 + Math.PI / 2;
  const x = Math.cos(a) * 24, z = Math.sin(a) * 24;
  const yaw = Math.atan2(-(0 - x), -(0 - z));
  return { pos: [x, 0.1, z], yaw };
}

const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

let roomSeq = 0;

export class Room {
  constructor(name, server) {
    this.id = `hub_${++roomSeq}`;
    this.name = name || `HUB_${roomSeq}`;
    this.server = server;
    this.maxPlayers = MAX_PLAYERS;
    this.players = new Map(); // clientId -> PlayerState
    this.state = 'lobby';     // 'lobby' | 'playing'
    this.destroyedChunks = new Set();
    // Кеш-режим
    this.cashbox = { holder: null, pos: [0, 0.4, -2] }; // спавн как в arena.js
    this.stations = [
      { letter: 'A', pos: [-24, 0, -18], owner: null, progress: 0, by: null },
      { letter: 'B', pos: [24, 0, 18], owner: null, progress: 0, by: null },
      { letter: 'C', pos: [20, 0, 22], owner: null, progress: 0, by: null },
    ];
    this.scores = [0, 0, 0];
    this._tickTimer = null;
    this._respawnTimers = new Map();
  }

  get size() { return this.players.size; }

  info() {
    return { id: this.id, name: this.name, players: this.size, max: this.maxPlayers, state: this.state };
  }

  // ---------- Игроки ----------

  // Автораспределение: в самую малочисленную команду
  _pickTeam() {
    const counts = [0, 0, 0];
    for (const p of this.players.values()) counts[p.team]++;
    let best = 0;
    for (let i = 1; i < TEAM_COUNT; i++) if (counts[i] < counts[best]) best = i;
    return best;
  }

  addPlayer(client) {
    const team = this._pickTeam();
    const sp = teamSpawn(team);
    const p = {
      id: client.id, client, name: client.name, team,
      ready: false,
      pos: [...sp.pos], yaw: sp.yaw, pitch: 0,
      srvPos: [...sp.pos], // серверная lerp-позиция
      hp: MAX_HP, alive: true,
      kills: 0, deaths: 0, seq: 0,
      voice: false,
      _shotTimes: [],
    };
    this.players.set(client.id, p);
    return p;
  }

  removePlayer(clientId) {
    const p = this.players.get(clientId);
    if (!p) return;
    if (this.cashbox.holder === clientId) {
      this.cashbox.holder = null;
      this.cashbox.pos = [...p.srvPos];
    }
    for (const st of this.stations) {
      if (st.by === clientId) { st.by = null; st.progress = 0; }
    }
    const t = this._respawnTimers.get(clientId);
    if (t) { clearTimeout(t); this._respawnTimers.delete(clientId); }
    this.players.delete(clientId);
    this.broadcast({ t: 'playerLeft', id: clientId });
    this._broadcastCash();
    this._broadcastVoicePeers(p.team);
    // Если матч опустел — вернуть в лобби
    if (this.size === 0) this._stopTicker();
  }

  // ---------- Лобби ----------

  setReady(clientId, ready) {
    const p = this.players.get(clientId);
    if (!p || this.state !== 'lobby') return;
    p.ready = !!ready;
    this.broadcast({ t: 'ready', id: clientId, ready: p.ready });
    // Автостарт, когда все (минимум 1) готовы
    if (this.size >= 1 && [...this.players.values()].every((q) => q.ready)) {
      this.start();
    }
  }

  start() {
    if (this.state === 'playing') return;
    this.state = 'playing';
    this.destroyedChunks.clear();
    this.cashbox = { holder: null, pos: [0, 0.4, -2] };
    for (const st of this.stations) { st.owner = null; st.progress = 0; st.by = null; }
    this.scores = [0, 0, 0];
    const players = [];
    for (const p of this.players.values()) {
      const sp = teamSpawn(p.team);
      p.pos = [...sp.pos]; p.srvPos = [...sp.pos]; p.yaw = sp.yaw; p.pitch = 0;
      p.hp = MAX_HP; p.alive = true; p.kills = 0; p.deaths = 0;
      players.push(this.publicPlayer(p));
    }
    this.broadcast({ t: 'start', players, cash: this.cashState() });
    this._startTicker();
  }

  backToLobby() {
    this.state = 'lobby';
    this._stopTicker();
    for (const p of this.players.values()) p.ready = false;
    this.broadcast({ t: 'lobby', room: this.fullInfo() });
  }

  publicPlayer(p) {
    return {
      id: p.id, name: p.name, team: p.team, ready: p.ready,
      pos: p.srvPos, yaw: p.yaw, pitch: p.pitch,
      hp: p.hp, alive: p.alive, kills: p.kills, deaths: p.deaths, voice: p.voice,
    };
  }

  fullInfo() {
    return {
      ...this.info(),
      players: [...this.players.values()].map((p) => this.publicPlayer(p)),
      destroyedChunks: [...this.destroyedChunks],
      cash: this.cashState(),
    };
  }

  // ---------- Рассылки ----------

  broadcast(msg, exceptId = null) {
    const raw = JSON.stringify(msg);
    for (const p of this.players.values()) {
      if (p.id !== exceptId) p.client.sendRaw(raw);
    }
  }

  broadcastTeam(team, msg, exceptId = null) {
    const raw = JSON.stringify(msg);
    for (const p of this.players.values()) {
      if (p.team === team && p.id !== exceptId) p.client.sendRaw(raw);
    }
  }

  cashState() {
    return {
      cashbox: this.cashbox,
      stations: this.stations.map((s) => ({ letter: s.letter, owner: s.owner, progress: +s.progress.toFixed(3) })),
      scores: [...this.scores],
    };
  }

  _broadcastCash() {
    if (this.state === 'playing') this.broadcast({ t: 'cash', ...this.cashState() });
  }

  // ---------- Игровые события ----------

  onInput(p, msg) {
    if (!p || !p.alive) return;
    const { pos, yaw, pitch } = msg;
    if (!Array.isArray(pos) || pos.length !== 3 || pos.some((v) => !Number.isFinite(v))) return;
    // Античит-лайт: кламп в пределы арены с запасом
    p.pos = [
      Math.max(-60, Math.min(60, pos[0])),
      Math.max(-5, Math.min(60, pos[1])),
      Math.max(-60, Math.min(60, pos[2])),
    ];
    p.yaw = Number.isFinite(yaw) ? yaw : p.yaw;
    p.pitch = Number.isFinite(pitch) ? pitch : p.pitch;
    if (Number.isFinite(msg.seq)) p.seq = msg.seq;
  }

  onShot(p, msg) {
    if (!p || !p.alive || this.state !== 'playing') return;
    // Rate limit выстрелов
    const now = Date.now();
    p._shotTimes = p._shotTimes.filter((t) => now - t < SHOT_RATE_WINDOW_MS);
    if (p._shotTimes.length >= SHOT_RATE_MAX) return;
    p._shotTimes.push(now);
    const { origin, dir, weapon } = msg;
    if (!Array.isArray(origin) || !Array.isArray(dir)) return;
    this.broadcast({
      t: 'shot', id: p.id,
      origin: origin.slice(0, 3).map((v) => +v || 0),
      dir: dir.slice(0, 3).map((v) => +v || 0),
      weapon: String(weapon || 'rifle').slice(0, 24),
    }, p.id);
  }

  onHit(p, msg) {
    if (!p || !p.alive || this.state !== 'playing') return;
    const target = this.players.get(msg.target);
    if (!target || !target.alive || target.team === p.team) return;
    // Упрощённая валидация: дистанция между серверными позициями
    const d = dist3(p.srvPos, target.srvPos);
    if (d > MAX_SHOT_DIST) return;
    const claimed = Number.isFinite(msg.dist) ? msg.dist : d;
    if (Math.abs(claimed - d) > 6) return; // заявленная дистанция сильно врёт
    const part = msg.part === 'head' ? 'head' : 'body';
    let dmg = Math.max(1, Math.min(100, +msg.dmg || 0));
    target.hp -= dmg;
    const dead = target.hp <= 0;
    this.broadcast({
      t: 'hit', from: p.id, target: target.id,
      dmg, part, hp: Math.max(0, target.hp), dead,
    });
    if (dead) this._kill(p, target);
  }

  _kill(by, victim) {
    victim.alive = false;
    victim.hp = 0;
    victim.deaths++;
    if (by && by.id !== victim.id) by.kills++;
    // Кешбокс падает на месте смерти
    if (this.cashbox.holder === victim.id) {
      this.cashbox.holder = null;
      this.cashbox.pos = [...victim.srvPos];
    }
    for (const st of this.stations) {
      if (st.by === victim.id) { st.by = null; st.progress = 0; }
    }
    this.broadcast({
      t: 'death', id: victim.id, by: by?.id || null,
      kills: by?.kills ?? 0, deaths: victim.deaths,
    });
    this._broadcastCash();
    // Респавн
    const timer = setTimeout(() => {
      this._respawnTimers.delete(victim.id);
      if (!this.players.has(victim.id) || this.state !== 'playing') return;
      const sp = teamSpawn(victim.team);
      victim.pos = [...sp.pos]; victim.srvPos = [...sp.pos]; victim.yaw = sp.yaw;
      victim.hp = MAX_HP; victim.alive = true;
      this.broadcast({ t: 'respawn', id: victim.id, pos: sp.pos, yaw: sp.yaw, hp: MAX_HP });
    }, RESPAWN_MS);
    this._respawnTimers.set(victim.id, timer);
  }

  onChunk(p, msg) {
    if (this.state !== 'playing') return;
    const id = String(msg.chunkId ?? '').slice(0, 64);
    if (!id) return;
    if (this.destroyedChunks.has(id)) return; // идемпотентно
    this.destroyedChunks.add(id);
    this.broadcast({ t: 'chunk', chunkId: id, by: p?.id || null });
  }

  onCash(p, msg) {
    if (!p || !p.alive || this.state !== 'playing') return;
    const action = msg.action;
    if (action === 'pickup') {
      if (this.cashbox.holder) return;
      if (dist3(p.srvPos, this.cashbox.pos) > CASHBOX_PICKUP_DIST + 1.5) return;
      this.cashbox.holder = p.id;
      this.broadcast({ t: 'cash', event: 'pickup', id: p.id, ...this.cashState() });
    } else if (action === 'drop') {
      if (this.cashbox.holder !== p.id) return;
      this.cashbox.holder = null;
      this.cashbox.pos = [...p.srvPos];
      this.broadcast({ t: 'cash', event: 'drop', id: p.id, ...this.cashState() });
    } else if (action === 'deposit') {
      const st = this.stations.find((s) => s.letter === msg.station);
      if (!st || this.cashbox.holder !== p.id) return;
      if (st.by && st.by !== p.id) return; // станция занята
      if (dist3(p.srvPos, st.pos) > STATION_USE_DIST + 1.5) return;
      st.by = p.id;
      st.owner = p.team;
      this.broadcast({ t: 'cash', event: 'depositStart', id: p.id, station: st.letter, ...this.cashState() });
    }
  }

  // ---------- Голос ----------

  setVoice(p, on) {
    if (!p) return;
    p.voice = !!on;
    this._broadcastVoicePeers(p.team);
  }

  _broadcastVoicePeers(team) {
    if (this.state !== 'playing') return;
    const teamPlayers = [...this.players.values()].filter((q) => q.team === team);
    for (const q of teamPlayers) {
      if (!q.voice) continue;
      q.client.send({
        t: 'voice-peers',
        peers: teamPlayers.filter((o) => o.voice && o.id !== q.id).map((o) => o.id),
      });
    }
  }

  onVoiceSignal(p, msg) {
    if (!p || !p.voice) return;
    const to = this.players.get(msg.to);
    // Ретрансляция только внутри команды и только между включившими голос
    if (!to || !to.voice || to.team !== p.team) return;
    if (!msg.data || typeof msg.data !== 'object') return;
    to.client.send({ t: 'voice-signal', from: p.id, data: msg.data });
  }

  // ---------- Тикер 20 Гц ----------

  _startTicker() {
    if (this._tickTimer) return;
    let last = Date.now();
    this._tickTimer = setInterval(() => {
      const now = Date.now();
      const dt = Math.min(0.25, (now - last) / 1000);
      last = now;
      this._tick(dt);
    }, 1000 / TICK_HZ);
  }

  _stopTicker() {
    if (this._tickTimer) { clearInterval(this._tickTimer); this._tickTimer = null; }
  }

  _tick(dt) {
    if (this.state !== 'playing') { this._stopTicker(); return; }
    // lerp серверной позиции к заявленной (сглаживание телепортов)
    const k = Math.min(1, dt * 12);
    for (const p of this.players.values()) {
      p.srvPos[0] += (p.pos[0] - p.srvPos[0]) * k;
      p.srvPos[1] += (p.pos[1] - p.srvPos[1]) * k;
      p.srvPos[2] += (p.pos[2] - p.srvPos[2]) * k;
    }
    // Прогресс кешаут-станций
    let cashDirty = false;
    for (const st of this.stations) {
      if (!st.by) continue;
      const holder = this.players.get(st.by);
      const valid = holder && holder.alive
        && this.cashbox.holder === st.by
        && dist3(holder.srvPos, st.pos) <= STATION_USE_DIST + 1.5;
      if (!valid) { st.by = null; st.progress = 0; cashDirty = true; continue; }
      st.progress += (dt * 1000) / CASHOUT_TIME_MS;
      cashDirty = true;
      if (st.progress >= 1) {
        this.scores[st.owner]++;
        this.cashbox = { holder: null, pos: [0, 0.4, -2] };
        st.by = null; st.progress = 0;
        this.broadcast({ t: 'cash', event: 'cashout', team: st.owner, ...this.cashState() });
        // Серверный ELO: кешаут меняет рейтинг игроков комнаты
        this.server.applyCashoutRating?.(this, st.owner);
        cashDirty = false; // уже разослали
      }
    }
    if (cashDirty) this._broadcastCash();
    // Кешбокс следует за держателем
    if (this.cashbox.holder) {
      const h = this.players.get(this.cashbox.holder);
      if (h) this.cashbox.pos = [h.srvPos[0], h.srvPos[1] + 0.4, h.srvPos[2]];
    }
    // Снапшот игроков
    this.broadcast({
      t: 'players',
      ts: Date.now(),
      list: [...this.players.values()].map((p) => ({
        id: p.id,
        pos: p.srvPos.map((v) => +v.toFixed(3)),
        yaw: +p.yaw.toFixed(4), pitch: +p.pitch.toFixed(4),
        hp: p.hp, alive: p.alive, team: p.team, seq: p.seq,
      })),
    });
  }
}
