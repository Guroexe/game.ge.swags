// ===== GEN.SWAGS NetClient =====
// Полный сетевой клиент. Публичный API заглушки сохранён:
// connect(url, {room, name}) / on(event, cb) / off / send(obj) / rooms / chat / latency
// + sendInput / sendChat / listRooms / disconnect / serverUrlFromLocation.
// По умолчанию НЕ подключается: только при ?server=ws://... в URL.
// Graceful fallback на соло-игру при любой ошибке.
//
// Добавлено:
//  - авто-реконнект с backoff (до 5 попыток, 1с→15с + джиттер)
//  - интерполяция удалённых игроков (буфер 100 мс): samplePlayers()
//  - события: 'players','shot','hit','death','respawn','chunk','cash','chat',
//    'friends','friendRequest','friendAccepted','start','lobby','rooms',
//    'roomJoined','playerJoined','playerLeft','ready','voice-peers','voice-signal',
//    'reconnecting','reconnected','solo','open','close','state' (любое сообщение)
//  - VoiceChat (WebRTC mesh по команде): net.voice.enable()/disable()/setMuted(),
//    событие net.voice.on('speaking', {id, level, speaking})

const INPUT_HZ = 15;              // клиент шлёт инпут 15 Гц
const INTERP_DELAY_MS = 100;      // буфер интерполяции
const MAX_RECONNECT = 5;
const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

export class NetClient {
  constructor() {
    this.ws = null;
    this.connected = false;
    this.playerId = null;
    this.room = null;             // id текущей комнаты (или null)
    this.roomInfo = null;         // полное состояние комнаты (roomJoined)
    this.you = null;              // {id, team}
    this.rooms = [];              // кэш списка комнат
    this._handlers = new Map();   // event -> [cb]
    this._sendQueue = [];
    this.latency = 0;
    this._pingTimer = null;

    // Сессия / реконнект
    this._url = null;
    this._name = 'PLAYER';
    this._wantedRoom = 'hub_1';
    this._manualClose = false;
    this._reconnectAttempts = 0;
    this._reconnectTimer = null;

    // Удалённые игроки: id -> {team, alive, hp, buffer:[{ts, pos, yaw, pitch}]}
    this.remote = new Map();
    this.interpDelay = INTERP_DELAY_MS;

    // Голосовой чат (ленивый, только по кнопке)
    this.voice = new VoiceChat(this);
  }

  // URL сервера из ?server= или null
  static serverUrlFromLocation() {
    try {
      const p = new URLSearchParams(window.location.search);
      return p.get('server');
    } catch { return null; }
  }

  // Дефолтный URL MP-сервера по текущему location (без ?server=):
  //  • https-прод (Railway/любой HTTPS-хост) → wss://тот же хост (общий порт,
  //    upgrade-запросы — так работает server/start.railway.js)
  //  • http-локалка/LAN → ws://<host>:7777 (standalone WS из server/start.js)
  static defaultServerUrl() {
    try {
      const proto = window.location.protocol;
      const host = window.location.hostname;
      if (proto === 'https:') return `wss://${window.location.host}`;
      if (proto === 'http:' && host) return `ws://${host}:7777`;
    } catch { /* noop */ }
    return null;
  }

  // Полный резолв: ?server= имеет приоритет, иначе дефолт по location.
  static resolveServerUrl() {
    return NetClient.serverUrlFromLocation() || NetClient.defaultServerUrl();
  }


  on(event, cb) {
    if (!this._handlers.has(event)) this._handlers.set(event, []);
    this._handlers.get(event).push(cb);
    return this;
  }
  off(event, cb) {
    const arr = this._handlers.get(event);
    if (arr) {
      const i = arr.indexOf(cb);
      if (i >= 0) arr.splice(i, 1);
    }
  }
  _emit(event, data) {
    const arr = this._handlers.get(event);
    if (arr) for (const cb of arr) { try { cb(data); } catch (e) { console.error('[net]', e); } }
  }

