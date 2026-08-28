// ===== GEN.SWAGS Player =====
// FPS-контроллер Quake-стиля: accel/friction, air control, bhop, sprint,
// slide, double jump, dash, FOV-кик, head-bob, здоровье/реген.
// GROOVE (rhythm.js): непрерывная сила действий от попадания в темп —
// дальность дэша, дальность grapple, скорость бега, откат скилов.
import * as THREE from 'three';
import { activeGroove } from './rhythm.js';

const WALK_SPEED = 7.0;
const SPRINT_SPEED = 9.5;
const GROUND_ACCEL = 60;
const AIR_ACCEL = 18;
const FRICTION = 8;
const JUMP_VEL = 8.2;
// Моментум: bhop/слайд/wall-run без ударов о стены разгоняют до ×2.3 от спринта
const MOMENTUM_MAX_BOOST = 1.3;
const MOMENTUM_BHOP = 0.18;    // прыжок сразу после приземления
const MOMENTUM_SLIDE = 0.12;   // вход в подкат
const MOMENTUM_AIR = 0.05;     // чистый полёт, в сек
const MOMENTUM_WALLRUN = 0.12; // бег по стене, в сек
const MOMENTUM_HITWALL = 0.3;  // множитель при ударе о стену (сильный слив)
// Бег по стенам
const WALLRUN_MIN_SPEED = 4;
const WALLRUN_TIME = 1.5;
const WALLRUN_GRAVITY = 0.25;
const WALLJUMP_PUSH = 6.5;
const DASH_SPEED = 14;
const DASH_TIME = 0.18;
const DASH_CD = 2.2;
const SHOCK_CD = 12;
const GRAPPLE_CD = 10;
const GRAPPLE_RANGE = 25;
const GRAPPLE_SPEED = 17;
const GRAPPLE_MAX_T = 1.8;
const SLIDE_TIME = 0.7;
const SLIDE_FRICTION = 1.2;
const EYE_HEIGHT = 1.55;
const EYE_HEIGHT_SLIDE = 0.9;

export class Player {
  constructor({ camera, input, physics, sfx }) {
    this.camera = camera;
    this.input = input;
    this.physics = physics;
    this.sfx = sfx;

    this.body = {
      pos: new THREE.Vector3(0, 0.1, 0), // позиция ног
      vel: new THREE.Vector3(),
      half: 0.35, height: 1.7,
    };
    this.look = { yaw: 0, pitch: 0 };    // радианы
    this.hp = 100; this.maxHp = 100;
    this.alive = true;
    this.onGround = false;
    this.jumpsLeft = 2;
    this.sprinting = false;
    this.sliding = false;
    this._slideT = 0;
    this.dashT = 0; this.dashCd = 0;
    this._dashDir = new THREE.Vector3();
    this.eyeH = EYE_HEIGHT;
    this.bobPhase = 0; this.bobAmp = 0;
    this.baseFov = 75;
    this.fovKick = 0;
    this.recoilPitch = 0; this.recoilYaw = 0; // применяется из weapons
    this._stepAcc = 0;
    this._lastJumpPressed = 0;
    this._jumpWasDown = false;
    this._dashWasDown = false;
    this._slideWasDown = false;
    this._shockWasDown = false;
    this._grappleWasDown = false;
    this._regenDelay = 0;
    this.landImpact = 0;

    // Модификаторы режима (носитель кешбокса и т.п.)
    this.speedMul = 1;       // множитель скорости (режим/события)
    this.sprintLock = false; // запрет спринта (носитель)

    // Скил E — ударная волна
    this.shockCd = 0;
    this.onShockwave = null; // cb(pos) — радиальный урон/разрушение снаружи

    // Скил F — крюк
    this.grapple = { active: false, cd: 0, t: 0, point: new THREE.Vector3() };
    this.onGrapple = null;   // cb(point) — визуал/звук снаружи

    // Ритм-хуки (main): дэш возвращает множитель дальности (на бите ×1.2)
    this.onDash = null;      // cb() -> rangeMul
    this.onJump = null;      // cb(isDouble)
    this.onSlide = null;     // cb()
    this._dashSpeedMul = 1;

    this._fwd = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._wish = new THREE.Vector3();
    this._v1 = new THREE.Vector3(); this._v2 = new THREE.Vector3(); this._v3 = new THREE.Vector3();
    this._vaultCd = 0; this._mantleAnim = 0;
    this.hitKick = 0; this.crouching = false; this.weaponMoveMul = 1;
    this.arenaHalf = 40; // радиус арены (main выставляет при rebuildArena)

    // Моментум (скорость за чистое перемещение) и бег по стенам
    this.momentum = 0;
    this._justLanded = 0;      // окно bhop после приземления
    this.wallRun = { active: false, side: 0, normal: new THREE.Vector3(), t: 0 };
    this._wallRunCd = 0;       // пауза после wall-jump (нет мгновенного переприлипания)
  }

