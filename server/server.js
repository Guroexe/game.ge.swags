// ===== GEN.SWAGS Server =====
// Node.js WebSocket сервер (deps: только ws). JSON-протокол.
// Лобби (ники/комнаты/готовность), авторитетный матч 20 Гц, чат,
// друзья (персист в data/friends.json), WebRTC voice signaling (team mesh).
// Запуск: npm i && npm start   (порт: env PORT, по умолчанию 7777)
import { WebSocketServer } from 'ws';
import { Room, MAX_PLAYERS } from './rooms.js';
import { FriendsStore } from './friends.js';
import { RatingStore } from './rating.js';

const PORT = Number(process.env.PORT) || 7777;
const MAX_MSG_SIZE = 8 * 1024;        // ws maxPayload
const CHAT_MAX_LEN = 200;
const CHAT_RATE_PER_SEC = 4;
const FLOOD_WINDOW_MS = 5000;         // глобальный анти-флуд
const FLOOD_MAX_MSGS = 300;
const HEARTBEAT_MS = 15000;
const NAME_RE = /^[\wА-Яа-яЁё .-]{2,20}$/u;

const friends = new FriendsStore();
const ratings = new RatingStore();
const clients = new Map();   // id -> Client
const byName = new Map();    // name (lower) -> Client
const rooms = new Map();     // roomId -> Room
let clientSeq = 0;

// Дефолтная комната HUB_1
function ensureDefaultRoom() {
  for (const r of rooms.values()) if (r.name === 'HUB_1') return r;
  const r = new Room('HUB_1', api);
  rooms.set(r.id, r);
  return r;
}

// ---------- Client ----------
class Client {
  constructor(ws) {
    this.ws = ws;
    this.id = `p${++clientSeq}`;
    this.name = null;         // до 'hello'
    this.room = null;
    this.isAlive = true;      // ws heartbeat
    this._msgCount = 0;
    this._msgWindowStart = Date.now();
    this._chatTokens = CHAT_RATE_PER_SEC;
    this._chatLastRefill = Date.now();
  }
  send(obj) {
    if (this.ws.readyState === 1) {
      try { this.ws.send(JSON.stringify(obj)); return true; } catch { /* noop */ }
    }
    return false;
  }
  sendRaw(raw) {
    if (this.ws.readyState === 1) {
      try { this.ws.send(raw); return true; } catch { /* noop */ }
    }
    return false;
  }
  error(code, msg) { this.send({ t: 'error', code, msg }); }

  // Глобальный анти-флуд: true = заблокировать
  floodCheck() {
    const now = Date.now();
    if (now - this._msgWindowStart > FLOOD_WINDOW_MS) {
      this._msgWindowStart = now;
      this._msgCount = 0;
    }
    return ++this._msgCount > FLOOD_MAX_MSGS;
  }

  // Токен-бакет для чата: 4 сообщ/сек
  chatAllowed() {
    const now = Date.now();
    this._chatTokens = Math.min(CHAT_RATE_PER_SEC,
      this._chatTokens + ((now - this._chatLastRefill) / 1000) * CHAT_RATE_PER_SEC);
    this._chatLastRefill = now;
    if (this._chatTokens < 1) return false;
    this._chatTokens -= 1;
    return true;
  }
}

// ---------- Server API (для Room) ----------
const api = {
  broadcastLobbyRooms() { broadcastRooms(); },
  // Кешаут команды teamIdx: ELO всем игрокам комнаты (+16 победителям, −8 остальным)
  // и рассылка дельт событием протокола {t:'rating', ratings}.
  applyCashoutRating(room, teamIdx) {
    const out = {};
    for (const p of room.players.values()) {
      if (!p.name) continue;
      out[p.name] = ratings.applyResult(p.name, p.team === teamIdx ? 1 : 0.25, 0.5);
    }
    if (Object.keys(out).length) room.broadcast({ t: 'rating', ratings: out });
  },
};
ensureDefaultRoom();

// ---------- Лобби ----------

function roomsList() {
  return [...rooms.values()].map((r) => r.info());
}

function broadcastRooms() {
  const msg = JSON.stringify({ t: 'rooms', rooms: roomsList() });
  for (const c of clients.values()) if (c.name && !c.room) c.sendRaw(msg);
}

