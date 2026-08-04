// ===== GEN.SWAGS Meta Tests =====
// ELO-математика (победа/поражение/границы рангов), классификация фаз трека
// на синтетической энергии, ритм-окна (perfect/good/miss), headless-поток
// мета-петли: match → intermission → next arena → startGame.
// Запуск: node test/meta.test.mjs
import { RatingSystem, rankFor, RANKS } from '../js/game/rating.js';
import { PhaseClassifier } from '../js/engine/audio.js';
import { RhythmSystem } from '../js/game/rhythm.js';
import { MetaLoop, ARENA_ROTATION } from '../js/game/meta.js';

let passed = 0, failed = 0;
function ok(cond, name) {
  if (cond) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}`); }
}

// ---------- Утилиты ----------
function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v) };
}

// ============================
// 1. ELO-математика
// ============================
console.log('\n== ELO ==');
{
  const rs = new RatingSystem({ storage: memStorage() });
  ok(rs.rating === 1000, 'стартовый рейтинг 1000');

  // Победа (место 1), нейтральная личная статистика → положительная дельта
  const win = rs.recordMatch({ place: 1, kills: 4, deaths: 4, perfectPct: 0.3 });
  ok(win.delta > 0, `победа → +дельта (${win.delta})`);
  ok(win.rating === 1000 + win.delta && win.oldRating === 1000, 'рейтинг вырос от 1000');
  ok(rs.matches === 1 && rs.wins === 1, 'счётчики матчей/побед');

  // Поражение (место 3), плохая статистика → отрицательная дельта
  const rs2 = new RatingSystem({ storage: memStorage() });
  const lose = rs2.recordMatch({ place: 3, kills: 1, deaths: 9, perfectPct: 0.05 });
  ok(lose.delta < 0, `поражение → −дельта (${lose.delta})`);
  ok(rs2.rating < 1000, 'рейтинг упал ниже 1000');

  // Место 2 при нейтральной статистике ≈ 0
  const rs3 = new RatingSystem({ storage: memStorage() });
  const mid = rs3.recordMatch({ place: 2, kills: 5, deaths: 5, perfectPct: 0.3 });
  ok(mid.delta === 0, `место 2 нейтрально → дельта 0 (${mid.delta})`);

  // Победа/поражение симметричны при зеркальной статистике
  const a = new RatingSystem({ storage: memStorage() }).recordMatch({ place: 1, kills: 8, deaths: 0, perfectPct: 0.6 });
  const b = new RatingSystem({ storage: memStorage() }).recordMatch({ place: 3, kills: 0, deaths: 8, perfectPct: 0.0 });
  ok(a.delta === -b.delta, `симметрия: +${a.delta} / ${b.delta}`);

  // Персист: тот же storage → рейтинг восстановлен
  const st = memStorage();
  const r1 = new RatingSystem({ storage: st });
  r1.recordMatch({ place: 1, kills: 6, deaths: 2, perfectPct: 0.4 });
  const r2 = new RatingSystem({ storage: st });
  ok(r2.rating === r1.rating && r2.matches === 1, 'рейтинг персистится в storage');
}

// ---------- Границы рангов ----------
console.log('\n== Ранги ==');
{
  ok(rankFor(0) === 'НЕЙРОН', '0 → НЕЙРОН');
  ok(rankFor(1000) === 'НЕЙРОН', '1000 → НЕЙРОН');
  ok(rankFor(1099) === 'НЕЙРОН', '1099 → НЕЙРОН (граница снизу)');
  ok(rankFor(1100) === RANKS[1].name, `1100 → ${RANKS[1].name}`);
  ok(rankFor(1299) === RANKS[1].name, '1299 → ещё не следующий');
  ok(rankFor(1300) === RANKS[2].name, `1300 → ${RANKS[2].name}`);
  ok(rankFor(1500) === RANKS[3].name, `1500 → ${RANKS[3].name}`);
  ok(rankFor(1800) === 'ZE FLOW', '1800 → ZE FLOW');
  ok(rankFor(9999) === 'ZE FLOW', '9999 → ZE FLOW (потолок)');

  // Минимальный рейтинг не уходит ниже 100
  const rs = new RatingSystem({ storage: memStorage() });
  rs.rating = 105;
  rs.recordMatch({ place: 3, kills: 0, deaths: 20, perfectPct: 0 });
  ok(rs.rating >= 100, `рейтинг ограничен снизу (${rs.rating} >= 100)`);
}

// ---------- Место команды ----------
{
  ok(RatingSystem.placeOf([3000, 1000, 500], 0) === 1, 'место 1 по счёту');
  ok(RatingSystem.placeOf([500, 3000, 100], 0) === 2, 'место 2 по счёту');
  ok(RatingSystem.placeOf([500, 1000, 3000], 0) === 3, 'место 3 по счёту');
}

// ============================
// 2. Классификация фаз трека (синтетическая энергия)
// ============================
console.log('\n== Фазы трека ==');
{
  const pc = new PhaseClassifier();
  const seen = [];
  pc.onPhase((p) => seen.push(p));
  ok(pc.phase === 'intro', 'стартовая фаза intro');

  // Тихое интро 3с: бас/энергия низкие
  for (let t = 0; t < 3; t += 1 / 30) pc.push(0.05, 0.05, 1 / 30);
  ok(pc.phase === 'intro', 'тихий участок остаётся intro');

  // DROP: бас вырастает >2× за ~0.5с
  for (let t = 0; t < 3; t += 1 / 30) pc.push(0.4, 0.3, 1 / 30);
  ok(pc.phase === 'drop', `рост баса ×8 → drop (фаза: ${pc.phase})`);
  ok(seen.includes('drop'), 'событие onPhase(drop) пришло');

  // Drop держится, пока энергия высокая
  for (let t = 0; t < 3; t += 1 / 30) pc.push(0.4, 0.35, 1 / 30);
  ok(pc.phase === 'drop', 'drop удерживается при высокой энергии');

  // BREAKDOWN: энергия падает <40% среднего и держится 4с+
  for (let t = 0; t < 5; t += 1 / 30) pc.push(0.03, 0.02, 1 / 30);
  ok(pc.phase === 'breakdown', `затухание <40% 4с → breakdown (фаза: ${pc.phase})`);
  ok(seen.indexOf('drop') < seen.indexOf('breakdown'), 'порядок: drop → breakdown');

  // BUILD: энергия растёт >1.3× за 2с после breakdown (бас ровный — не drop)
  for (let t = 0; t < 3; t += 1 / 30) pc.push(0.04, 0.05 + t * 0.12, 1 / 30);
  ok(pc.phase === 'build', `рост энергии → build (фаза: ${pc.phase})`);

  // reset возвращает в intro
  pc.reset();
  ok(pc.phase === 'intro', 'reset → intro');
}

// ============================
// 3. Ритм-окна (perfect/good/miss по дельте)
// ============================
console.log('\n== Ритм-окна ==');
{
  // Фейковая музыка: onBeat + bpm
  const cbs = [];
  const music = { bpm: 120, onBeat: (cb) => cbs.push(cb) };
  const r = new RhythmSystem({ music });
  ok(r.perfectWindow > 0.08 && r.goodWindow > 0.16, 'окна шире базовых при 120 BPM (медленнее референса)');

  // Эмулируем бит в момент t=1.0 (интервал 0.5с при 120 BPM)
  r.update(1.0);
  for (const cb of cbs) cb(); // бит сейчас
  ok(r.timeSinceBeat() < 0.001, 'бит зарегистрирован');

  r.update(0.03); // +30мс после бита
  ok(r.judge('shoot') === 'perfect', '+30мс → perfect');
  ok(r.streak === 1, 'стрик = 1 после perfect');

  r.update(0.10); // +130мс
  ok(r.judge('dash') === 'good', '+130мс → good');
  ok(r.streak === 1, 'good не рвёт и не растит стрик');

  r.update(0.12); // t=1.25: ровно между битами (интервал 0.5) → miss
  ok(r.judge('jump') === 'miss', 'между битами → miss');
  ok(r.streak === 0, 'miss сбрасывает стрик');

  // Незадолго ДО следующего бита тоже perfect (интервал 0.5с)
  r.update(0.22); // t=1.47: до следующего бита ~30мс
  ok(r.peek() === 'perfect', 'за 30мс до бита → perfect');
}
// Отдельный чистый кейс ZE FLOW
{
  const cbs = [];
  const music = { bpm: 120, onBeat: (cb) => cbs.push(cb) };
  const r = new RhythmSystem({ music });
  let ze = 0;
  r.onZeFlowStart = () => ze++;
  r.update(1.0);
  for (const cb of cbs) cb(); // бит
  for (let i = 0; i < 8; i++) {
    r.update(0.01); // +10мс от бита — perfect
    r.judge('shoot');
    r.update(0.49); // дожидаемся следующего бита
    for (const cb of cbs) cb();
  }
  ok(ze === 1 && r.zeFlow, `8 perfect подряд → ZE FLOW (стрик ${r.bestStreak})`);
  r.update(5.1);
  ok(!r.zeFlow, 'ZE FLOW истекает через 5с');

  // perfectPct
  const r3 = new RhythmSystem({ music });
  ok(r3.perfectPct === 0, 'нет действий → perfectPct 0');
}

// ============================
// 4. Мета-поток headless: match → intermission → next arena
// ============================
console.log('\n== Мета-поток (headless) ==');
{
  const calls = { rebuild: [], start: 0, psy: [], showEnd: null, hideEnd: 0 };
  const fakeGame = {
    mode: { scores: [3000, 1500, 500], playerTeam: 0 },
    engine: {
      camera: { position: { set() {} }, lookAt() {} },
      fx: {
        setPsyBreak(on, k) { calls.psy.push([on, k]); },
        pulse() {},
      },
    },
    menu: {
      showEnd(data) { calls.showEnd = data; },
      hideEnd() { calls.hideEnd++; },
    },
    input: { exitPointerLock() {} },
    collectMatchStats: () => ({ kills: 7, deaths: 3, perfectPct: 0.48, flowMax: 96 }),
    rebuildArena(variant) { calls.rebuild.push(variant); },
    startGame() { calls.start++; },
  };
  const meta = new MetaLoop(fakeGame, { rating: new RatingSystem({ storage: memStorage() }) });

  // Матч завершён: экран итогов со статами и дельтой рейтинга
  const res = meta.onMatchEnd({ scores: [3000, 1500, 500], winner: 0, playerWon: true });
  ok(calls.showEnd === res, 'showEnd вызван с результатом');
  ok(res.place === 1, 'место 1 вычислено из счёта');
  ok(res.rating.delta > 0, `дельта рейтинга + (${res.rating.delta})`);
  ok(res.stats.kills === 7 && Math.round(res.stats.perfectPct * 100) === 48, 'статы матча прокинуты');
  ok(typeof res.nextArena === 'string', 'имя следующей арены в результате');

  // Интермиссия: psy-break включён
  ok(meta.startIntermission() === true, 'интермиссия стартует');
  ok(meta.intermission && calls.psy.at(-1)[0] === true, 'psy-break ON при старте');
  ok(calls.hideEnd === 1, 'экран итогов скрыт');
  ok(calls.rebuild.length === 0, 'арена ещё не пересобрана');

  // Первая половина: орбита; пересборка в середине (float-безопасно: 6.2с)
  for (let i = 0; i < 62; i++) meta.update(0.1);
  ok(calls.rebuild.length === 1, `на 6с арена пересобрана (${calls.rebuild[0]})`);
  ok(calls.rebuild[0] === ARENA_ROTATION[1], `следующая арена по ротации = ${ARENA_ROTATION[1]}`);
  ok(meta.arenaIndex === 1, 'arenaIndex переключён');
  ok(calls.start === 0, 'матч ещё не начат');

  // Вторая половина → конец: psy-break OFF, startGame
  for (let i = 0; i < 61; i++) meta.update(0.1); // ещё 6.1с
  ok(!meta.intermission, 'интермиссия завершена после 12с');
  ok(calls.psy.at(-1)[0] === false, 'psy-break OFF в конце');
  ok(calls.start === 1, 'startGame вызван — следующий матч');

  // Повторный цикл: ротация идёт дальше
  meta.onMatchEnd({ scores: [0, 3000, 500], winner: 1, playerWon: false });
  meta.startIntermission();
  for (let i = 0; i < 130; i++) meta.update(0.1);
  ok(calls.rebuild[1] === ARENA_ROTATION[2], `второй цикл → ${ARENA_ROTATION[2]}`);
  ok(calls.start === 2, 'второй startGame');

  // abort во время интермиссии гасит psy-break
  meta.startIntermission();
  meta.abort();
  ok(!meta.intermission && calls.psy.at(-1)[0] === false, 'abort гасит интермиссию');
}

console.log(`\n===== ИТОГ: ${passed} passed, ${failed} failed =====`);
process.exit(failed ? 1 : 0);