  get position() { return this.body.pos; }
  get eyePos() {
    return new THREE.Vector3(this.body.pos.x, this.body.pos.y + this.eyeH, this.body.pos.z);
  }
  get speed() { return Math.hypot(this.body.vel.x, this.body.vel.z); }

  spawn(point, yaw = 0) {
    this.body.pos.copy(point);
    this.body.vel.set(0, 0, 0);
    this.look.yaw = yaw; this.look.pitch = 0;
    this.hp = this.maxHp; this.alive = true;
    this.dashCd = 0; this.dashT = 0; this.sliding = false;
    this.momentum = 0; this._justLanded = 0;
    this.wallRun.active = false; this.wallRun.side = 0; this._wallRunCd = 0;
  }

  damage(amount) {
    if (!this.alive) return;
    this.hp -= amount;
    this._regenDelay = 5; // The Finals: регреген только после 5с без урона
    this.hitKick = Math.min(1, (this.hitKick || 0) + 0.55); // тряска камеры от попадания
    this.sfx?.hurt();
    const v = document.getElementById('damage-vignette');
    if (v) { v.style.opacity = '1'; setTimeout(() => { v.style.opacity = '0'; }, 200); }
    if (this.onDamaged) this.onDamaged(amount);
    if (this.hp <= 0) { this.hp = 0; this.alive = false; if (this.onDeath) this.onDeath(); }
  }