  // Подключение. resolve(true) при успехе, resolve(false) при fallback на соло.
  get playerName() { return this._name; }

  connect(url, { room = 'hub_1', name = 'PLAYER' } = {}) {
    this._url = url;
    this._name = name;
    this._wantedRoom = room;
    this._manualClose = false;
    this._reconnectAttempts = 0;
    return this._open(true);
  }

  _open(firstTry = false) {
    return new Promise((resolve) => {
      const url = this._url;
      if (!url) { this._emit('solo'); resolve(false); return; }
      let settled = false;
      const fail = () => {
        if (settled) return;
        settled = true;
        this.connected = false;
        if (firstTry || this._reconnectAttempts >= MAX_RECONNECT) {
          this._emit('solo');
          resolve(false);
        } else {
          this._scheduleReconnect();
          resolve(false);
        }
      };
      try {
        this.ws = new WebSocket(url);
      } catch { fail(); return; }

      const timeout = setTimeout(fail, 5000);
      this.ws.onopen = () => {
        this.connected = true;
        this.send({ t: 'hello', name: this._name });
        clearInterval(this._pingTimer);
        this._pingTimer = setInterval(() => {
          this._pingAt = performance.now();
          this.send({ t: 'ping', ts: this._pingAt });
        }, 3000);
        this._emit('open');
      };
      this.ws.onerror = () => { clearTimeout(timeout); fail(); };
      this.ws.onclose = () => {
        clearTimeout(timeout);
        clearInterval(this._pingTimer);
        const wasConnected = this.connected;
        this.connected = false;
        if (wasConnected) {
          this._emit('close');
          if (!settled) { settled = true; resolve(true); } // уже в игре
          if (!this._manualClose) this._scheduleReconnect();
        } else {
          fail();
        }
      };
      this.ws.onmessage = (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch { return; }
        if (msg.t === 'welcome') {
          clearTimeout(timeout);
          this.playerId = msg.id;
          this._reconnectAttempts = 0;
          if (this._wantedRoom) this.send({ t: 'joinRoom', roomId: this._wantedRoom });
          if (!settled) { settled = true; resolve(true); }
          else this._emit('reconnected');
        }
        this._route(msg);
      };
    });
  }

