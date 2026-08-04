// ===== GEN.SWAGS FLOW =====
// Музыкально-реактивный геймплей: FLOW 0-100, бонусы урона/скорости,
// DROP-события (гравитация -30%, двойной урон, малиновый туман).
// Чистая логика без DOM — тестируется в Node.
import { activeGroove } from './rhythm.js';

export class FlowSystem {
  constructor({ music = null, dropDuration = 8, scheduledDropEvery = 42 } = {}) {
    this.value = 0;              // 0..100
    this.max = 100;
    this.decay = 3.2;            // затухание в секунду
    this.dropActive = false;
    this.dropT = 0;
    this.dropDuration = dropDuration;
    this._scheduledDropEvery = scheduledDropEvery;
    this._sinceDrop = 0;
    this._lastBeatAt = -100;
    this._beatInterval = 0.5;
    this._time = 0;

    // Колбэки наружу (HUD/мир)
    this.onDropStart = null;  // (strength)
    this.onDropEnd = null;
    this.onBeat = null;       // (bassEnergy)

    if (music) this.attachMusic(music);
  }

  attachMusic(music) {
    this.music = music;
    music.onBeat((bass) => {
      this._lastBeatAt = this._time;
      if (music.bpm) this._beatInterval = 60 / music.bpm;
      this.add(0.7); // ритм сам по себе чуть наполняет FLOW
      this.onBeat?.(bass);
    });
    music.onDrop((k) => this.triggerDrop(k));
  }

  // Секунды с последнего бита
  timeSinceBeat() { return this._time - this._lastBeatAt; }
  // ±100мс от бита
  get onBeatNow() { return Math.abs(this.timeSinceBeat()) <= 0.1; }
  get beatInterval() { return this._beatInterval; }

  add(n) { this.value = Math.min(this.max, this.value + n); }

  // Убийство: на бите (±100мс) — двойной прирост
  registerKill() {
    const mult = this.onBeatNow ? 2 : 1;
    this.add(10 * mult);
    return mult;
  }

  registerHit(dmg) { this.add(dmg * 0.05); }
  registerDamageDealtInDrop(dmg) { if (this.dropActive) this.add(dmg * 0.1); }

  triggerDrop(strength = 1.5) {
    if (this.dropActive) return;
    this.dropActive = true;
    this.dropT = this.dropDuration;
    this._sinceDrop = 0;
    this.onDropStart?.(strength);
  }

  // moveSpeed — скорость игрока (движение наполняет FLOW)
  update(dt, { moveSpeed = 0 } = {}) {
    this._time += dt;
    this._sinceDrop += dt;

    this.value = Math.max(0, this.value - this.decay * dt);
    if (moveSpeed > 2) this.add(dt * 1.4);

    // Ручной триггер по расписанию, если трек не даёт дропов
    if (!this.dropActive && this._sinceDrop >= this._scheduledDropEvery) {
      this.triggerDrop(1.5);
    }

    if (this.dropActive) {
      this.dropT -= dt;
      if (this.dropT <= 0) {
        this.dropActive = false;
        this.dropT = 0;
        this.onDropEnd?.();
      }
    }
  }

  // До +20% урона от FLOW; в DROP — ещё ×2
  get damageMul() { return (1 + 0.2 * (this.value / this.max)) * (this.dropActive ? 2 : 1); }
  // GROOVE (rhythm.js): непрерывный множитель урона от попадания в темп.
  // Композиция ПЕРЕМНОЖЕНИЕМ — FLOW/DROP и GROOVE не затирают друг друга.
  // Применяется в weapons.js через dmgMul (в MP groove-доля отключена —
  // урон авторитетен серверу). Этот геттер — для HUD/диагностики.
  get grooveDmgMul() { return activeGroove()?.dmgMul ?? 1; }
  get damageMulTotal() { return this.damageMul * this.grooveDmgMul; }
  // До +10% скорости
  get speedMul() { return 1 + 0.1 * (this.value / this.max); }
  get gravityMul() { return this.dropActive ? 0.7 : 1; }
  get flowNorm() { return this.value / this.max; }
}