  update(dt) {
    if (!this.alive) return;
    const inp = this.input;
    const body = this.body;

    // --- Обзор: мышь/тач + гироскоп (аддитивно, параллельно) ---
    const d = inp.consumeLookDelta();
    this.look.yaw -= d.dx;
    this.look.pitch -= d.dy;
    inp.gyro.applyToCamera(this.look, dt);
    const pitchLim = Math.PI / 2 - 0.01;
    this.look.pitch = Math.max(-pitchLim, Math.min(pitchLim, this.look.pitch));

    // --- Кнопки ---
    const jumpDown = inp.isDown('Space') || inp.touch.jump;
    const dashDown = inp.isDown('KeyQ') || inp.touch.dash;
    const slideDown = inp.isDown('ControlLeft') || inp.isDown('KeyC');
    const shockDown = inp.isDown('KeyE') || inp.touch.shock;
    const grappleDown = inp.isDown('KeyF') || inp.touch.grapple;
    this.sprinting = !this.sprintLock &&
      (inp.isDown('ShiftLeft') || inp.isDown('ShiftRight') || (inp.isTouch && Math.hypot(inp.touch.moveX, inp.touch.moveY) > 0.92));

    // --- Направления ---
    this._fwd.set(-Math.sin(this.look.yaw), 0, -Math.cos(this.look.yaw));
    this._right.set(-this._fwd.z, 0, this._fwd.x);
    const axes = inp.getMoveAxes();
    this._wish.set(0, 0, 0)
      .addScaledVector(this._fwd, axes.z)
      .addScaledVector(this._right, axes.x);
    if (this._wish.lengthSq() > 1) this._wish.normalize();

    // GROOVE: непрерывные множители силы действий (0 при отсутствии метра)
    const groove = activeGroove();
    const grooveRun = groove?.runMul ?? 1;
    const cdRate = 1 / (groove?.cooldownMul ?? 1); // КД 1.0→0.85 = быстрее откат

    // --- Дэш ---
    if (this.dashCd > 0) this.dashCd -= dt * cdRate;
    if (dashDown && !this._dashWasDown && this.dashCd <= 0) {
      this.dashT = DASH_TIME;
      this.dashCd = DASH_CD;
      this._dashDir.copy(this._wish.lengthSq() > 0.01 ? this._wish : this._fwd).normalize();
      // Ритм-бонус: дэш на бите — +20% дальности (точечный, из main через onDash).
      // GROOVE: непрерывная дальность дэша ×0.9→1.3 — стекается перемножением.
      this._dashSpeedMul = (this.onDash?.() || 1) * (groove?.dashMul ?? 1);
      this.sfx?.dash();
      this.fovKick = Math.min(this.fovKick + 10, 14);
    }
    this._dashWasDown = dashDown;

    // --- Скил E: ударная волна ---
    if (this.shockCd > 0) this.shockCd -= dt * cdRate;
    if (shockDown && !this._shockWasDown && this.shockCd <= 0) {
      this.shockCd = SHOCK_CD;
      this.fovKick = Math.min(this.fovKick + 8, 14);
      // GROOVE: радиус/урон shockwave ×0.9→1.4 передаём вторым аргументом
      // (обратно-совместимо: старый обработчик main(pos) его игнорирует)
      if (this.onShockwave) this.onShockwave(this.body.pos, groove?.shockMul ?? 1);
    }
    this._shockWasDown = shockDown;

    // --- Скил F: крюк ---
    const gr = this.grapple;
    if (gr.cd > 0) gr.cd -= dt * cdRate;
    if (grappleDown && !this._grappleWasDown && gr.cd <= 0 && !gr.active) {
      // Точка прицела: raycast из глаз по направлению камеры
      // GROOVE: дальность крюка 25м→32м
      const eye = this.eyePos;
      const dir = new THREE.Vector3();
      this.camera.getWorldDirection(dir);
      const hit = this.physics.raycast(eye, dir, GRAPPLE_RANGE * (groove?.grappleRangeMul ?? 1));
      if (hit) {
        gr.active = true;
        gr.t = 0;
        gr.cd = GRAPPLE_CD;
        gr.point.copy(hit.point);
        this.onGround = false;
        this.sfx?.dash();
        if (this.onGrapple) this.onGrapple(gr.point);
      }
    }
    this._grappleWasDown = grappleDown;
    if (gr.active) {
      gr.t += dt;
      const toPoint = this._fwd.copy(gr.point).sub(body.pos); // _fwd как временный (пересчитается в след. кадре)
      const dist = toPoint.length();
      if (dist < 2 || gr.t > GRAPPLE_MAX_T) {
        gr.active = false;
      } else {
        toPoint.normalize();
        body.vel.copy(toPoint).multiplyScalar(GRAPPLE_SPEED);
      }
      this._wish.set(0, 0, 0); // во время полёта не суммировать с обычным ускорением
    }

    // --- Слайд / присед (The Finals: Ctrl в беге = подкат, стоя = присед) ---
    if (slideDown && !this._slideWasDown && this.onGround && this.speed > 5.5 && this.sprinting && !this.sliding) {
      this.sliding = true;
      this._slideT = SLIDE_TIME;
      this.momentum = Math.min(1, this.momentum + MOMENTUM_SLIDE); // подкат разгоняет
      this.sfx?.slide();
      this.onSlide?.();
    }
    this._slideWasDown = slideDown;
    if (this.sliding) {
      this._slideT -= dt;
      if (this._slideT <= 0 || this.speed < 2 || !this.onGround) this.sliding = false;
    }
    // Присед: удерживаем Ctrl/C на месте или в медленном движении (не в подкате)
    this.crouching = !this.sliding && slideDown && this.onGround && this.speed <= 5.5;

    // --- Бег по стенам: детект до прыжков (wall-jump перехватывает прыжок) ---
    this._updateWallRun(dt);

    // --- Прыжки (буфер + двойной + от стены) ---
    if (jumpDown && !this._jumpWasDown) this._lastJumpPressed = 0.12;
    this._jumpWasDown = jumpDown;
    if (this._lastJumpPressed > 0) {
      this._lastJumpPressed -= dt;
      if (this.wallRun.active) {
        // Отпрыгивание от стены: по нормали + вверх, моментум сохраняется и растёт
        const n = this.wallRun.normal;
        body.vel.x += n.x * WALLJUMP_PUSH;
        body.vel.z += n.z * WALLJUMP_PUSH;
        body.vel.y = JUMP_VEL * 0.95;
        this.wallRun.active = false; this.wallRun.side = 0;
        this._wallRunCd = 0.3;
        this._lastJumpPressed = 0;
        this.momentum = Math.min(1, this.momentum + 0.10);
        this.sfx?.jump();
        this.onJump?.(false);
        this.fovKick = Math.min(this.fovKick + 6, 14);
      } else if (this.onGround) {
        body.vel.y = JUMP_VEL;
        this.onGround = false;
        this.jumpsLeft = 1;
        // bhop: прыжок в окне сразу после приземления — моментум растёт
        if (this._justLanded > 0) this.momentum = Math.min(1, this.momentum + MOMENTUM_BHOP);
        this._justLanded = 0;
        this._lastJumpPressed = 0;
        this.sfx?.jump();
        this.onJump?.(false);
      } else if (this.jumpsLeft > 0) {
        body.vel.y = JUMP_VEL * 0.9;
        this.jumpsLeft--;
        this._lastJumpPressed = 0;
        this.sfx?.jump();
        this.onJump?.(true);
      }
    }

    // --- Горизонтальное ускорение (Quake) ---
    const vel = body.vel;
    if (this.dashT > 0) {
      this.dashT -= dt;
      vel.x = this._dashDir.x * DASH_SPEED * this._dashSpeedMul;
      vel.z = this._dashDir.z * DASH_SPEED * this._dashSpeedMul;
      if (vel.y < 0) vel.y = 0; // дэш гасит падение
    } else if (this.onGround) {
      if (this.sliding) {
        // Слайд: низкое трение, лёгкое ускорение вниз по склону (просто сохраняем скорость)
        const sp = this.speed;
        if (sp > 0.01) {
          const drop = sp * SLIDE_FRICTION * dt;
          const k = Math.max(sp - drop, 0) / sp;
          vel.x *= k; vel.z *= k;
        }
      } else {
        // Friction
        const sp = this.speed;
        if (sp > 0.01) {
          const drop = sp * FRICTION * dt;
          const k = Math.max(sp - drop, 0) / sp;
          vel.x *= k; vel.z *= k;
        } else { vel.x = 0; vel.z = 0; }
        // Accelerate (GROOVE: тонкий бонус скорости бега ×1.0→1.08)
        // Моментум поднимает потолок скорости: ×1 → ×2.3 при полном разгоне
        const maxSp = (this.sprinting ? SPRINT_SPEED : WALK_SPEED) * this.speedMul * grooveRun
          * (this.weaponMoveMul || 1) * (this.crouching ? 0.55 : 1)
          * (1 + MOMENTUM_MAX_BOOST * this.momentum);
        const cur = vel.x * this._wish.x + vel.z * this._wish.z;
        const add = Math.min(GROUND_ACCEL * dt, Math.max(maxSp - cur, 0));
        vel.x += this._wish.x * add;
        vel.z += this._wish.z * add;
      }
    } else {
      // Air control (bhop: без трения, скорость сохраняется; моментум поднимает потолок)
      const maxSp = (this.sprinting ? SPRINT_SPEED : WALK_SPEED) * this.speedMul * grooveRun
        * (this.weaponMoveMul || 1)
        * (1 + MOMENTUM_MAX_BOOST * this.momentum);
      const cur = vel.x * this._wish.x + vel.z * this._wish.z;
      const add = Math.min(AIR_ACCEL * dt, Math.max(maxSp - cur, 0));
      vel.x += this._wish.x * add;
      vel.z += this._wish.z * add;
    }

    // --- Гравитация (на стене — сильно слабее, скольжение вниз ограничено) ---
    vel.y += this.physics.gravity * (this.wallRun.active ? WALLRUN_GRAVITY : 1) * dt;
    if (this.wallRun.active && vel.y < -2.5) vel.y = -2.5;

    // --- Столкновения ---
    const wasAirborne = !this.onGround;
    const fallSpeed = -vel.y;
    const res = this.physics.moveBody(body, dt);
    this.onGround = res.onGround;
    // Удар о стену сливает моментум (во время wall-run контакт штатный — не считаем)
    if (res.hitWall && !this.wallRun.active && !this.grapple.active) {
      this.momentum *= MOMENTUM_HITWALL;
    }
    if (this.onGround) {
      this.jumpsLeft = 1; // остался двойной прыжок после касания
      if (wasAirborne) this._justLanded = 0.12; // окно bhop
      if (wasAirborne && fallSpeed > 8) {
        this.landImpact = Math.min(1, fallSpeed / 20);
        this.sfx?.step();
      }
      if (this.wallRun.active) { this.wallRun.active = false; this.wallRun.side = 0; }
    }
    if (this._justLanded > 0) this._justLanded -= dt;
    // Моментум: полёт и wall-run копят, бег по земле без прыжков медленно сливает
    if (!this.onGround) this.momentum = Math.min(1, this.momentum + MOMENTUM_AIR * dt);
    if (this.wallRun.active) this.momentum = Math.min(1, this.momentum + MOMENTUM_WALLRUN * dt);
    if (this.onGround && !this.sliding) {
      const decay = this.speed > 1 ? 0.10 : 0.6;
      this.momentum = Math.max(0, this.momentum - decay * dt);
    }

    // Падение за арену / в пустоту = смерть (kill-объём)
    const ah = this.arenaHalf || 40;
    if (body.pos.y < -10 || Math.abs(body.pos.x) > ah + 6 || Math.abs(body.pos.z) > ah + 6) {
      this.lastDeathCause = 'fall'; // анонсер HUMILIATION в main
      this.damage(9999);
      return;
    }

    // --- Head-bob и шаги ---
    const spd = this.speed;
    if (this.onGround && spd > 0.5 && !this.sliding) {
      this.bobPhase += dt * (6 + spd * 1.1);
      this.bobAmp += (Math.min(spd / SPRINT_SPEED, 1) - this.bobAmp) * dt * 8;
      this._stepAcc += dt * spd;
      if (this._stepAcc > 2.6) { this._stepAcc = 0; this.sfx?.step(); }
    } else {
      this.bobAmp += (0 - this.bobAmp) * dt * 6;
    }

    // --- Высота глаз (слайд / присед) ---
    const targetEye = this.sliding ? EYE_HEIGHT_SLIDE : this.crouching ? 1.05 : EYE_HEIGHT;
    this.eyeH += (targetEye - this.eyeH) * Math.min(1, dt * 10);

    // --- Реген HP (The Finals: быстрый, после 5с без урона) ---
    if (this._regenDelay > 0) this._regenDelay -= dt;
    else if (this.hp < this.maxHp) this.hp = Math.min(this.maxHp, this.hp + 20 * dt);

    // --- Паркур: перелаз через низкие / забраться на высокие (The Finals) ---
    this._tryVault(jumpDown, dt);

    // --- Камера ---
    this._updateCamera(dt, spd);
  }