function sendRooms(c) { c.send({ t: 'rooms', rooms: roomsList() }); }

function setName(c, name) {
  name = String(name || '').trim();
  if (!NAME_RE.test(name)) { c.error('bad_name', 'Ник: 2-20 символов (буквы/цифры/._-)'); return false; }
  const key = name.toLowerCase();
  const taken = byName.get(key);
  if (taken && taken !== c) { c.error('name_taken', 'Ник занят'); return false; }
  if (c.name) byName.delete(c.name.toLowerCase());
  c.name = name;
  byName.set(key, c);
  return true;
}

function joinRoom(c, roomId) {
  if (!c.name) { c.error('no_name', 'Сначала представься (hello)'); return; }
  let room = rooms.get(roomId)
    || [...rooms.values()].find((r) => r.name.toLowerCase() === String(roomId).toLowerCase());
  if (!room && String(roomId).toLowerCase() === 'hub_1') room = ensureDefaultRoom();
  if (!room) { c.error('no_room', 'Комната не найдена'); return; }
  if (room.size >= room.maxPlayers) { c.error('room_full', 'Комната заполнена'); return; }
  if (c.room === room) return;
  leaveRoom(c, true);
  const p = room.addPlayer(c);
  c.room = room;
  c.send({ t: 'roomJoined', room: room.fullInfo(), you: { id: c.id, team: p.team } });
  room.broadcast({ t: 'playerJoined', player: room.publicPlayer(p) }, c.id);
  broadcastRooms();
}

function leaveRoom(c, silent = false) {
  const room = c.room;
  if (!room) return;
  c.room = null;
  room.removePlayer(c.id);
  if (room.size === 0 && room.name !== 'HUB_1') rooms.delete(room.id);
  else if (room.size === 0 && room.state === 'playing') room.backToLobby();
  if (!silent) c.send({ t: 'roomLeft' });
  broadcastRooms();
}

function createRoom(c, name) {
  if (!c.name) { c.error('no_name', 'Сначала представься (hello)'); return; }
  const room = new Room(String(name || '').slice(0, 24) || `HUB_${rooms.size + 1}`, api);
  rooms.set(room.id, room);
  joinRoom(c, room.id);
}

// ---------- Чат ----------

function handleChat(c, msg) {
  if (!c.name) return;
  const text = String(msg.text || '').slice(0, CHAT_MAX_LEN).trim();
  if (!text) return;
  if (!c.chatAllowed()) { c.error('chat_rate', 'Слишком часто: максимум 4 сообщ/сек'); return; }
  const out = { t: 'chat', from: c.id, name: c.name, text, team: !!msg.team, ts: Date.now() };
  const room = c.room;
  if (room && msg.team && room.state === 'playing') {
    const p = room.players.get(c.id);
    if (p) room.broadcastTeam(p.team, out);
  } else if (room) {
    room.broadcast(out);
  } else {
    // Общий лобби-чат: всем, кто не в матче
    const raw = JSON.stringify(out);
    for (const o of clients.values()) {
      if (o.name && (!o.room || o.room.state !== 'playing')) o.sendRaw(raw);
    }
  }
}

// ---------- Друзья ----------

function findByName(name) {
  return byName.get(String(name || '').toLowerCase()) || null;
}

function friendsPayload(c) {
  const { friends: fl, requests } = friends.list(c.name);
  return {
    t: 'friends',
    list: fl.map((n) => ({ name: n, online: !!findByName(n) })),
    requests,
  };
}

