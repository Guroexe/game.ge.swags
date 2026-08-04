// ===== GEN.SWAGS — интеграционный тест этапа 2 (Node, без DOM) =====
// 1) A* по waypoint-гриду находит путь.
// 2) FSM бота: SEEK_BOX → CARRY → (канал 6с) → DEFEND, депозит 20с → +1000$.
// 3) Кеш-цикл завершается, новый бокс через 10с.
// 4) FLOW растёт от килла на бите (×2), DROP ×2 урон, гравитация -30%.
// 5) Бот получает урон, умирает, респавнится через 5с.
// Запуск: node test/stage2.test.mjs
import * as THREE from 'three';
import { findPath, BotManager, BotState } from '../js/game/bots.js';
import { CashoutMode, CashState } from '../js/game/mode_cashout.js';
import { FlowSystem } from '../js/game/flow.js';

let passed = 0, failed = 0;
function ok(cond, name) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}`); }
}

// ---------- Моки ----------
function makeWaypoints() {
  // Линейный грид: (-12..12, z=0), шаг 4
  const nodes = [];
  for (let x = -12; x <= 12; x += 4) nodes.push({ x, y: 0.1, z: 0, walkable: true, neighbors: [] });
  for (let i = 0; i < nodes.length - 1; i++) {
    nodes[i].neighbors.push(i + 1);
    nodes[i + 1].neighbors.push(i);
  }
  return {
    nodes, step: 4,
    nearest(pos) {
      let best = -1, bd = Infinity;
      for (let i = 0; i < nodes.length; i++) {
        const d = (nodes[i].x - pos.x) ** 2 + (nodes[i].z - pos.z) ** 2;
        if (d < bd) { bd = d; best = i; }
      }
      return best;
    },
  };
}

function makeArena() {
  return {
    spawns: [
      { team: 0, pos: new THREE.Vector3(0, 0.1, 24), yaw: Math.PI },
      { team: 1, pos: new THREE.Vector3(-12, 0.1, 0), yaw: Math.PI / 2 },
      { team: 2, pos: new THREE.Vector3(12, 0.1, 0), yaw: -Math.PI / 2 },
    ],
    cashboxSpawn: new THREE.Vector3(0, 0.4, 0),
    cashbox: null, // headless
    cashoutStations: [
      { letter: 'A', pos: new THREE.Vector3(12, 0, 0) },
      { letter: 'B', pos: new THREE.Vector3(-12, 0, 0) },
    ],
    waypoints: makeWaypoints(),
    centerWalls: [],
  };
}

const physicsMock = { raycast: () => null }; // нет стен — LOS всегда чист

function makePlayer() {
  return {
    body: { pos: new THREE.Vector3(0, 0.1, 24), vel: new THREE.Vector3() },
    hp: 100, maxHp: 100, alive: true,
    spawn(pos, yaw) { this.body.pos.copy(pos); this.hp = 100; this.alive = true; },
    damage(d) { this.hp -= d; if (this.hp <= 0) this.alive = false; },
    speedMul: 1, sprintLock: false,
  };
}

// ============================================================
console.log('\n[1] A* pathfinding');
{
  const wp = makeWaypoints();
  const path = findPath(wp, 0, 6);
  ok(Array.isArray(path) && path[0] === 0 && path[path.length - 1] === 6, 'путь 0→6 найден');
  ok(path.length === 7, `длина пути оптимальна (${path.length} === 7)`);
  ok(findPath(wp, 3, 3).length === 1, 'путь в себя = [self]');
  ok(findPath(wp, -1, 3) === null, 'невалидный старт → null');
}

// ============================================================
console.log('\n[2-3] FSM бота + полный кеш-цикл');
{
  const arena = makeArena();
  const player = makePlayer();
  const events = [];
  const mode = new CashoutMode({ arena, headless: true });
  mode.bind({ getPlayer: () => player, emit: (t, d) => events.push({ t, d }) });

  const mgr = new BotManager({ physics: physicsMock, arena, headless: true });
  mgr.bindPlayer(player, 0);
  mgr.setMode(mode);
  // Один бот команды BRAVO (1)
  const bot = mgr._makeBot({ team: 1, name: 'TESTBOT' });
  mgr.bots = [bot];

  mode.startMatch();

  const dt = 1 / 30;
  const seenStates = new Set();
  let deposited = false;
  let simT = 0;

  // Фаза 1: SEEK_BOX — бот бежит к боксу в центре (спавн на -12)
  for (let i = 0; i < 30 * 20 && simT < 60; i++) {
    simT += dt;
    mgr.update(dt, player);
    mode.update(dt);
    seenStates.add(bot.state);
    if (mode.state === CashState.DEPOSIT) { deposited = true; break; }
  }

  ok(seenStates.has(BotState.SEEK_BOX), 'бот прошёл SEEK_BOX');
  ok(seenStates.has(BotState.CARRY), 'бот прошёл CARRY (подобрал и понёс)');
  ok(mode.state === CashState.DEPOSIT || deposited, 'дошёл до станции, канал 6с пройден → DEPOSIT');
  ok(events.some((e) => e.t === 'channel_start'), 'событие channel_start');
  ok(mode.scores[1] === 0, 'очки ещё не начислены во время депозита');
  ok(bot.state === BotState.DEFEND, `бот в DEFEND (есть: ${bot.state})`);

  // Фаза 2: 45с удержания → +1000$
  for (let i = 0; i < 30 * 50; i++) {
    mgr.update(dt, player);
    mode.update(dt);
    if (mode.state === CashState.COOLDOWN) break;
  }
  ok(mode.scores[1] === 1000, `+1000$ команде BRAVO (scores=${mode.scores})`);
  ok(mode.state === CashState.COOLDOWN, 'после депозита — COOLDOWN 10с');

  // Фаза 3: новый кешбокс через 10с
  for (let i = 0; i < 30 * 11; i++) {
    mgr.update(dt, player);
    mode.update(dt);
    if (mode.state === CashState.IDLE) break;
  }
  ok(mode.state === CashState.IDLE, 'новый кешбокс заспавнен (IDLE)');
  ok(mode.boxPos.distanceTo(arena.cashboxSpawn) < 0.01, 'бокс в центре арены');
}

// ============================================================
console.log('\n[4] FLOW: килл на бите ×2, DROP, гравитация');
{
  const flow = new FlowSystem({ scheduledDropEvery: Infinity });
  // Без бита: +10
  flow.registerKill();
  ok(Math.abs(flow.value - 10) < 0.001, `килл без бита +10 (${flow.value})`);
  // На бите (±100мс): +20
  flow._lastBeatAt = flow._time;
  const mult = flow.registerKill();
  ok(mult === 2, 'мультипликатор килла на бите = 2');
  ok(Math.abs(flow.value - 30) < 0.001, `FLOW = 30 после двух киллов (${flow.value})`);
  // Бонусы
  const dmgNoDrop = flow.damageMul;
  ok(Math.abs(dmgNoDrop - (1 + 0.2 * 0.3)) < 0.001, `damageMul без дропа = ${dmgNoDrop.toFixed(3)}`);
  ok(flow.speedMul > 1 && flow.speedMul <= 1.1, `speedMul = ${flow.speedMul.toFixed(3)}`);
  // DROP
  let dropStarted = false, dropEnded = false;
  flow.onDropStart = () => { dropStarted = true; };
  flow.onDropEnd = () => { dropEnded = true; };
  flow.triggerDrop(1.6);
  ok(flow.dropActive && dropStarted, 'DROP активирован');
  ok(Math.abs(flow.gravityMul - 0.7) < 0.001, 'гравитация -30% в дропе');
  ok(Math.abs(flow.damageMul - dmgNoDrop * 2) < 0.001, 'двойной урон в дропе');
  // 8 секунд → конец
  for (let i = 0; i < 60 * 9; i++) flow.update(1 / 60);
  ok(!flow.dropActive && dropEnded, 'DROP завершился через 8с');
  // Затухание FLOW
  const v0 = flow.value;
  for (let i = 0; i < 60; i++) flow.update(1 / 60);
  ok(flow.value < v0, 'FLOW тает со временем');
  // Расписание: авто-дроп
  const flow2 = new FlowSystem({ scheduledDropEvery: 5 });
  for (let i = 0; i < 60 * 6; i++) flow2.update(1 / 60);
  ok(flow2.dropActive || flow2._sinceDrop < 5, 'ручной триггер дропа по расписанию');
}

// ============================================================
console.log('\n[5] Урон боту, смерть, респавн 5с');
{
  const arena = makeArena();
  const mgr = new BotManager({ physics: physicsMock, arena, headless: true });
  const bot = mgr._makeBot({ team: 2, name: 'DUMMY' });
  mgr.bots = [bot];
  bot.pos.set(5, 0.1, 0);

  // hitTest по лучу
  const ray = new THREE.Ray(new THREE.Vector3(5, 1.0, 8), new THREE.Vector3(0, 0, -1));
  const hit = bot.hitTest(ray, 100);
  ok(hit && hit.target === bot && hit.part === 'body', 'hitTest: попадание в тело');
  const headRay = new THREE.Ray(new THREE.Vector3(5, 1.68, 8), new THREE.Vector3(0, 0, -1)); // голова cyber-girl: pos.y(0.1)+1.58
  ok(bot.hitTest(headRay, 100)?.part === 'head', 'hitTest: попадание в голову');
  const missRay = new THREE.Ray(new THREE.Vector3(50, 1, 8), new THREE.Vector3(0, 0, -1));
  ok(bot.hitTest(missRay, 100) === null, 'hitTest: промах → null');

  // Friendly fire off
  bot.damage(30, null, 2);
  ok(bot.hp === 100, 'свой огонь не наносит урон');
  bot.damage(30, null, 0);
  ok(bot.hp === 70, 'урон от врага проходит');

  // Смерть
  const killed = bot.damage(200, null, 1);
  ok(killed === true && !bot.alive, 'бот убит');
  ok(bot.state === BotState.RESPAWN, 'FSM: RESPAWN');
  ok(bot.hitTest(ray, 100) === null, 'мёртвый бот не ловит хиты');

  // Респавн через 5с (ловим кадр респавна, пока бот не ушёл со спавна)
  const player = makePlayer();
  let respawnPos = null;
  for (let i = 0; i < 30 * 8; i++) {
    mgr.update(1 / 30, player);
    if (i < 30 * 4) ok_frames: { if (bot.alive) { ok(false, 'до 5с бот ещё мёртв'); break ok_frames; } }
    if (bot.alive && !respawnPos) { respawnPos = bot.pos.clone(); break; }
  }
  ok(respawnPos !== null && bot.hp === 100, 'бот респавнился через ~5с с полным HP');
  const sp = arena.spawns[2];
  ok(respawnPos && Math.hypot(respawnPos.x - sp.pos.x, respawnPos.z - sp.pos.z) < 2.5, 'респавн на точке команды');
}

// ============================================================
console.log('\n[6] Бот стреляет по игроку (реакция, очереди)');
{
  const arena = makeArena();
  const player = makePlayer();
  const mgr = new BotManager({ physics: physicsMock, arena, headless: true });
  mgr.bindPlayer(player, 0);
  const bot = mgr._makeBot({ team: 1, name: 'SHOOTER' });
  mgr.bots = [bot];
  bot.pos.set(0, 0.1, 0);
  player.body.pos.set(4, 0.1, 0); // в 4м, LOS чист
  player.hp = 100000; // не даём убить за время теста — проверяем сам факт огня
  const hp0 = player.hp;
  // 2.5 секунды боя
  for (let i = 0; i < 30 * 2.5; i++) mgr.update(1 / 30, player);
  ok(bot.state === BotState.ATTACK, `бот в ATTACK (${bot.state})`);
  ok(player.hp < hp0, `игрок получил урон (${hp0} → ${player.hp.toFixed(0)})`);
}

// ============================================================
console.log(`\n===== ИТОГ: ${passed} passed, ${failed} failed =====`);
process.exit(failed ? 1 : 0);
