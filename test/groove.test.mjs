// ===== GEN.SWAGS GROOVE Tests =====
// Чистая EMA-математика GrooveMeter (Node, без DOM):
// 1) perfect-серия → groove > 0.8; good-серия → ~0.6; miss-серия → падение к 0;
// 2) бездействие → мягкий дрейф к нейтрали 0.3 (не наказание);
// 3) капы множителей силы (урон/shock/dash/reload/grapple/run/кулдауны);
// 4) анти-спам: тип действия учитывается не чаще 2/сек (спам прыжками не фармит);
// 5) стек с flow.damageMul — перемножение, в MP groove-доля урона отключена;
// 6) интеграция с RhythmSystem: judge() кормит метр, resetStats() — с нейтрали.
// Запуск: node test/groove.test.mjs
import { GrooveMeter, RhythmSystem, activeGroove } from '../js/game/rhythm.js';
import { FlowSystem } from '../js/game/flow.js';

let passed = 0, failed = 0;
function ok(cond, name) {
  if (cond) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}`); }
}
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

// Симуляция серии действий с шагом dt (метр живёт в реальном времени)
function run(meter, type, judge, dt, n) {
  for (let i = 0; i < n; i++) {
    meter.update(dt);
    meter.sample(type, judge);
  }
}

// ---------- 1. EMA: perfect-серия ----------
console.log('\n== EMA качества действий ==');
{
  const m = new GrooveMeter();
  ok(near(m.value, 0.3), 'старт с нейтрали 0.3');
  ok(m.percent === 30, 'шкала 0..100: старт = 30');
  run(m, 'shoot', 'perfect', 0.3, 20); // ~6с стабильных perfect
  ok(m.value > 0.8, `perfect-серия 6с → groove > 0.8 (=${m.value.toFixed(3)})`);
  ok(m.percent > 80, 'шкала > 80');
}
{
  const m = new GrooveMeter();
  run(m, 'shoot', 'good', 0.3, 20);
  ok(m.value > 0.5 && m.value < 0.7, `good-серия → groove ≈ 0.6 (=${m.value.toFixed(3)})`);
}
{
  const m = new GrooveMeter();
  run(m, 'shoot', 'perfect', 0.3, 20);
  const hi = m.value;
  run(m, 'shoot', 'miss', 0.3, 20);
  ok(m.value < 0.1, `miss-серия → падение к 0 (=${m.value.toFixed(3)})`);
  ok(m.value < hi, 'miss штрафует (значение ниже, чем после perfect-серии)');
}

// ---------- 2. Дрейф к нейтрали ----------
console.log('\n== Дрейф к нейтрали при бездействии ==');
{
  const m = new GrooveMeter();
  run(m, 'shoot', 'perfect', 0.3, 20);
  for (let i = 0; i < 80; i++) m.update(0.1); // 8с тишины
  ok(Math.abs(m.value - 0.3) < 0.1, `из максимума дрейфует к 0.3 (=${m.value.toFixed(3)})`);
  ok(m.value > 0.3, 'дрейф мягкий: не проваливается ниже нейтрали');
  const m2 = new GrooveMeter();
  run(m2, 'shoot', 'miss', 0.3, 20);
  for (let i = 0; i < 80; i++) m2.update(0.1);
  ok(Math.abs(m2.value - 0.3) < 0.1, `из нуля дрейфует ВВЕРХ к 0.3 (=${m2.value.toFixed(3)})`);
}

// ---------- 3. Капы множителей ----------
console.log('\n== Капы множителей силы ==');
{
  const m = new GrooveMeter();
  m.value = 0;
  ok(near(m.dmgMul, 0.90) && near(m.shockMul, 0.90) && near(m.dashMul, 0.90) &&
     near(m.reloadMul, 0.90) && near(m.grappleRangeMul, 1.00) &&
     near(m.runMul, 1.00) && near(m.cooldownMul, 1.00), 'g=0: минимумы (0.9/0.9/0.9/0.9/25м/1.0/1.0)');
  m.value = 1;
  ok(near(m.dmgMul, 1.25), 'g=1: урон ×1.25 (кап)');
  ok(near(m.shockMul, 1.40), 'g=1: shockwave ×1.40 (кап)');
  ok(near(m.dashMul, 1.30), 'g=1: дэш ×1.30 (кап)');
  ok(near(m.reloadMul, 1.25), 'g=1: перезарядка ×1.25 (время ÷1.25)');
  ok(near(m.grappleRangeMul, 1.28), 'g=1: grapple ×1.28 (25м → 32м)');
  ok(near(25 * m.grappleRangeMul, 32), 'g=1: дальность grapple ровно 32м');
  ok(near(m.runMul, 1.08), 'g=1: бег ×1.08 (тонко)');
  ok(near(m.cooldownMul, 0.85), 'g=1: кулдауны ×0.85 (быстрее откат)');
  m.value = 0.5; // монотонность/плавность
  ok(m.dmgMul > 0.9 && m.dmgMul < 1.25 && near(m.dmgMul, 1.075), 'g=0.5: урон плавно ×1.075');
}

// ---------- 4. Анти-спам 2/сек ----------
console.log('\n== Анти-спам (≤2 действий типа в секунду) ==');
{
  const m = new GrooveMeter();
  let counted = 0;
  for (let i = 0; i < 10; i++) counted += m.sample('jump', 'perfect') ? 1 : 0; // 10 прыжков мгновенно
  ok(counted === 2, `10 мгновенных прыжков → учтено ровно 2 (=${counted})`);
  // Спам прыжками не фармит groove быстрее, чем 2/сек
  const spammer = new GrooveMeter();
  const honest = new GrooveMeter();
  for (let s = 0; s < 3; s++) { // 3 секунды
    for (let i = 0; i < 20; i++) spammer.sample('jump', 'perfect'); // спам 20/сек
    for (let i = 0; i < 2; i++) honest.sample('jump', 'perfect');   // честные 2/сек
    spammer.update(1); honest.update(1);
  }
  ok(Math.abs(spammer.value - honest.value) < 0.05,
    `спам 20/сек ≈ честные 2/сек (spam=${spammer.value.toFixed(3)} honest=${honest.value.toFixed(3)})`);
  // Разные типы действий лимитированы независимо
  const m2 = new GrooveMeter();
  ok(m2.sample('jump', 'perfect') && m2.sample('shoot', 'perfect'), 'разные типы — независимые лимиты');
  // Лимитное действие всё равно видно HUD (lastAction обновляется)
  const m3 = new GrooveMeter();
  for (let i = 0; i < 5; i++) m3.sample('dash', 'perfect');
  ok(m3.lastAction?.type === 'dash' && near(m3.lastAction.mult, m3.dashMul), 'lastAction для всплывашки ×mult');
}

// ---------- 5. Стек с FLOW (перемножение) + MP ----------
console.log('\n== Стек с FLOW и MP-режим ==');
{
  // Регистрируем метр как активный (как делает игра через RhythmSystem),
  // чтобы flow.grooveDmgMul/damageMulTotal видели его через реестр
  const m = new RhythmSystem({ music: { bpm: 120, onBeat: () => {} } }).groove;
  const flow = new FlowSystem();
  flow.value = 100; // +20% урона от FLOW
  m.value = 1;      // +25% от GROOVE
  const total = flow.damageMul * m.dmgMul; // как в weapons: dmgMul(flow) × groove
  ok(near(total, 1.2 * 1.25), `FLOW ×1.2 и GROOVE ×1.25 стекаются перемножением (=${total.toFixed(3)})`);
  flow.triggerDrop(1.5);
  ok(near(flow.damageMul * m.dmgMul, 2.4 * 1.25), 'DROP ×2 стекается поверх обоих');
  // MP: урон авторитетен серверу — groove-доля отключена, остальные множители живы
  m.mpMode = true;
  ok(near(m.dmgMul, 1), 'MP: groove НЕ влияет на заявляемый урон (×1)');
  ok(near(flow.damageMul * m.dmgMul, 2.4), 'MP: остаётся только FLOW/DROP урон');
  ok(m.dashMul > 1 && m.runMul > 1, 'MP: движение/визуал groove работает');
  ok(near(flow.damageMulTotal, 2.4), 'MP: flow.damageMulTotal уважает mpMode');
  m.mpMode = false;
  ok(near(flow.damageMulTotal, 2.4 * 1.25), 'соло: damageMulTotal = FLOW×DROP×GROOVE');
}

// ---------- 6. Интеграция с RhythmSystem ----------
console.log('\n== Интеграция RhythmSystem ==');
{
  const cbs = [];
  const music = { bpm: 120, onBeat: (cb) => cbs.push(cb) };
  const r = new RhythmSystem({ music });
  ok(r.groove instanceof GrooveMeter, 'RhythmSystem несёт GrooveMeter');
  ok(activeGroove() === r.groove, 'реестр activeGroove указывает на метр игрока');
  ok(music.groove === r.groove, 'метр доступен и через music.groove');
  r.update(1.0);
  for (const cb of cbs) cb(); // бит
  r.update(0.03); // +30мс → perfect
  const before = r.groove.value;
  r.judge('shoot');
  ok(r.groove.value > before, 'judge() кормит GROOVE-метр');
  ok(r.groove.lastAction?.judge === 'perfect', 'lastAction фиксирует оценку');
  // Бездействие → дрейф через rhythm.update
  const v0 = r.groove.value;
  for (let i = 0; i < 50; i++) r.update(0.1); // 5с
  ok(r.groove.value < v0 && r.groove.value >= 0.3, 'rhythm.update дрейфует метр к нейтрали');
  r.groove.value = 0.9;
  r.resetStats();
  ok(near(r.groove.value, 0.3), 'resetStats: новый матч — groove с нейтрали');
}

console.log(`\n===== ИТОГ: ${passed} passed, ${failed} failed =====`);
process.exit(failed ? 1 : 0);