function handleFriend(c, msg) {
  if (!c.name) { c.error('no_name', 'Сначала представься (hello)'); return; }
  const target = String(msg.name || '').trim().slice(0, 20);
  switch (msg.t) {
    case 'friends':
      c.send(friendsPayload(c));
      break;
    case 'friendAdd': {
      if (!target) return;
      const res = friends.add(c.name, target);
      if (res === 'self') { c.error('friend_self', 'Нельзя добавить себя'); return; }
      if (res === 'already') { c.error('friend_dup', 'Уже в друзьях или заявка отправлена'); return; }
      const online = findByName(target);
      if (res === 'auto-accepted') {
        c.send({ t: 'friendAccepted', name: target });
        c.send(friendsPayload(c));
        if (online) { online.send({ t: 'friendAccepted', name: c.name }); online.send(friendsPayload(online)); }
      } else {
        c.send({ t: 'friendRequested', name: target });
        if (online) { online.send({ t: 'friendRequest', from: c.name }); online.send(friendsPayload(online)); }
      }
      break;
    }
    case 'friendAccept': {
      if (!target) return;
      if (friends.accept(c.name, target)) {
        c.send({ t: 'friendAccepted', name: target });
        c.send(friendsPayload(c));
        const online = findByName(target);
        if (online) { online.send({ t: 'friendAccepted', name: c.name }); online.send(friendsPayload(online)); }
      } else {
        c.error('friend_no_req', 'Нет входящей заявки от этого игрока');
      }
      break;
    }
    case 'friendDecline': {
      if (friends.decline(c.name, target)) c.send(friendsPayload(c));
      break;
    }
    case 'friendRemove': {
      if (friends.remove(c.name, target)) {
        c.send(friendsPayload(c));
        const online = findByName(target);
        if (online) online.send(friendsPayload(online));
      }
      break;
    }
  }
}

// ---------- Диспетчер протокола ----------

function dispatch(c, msg) {
  if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return;
  const room = c.room;
  const p = room ? room.players.get(c.id) : null;

  switch (msg.t) {
    // --- Системные ---
    case 'ping':
      c.send({ t: 'pong', ts: msg.ts });
      return;
    case 'hello': {
      if (!setName(c, msg.name)) return;
      c.send({ t: 'welcome', id: c.id, name: c.name, serverTime: Date.now(), maxPlayers: MAX_PLAYERS });
      c.send(friendsPayload(c));
      sendRooms(c);
      return;
    }
    // --- Лобби ---
    case 'join': // совместимость с заглушкой этапа 1: {t:'join', room, name}
      if (!c.name && !setName(c, msg.name)) return;
      if (!c._welcomed) { c._welcomed = 1; c.send({ t: 'welcome', id: c.id, name: c.name, serverTime: Date.now() }); }
      joinRoom(c, msg.room || 'hub_1');
      return;
    case 'rooms': sendRooms(c); return;
    case 'createRoom': createRoom(c, msg.name); return;
    case 'joinRoom': joinRoom(c, msg.roomId || msg.room); return;
    case 'leaveRoom': leaveRoom(c); return;
    case 'ready': if (room) room.setReady(c.id, msg.ready !== false); return;
    case 'start':
      if (room && room.state === 'lobby') {
        if (room.size >= 1 && [...room.players.values()].every((q) => q.ready)) room.start();
        else c.error('not_ready', 'Не все игроки готовы');
      }
      return;
    // --- Матч ---
    case 'input': if (p) room.onInput(p, msg); return;
    case 'shot': if (p) room.onShot(p, msg); return;
    case 'hit': if (p) room.onHit(p, msg); return;
    case 'chunk': room?.onChunk(p, msg); return;
    case 'cash': if (p) room.onCash(p, msg); return;
    // --- SOUND WAR (аддитивно): trackId команды + дропы для клэш-синка ---
    // Ретрансляция всей комнате (кроме отправителя); старые клиенты игнорируют.
    case 'soundwar':
      if (p) {
        room.broadcast({
          t: 'soundwar', id: c.id, team: p.team,
          trackId: typeof msg.trackId === 'string' ? msg.trackId.slice(0, 128) : undefined,
          clashDrop: !!msg.clashDrop,
        }, c.id);
      }
      return;
    // --- Голос ---
    case 'voice-join': if (p) room.setVoice(p, true); return;
    case 'voice-leave': if (p) room.setVoice(p, false); return;
    case 'voice-signal': if (p) room.onVoiceSignal(p, msg); return;
    // --- Чат ---
    case 'chat': handleChat(c, msg); return;
    // --- Рейтинг: запрос топа + моей позиции ---
    case 'rating':
      c.send({ t: 'rating', top: ratings.top(10), me: c.name ? ratings.get(c.name) : null });
      return;
    // --- Друзья ---
    case 'friends':
    case 'friendAdd':
    case 'friendAccept':
    case 'friendDecline':
    case 'friendRemove':
      handleFriend(c, msg);
      return;
    default:
      // Неизвестные типы игнорируем (forward-compat)
      return;
  }
}