  // Бег по стенам: в воздухе рядом со стеной (рейкасты влево/вправо от корпуса)
  // — гравитация слабая, скорость вдоль стены, камера кренится. Повторный
  // прыжок — отпрыгивание (см. блок прыжков в update).
  _updateWallRun(dt) {
    const wr = this.wallRun;
    if (this._wallRunCd > 0) { this._wallRunCd -= dt; wr.active = false; wr.side = 0; return; }
    const canRun = !this.onGround && this.dashT <= 0 && !this.grapple.active
      && this.speed > WALLRUN_MIN_SPEED;
    if (!canRun) { wr.active = false; wr.side = 0; return; }
    const o = this._v1.set(this.body.pos.x, this.body.pos.y + 0.9, this.body.pos.z);
    const hitR = this.physics.raycast(o, this._v2.copy(this._right), 0.7);
    const hitL = this.physics.raycast(o, this._v2.copy(this._right).negate(), 0.7);
    let side = 0, wall = null;
    if (hitR && (!hitL || hitR.dist <= hitL.dist)) { side = 1; wall = hitR; }
    else if (hitL) { side = -1; wall = hitL; }
    // Гистерезис: продолжаем по текущей стороне, пока стена есть
    if (wr.active && wr.side !== 0) {
      const same = wr.side === 1 ? hitR : hitL;
      if (same) { side = wr.side; wall = same; }
    }
    if (!wall || Math.abs(wall.normal.y) > 0.35) { wr.active = false; wr.side = 0; return; }
    const fresh = !wr.active || wr.side !== side;
    if (fresh) { wr.t = 0; this.sfx?.slide?.(); }
    wr.active = true; wr.side = side;
    wr.normal.copy(wall.normal);
    wr.t += dt;
    if (wr.t > WALLRUN_TIME) { wr.active = false; wr.side = 0; return; }
    // Движение вдоль стены: убираем компоненту скорости в нормаль, лёгкое прилипание
    const vel = this.body.vel;
    const n = wr.normal;
    const dot = vel.x * n.x + vel.z * n.z;
    vel.x -= n.x * dot; vel.z -= n.z * dot;
    vel.x -= n.x * 8 * dt; vel.z -= n.z * 8 * dt;
    // Минимальный ход вдоль стены — бег не умирает на месте
    const sp = Math.hypot(vel.x, vel.z);
    if (sp > 0.01 && sp < 6) { const k = 6 / sp; vel.x *= k; vel.z *= k; }
  }

