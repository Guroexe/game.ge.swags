// ===== GEN.SWAGS — интеграционный тест мультиплеера =====
// Два+ NetClient'а (боевой js/engine/net.js) против реального server на
// тестовом порту: комната → готовность/старт → input-снапшоты → чат
// (общий/командный) → hit → chunk (идемпотентно) → cash (pickup/deposit/
// cashout) → voice signaling (team-only). Запуск: node test/mp-integration.test.mjs
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// net.js использует глобальный WebSocket — подставляем реализацию из server/node_modules
const require = createRequire(path.join(__dirname, '..', 'server', 'package.json'));
const WS = require('ws');
globalThis.WebSocket = WS.WebSocket || WS;

const { NetClient } = await import('../js/engine/net.js');

const PORT = 7799;
const URL = `ws://127.0.0.1:${PORT}`;
let passed = 0, failed = 0;
const ok = (cond, name, extra = '') => {
  if (cond) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.error(`FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function waitEvent(net, event, timeout = 5000, pred = null) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { net.off(event, cb); reject(new Error(`timeout: ${event}`)); }, timeout);
    const cb = (m) => {
      if (!pred || pred(m)) { clearTimeout(timer); net.off(event, cb); resolve(m); }
    };
    net.on(event, cb);
  });
}

// ---------- Поднимаем сервер ----------
const srv = spawn(process.execPath, ['server.js'], {
  cwd: path.join(__dirname, '..', 'server'),
  env: { ...process.env, PORT: String(PORT) },
  stdio: 'pipe',
});
await new Promise((res, rej) => {
  const to = setTimeout(() => rej(new Error('server start timeout')), 6000);
  srv.stdout.on('data', (d) => { if (String(d).includes('слушает')) { clearTimeout(to); res(); } });
  srv.on('exit', () => rej(new Error('server exited early')));
});

const clients = [];
try {
  // 4 клиента: A,B,C — автораспределение в команды 0/1/2, D — в команду 0 (с A)
  const [A, B, C, D] = ['ALICE', 'BOB', 'CARL', 'DAVE'].map((n) => {
    const c = new NetClient();
    clients.push(c);
    return c;
  });

  // ---------- Подключение и комната ----------
  ok(await A.connect(URL, { room: null, name: 'ALICE' }) === true, 'A подключился к серверу');
  ok(await B.connect(URL, { room: null, name: 'BOB' }) === true, 'B подключился к серверу');
  const joinedA = waitEvent(A, 'roomJoined');
  A.createRoom('MPTEST');
  const rj = await joinedA;
  ok(!!rj.room?.id, 'A создал комнату и вошёл', rj.room?.id);
  A.listRooms();
  const roomsMsg = await waitEvent(A, 'rooms');
  ok(roomsMsg.rooms.some((r) => r.name === 'MPTEST'), 'комната видна в списке rooms');

  const joinB = waitEvent(B, 'roomJoined');
  B.joinRoom(rj.room.id);
  await joinB;
  ok(B.room === rj.room.id, 'B вошёл в комнату по id');
  ok((await C.connect(URL, { room: null, name: 'CARL' })) && (await D.connect(URL, { room: null, name: 'DAVE' })), 'C и D подключились');
  C.joinRoom(rj.room.id);
  const aSeesD = waitEvent(A, 'playerJoined', 3000, (m) => m.player?.id === D.playerId);
  D.joinRoom(rj.room.id);
  await waitEvent(D, 'roomJoined');
  await aSeesD;
  ok(A.remote.size === 3, `A видит 3 других игроков в лобби (${A.remote.size})`);

  // ---------- Готовность → старт ----------
  const startA = waitEvent(A, 'start');
  const startD = waitEvent(D, 'start');
  A.setReady(true);
  B.setReady(true);
  C.setReady(true);
  D.setReady(true);
  const st = await startA;
  await startD;
  ok(st.players.length === 4, 'матч стартовал: 4 игрока');
  const teamOf = (id) => st.players.find((p) => p.id === id)?.team;
  ok(teamOf(A.playerId) === teamOf(D.playerId) && teamOf(A.playerId) !== teamOf(B.playerId),
    'команды: A и D вместе, B против');

  // ---------- Input-снапшоты → интерполяция ----------
  let aPos = [5, 0.1, 5];
  A.startInputLoop(() => ({ pos: aPos, yaw: 1.0, pitch: 0 }));
  B.startInputLoop(() => ({ pos: [6, 0.1, 5], yaw: -1.0, pitch: 0 }));
  D.startInputLoop(() => ({ pos: [0, 0.1, -2], yaw: 0, pitch: 0 }));
  await sleep(900);
  const snapB = B.samplePlayers().find((p) => p.id === A.playerId);
  ok(!!snapB, 'B получает снапшоты игрока A');
  ok(snapB && Math.hypot(snapB.pos[0] - 5, snapB.pos[2] - 5) < 1.0,
    'интерполированная позиция A на B ≈ [5,·,5]', snapB && snapB.pos.map((v) => v.toFixed(2)).join(','));

  // ---------- Чат: общий и командный ----------
  const chatP = waitEvent(B, 'chat', 3000, (m) => m.text === 'всем привет');
  A.sendChat('всем привет');
  const cm = await chatP;
  ok(cm.name === 'ALICE', 'общий чат дошёл до B');
  let bGotTeam = false;
  B.on('chat', (m) => { if (m.text === 'секрет') bGotTeam = true; });
  const teamChatP = waitEvent(D, 'chat', 3000, (m) => m.text === 'секрет');
  A.sendChat('секрет', true);
  const tm = await teamChatP;
  ok(tm.team === true, 'командный чат дошёл до сокомандника D');
  await sleep(500);
  ok(!bGotTeam, 'командный чат НЕ дошёл до чужой команды (B)');

  // ---------- Hit (сервер авторитетен) ----------
  await sleep(400); // серверный lerp позиций (A≈[5], B≈[6], дистанция ~1)
  const hitP = waitEvent(A, 'hit', 3000, (m) => m.target === B.playerId);
  A.sendHit(B.playerId, 40, 'body');
  const hm = await hitP;
  ok(hm.hp === 60, `hit применён сервером (hp=${hm.hp})`);

  // ---------- Chunk: идемпотентная ретрансляция ----------
  let bChunks = 0;
  B.on('chunk', () => bChunks++);
  const chunkP = waitEvent(B, 'chunk', 3000, (m) => m.chunkId === 'w0_3');
  A.sendChunk('w0_3');
  await chunkP;
  A.sendChunk('w0_3'); // дубликат — сервер должен проигнорировать
  await sleep(500);
  ok(bChunks === 1, `chunk ретранслирован ровно один раз (${bChunks})`);

  // ---------- Cash: pickup → deposit → cashout ----------
  aPos = [0, 0.4, -2]; // A идёт к кешбоксу
  await sleep(600);
  const pickupP = waitEvent(B, 'cash', 3000, (m) => m.event === 'pickup');
  A.sendCash('pickup');
  const pm = await pickupP;
  ok(pm.cashbox.holder === A.playerId, 'кешбокс подобран (сервер подтвердил)');
  aPos = [-24, 0.1, -18]; // A идёт на станцию A
  await sleep(800);
  const depP = waitEvent(B, 'cash', 3000, (m) => m.event === 'depositStart');
  A.sendCash('deposit', 'A');
  const dm = await depP;
  ok(dm.station === 'A', 'загрузка на станции A началась');
  const cashoutP = waitEvent(B, 'cash', 8000, (m) => m.event === 'cashout');
  const co = await cashoutP;
  ok(co.team === teamOf(A.playerId) && co.scores[teamOf(A.playerId)] === 1,
    `кешаут завершён, счёт ${co.scores}`);

  // ---------- Voice signaling (team-only) ----------
  const peersA = waitEvent(A, 'voice-peers', 3000, (m) => m.peers.includes(D.playerId));
  const peersD = waitEvent(D, 'voice-peers', 3000, (m) => m.peers.includes(A.playerId));
  A.send({ t: 'voice-join' });
  D.send({ t: 'voice-join' });
  await peersA;
  await peersD;
  ok(true, 'voice-peers: A и D видят друг друга');
  const sigP = waitEvent(D, 'voice-signal', 3000, (m) => m.from === A.playerId);
  A.send({ t: 'voice-signal', to: D.playerId, data: { type: 'offer', sdp: 'test-sdp' } });
  const sig = await sigP;
  ok(sig.data?.sdp === 'test-sdp', 'voice-signal ретранслирован внутри команды');
  let bGotSignal = false;
  B.on('voice-signal', () => { bGotSignal = true; });
  A.send({ t: 'voice-signal', to: B.playerId, data: { type: 'offer', sdp: 'x' } });
  await sleep(500);
  ok(!bGotSignal, 'voice-signal в чужую команду отклонён');

  // ---------- Смерть/респавн через сервер ----------
  const deathP = waitEvent(A, 'death', 3000, (m) => m.id === B.playerId);
  A.sendHit(B.playerId, 200, 'head');
  await deathP;
  ok(true, 'смерть B по событию сервера');
  const respP = waitEvent(A, 'respawn', 5000, (m) => m.id === B.playerId);
  await respP;
  ok(true, 'респавн B через ~3с');
} catch (e) {
  failed++;
  console.error(`FAIL  исключение: ${e.message}`);
} finally {
  for (const c of clients) { try { c.disconnect(); } catch {} }
  srv.kill('SIGTERM');
  await sleep(300);
}

console.log(`\n===== ИТОГ: ${passed} passed, ${failed} failed =====`);
process.exit(failed ? 1 : 0);
