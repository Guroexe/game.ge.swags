// ===== GEN.SWAGS E2E Test =====
// Поднимает сервер на тестовом порту, гоняет 5 WS-клиентов через:
// лобби → комната → готовность/старт → движение → чат (комнатный/командный/лимит)
// → выстрел/попадание/смерть/респавн → чанк → кеш (pickup/deposit/cashout)
// → друзья (add/accept/online) → voice signaling (offer/answer/ice, team-only).
// Запуск: node test-client.js  (или npm test)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 7788;
const URL = `ws://127.0.0.1:${PORT}`;
const FRIENDS_FILE = path.join(__dirname, 'data', 'friends.json');
const RATINGS_FILE = path.join(__dirname, 'data', 'ratings.json');

const results = [];
function report(name, ok, extra = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- Тестовый клиент ----------
class TClient {
  constructor(label) {
    this.label = label;
    this.id = null;
    this.msgs = [];       // все входящие
    this.waiters = [];    // {pred, resolve, timer}
    this.lastSnapshot = null;
  }
  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(URL);
      this.ws.on('open', resolve);
      this.ws.on('error', reject);
      this.ws.on('message', (data) => {
        let msg;
        try { msg = JSON.parse(data.toString()); } catch { return; }
        if (msg.t === 'welcome') this.id = msg.id;
        if (msg.t === 'players') this.lastSnapshot = msg;
        this.msgs.push(msg);
        this.waiters = this.waiters.filter((w) => {
          if (w.pred(msg)) { clearTimeout(w.timer); w.resolve(msg); return false; }
          return true;
        });
      });
    });
  }
  send(obj) { this.ws.send(JSON.stringify(obj)); }
  // Ждать сообщение по предикату
  waitFor(pred, timeout = 3000, what = 'msg') {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout: ${what}`)), timeout);
      this.waiters.push({ pred, resolve, timer });
    });
  }
  // Убедиться, что сообщение НЕ приходит за окно времени
  async ensureSilent(pred, windowMs = 400) {
    const before = this.msgs.length;
    await sleep(windowMs);
    return !this.msgs.slice(before).some(pred);
  }
  snapPos(id) {
    const s = this.lastSnapshot?.list?.find((p) => p.id === id);
    return s ? s.pos : null;
  }
  close() { try { this.ws.close(); } catch {} }
}

// ---------- Запуск сервера ----------
async function startServer() {
  try { fs.rmSync(FRIENDS_FILE); } catch {}
  try { fs.rmSync(RATINGS_FILE); } catch {}
  const child = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr.on('data', (d) => process.stderr.write(`[server:err] ${d}`));
  await new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error('server start timeout')), 5000);
    child.stdout.on('data', (d) => {
      process.stdout.write(`[server] ${d}`);
      if (d.toString().includes('слушает')) { clearTimeout(to); resolve(); }
    });
    child.on('exit', (code) => { clearTimeout(to); reject(new Error(`server exited: ${code}`)); });
  });
  return child;
}

// ---------- Тесты ----------
async function main() {
  const server = await startServer();
  try {
    // 1. Подключение и регистрация ников
    const [A, B, C, D, E] = [new TClient('A'), new TClient('B'), new TClient('C'), new TClient('D'), new TClient('E')];
    for (const c of [A, B, C, D, E]) await c.connect();
    for (const [c, name] of [[A, 'AAA'], [B, 'BBB'], [C, 'CCC'], [D, 'DDD'], [E, 'EEE']]) {
      const w = c.waitFor((m) => m.t === 'welcome', 2000, 'welcome');
      c.send({ t: 'hello', name });
      await w;
    }
    report('hello/welcome ×5', [A, B, C, D, E].every((c) => c.id));

    // 2. Список комнат (E в лобби)
    {
      const w = E.waitFor((m) => m.t === 'rooms' && m.rooms.some((r) => r.name === 'HUB_1'), 2000, 'rooms');
      E.send({ t: 'rooms' });
      await w;
      report('список комнат содержит HUB_1', true);
    }

    // 3. Вход в комнату, автораспределение по командам
    const teams = {};
    for (const c of [A, B, C, D]) {
      const w = c.waitFor((m) => m.t === 'roomJoined', 2000, 'roomJoined');
      c.send({ t: 'joinRoom', roomId: 'hub_1' });
      const msg = await w;
      teams[c.label] = msg.you.team;
    }
    report('вход в HUB_1 ×4', Object.keys(teams).length === 4);
    const teamsOk = teams.A === teams.D && new Set([teams.A, teams.B, teams.C]).size === 3;
    report('автораспределение 3×N (A и D в одной команде)', teamsOk, JSON.stringify(teams));
    report('playerJoined ретранслируется', A.msgs.some((m) => m.t === 'playerJoined'));

    // 4. Лобби-чат (E вне комнаты, A в комнате-лобби)
    {
      const wA = A.waitFor((m) => m.t === 'chat' && m.text === 'hi lobby', 2000, 'lobby chat A');
      const wB = B.waitFor((m) => m.t === 'chat' && m.text === 'hi lobby', 2000, 'lobby chat B');
      E.send({ t: 'chat', text: 'hi lobby' });
      await Promise.all([wA, wB]);
      report('лобби-чат до матча', true);
    }

    // 5. Друзья: add → request → accept → online-статус
    {
      const reqB = B.waitFor((m) => m.t === 'friendRequest' && m.from === 'AAA', 2000, 'friendRequest');
      A.send({ t: 'friendAdd', name: 'BBB' });
      await reqB;
      const accA = A.waitFor((m) => m.t === 'friendAccepted' && m.name === 'BBB', 2000, 'friendAccepted A');
      const accB = B.waitFor((m) => m.t === 'friendAccepted' && m.name === 'AAA', 2000, 'friendAccepted B');
      B.send({ t: 'friendAccept', name: 'AAA' });
      await Promise.all([accA, accB]);
      const listW = A.waitFor((m) => m.t === 'friends' && m.list.some((f) => f.name === 'BBB'), 2000, 'friends list');
      A.send({ t: 'friends' });
      const list = await listW;
      report('друзья: add+accept+онлайн', list.list.find((f) => f.name === 'BBB')?.online === true);
    }

    // 6. Готовность → автостарт
    {
      const starts = [A, B, C, D].map((c) => c.waitFor((m) => m.t === 'start', 3000, 'start'));
      for (const c of [A, B, C]) c.send({ t: 'ready', ready: true });
      await sleep(100);
      D.send({ t: 'ready', ready: true }); // последний — триггер автостарта
      await Promise.all(starts);
      report('готовность → автостарт матча', true);
    }

    // 7. Voice signaling: mesh только внутри команды
    {
      const peersA = A.waitFor((m) => m.t === 'voice-peers' && m.peers.includes(D.id), 2000, 'peers A');
      const peersD = D.waitFor((m) => m.t === 'voice-peers' && m.peers.includes(A.id), 2000, 'peers D');
      A.send({ t: 'voice-join' });
      B.send({ t: 'voice-join' });
      D.send({ t: 'voice-join' });
      await Promise.all([peersA, peersD]);
      report('voice-peers: A↔D видят друг друга', true);

      const offerD = D.waitFor((m) => m.t === 'voice-signal' && m.from === A.id && m.data.type === 'offer', 2000, 'offer');
      A.send({ t: 'voice-signal', to: D.id, data: { type: 'offer', sdp: 'v=0 fake-sdp' } });
      await offerD;
      const ansA = A.waitFor((m) => m.t === 'voice-signal' && m.from === D.id && m.data.type === 'answer', 2000, 'answer');
      D.send({ t: 'voice-signal', to: A.id, data: { type: 'answer', sdp: 'v=0 fake-answer' } });
      await ansA;
      const iceD = D.waitFor((m) => m.t === 'voice-signal' && m.from === A.id && m.data.type === 'ice', 2000, 'ice');
      A.send({ t: 'voice-signal', to: D.id, data: { type: 'ice', candidate: { candidate: 'candidate:fake', sdpMid: '0' } } });
      await iceD;
      report('voice offer/answer/ice ретрансляция', true);

      // Между командами — запрещено
      A.send({ t: 'voice-signal', to: B.id, data: { type: 'offer', sdp: 'x' } });
      const silent = await B.ensureSilent((m) => m.t === 'voice-signal', 400);
      report('voice-сигнал чужой команде блокируется', silent);
    }

    // 8. Движение: input → снапшот 20 Гц
    {
      const w = B.waitFor((m) => m.t === 'players' && m.list.some((p) => p.id === A.id), 2000, 'players');
      A.send({ t: 'input', pos: [1, 0.1, 20], yaw: 1.0, pitch: 0, seq: 1 });
      await w;
      await sleep(500); // lerp сервера
      const pos = B.snapPos(A.id);
      const ok = pos && Math.hypot(pos[0] - 1, pos[1] - 0.1, pos[2] - 20) < 2;
      report('input → снапшот players (позиция A у B)', !!ok, pos ? pos.map((v) => v.toFixed(1)).join(',') : 'нет');
    }

    // 9. Чат в матче: комнатный + командный + rate limit
    {
      const wB = B.waitFor((m) => m.t === 'chat' && m.text === 'room msg', 2000, 'room chat');
      A.send({ t: 'chat', text: 'room msg' });
      await wB;
      report('комнатный чат в матче', true);

      const wD = D.waitFor((m) => m.t === 'chat' && m.text === 'team msg' && m.team, 2000, 'team chat');
      A.send({ t: 'chat', text: 'team msg', team: true });
      await wD;
      const bSilent = await B.ensureSilent((m) => m.t === 'chat' && m.text === 'team msg', 400);
      report('командный чат: сокомандник получил, чужой — нет', bSilent);

      const rateW = C.waitFor((m) => m.t === 'error' && m.code === 'chat_rate', 2000, 'chat_rate');
      for (let i = 0; i < 6; i++) C.send({ t: 'chat', text: `spam ${i}` });
      await rateW;
      report('chat rate limit 4/сек', true);
    }

    // 10. Выстрел → ретрансляция
    {
      const wB = B.waitFor((m) => m.t === 'shot' && m.id === A.id, 2000, 'shot');
      A.send({ t: 'shot', origin: [1, 1.5, 20], dir: [0, 0, -1], weapon: 'rifle' });
      await wB;
      report('shot ретранслируется', true);
    }

    // 11. Попадание (валидация по дистанции) → смерть → респавн
    {
      const aPos = A.snapPos(A.id), bPos = A.snapPos(B.id);
      const dist = Math.hypot(aPos[0] - bPos[0], aPos[1] - bPos[1], aPos[2] - bPos[2]);
      const hitW = C.waitFor((m) => m.t === 'hit' && m.target === B.id && m.hp === 60, 2000, 'hit');
      A.send({ t: 'hit', target: B.id, dmg: 40, part: 'body', dist });
      await hitW;
      report('hit валидируется и применяется (hp 60)', true);

      const deathW = C.waitFor((m) => m.t === 'death' && m.id === B.id && m.by === A.id, 2000, 'death');
      A.send({ t: 'hit', target: B.id, dmg: 100, part: 'head', dist });
      await deathW;
      report('смерть: death broadcast', true);
      const respawnW = B.waitFor((m) => m.t === 'respawn' && m.id === B.id && m.hp === 100, 5000, 'respawn');
      await respawnW;
      report('респавн через ~3с с полным HP', true);

      // Невалидный hit: слишком далеко (C на своём спавне, dist врёт)
      const before = A.msgs.filter((m) => m.t === 'hit').length;
      A.send({ t: 'hit', target: C.id, dmg: 10, part: 'body', dist: 9999 });
      const rejected = (await A.ensureSilent((m) => m.t === 'hit' && m.target === C.id, 400))
        && A.msgs.filter((m) => m.t === 'hit').length === before;
      report('невалидный hit (врёт дистанция) отклоняется', rejected);
    }

    // 12. Чанк: идемпотентный broadcast
    {
      const w1 = C.waitFor((m) => m.t === 'chunk' && m.chunkId === 'wall1:0', 2000, 'chunk');
      A.send({ t: 'chunk', chunkId: 'wall1:0' });
      await w1;
      D.send({ t: 'chunk', chunkId: 'wall1:0' }); // повтор — должен быть проигнорирован
      const noDup = await C.ensureSilent((m) => m.t === 'chunk' && m.chunkId === 'wall1:0' && m.by === D.id, 400);
      report('chunkDestroyed ретранслируется идемпотентно', noDup);
    }

    // 13. Кеш-режим: pickup → deposit → cashout
    {
      A.send({ t: 'input', pos: [0, 0.1, -2], yaw: 0, pitch: 0, seq: 2 }); // к кешбоксу
      await sleep(600);
      const pickW = C.waitFor((m) => m.t === 'cash' && m.event === 'pickup' && m.cashbox.holder === A.id, 2000, 'pickup');
      A.send({ t: 'cash', action: 'pickup' });
      await pickW;
      report('кешбокс: pickup', true);

      A.send({ t: 'input', pos: [-24, 0.1, -18], yaw: 0, pitch: 0, seq: 3 }); // к станции A
      await sleep(600);
      const depW = C.waitFor((m) => m.t === 'cash' && m.event === 'depositStart' && m.station === 'A', 2000, 'depositStart');
      A.send({ t: 'cash', action: 'deposit', station: 'A' });
      await depW;
      report('кешаут: depositStart на станции A', true);

      const cashoutW = C.waitFor((m) => m.t === 'cash' && m.event === 'cashout', 8000, 'cashout');
      const co = await cashoutW;
      report('кешаут завершён, счёт команды +1', co.scores[teams.A] === 1, `scores=${JSON.stringify(co.scores)}`);

      // 13b. Рейтинг: кешаут меняет ELO игроков (победителям +16, остальным −8)
      const ratingW = C.waitFor((m) => m.t === 'rating' && m.ratings, 3000, 'rating-broadcast');
      const rm = await ratingW;
      const nameOf = (c) => ({ [A.id]: 'AAA', [B.id]: 'BBB', [C.id]: 'CCC', [D.id]: 'DDD', [E.id]: 'EEE' })[c.id];
      const winners = [A, B, C, D].filter((c) => teams[c.label] === teams.A).map(nameOf);
      const losers = [A, B, C, D].filter((c) => teams[c.label] !== teams.A).map(nameOf);
      const winnersOk = winners.every((n) => rm.ratings[n]?.delta === 16 && rm.ratings[n]?.rating === 1016);
      const losersOk = losers.every((n) => rm.ratings[n]?.delta === -8 && rm.ratings[n]?.rating === 992);
      report('кешаут → рейтинг: победителям +16 (1016), остальным −8 (992)', winnersOk && losersOk,
        JSON.stringify(Object.fromEntries(Object.entries(rm.ratings).map(([k, v]) => [k, v.delta]))));

      // 13c. Запрос топа рейтинга: {t:'rating'} → топ + моя позиция
      const topW = A.waitFor((m) => m.t === 'rating' && m.top, 3000, 'rating-top');
      A.send({ t: 'rating' });
      const top = await topW;
      report('рейтинг: топ содержит игроков, me заполнен',
        top.top.some((p) => p.name === 'AAA') && top.me?.name === 'AAA' && top.me?.rating === 1016,
        `top1=${top.top[0]?.name}:${top.top[0]?.rating}`);
    }

    // 14. Ping/pong (app-level)
    {
      const w = A.waitFor((m) => m.t === 'pong', 2000, 'pong');
      A.send({ t: 'ping', ts: 123 });
      await w;
      report('ping/pong', true);
    }

    for (const c of [A, B, C, D, E]) c.close();
  } finally {
    server.kill('SIGTERM');
    await sleep(400);
  }

  // 15. Персист друзей на диске
  try {
    const json = JSON.parse(fs.readFileSync(FRIENDS_FILE, 'utf8'));
    report('друзья персистятся в data/friends.json',
      json.AAA?.friends?.includes('BBB') && json.BBB?.friends?.includes('AAA'));
  } catch (e) {
    report('друзья персистятся в data/friends.json', false, e.message);
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n===== ИТОГ: ${results.length - failed.length}/${results.length} PASS${failed.length ? `, FAILED: ${failed.map((f) => f.name).join('; ')}` : ''} =====`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error('FATAL:', e);
  report('завершение без исключений', false, e.message);
  process.exit(1);
});