  // Перелаз/закарабкивание: если упёрлись в препятствие при движении вперёд —
  // луч вперёд на уровне колен, замер высоты верхней грани, толчок вверх.
  _tryVault(jumpDown, dt) {
    if (this._vaultCd > 0) { this._vaultCd -= dt; return; }
    if (this._wish.lengthSq() < 0.3 || this.dashT > 0 || this.grapple.active) return;
    const blocked = this.onGround && this.speed < 2.6;
    const wantMantle = !this.onGround && jumpDown; // в прыжке по направлению к стене
    if (!blocked && !wantMantle) return;
    const o = this._v1.set(this.body.pos.x, this.body.pos.y + 0.45, this.body.pos.z);
    const d = this._v2.copy(this._wish).normalize();
    const wall = this.physics.raycast(o, d, 0.95);
    if (!wall) return;
    // Верх препятствия: луч вниз из точки над препятствием
    const topO = this._v1.set(
      this.body.pos.x + d.x * (wall.dist + 0.35),
      this.body.pos.y + 3.1,
      this.body.pos.z + d.z * (wall.dist + 0.35));
    const top = this.physics.raycast(topO, this._v3.set(0, -1, 0), 3.1);
    if (!top) return; // нет грани сверху — слишком высоко
    const clear = top.point.y - this.body.pos.y;
    if (clear <= 0.35) return; // ступенька — и так поднимемся
    if (clear <= 1.35 && this.onGround) {
      // Перелаз: плавный подброс + перенос вперёд
      this.body.vel.y = 6.4;
      this.body.vel.x += d.x * 2.4; this.body.vel.z += d.z * 2.4;
      this.onGround = false;
      this._vaultCd = 0.45; this._mantleAnim = 0.32;
      this.sfx?.jump(); this.onJump?.(false);
    } else if (clear <= 2.75 && (jumpDown || wantMantle)) {
      // Закарабкивание на высокий объект: сильнее, дольше, с просадкой камеры
      this.body.vel.y = 8.6;
      this.body.vel.x += d.x * 1.6; this.body.vel.z += d.z * 1.6;
      this.onGround = false;
      this._vaultCd = 0.7; this._mantleAnim = 0.55;
      this.sfx?.jump(); this.onJump?.(true);
    }
  }