// ---------- WebSocket сервер ----------

// Если порт занят (второй экземпляр уже запущен) — НЕ падаем, а берём
// следующий свободный (7777..7782). Статика и соло-игра работают в любом случае.
let wss = null;
let wsPort = PORT;
// Подключить готовый WebSocketServer к игровой логике (общий код).
function wireUp(candidate) {
  candidate.on('connection', onWsConnection);
  wss = candidate; // heartbeat/shutdown работают с последним (актуальным) инстансом
}

function startWs(port, triesLeft = 6) {
  wsPort = port;
  const candidate = new WebSocketServer({ port, maxPayload: MAX_MSG_SIZE });
  candidate.on('error', (e) => {
    if (e.code === 'EADDRINUSE' && triesLeft > 0) {
      console.log(`[gen.swags] порт :${port} занят — пробую :${port + 1}...`);
      try { candidate.close(); } catch { /* noop */ }
      startWs(port + 1, triesLeft - 1);
    } else if (e.code === 'EADDRINUSE') {
      console.log(`[gen.swags] ВНИМАНИЕ: порты WS ${PORT}–${port} заняты.`);
      console.log('[gen.swags] MP-лобби недоступно (уже запущен другой экземпляр?),');
      console.log('[gen.swags] но статика и соло-игра работают.');
    } else {
      console.error('[gen.swags] WS-ошибка:', e.message);
    }
  });
  candidate.on('listening', () => {
    console.log(`[gen.swags] WS-сервер слушает :${port} (тик 20 Гц, комнат: ${rooms.size})`);
  });
  wireUp(candidate);
}

// attachServer(wss, httpServer): поднять MP на ВНЕШНЕМ http-сервере
// (тот же порт, upgrade-запросы). Используется Railway-входом start.railway.js —
// один процесс/порт отдаёт и статику, и WebSocket.
export function attachServer(wss, httpServer) {
  httpServer.on('upgrade', (req, socket, head) => {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });
  wireUp(wss);
  console.log(`[gen.swags] MP WebSocket подключён к http-серверу (общий порт, тик 20 Гц)`);
  return wss;
}

// Автозапуск standalone-WS только при ПРЯМОМ запуске (node server/server.js
// или через server/start.js). При импорте (start.railway.js) — не стартуем.
if (!process.env.GENSWAGS_NO_AUTOSTART) startWs(PORT);

function onWsConnection(ws, req) {
  const c = new Client(ws);
  clients.set(c.id, c);
  ws.isAlive = true;

  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (data) => {
    if (c.floodCheck()) {
      c.error('flood', 'Анти-флуд: соединение закрыто');
      try { ws.close(1008, 'flood'); } catch { /* noop */ }
      return;
    }
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }
    try { dispatch(c, msg); } catch (e) { console.error(`[dispatch] ${msg?.t}:`, e); }
  });

  ws.on('close', () => {
    leaveRoom(c, true);
    if (c.name) byName.delete(c.name.toLowerCase());
    clients.delete(c.id);
  });

  ws.on('error', () => { /* close обработает */ });

  console.log(`[+] ${c.id} подключился (${req.socket.remoteAddress}), всего: ${clients.size}`);
}

// Heartbeat: чистка мёртвых соединений
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch { /* noop */ }
  }
}, HEARTBEAT_MS);

// Периодическое обновление списка комнат для лобби
const roomsTicker = setInterval(broadcastRooms, 5000);

// ---------- Graceful shutdown ----------
function shutdown(sig) {
  console.log(`\n[${sig}] завершение: сохраняю друзей, закрываю соединения...`);
  clearInterval(heartbeat);
  clearInterval(roomsTicker);
  friends.save();
  ratings.save();
  for (const c of clients.values()) {
    c.send({ t: 'serverShutdown' });
    try { c.ws.close(1001, 'shutdown'); } catch { /* noop */ }
  }
  wss.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
