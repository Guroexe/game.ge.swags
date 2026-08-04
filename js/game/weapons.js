// ===== GEN.SWAGS Weapons =====
// Hitscan-стрельба: pattern-отдача, spread, ADS, перезарядка, трассеры,
// декали, хитмаркеры, урон по частям, muzzle flash, дробовик.
import * as THREE from 'three';
import { createViewmodel, flatMat } from '../engine/models.js';
import { upgradeViewmodel } from '../engine/assetlib.js';
import { activeGroove } from './rhythm.js';
import { GoreSystem } from './gore.js';

const WEAPONS = {
  rifle: {
    name: 'АК-47', jp: '突撃銃',
    damage: 16, headMul: 2, rpm: 640, mag: 30, reloadTime: 1.6,
    spreadBase: 0.012, spreadMax: 0.05, spreadAdd: 0.006,
    recoilVert: 0.011, recoilWeave: 0.006, kick: 0.55,
    auto: true, pellets: 1, range: 120, adsFov: 14,
    fallStart: 30, fallEnd: 70, fallMin: 0.6, vm: 'rifle', reloadFx: 'magflip',
  },
  smg: {
    name: 'УЗИ', jp: '短機関銃',
    damage: 11, headMul: 1.8, rpm: 950, mag: 40, reloadTime: 1.35,
    spreadBase: 0.018, spreadMax: 0.07, spreadAdd: 0.005,
    recoilVert: 0.007, recoilWeave: 0.008, kick: 0.4,
    auto: true, pellets: 1, range: 70, adsFov: 10,
    fallStart: 16, fallEnd: 42, fallMin: 0.45, vm: 'smg', reloadFx: 'spin',
  },
  shotgun: {
    name: 'SPAS-12', jp: '散弾銃',
    damage: 9, headMul: 1.6, rpm: 75, mag: 6, reloadTime: 2.2,
    spreadBase: 0.045, spreadMax: 0.09, spreadAdd: 0.01,
    recoilVert: 0.05, recoilWeave: 0.02, kick: 1.4,
    auto: false, pellets: 8, range: 40, adsFov: 6,
    fallStart: 8, fallEnd: 24, fallMin: 0.25, vm: 'shotgun', reloadFx: 'pump',
  },
  dmr: {
    name: 'СВД', jp: '狙撃銃',
    damage: 55, headMul: 2.5, rpm: 110, mag: 8, reloadTime: 2.0,
    spreadBase: 0.002, spreadMax: 0.02, spreadAdd: 0.012,
    recoilVert: 0.045, recoilWeave: 0.006, kick: 1.6,
    auto: false, pellets: 1, range: 220, adsFov: 34,
    fallStart: 60, fallEnd: 140, fallMin: 0.75, vm: 'dmr', reloadFx: 'bolt',
  },
  lmg: {
    name: 'ПКМ', jp: '機関銃',
    damage: 14, headMul: 1.7, rpm: 540, mag: 80, reloadTime: 3.4,
    spreadBase: 0.02, spreadMax: 0.055, spreadAdd: 0.004,
    recoilVert: 0.009, recoilWeave: 0.010, kick: 0.7,
    auto: true, pellets: 1, range: 110, adsFov: 12,
    fallStart: 35, fallEnd: 80, fallMin: 0.6, vm: 'lmg', moveMul: 0.88, reloadFx: 'toss',
  },
  revolver: {
    name: 'МАГНУМ .44', jp: '拳銃',
    damage: 34, headMul: 2.2, rpm: 220, mag: 6, reloadTime: 1.9,
    spreadBase: 0.006, spreadMax: 0.03, spreadAdd: 0.014,
    recoilVert: 0.03, recoilWeave: 0.008, kick: 1.1,
    auto: false, pellets: 1, range: 90, adsFov: 8,
    fallStart: 25, fallEnd: 55, fallMin: 0.5, vm: 'revolver', reloadFx: 'drum',
  },
  // ============ НОВЫЕ СТВОЛЫ (выпадают случайно на респавне) ============
  awp: {
    name: 'AWP', jp: '鬼狙',
    damage: 120, headMul: 2.5, rpm: 45, mag: 5, reloadTime: 2.6,
    spreadBase: 0.001, spreadMax: 0.012, spreadAdd: 0.01,
    recoilVert: 0.06, recoilWeave: 0.008, kick: 2.2,
    auto: false, pellets: 1, range: 400, adsFov: 48,
    fallStart: 100, fallEnd: 300, fallMin: 0.85, vm: 'awp', reloadFx: 'bolt',
  },
  flamer: {
    name: 'ОГНЕМЁТ «РЫСЬ»', jp: '火炎放射',
    damage: 7, headMul: 1, rpm: 900, mag: 100, reloadTime: 2.8,
    spreadBase: 0.05, spreadMax: 0.08, spreadAdd: 0.002,
    recoilVert: 0.002, recoilWeave: 0.002, kick: 0.15,
    auto: true, pellets: 1, range: 14, adsFov: 4,
    fallStart: 6, fallEnd: 14, fallMin: 0.3, vm: 'flamer', flame: true, reloadFx: 'vent',
  },
  rocket: {
    name: 'РПГ-7', jp: '雷神砲',
    damage: 90, headMul: 1, rpm: 60, mag: 1, reloadTime: 2.4,
    spreadBase: 0.004, spreadMax: 0.01, spreadAdd: 0.002,
    recoilVert: 0.05, recoilWeave: 0.01, kick: 2.4,
    auto: false, pellets: 1, range: 200, adsFov: 10,
    fallStart: 999, fallEnd: 1000, fallMin: 1, vm: 'rocket',
    projectile: 'rocket', reloadFx: 'spin',
  },
  gl: {
    name: 'ГМ-94', jp: '化榴砲',
    damage: 55, headMul: 1, rpm: 90, mag: 4, reloadTime: 2.6,
    spreadBase: 0.006, spreadMax: 0.014, spreadAdd: 0.004,
    recoilVert: 0.04, recoilWeave: 0.008, kick: 1.8,
    auto: false, pellets: 1, range: 120, adsFov: 8,
    fallStart: 999, fallEnd: 1000, fallMin: 1, vm: 'gl',
    projectile: 'shell', reloadFx: 'drum',
  },
};
const SLOT_ORDER = ['rifle', 'smg', 'shotgun', 'dmr', 'lmg', 'revolver', 'awp', 'flamer', 'rocket', 'gl'];