  _scheduleReconnect() {
    if (this._manualClose || this._reconnectTimer) return;
    if (this._reconnectAttempts >= MAX_RECONNECT) { this._emit('solo'); return; }
    const attempt = ++this._reconnectAttempts;
    const delay = Math.min(1000 * 2 ** (attempt - 1), 15000) + Math.random() * 500;
    this._emit('reconnecting', { attempt, delay });
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this._open(false);
    }, delay);
  }

  // Маршрутизация входящих сообщений
  _route(msg) {
    switch (msg.t) {
      case 'pong':
        this.latency = performance.now() - (this._pingAt || 0);
        return;
      case 'rooms':
        this.rooms = msg.rooms || [];
        break;
      case 'roomJoined':
        this.room = msg.room?.id || null;
        this.roomInfo = msg.room || null;
        this.you = msg.you || null;
        this.remote.clear();
        if (msg.room?.players) {
          for (const p of msg.room.players) {
            if (p.id !== this.playerId) this._remoteEntry(p.id, p);
          }
        }
        break;
      case 'playerJoined':
        if (msg.player && msg.player.id !== this.playerId) {
          this._remoteEntry(msg.player.id, msg.player);
        }
        break;
      case 'playerLeft':
        this.remote.delete(msg.id);
        break;
      case 'start':
        this.remote.clear();
        for (const p of msg.players || []) {
          if (p.id !== this.playerId) this._remoteEntry(p.id, p);
          if (p.id === this.playerId) this.you = { id: p.id, team: p.team };
        }
        break;
      case 'players':
        this._onPlayersSnapshot(msg);
        break;
      case 'rating':
        // Серверный рейтинг: кэшируем топ/дельты; неизвестное содержимое игнорируем
        if (msg.top) this.ratingTop = msg.top;
        if (msg.ratings) this.ratings = msg.ratings;
        break;
      default:
        break;
    }
    this._emit(msg.t, msg);
    this._emit('state', msg);
  }

  _remoteEntry(id, p = {}) {
    let e = this.remote.get(id);
    if (!e) { e = { id, name: '', team: 0, hp: 100, alive: true, buffer: [] }; this.remote.set(id, e); }
    if (p.name !== undefined) e.name = p.name;
    if (p.team !== undefined) e.team = p.team;
    if (p.hp !== undefined) e.hp = p.hp;
    if (p.alive !== undefined) e.alive = p.alive;
    if (Array.isArray(p.pos)) this._pushSample(e, p);
    return e;
  }

  _pushSample(e, p) {
    e.buffer.push({
      ts: performance.now(),
      pos: [...(p.pos || [0, 0, 0])],
      yaw: p.yaw || 0, pitch: p.pitch || 0,
    });
    // Храним ~2 секунды сэмплов
    const cutoff = performance.now() - 2000;
    while (e.buffer.length > 2 && e.buffer[0].ts < cutoff) e.buffer.shift();
  }

  _onPlayersSnapshot(msg) {
    for (const s of msg.list || []) {
      if (s.id === this.playerId) continue;
      const e = this._remoteEntry(s.id, s);
      e.alive = s.alive; e.hp = s.hp; e.team = s.team;
    }
  }

  // Интерполированные состояния удалённых игроков (рендер на 100 мс в прошлом)
  samplePlayers(now = performance.now()) {
    const rt = now - this.interpDelay;
    const out = [];
    for (const e of this.remote.values()) {
      const b = e.buffer;
      if (!b.length) continue;
      let s0 = b[0], s1 = b[b.length - 1];
      for (let i = b.length - 1; i >= 0; i--) {
        if (b[i].ts <= rt) { s0 = b[i]; s1 = b[Math.min(i + 1, b.length - 1)]; break; }
      }
      const span = Math.max(1, s1.ts - s0.ts);
      const k = Math.max(0, Math.min(1, (rt - s0.ts) / span));
      const dyaw = ((s1.yaw - s0.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      out.push({
        id: e.id, name: e.name, team: e.team, hp: e.hp, alive: e.alive,
        pos: [
          s0.pos[0] + (s1.pos[0] - s0.pos[0]) * k,
          s0.pos[1] + (s1.pos[1] - s0.pos[1]) * k,
          s0.pos[2] + (s1.pos[2] - s0.pos[2]) * k,
        ],
        yaw: s0.yaw + dyaw * k,
        pitch: s0.pitch + (s1.pitch - s0.pitch) * k,
      });
    }
    return out;
  }

  // Отправка (надёжная очередь до открытия сокета)
  send(obj) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      if (this._sendQueue.length < 100) this._sendQueue.push(obj);
      return false;
    }
    // Сначала выгребаем очередь
    while (this._sendQueue.length) {
      try { this.ws.send(JSON.stringify(this._sendQueue.shift())); } catch { break; }
    }
    try { this.ws.send(JSON.stringify(obj)); return true; } catch { return false; }
  }

  // ===== Игровые хелперы =====
  sendInput(input) { return this.send({ t: 'input', ...input }); }
  sendShot(origin, dir, weapon) { return this.send({ t: 'shot', origin, dir, weapon }); }
  sendHit(target, dmg, part, dist) { return this.send({ t: 'hit', target, dmg, part, dist }); }
  sendChunk(chunkId) { return this.send({ t: 'chunk', chunkId }); }
  sendCash(action, station) { return this.send({ t: 'cash', action, station }); }
  sendChat(text, team = false) { return this.send({ t: 'chat', text, team }); }

  // Рейтинг (серверный, MP): запрос топа + моей позиции
  requestRating() { return this.send({ t: 'rating' }); }

  // Лобби
  listRooms() { return this.send({ t: 'rooms' }); }
  createRoom(name) { return this.send({ t: 'createRoom', name }); }
  joinRoom(roomId) { this._wantedRoom = roomId; return this.send({ t: 'joinRoom', roomId }); }
  leaveRoom() { return this.send({ t: 'leaveRoom' }); }
  setReady(ready = true) { return this.send({ t: 'ready', ready }); }
  startMatch() { return this.send({ t: 'start' }); }

  // Друзья
  listFriends() { return this.send({ t: 'friends' }); }
  friendAdd(name) { return this.send({ t: 'friendAdd', name }); }
  friendAccept(name) { return this.send({ t: 'friendAccept', name }); }
  friendDecline(name) { return this.send({ t: 'friendDecline', name }); }
  friendRemove(name) { return this.send({ t: 'friendRemove', name }); }

  // Авто-отправка инпута 15 Гц: передай getState() -> {pos:[x,y,z], yaw, pitch}
  startInputLoop(getState, hz = INPUT_HZ) {
    this.stopInputLoop();
    let seq = 0;
    this._inputTimer = setInterval(() => {
      if (!this.connected) return;
      const s = getState();
      if (s) this.sendInput({ ...s, seq: ++seq });
    }, 1000 / hz);
    return () => this.stopInputLoop();
  }
  stopInputLoop() {
    if (this._inputTimer) { clearInterval(this._inputTimer); this._inputTimer = null; }
  }

  disconnect() {
    this._manualClose = true;
    clearTimeout(this._reconnectTimer);
    this._reconnectTimer = null;
    this.stopInputLoop();
    this.voice.disable();
    clearInterval(this._pingTimer);
    if (this.ws) { try { this.ws.close(); } catch {} this.ws = null; }
    this.connected = false;
    this.remote.clear();
    this.room = null;
  }
}

