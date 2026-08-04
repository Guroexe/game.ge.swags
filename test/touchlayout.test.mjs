// ===== GEN.SWAGS — юнит-тесты раскладки тач-кнопок (Node, без браузера) =====
// Покрытие чистых функций js/game/touchlayout.js:
//  1) snap к сетке 8px
//  2) clampWidget: кламп к экрану с учётом safe-area
//  3) serialize/parse round-trip; битый JSON и мусор → null
//  4) parse: неизвестные id отбрасываются, s клампится в 0.7..1.5
//  5) defaultLayout: все виджеты, s=1, позиции в 0..1
//  6) save/load/clear через мок-storage (per-ориентация)
//  7) findOverlaps: пары перекрытий, отсутствие ложных срабатываний
//  8) orientationOf
// Запуск: node test/touchlayout.test.mjs
import {
  GRID, SCALE_MIN, SCALE_MAX, WIDGETS, LAYOUT_KEY_PREFIX,
  snap, orientationOf, clampScale, clampWidget,
  defaultLayout, serializeLayout, parseLayout, findOverlaps,
  loadLayout, saveLayout, clearTouchLayouts,
} from '../js/game/touchlayout.js';

let passed = 0, failed = 0;
function ok(cond, name) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}`); }
}

// Мок localStorage
const makeStorage = () => {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    _map: m,
  };
};

console.log('— snap —');
ok(snap(0) === 0 && snap(3) === 0 && snap(4) === 8 && snap(5) === 8 && snap(-3) === 0 && snap(13) === 16, 'snap к сетке 8px');
ok(GRID === 8, 'GRID = 8');

console.log('— orientationOf / clampScale —');
ok(orientationOf(390, 844) === 'portrait' && orientationOf(844, 390) === 'landscape', 'ориентация по viewport');
ok(clampScale(0.5) === SCALE_MIN && clampScale(2) === SCALE_MAX && clampScale(1.2) === 1.2 && clampScale(NaN) === 1, 'clampScale 0.7..1.5, NaN→1');

console.log('— clampWidget —');
{
  const safe = { top: 20, right: 10, bottom: 30, left: 5 };
  // Внутри — не меняется
  let r = clampWidget(100, 100, 58, 58, 390, 844, safe);
  ok(r.x === 100 && r.y === 100, 'точка внутри экрана не двигается');
  // За левым/верхним краем → к safe-area
  r = clampWidget(-50, -50, 58, 58, 390, 844, safe);
  ok(r.x === 5 && r.y === 20, 'кламп к левому/верхнему safe-area инсету');
  // За правым/нижним краем → viewW - inset - w
  r = clampWidget(1000, 1000, 58, 58, 390, 844, safe);
  ok(r.x === 390 - 10 - 58 && r.y === 844 - 30 - 58, 'кламп к правому/нижнему инсету с учётом размера');
  // Виджет шире экрана — не уходит в бесконечность
  r = clampWidget(50, 50, 500, 58, 390, 844, safe);
  ok(r.x === 5 && Number.isFinite(r.y), 'виджет шире экрана — кламп к minX');
  // Без safe-area — к нулю
  r = clampWidget(-10, -10, 58, 58, 390, 844);
  ok(r.x === 0 && r.y === 0, 'без safe-area — кламп к нулю');
}

console.log('— defaultLayout —');
{
  const def = defaultLayout();
  ok(Object.keys(def).length === WIDGETS.length, 'defaultLayout покрывает все виджеты');
  ok(WIDGETS.every((w) => def[w.id] && def[w.id].s === 1), 'defaultLayout: scale = 1');
  ok(WIDGETS.every((w) => def[w.id].nx >= 0 && def[w.id].nx <= 1 && def[w.id].ny >= 0 && def[w.id].ny <= 1), 'defaultLayout: позиции в 0..1');
  // Возврат — копия, не ссылка на дефолты
  def[WIDGETS[0].id].nx = 0.99;
  ok(defaultLayout()[WIDGETS[0].id].nx !== 0.99, 'defaultLayout возвращает независимую копию');
}

console.log('— serialize/parse round-trip —');
{
  const layout = defaultLayout();
  layout['tbtn-fire'] = { nx: 0.5, ny: 0.6, s: 1.25 };
  layout['stick-move'] = { nx: 0.1, ny: 0.7, s: 0.9 };
  const json = serializeLayout(layout);
  const back = parseLayout(json);
  ok(back && back['tbtn-fire'].nx === 0.5 && back['tbtn-fire'].ny === 0.6 && back['tbtn-fire'].s === 1.25, 'round-trip: tbtn-fire');
  ok(back['stick-move'].s === 0.9, 'round-trip: stick scale');
  ok(Object.keys(back).length === WIDGETS.length, 'round-trip: все виджеты сохранены');
}

console.log('— parse: валидация —');
ok(parseLayout(null) === null, 'null → null');
ok(parseLayout('') === null, 'пустая строка → null');
ok(parseLayout('{broken') === null, 'битый JSON → null');
ok(parseLayout('{"v":2,"widgets":{}}') === null, 'чужая версия → null');
ok(parseLayout('{"v":1}') === null, 'нет widgets → null');
ok(parseLayout('{"v":1,"widgets":{}}') === null, 'пустой widgets → null');
{
  const back = parseLayout(JSON.stringify({
    v: 1,
    widgets: {
      'tbtn-fire': { nx: 0.5, ny: 0.5, s: 99 },       // s → кламп
      'nope-btn': { nx: 0.1, ny: 0.1, s: 1 },          // неизвестный id → выбросить
      'tbtn-jump': { nx: 'x', ny: 0.2, s: 1 },         // не число → выбросить
    },
  }));
  ok(back && back['tbtn-fire'].s === SCALE_MAX, 'parse: s клампится к 1.5');
  ok(!back['nope-btn'] && !back['tbtn-jump'], 'parse: битые/неизвестные записи отброшены');
  ok(Object.keys(back).length === 1, 'parse: осталась одна валидная запись');
}

console.log('— storage: save/load/clear —');
{
  const st = makeStorage();
  const layout = defaultLayout();
  layout['tbtn-jump'] = { nx: 0.3, ny: 0.4, s: 1.1 };
  ok(saveLayout(st, 'portrait', layout) === true, 'saveLayout → true');
  ok(st.getItem(LAYOUT_KEY_PREFIX + 'portrait') !== null, 'ключ portrait записан');
  ok(st.getItem(LAYOUT_KEY_PREFIX + 'landscape') === null, 'landscape не тронут (per-ориентация)');
  const back = loadLayout(st, 'portrait');
  ok(back && back['tbtn-jump'].nx === 0.3 && back['tbtn-jump'].s === 1.1, 'loadLayout round-trip');
  saveLayout(st, 'landscape', layout);
  clearTouchLayouts(st);
  ok(loadLayout(st, 'portrait') === null && loadLayout(st, 'landscape') === null, 'clearTouchLayouts сбрасывает обе ориентации');
  // Сброс → после clear возвращаемся к штатной раскладке (defaultLayout валиден для serialize)
  ok(parseLayout(serializeLayout(defaultLayout())) !== null, 'defaultLayout сериализуется и читается (сброс)');
}

console.log('— findOverlaps —');
{
  const rects = [
    { id: 'a', x: 0, y: 0, w: 50, h: 50 },
    { id: 'b', x: 40, y: 40, w: 50, h: 50 },  // пересекается с a (10×10)
    { id: 'c', x: 200, y: 200, w: 50, h: 50 }, // отдельно
    { id: 'd', x: 52, y: 0, w: 40, h: 38 },    // рядом с a и над b — НЕ перекрытие
  ];
  const pairs = findOverlaps(rects);
  ok(pairs.length === 1 && pairs[0][0] === 'a' && pairs[0][1] === 'b', 'ровно одна пара перекрытия (a,b)');
  ok(findOverlaps([rects[2]]).length === 0 && findOverlaps([]).length === 0, 'без перекрытий → пусто');
}

console.log(`\nTOUCHLAYOUT UNIT: ${failed ? `${failed} FAILED, ` : ''}${passed} passed${failed ? '' : ' — ALL PASSED'}`);
process.exit(failed ? 1 : 0);