export class WeaponSystem {
  constructor({ scene, camera, player, physics, sfx, destruction }) {
    this.scene = scene;
    this.camera = camera;
    this.player = player;
    this.physics = physics;
    this.sfx = sfx;
    this.destruction = destruction;

    // Филлайт для видовой модели (классический FPS-трюк)
    const fill = new THREE.PointLight(0xfff0e0, 3, 2.5, 1.5);
    fill.position.set(0.1, 0.1, -0.2);
    camera.add(fill);

    this.slots = SLOT_ORDER.map((kind) => {
      const def = WEAPONS[kind];
      const vm = createViewmodel(def.vm);
      vm.group.visible = false;
      camera.add(vm.group);
      // GLB low-poly реальная модель оружия (assets/weapons/) —
      // АК/УЗИ/SPAS/СВД/ПКМ/Магнум/AWP/РПГ/ГМ/огнемёт.
      // upgradeViewmodel — асинхронный: сначала прячет процедурный корпус,
      // потом подгружает GLB и перетаскивает магазин/muzzle.
      upgradeViewmodel(vm, def.vm).catch((e) => {
        console.warn('[weapons] GLB upgrade fail, остаётся процедурная:', def.vm, e);
      });
      return { kind, def, vm, ammo: def.mag, cooldown: 0 };
    });
    this.current = 0;
    this.slots[0].vm.group.visible = true;
    // Владение: на респавне выдаётся ОДИН случайный ствол (randomizeLoadout)
    this.owned = new Set(SLOT_ORDER);
    this._dead = false;

    // --- Пул снарядов (ракетница/гранатомёт) ---
    this._projPool = [];
    const rocketGeo = new THREE.ConeGeometry(0.06, 0.3, 6);
    rocketGeo.rotateX(Math.PI / 2); // остриём вперёд
    const shellGeo = new THREE.SphereGeometry(0.09, 8, 6);
    for (let i = 0; i < 8; i++) {
      const isRocket = i % 2 === 0;
      const m = new THREE.Mesh(isRocket ? rocketGeo : shellGeo,
        new THREE.MeshStandardMaterial({
          color: isRocket ? 0x3a3f4a : 0x2e2f36,
          emissive: isRocket ? 0xff6a20 : 0xff2d55, emissiveIntensity: 1.4, flatShading: true,
        }));
      m.visible = false;
      scene.add(m);
      this._projPool.push({ mesh: m, active: false, vel: new THREE.Vector3(), kind: 'rocket', fuse: 0, trailT: 0 });
    }

    // --- Частицы огня (огнемёт) ---
    this._flamePool = [];
    const flameMat = new THREE.SpriteMaterial({
      map: this._makeFlashTexture?.() || null, color: 0xff7a20, transparent: true,
      opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    for (let i = 0; i < 26; i++) {
      const s = new THREE.Sprite(flameMat.clone());
      s.visible = false;
      scene.add(s);
      this._flamePool.push({ s, life: 0, vel: new THREE.Vector3() });
    }
    this._flameTick = 0;

    this.spread = 0;
    this.shotIndex = 0;      // для pattern-отдачи
    this.recoverT = 0;
    this.reloading = false;
    this._triggerWasDown = false;
    this._reloadWasDown = false;
    this._weapWasDown = false;
    this._nadeWasDown = false;
    this._dmgMulExt = 1;     // внешний множитель урона (FLOW/DROP/CLASH), пишет main

    // --- Гранаты ---
    this.grenades = 2;
    this.maxGrenades = 3;
    this._nadePool = [];
    const nadeGeo = new THREE.SphereGeometry(0.12, 8, 6);
    const nadeMat = new THREE.MeshStandardMaterial({ color: 0x2e2f36, emissive: 0xff2d55, emissiveIntensity: 1.2, flatShading: true });
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(nadeGeo, nadeMat);
      m.visible = false;
      scene.add(m);
      this._nadePool.push({ mesh: m, active: false, vel: new THREE.Vector3(), fuse: 0 });
    }

    // Цели (боты) — регистрируются снаружи: [{hitTest(ray)->{point,part,target}|null}]
    this.targets = [];

    // --- Трассеры (пул линий) ---
    this._tracers = [];
    const tracerMat = new THREE.LineBasicMaterial({ color: 0xffc860, transparent: true, opacity: 0.9 });
    const tracerGeo = new THREE.BufferGeometry();
    tracerGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    for (let i = 0; i < 24; i++) {
      const line = new THREE.Line(tracerGeo.clone(), tracerMat.clone());
      line.visible = false;
      line.frustumCulled = false;
      scene.add(line);
      this._tracers.push({ line, life: 0 });
    }

    // --- Декали-дырки (пул спрайтов) ---
    this._decals = [];
    const decalMat = new THREE.MeshBasicMaterial({
      color: 0x0a0a0a, transparent: true, opacity: 0.85,
      polygonOffset: true, polygonOffsetFactor: -2, depthWrite: false,
    });
    const decalGeo = new THREE.CircleGeometry(0.07, 6);
    for (let i = 0; i < 40; i++) {
      const d = new THREE.Mesh(decalGeo, decalMat);
      d.visible = false;
      scene.add(d);
      this._decals.push({ mesh: d, life: 0 });
    }
    this._decalIdx = 0;

    // --- Кровь/гуро (18+): бурсты частиц + сплаты на полу ---
    this.gore = new GoreSystem(scene);

    // --- Muzzle flash ---
    this.flash = new THREE.PointLight(0xffa040, 0, 9, 2);
    scene.add(this.flash);
    const flashTex = this._makeFlashTexture();
    this.flashSprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: flashTex, color: 0xffc060, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.flashSprite.scale.setScalar(0.35);
    scene.add(this.flashSprite);

    // Вспомогательные вектора
    this._origin = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this._ray = new THREE.Ray();
    this._tmp = new THREE.Vector3();
    this._muzzleWorld = new THREE.Vector3();

    // События
    this.onHit = null; // (target, part, damage)
    this.onKill = null;
    this.onFire = null; // (origin, dir, kind) — для сетевой рассылки выстрела
    this.onAction = null; // (type) -> 'perfect'|'good'|'miss' — ритм-судья (main)
    this._reloadSpeedMul = 1; // бонус: перезарядка, завершённая на бите, ускоряет следующую
    this.mpMode = false; // MP: урон себе от своих гранат не применяем (сервер авторитетен)
  }

  _makeFlashTexture() {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    const ctx = cv.getContext('2d');
    const grad = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
    grad.addColorStop(0, 'rgba(255,240,200,1)');
    grad.addColorStop(0.4, 'rgba(255,160,60,0.8)');
    grad.addColorStop(1, 'rgba(255,80,20,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(cv);
  }

  get weapon() { return this.slots[this.current]; }

  // Множитель урона: внешний (FLOW/DROP/SOUND CLASH, пишет main каждый кадр)
  // ПЕРЕМНОЖАЕТСЯ с непрерывным GROOVE-множителем (0.90→1.25) — системы не
  // затирают друг друга. В MP урон авторитетен серверу: groove не влияет на
  // заявляемый dmg (только HUD/анимации), в соло — полный эффект.
  set dmgMul(v) { this._dmgMulExt = v; }
  get dmgMul() {
    const g = activeGroove();
    const gm = (g && !this.mpMode) ? g.dmgMul : 1;
    return this._dmgMulExt * gm;
  }
  // «Сырой» внешний множитель без groove (для диагностики)
  get dmgMulExternal() { return this._dmgMulExt; }

  switchTo(idx) {
    if (idx === this.current || idx < 0 || idx >= this.slots.length || this.reloading) return;
    // На респавне выдаётся ОДИН ствол — переключаться не на что
    if (!this.owned.has(this.slots[idx].kind)) return;
    this.weapon.vm.group.visible = false;
    this.current = idx;
    this.weapon.vm.group.visible = !this._dead;
    this.spread = 0; this.shotIndex = 0;
    if (this.sfx?.weaponChange) this.sfx.weaponChange();
    else this.sfx?.ui();
    this._updateHud();
  }

  // Случайный ствол на респавне: ровно ОДИН, патроны полные, скин виден
  randomizeLoadout() {
    const kind = SLOT_ORDER[Math.floor(Math.random() * SLOT_ORDER.length)];
    this.owned = new Set([kind]);
    this.weapon.vm.group.visible = false;
    this.current = this.slots.findIndex((s) => s.kind === kind);
    const w = this.weapon;
    w.ammo = w.def.mag;
    w.cooldown = 0;
    this.reloading = false;
    this.spread = 0; this.shotIndex = 0;
    this.setDead(false);
    this._updateHud();
    return kind;
  }

  // Смерть: ствол из рук убираем (баг «оружие висит после смерти»)
  setDead(d) {
    this._dead = d;
    this.weapon.vm.group.visible = !d;
  }

  // Стартовый ствол из настроек меню (по имени ключа)
  switchToKind(kind) {
    const idx = this.slots.findIndex((s) => s.kind === kind);
    if (idx >= 0) {
      this.weapon.vm.group.visible = false;
      this.current = idx;
      this.weapon.vm.group.visible = true;
      this._updateHud();
    }
  }

  // Каталог для меню выбора оружия
  static get catalog() { return WEAPONS; }
  static get slotOrder() { return SLOT_ORDER; }

  _updateHud() {
    const w = this.weapon;
    const nameEl = document.getElementById('weapon-name');
    const magEl = document.getElementById('ammo-mag');
    const resEl = document.getElementById('ammo-reserve');
    if (nameEl) nameEl.textContent = w.def.name;
    if (magEl) magEl.textContent = this.reloading ? '---' : String(w.ammo).padStart(3, '0');
    if (resEl) resEl.textContent = '∞'; // резерв бесконечный (перезарядка есть всегда)
  }

  _doReload(w) {
    const def = w.def;
    if (w.ammo >= def.mag) { this.sfx?.ui(); return; }
    this.reloading = true;
    // Бонус ритма: предыдущая перезарядка, завершённая на бите, ускоряет эту на 10%
    // (точечный бонус). GROOVE: непрерывная скорость перезарядки ×0.9→1.25
    // (время ÷ mult) — стекается с точечным бонусом.
    const grooveReload = activeGroove()?.reloadMul ?? 1;
    const dur = def.reloadTime * this._reloadSpeedMul / grooveReload;
    this._reloadSpeedMul = 1;
    w.vm.startReload(dur, def.reloadFx || 'magflip');
    this.sfx?.reload();
    setTimeout(() => {
      w.ammo = def.mag; // резерв бесконечный — просто заполняем магазин
      this.reloading = false;
      // Перезарядка завершена НА БИТЕ → следующая на 10% быстрее
      const j = this.onAction?.('reload_end');
      if (j === 'perfect' || j === 'good') this._reloadSpeedMul = 0.9;
      this._updateHud();
    }, dur * 1000);
  }

  throwGrenade() {
    if (this.grenades <= 0 || !this.player.alive) return false;
    const n = this._nadePool.find((g) => !g.active);
    if (!n) return false;
    this.grenades--;
    this.camera.getWorldPosition(n.mesh.position);
    this.camera.getWorldDirection(n.vel);
    n.vel.multiplyScalar(14);
    n.vel.y += 3.5;
    n.active = true;
    n.fuse = 1.7;
    n.mesh.visible = true;
    this.sfx?.slide();
    this.onAction?.('grenade');
    this._updateHud();
    return true;
  }

  _explodeNade(n) {
    n.active = false;
    n.mesh.visible = false;
    const p = n.mesh.position;
    this.sfx?.explosion();
    // Разрушение
    if (this.destruction) this.destruction.applyDamage(p, 2.6, 80);
    // Урон ботам
    for (const t of this.targets) {
      if (!t.alive || !t.pos) continue;
      const d = Math.hypot(t.pos.x - p.x, (t.pos.y + 0.8) - p.y, t.pos.z - p.z);
      if (d < 4) {
        const killed = t.damage(90 * (1 - d / 4.5) * this.dmgMul, null, 0);
        this.gore?.burst(this._tmp.set(t.pos.x, t.pos.y + 1.0, t.pos.z), null, { kill: killed });
        if (killed) { this.sfx?.kill(); if (this.onKill) this.onKill(t); }
        else if (this.onHit) this.onHit(t, 'body', 0);
      }
    }
    // Урон себе (в MP HP игрока ведёт сервер — локально не трогаем)
    if (!this.mpMode) {
      const pd = this.player.body.pos.distanceTo(p);
      if (pd < 3.5) this.player.damage(60 * (1 - pd / 4));
    }
    // Вспышка
    this.flash.position.copy(p);
    this.flash.intensity = 30;
    this.flashSprite.position.copy(p);
    this.flashSprite.material.opacity = 1;
    this.flashSprite.scale.setScalar(2.5);
  }

  _updateNades(dt) {
    for (const n of this._nadePool) {
      if (!n.active) continue;
      n.fuse -= dt;
      n.vel.y += this.physics.gravity * 0.8 * dt;
      // Отскок от стен/разрушаемых чанков/статики: raycast по вектору движения,
      // упругое отражение с затуханием 0.4
      const speed = n.vel.length();
      if (speed > 0.001) {
        this._dir.copy(n.vel).divideScalar(speed);
        const hit = this.physics.raycast(n.mesh.position, this._dir, speed * dt + 0.12);
        if (hit && hit.tag !== 'floor') {
          const dot = n.vel.dot(hit.normal);
          if (dot < 0) {
            n.vel.addScaledVector(hit.normal, -2 * dot).multiplyScalar(0.4);
            n.mesh.position.copy(hit.point).addScaledVector(hit.normal, 0.13);
          } else {
            n.mesh.position.addScaledVector(n.vel, dt);
          }
        } else {
          n.mesh.position.addScaledVector(n.vel, dt);
        }
      } else {
        n.mesh.position.addScaledVector(n.vel, dt);
      }
      // Простой отскок от пола
      if (n.mesh.position.y < 0.12 && n.vel.y < 0) {
        n.mesh.position.y = 0.12;
        n.vel.y *= -0.45;
        n.vel.x *= 0.7; n.vel.z *= 0.7;
      }
      if (n.fuse <= 0) this._explodeNade(n);
    }
  }

  showHitmarker(head = false) {
    const el = document.getElementById('hitmarker');
    if (!el) return;
    el.classList.toggle('head', head);
    el.classList.remove('show');
    void el.offsetWidth; // перезапуск анимации
    el.classList.add('show');
  }

  update(dt, input) {
    const w = this.weapon;
    const def = w.def;
    this.gore?.update(dt);

    // Смена оружия (1..6 — прямой выбор слота, тач-кнопка — по кругу)
    for (let i = 0; i < this.slots.length && i < 6; i++) {
      if (input.isDown(`Digit${i + 1}`)) this.switchTo(i);
    }
    if (input.touch.weapon && !this._weapWasDown) this.switchTo((this.current + 1) % this.slots.length);
    this._weapWasDown = input.touch.weapon;

    // Перезарядка
    const reloadDown = input.isDown('KeyR') || input.touch.reload;
    if (reloadDown && !this._reloadWasDown && !this.reloading && w.ammo < def.mag) {
      this._doReload(w);
    }
    this._reloadWasDown = reloadDown;

    // Граната — но с кешбоксом в руках G бросает КЕШБОКС (физика режима)
    const nadeDown = input.isDown('KeyG') || input.touch.nade;
    if (nadeDown && !this._nadeWasDown) {
      const mode = this.getMode?.();
      if (mode?.playerCarrying && mode.state === 'CARRIED' && mode.throwByPlayer) {
        const dir = new THREE.Vector3();
        this.camera.getWorldDirection(dir);
        mode.throwByPlayer(dir);
      } else {
        this.throwGrenade();
      }
    }
    this._nadeWasDown = nadeDown;
    this._updateNades(dt);
    this._updateProjectiles(dt);
    this._updateFlames(dt);

    // ADS (зум зависит от ствола: карабин приближает сильнее)
    const ads = input.aiming && !this.reloading;
    this.player.fovAds = ads ? (def.adsFov ?? 14) : 0;
    // Тяжёлое оружие (пулемёт) слегка замедляет перемещение
    this.player.weaponMoveMul = def.moveMul ?? 1;

    // Ограничение скорострельности
    if (w.cooldown > 0) w.cooldown -= dt;

    // Spread recovery
    if (this.recoverT > 0) this.recoverT -= dt;
    else this.spread = Math.max(0, this.spread - dt * 0.06);
    // Spread от движения
    const moveSpread = Math.min(this.player.speed / 10, 1) * 0.02;

    // Стрельба
    const trigger = input.firing;
    const wantShot = def.auto ? trigger : (trigger && !this._triggerWasDown);
    if (wantShot && w.cooldown <= 0 && !this.reloading && this.player.alive) {
      if (w.ammo <= 0) {
        // Автоперезарядка при пустом магазине
        this._doReload(w);
      } else {
        this._fire(ads, moveSpread);
      }
    }
    this._triggerWasDown = trigger;

    // Прицел: размер от spread
    const totalSpread = def.spreadBase + this.spread + moveSpread - (ads ? def.spreadBase * 0.7 : 0);
    const ch = document.getElementById('crosshair');
    if (ch) ch.style.setProperty('--sp', `${4 + totalSpread * 600}px`);

    // Анимация видовой модели
    w.vm.update(dt, { speed: this.player.speed, ads, grounded: this.player.onGround });

    // Затухание вспышки
    this.flash.intensity *= Math.pow(0.001, dt * 8);
    this.flashSprite.material.opacity *= Math.pow(0.001, dt * 8);

    // Трассеры
    for (const t of this._tracers) {
      if (t.life > 0) {
        t.life -= dt;
        t.line.material.opacity = Math.max(0, t.life / 0.08) * 0.9;
        if (t.life <= 0) t.line.visible = false;
      }
    }
    // Декали живут недолго (переиспользуем пул по кругу)
  }

  _fire(ads, moveSpread) {
    const w = this.weapon;
    const def = w.def;
    w.ammo--;
    w.cooldown = 60 / def.rpm;
    this._updateHud();

    // Pattern-отдача: вертикальный подброс + псевдослучайный weave по индексу выстрела
    const idx = this.shotIndex++;
    const weave = Math.sin(idx * 2.4) * def.recoilWeave + (Math.random() - 0.5) * def.recoilWeave * 0.5;
    this.player.recoilPitch += def.recoilVert * (ads ? 0.6 : 1);
    this.player.recoilYaw += weave * (ads ? 0.6 : 1);
    this.recoverT = 0.12; // recovery начинается после паузы
    this.spread = Math.min(def.spreadMax, this.spread + def.spreadAdd);
    w.vm.kick(def.kick);

    if (this.sfx?.shot) this.sfx.shot(w.kind);                       // per-kind реальный выстрел
    else if (def.pellets > 1) this.sfx?.shotgun(); else this.sfx?.shoot();

    // Muzzle flash
    w.vm.muzzle.getWorldPosition(this._muzzleWorld);
    this.flash.position.copy(this._muzzleWorld);
    this.flash.intensity = def.pellets > 1 ? 10 : 6;
    this.flashSprite.position.copy(this._muzzleWorld);
    this.flashSprite.material.opacity = 0.95;
    this.flashSprite.scale.setScalar(0.35);
    this.flashSprite.material.rotation = Math.random() * Math.PI;

    // Выстрелы (пеллеты)
    this.camera.getWorldPosition(this._origin);
    // Сетевой хук: одно сообщение на нажатие (направление без разброса)
    if (this.onFire) {
      this.camera.getWorldDirection(this._dir);
      this.onFire(this._origin.clone(), this._dir.clone(), w.kind);
    }

    // --- Снаряды: ракетница (прямой полёт) / гранатомёт (снаряд с гравитацией) ---
    if (def.projectile) {
      this.camera.getWorldDirection(this._dir);
      this._fireProjectile(this._muzzleWorld, this._dir, def.projectile);
      return;
    }
    // --- Огнемёт: конус огня + частицы пламени (hitscan на range 14) ---
    if (def.flame) this._spawnFlame(this._muzzleWorld);
    // Ритм-синк выстрела: perfect → −50% spread этой пули/пеллет
    const shotJudge = this.onAction?.('shoot');
    const spreadBeatMul = shotJudge === 'perfect' ? 0.5 : 1;
    const totalSpread = (def.spreadBase + this.spread + moveSpread - (ads ? def.spreadBase * 0.7 : 0)) * spreadBeatMul;
    for (let p = 0; p < def.pellets; p++) {
      this.camera.getWorldDirection(this._dir);
      // Конус разброса
      this._dir.x += (Math.random() - 0.5) * 2 * totalSpread;
      this._dir.y += (Math.random() - 0.5) * 2 * totalSpread;
      this._dir.z += (Math.random() - 0.5) * 2 * totalSpread;
      this._dir.normalize();
      this._traceOne(this._origin, this._dir, def);
    }
  }

  // --- Снаряды (ракетница/гранатомёт) ---
  _fireProjectile(origin, dir, kind) {
    const pr = this._projPool.find((x) => !x.active);
    if (!pr) return;
    pr.kind = kind;
    pr.active = true;
    pr.fuse = 4;
    pr.mesh.visible = true;
    pr.mesh.position.copy(origin).addScaledVector(dir, 0.3);
    pr.vel.copy(dir).multiplyScalar(kind === 'rocket' ? 30 : 22);
    if (kind === 'shell') pr.vel.y += 2.5; // подброс дугой
    pr.mesh.lookAt(this._tmp.copy(pr.mesh.position).add(dir));
    this.sfx?.slide(); // свист запуска
  }

  _explodeAt(p, dmg, radius) {
    this.sfx?.explosion();
    if (this.destruction) this.destruction.applyDamage(p, radius * 0.7, dmg);
    for (const t of this.targets) {
      if (!t.alive || !t.pos) continue;
      const d = Math.hypot(t.pos.x - p.x, (t.pos.y + 0.8) - p.y, t.pos.z - p.z);
      if (d < radius) {
        const killed = t.damage(dmg * (1 - d / (radius + 0.5)) * this.dmgMul, null, 0);
        this.gore?.burst(this._tmp.set(t.pos.x, t.pos.y + 1.0, t.pos.z), null, { kill: killed });
        if (killed) { this.sfx?.kill(); if (this.onKill) this.onKill(t); }
        else if (this.onHit) this.onHit(t, 'body', 0);
      }
    }
    if (!this.mpMode) {
      const pd = this.player.body.pos.distanceTo(p);
      if (pd < radius) this.player.damage(dmg * 0.7 * (1 - pd / (radius + 0.5)));
    }
    this.flash.position.copy(p);
    this.flash.intensity = 30;
    this.flashSprite.position.copy(p);
    this.flashSprite.material.opacity = 1;
    this.flashSprite.scale.setScalar(2.5);
  }

  _updateProjectiles(dt) {
    for (const pr of this._projPool) {
      if (!pr.active) continue;
      pr.fuse -= dt;
      if (pr.kind === 'shell') pr.vel.y += this.physics.gravity * 0.55 * dt;
      const speed = pr.vel.length();
      this._dir.copy(pr.vel).divideScalar(Math.max(0.001, speed));
      const hit = this.physics.raycast(pr.mesh.position, this._dir, speed * dt + 0.1);
      // Попадание в бота (близость < 0.75)
      let hitBot = null;
      for (const t of this.targets) {
        if (!t.alive || !t.pos) continue;
        const dx = t.pos.x - pr.mesh.position.x, dy = (t.pos.y + 0.9) - pr.mesh.position.y, dz = t.pos.z - pr.mesh.position.z;
        if (dx * dx + dy * dy + dz * dz < 0.56) { hitBot = t; break; }
      }
      if (hit || hitBot || pr.fuse <= 0) {
        const p = hit ? hit.point : pr.mesh.position;
        if (pr.kind === 'shell' && hit && !hitBot && pr.fuse > 0 && hit.tag !== 'floor') {
          // гранатомётный снаряд рикошетит от стен (один раз с затуханием)
          const dot = pr.vel.dot(hit.normal);
          if (dot < 0) {
            pr.vel.addScaledVector(hit.normal, -2 * dot).multiplyScalar(0.5);
            pr.mesh.position.copy(hit.point).addScaledVector(hit.normal, 0.1);
            pr.fuse = Math.min(pr.fuse, 0.8); // после рикошета почти сразу взрыв
            continue;
          }
        }
        pr.active = false; pr.mesh.visible = false;
        this._explodeAt(p, pr.kind === 'rocket' ? 90 : 55, pr.kind === 'rocket' ? 4.2 : 3.2);
        continue;
      }
      pr.mesh.position.addScaledVector(pr.vel, dt);
      if (pr.kind === 'rocket') {
        pr.mesh.lookAt(this._tmp.copy(pr.mesh.position).add(pr.vel));
        // дымный след ракеты
        pr.trailT -= dt;
        if (pr.trailT <= 0) {
          pr.trailT = 0.03;
          this.gore?.spark(pr.mesh.position, this._dir.clone().negate());
        }
      }
      if (pr.mesh.position.y < 0.05) { // пол
        pr.active = false; pr.mesh.visible = false;
        this._explodeAt(pr.mesh.position, pr.kind === 'rocket' ? 90 : 55, 3.5);
      }
    }
  }

  // --- Огнемёт: частицы пламени из ствола ---
  _spawnFlame(origin) {
    this._flameTick++;
    const n = 2;
    for (let i = 0; i < n; i++) {
      const f = this._flamePool.find((x) => x.life <= 0);
      if (!f) return;
      this.camera.getWorldDirection(f.vel);
      f.vel.multiplyScalar(10 + Math.random() * 4);
      f.vel.x += (Math.random() - 0.5) * 1.6;
      f.vel.y += (Math.random() - 0.5) * 1.6 + 0.6;
      f.vel.z += (Math.random() - 0.5) * 1.6;
      f.s.position.copy(origin);
      f.life = 0.5 + Math.random() * 0.25;
      f.s.visible = true;
      f.s.material.opacity = 0.85;
      f.s.material.color.setHSL(0.06 + Math.random() * 0.04, 1, 0.55);
      f.s.scale.setScalar(0.25 + Math.random() * 0.2);
    }
  }

  _updateFlames(dt) {
    for (const f of this._flamePool) {
      if (f.life <= 0) continue;
      f.life -= dt;
      f.vel.multiplyScalar(1 - dt * 2.2); // затухание скорости
      f.vel.y += dt * 2.5;                // пламя вверх
      f.s.position.addScaledVector(f.vel, dt);
      const k = Math.max(0, f.life / 0.6);
      f.s.material.opacity = k * 0.85;
      f.s.scale.addScalar(dt * 1.6);      // расширяется
      if (f.life <= 0) f.s.visible = false;
    }
  }

  _traceOne(origin, dir, def) {
    this._ray.set(origin, dir);
    // 1) Статический мир + разрушаемые чанки
    const worldHit = this.physics.raycast(origin, dir, def.range);
    // 2) Боты
    let bestTarget = null;
    let bestDist = worldHit ? worldHit.dist : def.range;
    for (const t of this.targets) {
      const hit = t.hitTest(this._ray, bestDist);
      if (hit && hit.dist < bestDist) {
        bestDist = hit.dist;
        bestTarget = hit;
      }
    }

    let endPoint;
    if (bestTarget) {
      endPoint = bestTarget.point;
      const head = bestTarget.part === 'head';
      const limb = bestTarget.part === 'limb';
      // Множитель части тела: голова ×headMul, конечности ×0.8, тело ×1
      const partMul = head ? def.headMul : limb ? 0.8 : 1;
      // Фоллофф урона по дистанции (fallStart → fallEnd до fallMin)
      let fallMul = 1;
      if (def.fallEnd > def.fallStart) {
        const t = Math.max(0, Math.min(1, (bestDist - def.fallStart) / (def.fallEnd - def.fallStart)));
        fallMul = 1 + (def.fallMin - 1) * t;
      }
      const dmg = def.damage * partMul * fallMul * this.dmgMul;
      this.sfx?.hit(head);
      this.showHitmarker(head);
      const killed = bestTarget.target.damage(dmg, dir, -1, bestTarget.part);
      // Кровь: бурст в точке попадания; хедшот — мощнее, убийство — фонтан + сплат
      this.gore?.burst(bestTarget.point, dir, { head, kill: killed });
      if (killed) this.gore?.wisp(bestTarget.point); // душа убитого поднимается
      if (this.onHit) this.onHit(bestTarget.target, bestTarget.part, dmg);
      if (killed) {
        this.sfx?.kill();
        if (this.onKill) this.onKill(bestTarget.target, { part: bestTarget.part });
      }
    } else if (worldHit) {
      endPoint = worldHit.point;
      // Урон разрушаемым чанкам
      if (worldHit.tag === 'chunk' && this.destruction) {
        this.destruction.applyDamage(worldHit.point, 0.9, def.damage);
      }
      this._spawnDecal(worldHit.point, worldHit.normal);
      this.gore?.spark(worldHit.point, worldHit.normal); // искры от попадания в мир
    } else {
      endPoint = this._tmp.copy(dir).multiplyScalar(def.range).add(origin);
    }
    this._spawnTracer(this._muzzleWorld, endPoint);
  }

  _spawnTracer(from, to) {
    let best = this._tracers[0];
    for (const t of this._tracers) { if (t.life <= 0) { best = t; break; } }
    const pos = best.line.geometry.attributes.position;
    pos.setXYZ(0, from.x, from.y, from.z);
    pos.setXYZ(1, to.x, to.y, to.z);
    pos.needsUpdate = true;
    best.line.visible = true;
    best.line.material.opacity = 0.9;
    best.life = 0.08;
  }

  _spawnDecal(point, normal) {
    const d = this._decals[this._decalIdx];
    this._decalIdx = (this._decalIdx + 1) % this._decals.length;
    d.mesh.visible = true;
    d.mesh.position.copy(point).addScaledVector(normal, 0.01);
    d.mesh.lookAt(this._tmp.copy(point).add(normal));
  }
}