// ===== VoiceChat (WebRTC mesh по команде) =====
// Сигналинг через сервер ('voice-join'/'voice-signal'), медиа — P2P mesh
// между сокомандниками. getUserMedia вызывается ТОЛЬКО из enable() (кнопка).
export class VoiceChat {
  constructor(net) {
    this.net = net;
    this.enabled = false;
    this.muted = false;
    this.stream = null;
    this.pcs = new Map();        // peerId -> RTCPeerConnection
    this._audioCtx = null;
    this._analysers = new Map(); // peerId|'me' -> {analyser, data}
    this._speakTimer = null;
    this._handlers = new Map();

    net.on('voice-peers', (m) => { if (this.enabled) this._syncPeers(m.peers || []); });
    net.on('voice-signal', (m) => { if (this.enabled) this._onSignal(m.from, m.data); });
    net.on('start', () => { if (this.enabled) this.net.send({ t: 'voice-join' }); });
    net.on('close', () => this._teardown(false));
    net.on('roomLeft', () => this._teardown(false));
  }

  on(event, cb) {
    if (!this._handlers.has(event)) this._handlers.set(event, []);
    this._handlers.get(event).push(cb);
    return this;
  }
  _emit(event, data) {
    const arr = this._handlers.get(event);
    if (arr) for (const cb of arr) { try { cb(data); } catch (e) { console.error('[voice]', e); } }
  }

