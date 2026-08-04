// ===== GEN.SWAGS Sound War / Transition Tests =====
// Чистая логика звуковой войны и переходов (Node, без DOM/Web Audio — моки):
// 1) доминирование: перевес врага → enemyGain растёт, lowpass открывается;
// 2) clash-детект: совпадение фаз дропов в окне 2с → 8с клэш, урон +10%;
// 3) кража голоса: килл в клэше → трек жертвы немеет 4с, твой +3дБ на 8с;
// 4) килл-подавление: lowpass вражеского трека закрывается на 1с + шиммер;
// 5) зоны звука: дистанция/пан/окклюзия (raycast-мок);
// 6) fisheye-кривая перехода 0→1→0;
// 7) аудио-параметры headless: attachEnemy/setEnemyMix/setTransition на моке.
// Запуск: node test/soundwar.test.mjs
import {
  SoundWar, TRACK_META, metaFor, computeSyncRate, fisheyeCurve, dbToGain,
  CLASH_DURATION, VOICE_DUCK_TIME, VOICE_BOOST_TIME, CLASH_DAMAGE_MUL,
} from '../js/game/soundwar.js';
import { MusicEngine, bitcrushCurve } from '../js/engine/audio.js';
import { TransitionFX } from '../js/game/meta.js';

let passed = 0, failed = 0;
function ok(cond, name) {
  if (cond) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}`); }
}

// ---------- Моки Web Audio ----------
function param(v = 0) {
  return {
    value: v,
    setTargetAtTime(v2) { this.value = v2; },
    setValueAtTime(v2) { this.value = v2; },
    exponentialRampToValueAtTime(v2) { this.value = v2; },
  };
}
function mkNode() {
  return {
    connect() {}, disconnect() {},
    gain: param(1), frequency: param(1000), Q: param(1),
    pan: param(0), playbackRate: param(1), detune: param(0),
    curve: null, oversample: 'none', type: '', buffer: null, loop: false,
    start() {}, stop() {},
  };
}
function mockCtx() {
  return {
    sampleRate: 44100, currentTime: 0, destination: {},
    createGain: () => mkNode(),
    createBiquadFilter: () => mkNode(),
    createWaveShaper: () => mkNode(),
    createStereoPanner: () => mkNode(),
    createOscillator: () => mkNode(),
    createConvolver: () => mkNode(),
    createBufferSource: () => mkNode(),
    createBuffer: (ch, len) => ({ getChannelData: () => new Float32Array(len) }),
  };
}
function mockMusic() {
  const m = {
    ctx: mockCtx(),
    playlist: [],
    bpm: 0,
    gainNode: mkNode(),
    enemyActive: false,
    _mix: null, _attached: null, _rate: null,
    attachEnemy(buf, opts) { this._attached = { buf, opts }; this.enemyActive = true; return true; },
    detachEnemy() { this.enemyActive = false; },
    setEnemyMix(mix) { this._mix = mix; },
    setEnemyRate(r) { this._rate = r; },
  };
  return m;
}
function mkTrack(name, bpm = 140) {
  return { name, title: name, genre: 'X', bpm, buffer: { duration: 30 }, isUser: false };
}
function mkWar() {
  const music = mockMusic();
  const sw = new SoundWar({ music });
  sw.assignTracks(0, mkTrack('mine.mp3', 150), (team) => mkTrack(`enemy${team}.mp3`, 140));
  sw.startMatch();
  return { sw, music };
}
const ctxOf = (over = {}) => ({
  scores: [0, 0, 0], flowValue: 0, objHoldTeam: -1,
  zoneSources: [], playerPos: { x: 0, y: 0, z: 0 }, playerYaw: 0, playerAlive: true,
  ...over,
});

// ============================
console.log('\n== Подгонка BPM (rate ±10%) ==');
{
  ok(computeSyncRate(150, 150) === 1, 'одинаковый BPM → rate 1');
  ok(computeSyncRate(174, 140).toFixed(2) === '0.90', 'враг медленнее → clamp 0.90');
  ok(computeSyncRate(132, 174).toFixed(2) === '1.10', 'враг быстрее → clamp 1.10');
  ok(computeSyncRate(0, 140) === 1 && computeSyncRate(150, 0) === 1, 'нет BPM → rate 1');
}

// ============================
console.log('\n== Fisheye-кривая 0→1→0 ==');
{
  ok(fisheyeCurve(0) === 0 && fisheyeCurve(1) === 0, 'края = 0');
  ok(Math.abs(fisheyeCurve(0.5) - 1) < 1e-6, 'пик в середине = 1');
  ok(fisheyeCurve(0.25) > 0 && fisheyeCurve(0.25) < 1, 'подъём монотонный');
  ok(fisheyeCurve(0.75) > 0 && fisheyeCurve(0.75) < fisheyeCurve(0.5), 'спад после пика');
  ok(fisheyeCurve(-0.5) === 0 && fisheyeCurve(1.5) === 0, 'кламп за пределами');
}

// ============================
console.log('\n== Доминирование → присутствие врага ==');
{
  const { sw } = mkWar();
  // Равный счёт: просачивания почти нет
  sw.update(0.5, ctxOf());
  const calm = sw.computeTargets();
  ok(calm.gain < 0.12, `равный счёт → враг еле слышен (${calm.gain.toFixed(3)})`);
  ok(calm.lpHz < 2000, `проигрыш не начался → lowpass закрыт (${Math.round(calm.lpHz)} Гц)`);

  // Враг вырвался вперёд: трек врага просачивается и открывается
  sw.update(0.5, ctxOf({ scores: [0, 1500, 0] }));
  const losing = sw.computeTargets();
  ok(losing.gain > calm.gain + 0.2, `перевес врага → enemyGain растёт (${losing.gain.toFixed(3)})`);
  ok(losing.lpHz > calm.lpHz * 3, `доминирование врага → lowpass открывается (${Math.round(losing.lpHz)} Гц)`);

  // Мы вырвались вперёд: враг затихает
  sw.update(0.5, ctxOf({ scores: [2000, 0, 0], flowValue: 80 }));
  const winning = sw.computeTargets();
  ok(winning.gain <= calm.gain + 0.05, `наш перевес → враг тихий (${winning.gain.toFixed(3)})`);

  // Лидер врага определяется по счёту
  ok(sw.enemyLeader([0, 500, 900], 0) === 2, 'лидер врага = команда с max счётом');

  // Вражеский поток подключён с rate по BPM
  const { sw: sw2, music } = mkWar();
  sw2.update(0.1, ctxOf());
  ok(music.enemyActive, 'вражеский поток подключён при startMatch');
  ok(Math.abs(music._attached.opts.rate - computeSyncRate(150, 140)) < 1e-9, 'rate врага подогнан к твоему BPM');
}

// ============================
console.log('\n== SOUND CLASH: совпадение фаз дропов ==');
{
  const { sw } = mkWar();
  sw.update(0.1, ctxOf());
  const enemy = sw.activeEnemyTeam;
  // Дропы в окне 2с → клэш
  sw.notifyDrop('you');
  ok(sw.notifyDrop(enemy) === true, 'дроп врага в окне 2с → CLASH');
  ok(sw.clash.active && sw.clash.withTeam === enemy, 'клэш активен с командой врага');
  ok(sw.damageMul === CLASH_DAMAGE_MUL, `урон всех +10% (×${sw.damageMul})`);
  const t = sw.computeTargets();
  ok(Math.abs(t.gain - 0.5) < 1e-9, 'клэш: микс 50/50');
  ok(t.lpHz >= 14000, 'клэш: частоты открыты');
  // Повторный дроп во время клэша не перезапускает
  ok(sw.notifyDrop('you') === false, 'дроп внутри клэша не перезапускает его');
  // 8с → конец
  let ended = false;
  sw.onClashEnd = () => { ended = true; };
  for (let i = 0; i < 90; i++) sw.update(0.1, ctxOf());
  ok(!sw.clash.active && ended, 'клэш завершается через 8с');
  ok(sw.damageMul === 1, 'урон вернулся к норме');

  // Дропы вне окна — клэша нет
  const { sw: sw3 } = mkWar();
  sw3.update(0.1, ctxOf());
  sw3.notifyDrop('you');
  for (let i = 0; i < 30; i++) sw3.update(0.1, ctxOf()); // +3с
  ok(sw3.notifyDrop(sw3.activeEnemyTeam) === false, 'дропы в 3с друг от друга → клэша нет');
}

// ============================
console.log('\n== Кража голоса (kill в клэше) ==');
{
  const { sw } = mkWar();
  sw.update(0.1, ctxOf());
  const enemy = sw.activeEnemyTeam;
  sw.notifyDrop('you');
  sw.notifyDrop(enemy);
  const ev = sw.registerKill(0, enemy); // мы убили врага в клэше
  ok(ev.stolen, 'килл в клэше → кража голоса');
  ok(sw.duckT[enemy] === VOICE_DUCK_TIME, `трек жертвы немеет ${VOICE_DUCK_TIME}с`);
  ok(sw.boostT === VOICE_BOOST_TIME, `твой трек +3дБ на ${VOICE_BOOST_TIME}с`);
  const ducked = sw.computeTargets();
  ok(ducked.gain < 0.1, `немой враг почти не слышен (${ducked.gain.toFixed(3)})`);
  ok(sw.playerGainTarget() > 1.3, `+3дБ = ×${dbToGain(3).toFixed(2)} к твоему треку`);
  // Через 5с немота прошла, буст ещё держится
  for (let i = 0; i < 50; i++) sw.update(0.1, ctxOf());
  ok(sw.duckT[enemy] === 0 && sw.boostT > 0, 'немота 4с истекла, буст 8с ещё идёт');
  // Наша смерть в клэше — наш трек приглушают
  const ev2 = sw.registerKill(enemy, 0);
  ok(ev2.playerDucked && sw.playerGainTarget() < 0.5, 'твоя смерть в клэше → твой трек приглушён');
}

// ============================
console.log('\n== Килл = захват частот (подавление) ==');
{
  const { sw } = mkWar();
  sw.update(0.1, ctxOf());
  const enemy = sw.activeEnemyTeam;
  const ev = sw.registerKill(0, enemy);
  ok(ev.suppressed && sw.suppressT[enemy] === 1, 'килл по активному врагу → подавление 1с');
  const t = sw.computeTargets();
  ok(t.lpHz <= 320, `lowpass врага закрыт (${Math.round(t.lpHz)} Гц)`);
  ok(t.crush > 0.3, `bitcrush-шиммер на треке жертвы (${t.crush.toFixed(2)})`);
  for (let i = 0; i < 12; i++) sw.update(0.1, ctxOf());
  ok(sw.computeTargets().crush < 0.1, 'подавление истекает через ~1с');
}

// ============================
console.log('\n== Зоны звука (радар-музыка) ==');
{
  // Без окклюзии
  const sw = new SoundWar({ music: mockMusic() });
  sw.assignTracks(0, mkTrack('mine.mp3'), (t) => mkTrack(`e${t}.mp3`));
  const src = [{ x: 10, z: 0, team: 1, label: 'СТАНЦИЯ B' }];
  // Игрок смотрит строго на источник: forward = -sin(yaw),-cos(yaw)
  const yaw = Math.atan2(-10, 0); // смотрим на +x
  const z = sw.computeZone(src, { x: 0, y: 0, z: 0 }, yaw, 0);
  ok(z.gain > 0.5, `рядом с вражеской станцией трек слышен (${z.gain.toFixed(2)})`);
  ok(Math.abs(z.pan) < 0.2, `источник прямо по курсу → пан ~0 (${z.pan.toFixed(2)})`);
  const zFar = sw.computeZone(src, { x: -30, y: 0, z: 0 }, yaw, 0);
  ok(zFar.gain < z.gain, 'громкость падает с дистанцией');
  // Окклюзия: стена между → lowpass и тише
  const swOcc = new SoundWar({
    music: mockMusic(),
    physics: { raycast: () => ({ hit: true }) },
  });
  const zOcc = swOcc.computeZone(src, { x: 0, y: 0, z: 0 }, yaw, 0);
  ok(zOcc.occluded && zOcc.lpHz === 700 && zOcc.gain < z.gain, 'стена → lowpass 700 Гц + приглушение');
  // Своя станция не звучит
  const zMine = sw.computeZone([{ x: 5, z: 0, team: 0 }], { x: 0, y: 0, z: 0 }, yaw, 0);
  ok(zMine.gain === 0, 'свои источники игнорируются');
}

// ============================
console.log('\n== Аудио-параметры headless (мок AudioContext) ==');
{
  const m = Object.create(MusicEngine.prototype);
  m.ctx = mockCtx();
  m.master = mkNode();
  m.enemySource = null; m.enemyLow = null; m.enemyCrush = null;
  m.enemyGain = null; m.enemyPan = null;
  m._transRate = 1; m._transCrushK = 0; m._enemyCrushK = 0;
  m.source = mkNode();

  ok(m.attachEnemy({ duration: 30 }, { rate: 0.93 }) === true, 'attachEnemy на моке');
  ok(m.enemyActive && Math.abs(m.enemySource.playbackRate.value - 0.93) < 1e-9, 'rate врага выставлен');
  m.setEnemyMix({ gain: 0.5, lpHz: 900, crush: 0.9, pan: -0.5 });
  ok(m.enemyGain.gain.value === 0.5 && m.enemyLow.frequency.value === 900, 'setEnemyMix: gain/lowpass');
  ok(m.enemyPan.pan.value === -0.5, 'setEnemyMix: панорама');
  ok(m.enemyCrush.curve instanceof Float32Array, 'bitcrush-кривая пересчитана');

  // Переход: rate ×0.6 применяется к обоим потокам
  m.setTransition({ rate: 0.6, lpHz: 500, crush: 1, verb: 0.8, duck: 0.5 });
  ok(Math.abs(m.source.playbackRate.value - 0.6) < 1e-9, 'основной трек: rate ×0.6');
  ok(Math.abs(m.enemySource.playbackRate.value - 0.93 * 0.6) < 1e-9, 'вражеский трек проваливается вместе');
  // resetTransition — всё обратно
  m.resetTransition();
  ok(Math.abs(m.source.playbackRate.value - 1) < 1e-9, 'resetTransition: rate 1');
  m.transitionHit(); // не должно кидать на моке
  m.detachEnemy();
  ok(!m.enemyActive, 'detachEnemy отключает поток');

  // bitcrushCurve: k=0 почти линейна, k=1 — 4 бита
  const c0 = bitcrushCurve(0), c1 = bitcrushCurve(1);
  const uniq = (c) => new Set([...c].map((v) => v.toFixed(4))).size;
  ok(uniq(c0) > uniq(c1) * 4, `квантование: ${uniq(c0)} → ${uniq(c1)} уровней`);
}

// ============================
console.log('\n== TransitionFX (мини смерть / полный матч) ==');
{
  const mkGame = () => ({
    engine: {
      fx: {
        target: { rgbSplit: 0, glitch: 0, warp: 0.6, psy: 0, datamosh: 0.6, fisheye: 0 },
        set(patch) { Object.assign(this.target, patch); },
        pulse() {},
      },
      camera: { fov: 75, rotation: { z: 0 }, updateProjectionMatrix() {} },
      renderer: { toneMappingExposure: 1.35 },
    },
    music: {
      _v: {},
      setTransition(v) { Object.assign(this._v, v); },
      resetTransition() { this._v = { rate: 1 }; },
      transitionHit() { this._hit = true; },
    },
    player: { baseFov: 75 },
    sfx: { collapse() {} },
  });

  // Смерть: 3.2с (синхронно с soul-cam), fisheye 0→1→0, rate вниз и обратно
  const g = mkGame();
  const tr = new TransitionFX(g);
  ok(tr.startDeath() === true, 'startDeath активирует переход');
  ok(g.engine.fx.target.datamosh === 1 && g.engine.fx.target.warp >= 0.89, `warp ×1.5 (${g.engine.fx.target.warp.toFixed(2)}) + datamosh max`);
  tr.update(0.64); // p=0.2 — фаза провала
  ok(g.music._v.rate < 1 && g.music._v.lpHz < 16000, 'провал: rate/lp вниз');
  tr.update(0.96); // p=0.5 — тишина-удар
  ok(g.music._hit === true, 'тишина-удар в середине');
  ok(g.engine.camera.fov > 90, `FOV-панч (${Math.round(g.engine.camera.fov)})`);
  const midFish = g.engine.fx.target.fisheye;
  tr.update(1.7); // конец (t=3.3 > 3.2)
  ok(!tr.active, 'переход завершён');
  ok(g.engine.fx.target.fisheye === 0 && midFish > 0.5, `fisheye 0→${midFish.toFixed(2)}→0`);
  ok(g.music._v.rate === 1, 'трек втянут обратно (rate 1)');
  ok(g.engine.camera.fov === 75, 'FOV восстановлен');

  // Конец матча: направление ▲/▼
  const g2 = mkGame();
  const up = new TransitionFX(g2);
  up.startMatch({ up: true, arenaName: '«НЕКРО-ЗАВОД»', duration: 12 });
  ok(up.banner === '▲ ВОЗВЫШЕНИЕ: «НЕКРО-ЗАВОД»', 'баннер возвышения');
  up.update(6); // середина
  ok(up.camLift > 5, `победа → камера ВВЕРХ (+${up.camLift.toFixed(1)})`);
  ok(g2.engine.renderer.toneMappingExposure > 1.35, 'возвышение → светлее');
  up.stop();

  const g3 = mkGame();
  const down = new TransitionFX(g3);
  down.startMatch({ up: false, arenaName: '«ПУСТЫНЯ ДАННЫХ»', duration: 12 });
  ok(down.banner === '▼ ПАДЕНИЕ: «ПУСТЫНЯ ДАННЫХ»', 'баннер падения');
  down.update(6);
  ok(down.camLift < -5, `поражение → камера ВНИЗ (${down.camLift.toFixed(1)})`);
  ok(g3.engine.renderer.toneMappingExposure < 1.35, 'падение → темнее');
  down.stop();
}

// ============================
console.log('\n== Треки команд / MP-хуки ==');
{
  const { sw, music } = mkWar();
  ok(sw.assignments.size === 3, 'треки назначены 3 командам');
  const names = [...sw.assignments.values()].map((a) => a.name);
  ok(new Set(names).size === 3, 'треки команд разные');
  // MP: удалённый трек применяется по trackId из плейлиста
  const builtin = TRACK_META[0].file;
  music.playlist.push({ name: builtin, buffer: { duration: 10 } });
  ok(sw.applyRemoteTrack(2, builtin) === true, 'MP trackId → трек команды');
  ok(sw.trackOf(2).title === metaFor(builtin).title, 'метаданные из TRACK_META');
  ok(sw.applyRemoteTrack(2, 'user:чужой.mp3') === false, 'чужой user-трек → graceful fallback');
  ok(TRACK_META.length === 4, '4 встроенных трека в метаданных (3 боевых + меню)');
  ok(TRACK_META.filter((m) => m.start !== undefined && m.end !== undefined).length === 3,
    'у 3 боевых треков задан trim-сегмент (start/end)');
}

console.log(`\n${failed ? '❌' : '✅'} soundwar: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