  _updateCamera(dt, spd) {
    const cam = this.camera;
    cam.position.set(this.body.pos.x, this.body.pos.y + this.eyeH, this.body.pos.z);

    // Bob
    const bobY = Math.abs(Math.sin(this.bobPhase)) * 0.045 * this.bobAmp;
    const bobX = Math.cos(this.bobPhase) * 0.025 * this.bobAmp;
    cam.position.y += bobY;
    cam.position.x += bobX * Math.cos(this.look.yaw);
    cam.position.z -= bobX * Math.sin(this.look.yaw);

    // Land dip
    if (this.landImpact > 0) {
      cam.position.y -= this.landImpact * 0.25;
      this.landImpact = Math.max(0, this.landImpact - dt * 4);
    }

    // Паркур-анимация камеры: перелаз/закарабкивание — наклон вперёд + dip
    if (this._mantleAnim > 0) {
      const m = this._mantleAnim;
      cam.position.y -= Math.sin(Math.min(1, m * 3) * Math.PI) * 0.10;
      this._mantlePitch = Math.sin(Math.min(1, m * 2.2) * Math.PI) * 0.10;
      this._mantleAnim = Math.max(0, this._mantleAnim - dt);
    } else this._mantlePitch = 0;

    // Тряска от попаданий по нам (Point Blank: резкий джолт + затухание)
    this._hitShakeX = 0; this._hitShakeZ = 0;
    if (this.hitKick > 0) {
      const k = this.hitKick;
      this._hitT = (this._hitT || 0) + dt * 60;
      this._hitShakeX = Math.sin(this._hitT * 1.3) * 0.028 * k;
      this._hitShakeZ = Math.sin(this._hitT * 1.7 + 1) * 0.022 * k;
      this.hitKick = Math.max(0, this.hitKick - dt * 3.2);
    }

    cam.rotation.order = 'YXZ';
    // Отдача восстанавливается
    this.recoilPitch *= Math.max(0, 1 - dt * 7);
    this.recoilYaw *= Math.max(0, 1 - dt * 7);
    cam.rotation.y = this.look.yaw + this.recoilYaw;
    cam.rotation.x = this.look.pitch + this.recoilPitch + (this._mantlePitch || 0) + this._hitShakeX;
    // Наклон при слайде, стрейфе и беге по стене (+ extraRoll извне: бас-кач от музыки)
    const axes = this.input.getMoveAxes();
    const targetRoll = (this.sliding ? 0.14 : 0) + axes.x * -0.012 + (this.extraRoll || 0) + this._hitShakeZ
      + (this.wallRun.active ? -this.wallRun.side * 0.16 : 0);
    cam.rotation.z += (targetRoll - cam.rotation.z) * Math.min(1, dt * 8);

    // FOV: скорость + дэш + ADS (из weapons через fovAds); кап — моментум до ×2.3
    const speedFov = Math.min(14, Math.max(0, (spd - WALK_SPEED) / (SPRINT_SPEED - WALK_SPEED)) * 6);
    this.fovKick = Math.max(0, this.fovKick - dt * 30);
    const target = this.baseFov + speedFov + this.fovKick - (this.fovAds || 0);
    if (Math.abs(cam.fov - target) > 0.05) {
      cam.fov += (target - cam.fov) * Math.min(1, dt * 10);
      cam.updateProjectionMatrix();
    }
  }
}