  async enable() {
    if (this.enabled) return true;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true }, video: false,
      });
    } catch (e) {
      console.warn('[voice] getUserMedia отклонён:', e.message);
      this._emit('error', e);
      return false;
    }
    this.enabled = true;
    this._ensureAudioCtx();
    this._attachAnalyser('me', this.stream);
    this._applyMute();
    this.net.send({ t: 'voice-join' });
    this._startSpeakingPoll();
    this._emit('enabled');
    return true;
  }

  disable() {
    if (!this.enabled && !this.stream) return;
    this.net.send({ t: 'voice-leave' });
    this._teardown(true);
  }

  setMuted(muted) {
    this.muted = !!muted;
    this._applyMute();
  }

  _applyMute() {
    if (this.stream) {
      for (const track of this.stream.getAudioTracks()) track.enabled = !this.muted;
    }
  }

  _teardown(emitEvent) {
    this.enabled = false;
    for (const pc of this.pcs.values()) { try { pc.close(); } catch {} }
    this.pcs.clear();
    if (this.stream) { for (const t of this.stream.getTracks()) t.stop(); this.stream = null; }
    this._analysers.clear();
    if (this._speakTimer) { clearInterval(this._speakTimer); this._speakTimer = null; }
    if (emitEvent) this._emit('disabled');
  }

  _ensureAudioCtx() {
    if (!this._audioCtx) {
      try { this._audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
      catch { /* нет WebAudio — живём без индикатора */ }
    }
    if (this._audioCtx?.state === 'suspended') this._audioCtx.resume().catch(() => {});
  }

  _attachAnalyser(id, stream) {
    if (!this._audioCtx) return;
    try {
      const src = this._audioCtx.createMediaStreamSource(stream);
      const analyser = this._audioCtx.createAnalyser();
      analyser.fftSize = 512;
      src.connect(analyser);
      this._analysers.set(id, { analyser, data: new Uint8Array(analyser.frequencyBinCount) });
    } catch { /* noop */ }
  }

  _startSpeakingPoll() {
    if (this._speakTimer) clearInterval(this._speakTimer);
    let last = new Map();
    this._speakTimer = setInterval(() => {
      for (const [id, rec] of this._analysers) {
        rec.analyser.getByteTimeDomainData(rec.data);
        let sum = 0;
        for (let i = 0; i < rec.data.length; i++) {
          const v = (rec.data[i] - 128) / 128;
          sum += v * v;
        }
        const level = Math.sqrt(sum / rec.data.length);
        const speaking = level > 0.02;
        if (last.get(id) !== speaking) {
          last.set(id, speaking);
          this._emit('speaking', { id, level, speaking });
        }
      }
    }, 120);
  }

  // Mesh: коннектимся к каждому сокоманднику с включённым голосом.
  // Детерминированный инициатор: меньший id делает offer.
  _syncPeers(peers) {
    const myId = this.net.playerId || '';
    for (const peerId of peers) {
      if (this.pcs.has(peerId)) continue;
      const pc = this._createPc(peerId);
      if (myId < peerId) {
        pc.createOffer()
          .then((o) => pc.setLocalDescription(o))
          .then(() => this.net.send({ t: 'voice-signal', to: peerId, data: { type: 'offer', sdp: pc.localDescription.sdp } }))
          .catch((e) => console.warn('[voice] offer:', e));
      }
    }
    for (const [peerId, pc] of this.pcs) {
      if (!peers.includes(peerId)) { try { pc.close(); } catch {} this.pcs.delete(peerId); this._analysers.delete(peerId); }
    }
  }

  _createPc(peerId) {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    this.pcs.set(peerId, pc);
    if (this.stream) for (const t of this.stream.getTracks()) pc.addTrack(t, this.stream);
    pc.onicecandidate = (ev) => {
      if (ev.candidate) {
        this.net.send({ t: 'voice-signal', to: peerId, data: { type: 'ice', candidate: ev.candidate.toJSON() } });
      }
    };
    pc.ontrack = (ev) => {
      const stream = ev.streams[0];
      if (stream) {
        this._attachAnalyser(peerId, stream);
        this._emit('stream', { id: peerId, stream });
      }
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') { try { pc.restartIce(); } catch {} }
    };
    return pc;
  }

  async _onSignal(from, data) {
    if (!data || typeof data !== 'object') return;
    let pc = this.pcs.get(from);
    if (!pc) pc = this._createPc(from);
    try {
      if (data.type === 'offer') {
        await pc.setRemoteDescription({ type: 'offer', sdp: data.sdp });
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        this.net.send({ t: 'voice-signal', to: from, data: { type: 'answer', sdp: pc.localDescription.sdp } });
      } else if (data.type === 'answer') {
        await pc.setRemoteDescription({ type: 'answer', sdp: data.sdp });
      } else if (data.type === 'ice' && data.candidate) {
        await pc.addIceCandidate(data.candidate);
      }
    } catch (e) {
      console.warn('[voice] signal:', e);
    }
  }
}
