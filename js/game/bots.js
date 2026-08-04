// ===== GEN.SWAGS Bots =====
// ИИ ботов 3 команд × 3 (2 — напарники игрока). FSM: IDLE → SEEK_BOX →
// CARRY → DEFEND → ATTACK → RESPAWN. A* по waypoint-гриду арены,
// hitscan-стрельба с реакцией 250-500мс, точность от дистанции и FLOW.
import * as THREE from 'three';
import { flatMat, boxGeo, createCyberGirl } from '../engine/models.js';
import { instantiateGirl, charForTeam } from '../engine/charlib.js';
import { CashState } from './mode_cashout.js';

// Скины команд: с v5 — процедурные АНИМЕ-ДЕВУШКИ (createAnimeGirl, командные
// варианты волос/свечения/глаз). KayKit GLB остаются в assets как запасной
// пак (createRiggedCharacter сохранён в assetlib.js), но ботам/MP-игрокам
// больше не назначаются.
export const TEAM_SKINS = [
  ['Knight', 'Barbarian'],
  ['Mage'],
  ['Rogue_Hooded'],
];
export function botSkin(def, index = 0) {
  const skins = TEAM_SKINS[def.team % TEAM_SKINS.length];
  return skins[index % skins.length];
}

export const TEAMS = [
  { id: 0, name: 'ALPHA', color: 0xff2d55, css: '#ff2d55' },
  { id: 1, name: 'BRAVO', color: 0xa05cff, css: '#b388ff' },
  { id: 2, name: 'CHARLIE', color: 0x9adfff, css: '#bfe9ff' },
];

export const BotState = {
  IDLE: 'IDLE', SEEK_BOX: 'SEEK_BOX', CARRY: 'CARRY',
  DEFEND: 'DEFEND', ATTACK: 'ATTACK', RESPAWN: 'RESPAWN',
};

const BOT_SPEED = 4.6;
const CARRY_SPEED_MUL = 0.85;
const BOT_HP = 100;
const RESPAWN_TIME = 5;
const VIEW_DIST = 30;
const SHOT_DAMAGE = 10;

// Состав: 2 напарника (ALPHA) + 3 + 3
export const ROSTER = [
  { team: 0, name: 'NYA-07' }, { team: 0, name: 'MURA' },
  { team: 1, name: 'VEXA' }, { team: 1, name: 'KIRA' }, { team: 1, name: 'ZULA' },
  { team: 2, name: 'RENO' }, { team: 2, name: 'TAMA' }, { team: 2, name: 'LILU' },
];

// ---------- A* по waypoint-гриду ----------
export function findPath(waypoints, start, goal) {
  const nodes = waypoints.nodes;
  const n = nodes.length;
  if (start < 0 || goal < 0 || start >= n || goal >= n) return null;
  if (start === goal) return [goal];
  const g = new Float64Array(n).fill(Infinity);
  const f = new Float64Array(n).fill(Infinity);
  const came = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const inOpen = new Uint8Array(n);
  const open = [start];
  g[start] = 0;
  const gn = nodes[goal];
  const h = (i) => Math.hypot(nodes[i].x - gn.x, nodes[i].z - gn.z);
  f[start] = h(start);
  inOpen[start] = 1;
  let guard = 0;
  while (open.length && guard++ < 4000) {
    // Линейный минимум — узлов мало (≈200), дёшево
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (f[open[i]] < f[open[bi]]) bi = i;
    const cur = open.splice(bi, 1)[0];
    inOpen[cur] = 0;
    if (cur === goal) {
      const path = [cur];
      let c = cur;
      while (came[c] !== -1) { c = came[c]; path.push(c); }
      path.reverse();
      return path;
    }
    closed[cur] = 1;
    for (const nb of nodes[cur].neighbors) {
      if (closed[nb]) continue;
      const a = nodes[cur], b = nodes[nb];
      const cost = g[cur] + Math.hypot(a.x - b.x, a.z - b.z) + Math.abs(a.y - b.y) * 2;
      if (cost < g[nb]) {
        g[nb] = cost;
        f[nb] = cost + h(nb);
        came[nb] = cur;
        if (!inOpen[nb]) { open.push(nb); inOpen[nb] = 1; }
      }
    }
  }
  return null;
}

// ---------- Ray helpers ----------
export function raySphere(ray, center, radius) {
  const oc = new THREE.Vector3().subVectors(ray.origin, center);
  const b = oc.dot(ray.direction);
  const c = oc.lengthSq() - radius * radius;
  const disc = b * b - c;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  return t >= 0 ? t : null;
}

export function rayBox3(ray, box) {
  let tmin = 0, tmax = Infinity;
  for (const a of ['x', 'y', 'z']) {
    const inv = 1 / ray.direction[a];
    let t0 = (box.min[a] - ray.origin[a]) * inv;
    let t1 = (box.max[a] - ray.origin[a]) * inv;
    if (inv < 0) { const t = t0; t0 = t1; t1 = t; }
    tmin = Math.max(tmin, t0);
    tmax = Math.min(tmax, t1);
    if (tmax < tmin) return null;
  }
  return tmin >= 0 ? tmin : null;
}

// ============================================================
export class BotManager {
  constructor({ scene = null, physics, arena, destruction = null, sfx = null, flow = null, headless = false, gore = null }) {
    this.scene = scene;
    this.physics = physics;
    this.arena = arena;
    this.destruction = destruction;
    this.sfx = sfx;
    this.flow = flow;
    this.gore = gore;
    this.headless = headless;

    this.bots = [];
    this.mode = null;          // CashoutMode (setMode)
    this.player = null;        // Player (bindPlayer)
    this.playerTeam = 0;
    this.onKillEvent = null;   // cb(killerName, victim, byPlayer)
    this._debris = [];

    // Трассеры ботов (пул)
    this._tracers = [];
    if (!headless && scene) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      for (let i = 0; i < 18; i++) {
        const line = new THREE.Line(geo.clone(), new THREE.LineBasicMaterial({
          color: 0xffffff, transparent: true, opacity: 0.8,
        }));
        line.visible = false;
        line.frustumCulled = false;
        scene.add(line);
        this._tracers.push({ line, life: 0 });
      }
    }

    // Временные объекты (без аллокаций в цикле)
    this._v1 = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this._v3 = new THREE.Vector3();
    this._ray = new THREE.Ray();
    this._box = new THREE.Box3();
  }

  setMode(mode) { this.mode = mode; }
  // Скин из меню: применяется к девушкам команды игрока
  setPlayerSkin(skin) { this.playerSkin = skin || null; }
  bindPlayer(player, team = 0) {
    this.player = player;
    this.playerTeam = team;
  }

  // ---------- Спавн ----------
  spawnAll(roster = ROSTER) {
    roster.forEach((def, i) => this.bots.push(this._makeBot(def, i)));
    return this.bots;
  }

  // Смена состава (режимы игры: дуэль 1 бот, FFA 2 бота): старые удаляются
  // из сцены, новые спавнятся на точках своих команд.
  setRoster(defs) {
    for (const b of this.bots) b.root?.removeFromParent?.();
    this.bots = [];
    return this.spawnAll(defs);
  }

  _makeBot(def, index = 0) {
    const mgr = this;
    const team = TEAMS[def.team];
    let model = null;
    let root;
    if (this.headless) {
      root = { position: new THREE.Vector3(), rotation: { y: 0 }, visible: true };
    } else {
      // Скелетная GLB-модель (Mixamo) если загружена, иначе процедурная
      const charId = charForTeam(def.team, this.playerTeam, this.playerSkin);
      model = instantiateGirl(charId, { team: def.team }) || createCyberGirl({
        team: def.team,
        // Своя команда — в скине из меню (РОНИН/КУКЛА/ПУСТАЯ)
        skin: def.team === this.playerTeam ? this.playerSkin : null,
      });
      root = model.root;
      // Командная маркировка: светящаяся «антенна» и наплечники в цвете команды
      const matTeam = flatMat(team.color, { emissive: team.color, ei: 2.2 });
      const beacon = new THREE.Mesh(boxGeo(0.07, 0.16, 0.07), matTeam);
      beacon.position.set(0, 1.94, 0);
      root.add(beacon);
      const padL = new THREE.Mesh(boxGeo(0.16, 0.06, 0.16), matTeam);
      padL.position.set(-0.22, 1.36, 0);
      const padR = new THREE.Mesh(boxGeo(0.16, 0.06, 0.16), matTeam);
      padR.position.set(0.22, 1.36, 0);
      root.add(padL, padR);
      this.scene.add(root);
    }

    const bot = {
      name: def.name, team: def.team, teamInfo: team, isBot: true,
      model, root, pos: root.position,
      yaw: 0, speed: 0,
      hp: BOT_HP, maxHp: BOT_HP, alive: true,
      state: BotState.IDLE,
      respawnT: 0,
      // Навигация
      path: null, pathI: 0, repathT: 0,
      goalPos: new THREE.Vector3(), hasGoal: false,
      // Бой
      enemy: null, enemyDist: Infinity, reactT: 0,
      burstLeft: 0, burstPauseT: 0, shootCd: 0,
      scanT: Math.random() * 0.12, strafeDir: 1, strafeT: 0,
      // Уворот/перезарядка (взрослая боевая анимация)
      mag: 18, magSize: 18, reloadT: 0,
      dodgeT: 0, dodgeDir: 1, dodgeCd: 0,
      // Режим
      carrying: false, defendPos: null,
      // DOM-независимый hitTest (интерфейс weapons.targets)
      _headCenter: new THREE.Vector3(),
      _bodyBox: new THREE.Box3(),
      _legBox: new THREE.Box3(),
      hitTest: (ray, maxDist) => {
        if (!bot.alive) return null;
        bot._headCenter.set(bot.pos.x, bot.pos.y + 1.58, bot.pos.z);
        const headT = raySphere(ray, bot._headCenter, 0.22);
        // Тело (торс+руки): 0.55..1.38
        bot._bodyBox.min.set(bot.pos.x - 0.30, bot.pos.y + 0.55, bot.pos.z - 0.30);
        bot._bodyBox.max.set(bot.pos.x + 0.30, bot.pos.y + 1.38, bot.pos.z + 0.30);
        const bodyT = rayBox3(ray, bot._bodyBox);
        // Ноги (лимбы): 0..0.55 — пониженный урон
        bot._legBox.min.set(bot.pos.x - 0.26, bot.pos.y, bot.pos.z - 0.26);
        bot._legBox.max.set(bot.pos.x + 0.26, bot.pos.y + 0.55, bot.pos.z + 0.26);
        const legT = rayBox3(ray, bot._legBox);
        if (headT !== null && headT < maxDist && (bodyT === null || headT <= bodyT + 0.01)) {
          return { dist: headT, point: ray.at(headT, new THREE.Vector3()), part: 'head', target: bot };
        }
        if (bodyT !== null && bodyT < maxDist) {
          return { dist: bodyT, point: ray.at(bodyT, new THREE.Vector3()), part: 'body', target: bot };
        }
        if (legT !== null && legT < maxDist) {
          return { dist: legT, point: ray.at(legT, new THREE.Vector3()), part: 'limb', target: bot };
        }
        return null;
      },
      damage: (dmg, dir, attackerTeam = -1, part = 'body') => {
        if (!bot.alive) return false;
        if (attackerTeam === bot.team) return false; // friendly fire off
        bot.hp -= dmg;
        if (dir) { bot.pos.x += dir.x * 0.06; bot.pos.z += dir.z * 0.06; }
        mgr._updateLabel(bot);
        if (bot.hp <= 0) {
          bot.hp = 0;
          bot.alive = false;
          bot.state = BotState.RESPAWN;
          bot.respawnT = RESPAWN_TIME;
          bot.enemy = null;
          bot.path = null;
          // Стиль смерти (18+): взрыв — разнос на куски; хедшот 25% —
          // декапитация; тело 25% — разрыв живота; иначе — падение трупом.
          let deathStyle = 'corpse';
          if (dmg >= 50 && !dir) deathStyle = 'explode';
          else if (part === 'head' && Math.random() < 0.25) deathStyle = 'decap';
          else if (part === 'body' && Math.random() < 0.25) deathStyle = 'guts';
          bot.deathStyle = deathStyle;
          if (model && mgr.scene) {
            const corpse = model.dieCorpse ? model.dieCorpse({ style: deathStyle }) : null;
            if (!corpse) {
              const debris = model.explode(mgr.scene);
              for (const d of debris) mgr._debris.push(d);
            } else if (mgr.gore) {
              const px = bot.pos.x, pz = bot.pos.z;
              if (deathStyle === 'decap') {
                // голова отлетает, из шеи — фонтан крови
                mgr.gore.gib({ x: px, y: bot.pos.y + 1.56, z: pz }, null, 1);
                mgr.gore.burst({ x: px, y: bot.pos.y + 1.5, z: pz }, null, { kill: true });
                mgr.gore.splat(px, pz, 2.2);
              } else if (deathStyle === 'guts') {
                // кишки вываливаются наружу
                mgr.gore.intestines({ x: px, y: bot.pos.y + 0.9, z: pz });
                mgr.gore.burst({ x: px, y: bot.pos.y + 0.9, z: pz }, null, { kill: true });
              } else {
                mgr.gore.burst({ x: px, y: bot.pos.y + 1.0, z: pz }, null, { kill: true });
              }
            }
          }
          if (bot.carrying && mgr.mode) mgr.mode.onCarrierDeath(bot);
          bot.carrying = false;
          if (mgr.onKillEvent) mgr.onKillEvent(bot, attackerTeam);
          return true;
        }
        model?.setMode('hit'); // hit-реакция (клип Hit_A)
        // Флинч (Point Blank): дёргается корпус; хедшот — сильнее всего
        if (model) model.state.flinchT = part === 'head' ? 0.34 : part === 'limb' ? 0.14 : 0.22;
        // Под огнём бот запоминает агрессора: мгновенная реакция, если был без цели
        if (!bot.enemy && attackerTeam >= 0) bot.reactT = Math.min(bot.reactT || 0.3, 0.3);
        // Уворот: под огнём бот с шансом делает резкий боковой рывок
        if (bot.dodgeCd <= 0 && Math.random() < 0.4) {
          bot.dodgeCd = 2.4;
          bot.dodgeT = 0.45;
          bot.dodgeDir = Math.random() < 0.5 ? 1 : -1;
          if (dir) bot.dodgeDir = (dir.x * Math.cos(bot.yaw) - dir.z * Math.sin(bot.yaw)) > 0 ? -1 : 1;
          model?.setMode('dodge');
          if (model) model.state.dodgeDir = bot.dodgeDir;
        }
        return false;
      },
    };

    // Спавн на точке команды
    const sp = this.arena.spawns[def.team % this.arena.spawns.length];
    bot.pos.copy(sp.pos);
    bot.yaw = sp.yaw;
    root.rotation.y = sp.yaw;

    if (!this.headless) this._makeLabel(bot);
    return bot;
  }

  // ---------- Имя + HP над головой (спрайт) ----------
  _makeLabel(bot) {
    const cv = document.createElement('canvas');
    cv.width = 160; cv.height = 40;
    const tex = new THREE.CanvasTexture(cv);
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, transparent: true, depthWrite: false,
    }));
    spr.scale.set(1.9, 0.48, 1);
    spr.position.y = 1.98;
    bot.root.add(spr);
    bot._label = { cv, tex, spr };
    this._updateLabel(bot);
  }

  _updateLabel(bot) {
    const L = bot._label;
    if (!L) return;
    const ctx = L.cv.getContext('2d');
    ctx.clearRect(0, 0, 160, 40);
    ctx.font = 'bold 17px monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(10, 0, 140, 22);
    ctx.fillStyle = bot.teamInfo.css;
    ctx.fillText(`${bot.teamInfo.name} · ${bot.name}`, 80, 16);
    // HP-бар
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(20, 26, 120, 8);
    ctx.fillStyle = bot.hp > 40 ? bot.teamInfo.css : '#ff3040';
    ctx.fillRect(21, 27, 118 * Math.max(0, bot.hp / bot.maxHp), 6);
    L.tex.needsUpdate = true;
  }

  // ---------- Respawn ----------
  _respawn(bot) {
    const sp = this.arena.spawns[bot.team % this.arena.spawns.length];
    bot.pos.set(sp.pos.x + (Math.random() - 0.5) * 2, sp.pos.y, sp.pos.z + (Math.random() - 0.5) * 2);
    bot.yaw = sp.yaw;
    bot.hp = bot.maxHp;
    bot.alive = true;
    bot.state = BotState.IDLE;
    bot.carrying = false;
    bot.defendPos = null;
    bot.path = null;
    if (bot.model) bot.model.reset();
    this._updateLabel(bot);
  }

  // ---------- Навигация ----------
  _setGoal(bot, x, y, z, force = false) {
    if (!force && bot.hasGoal &&
        Math.abs(bot.goalPos.x - x) < 1.5 && Math.abs(bot.goalPos.z - z) < 1.5) return;
    bot.goalPos.set(x, y, z);
    bot.hasGoal = true;
    if (bot.repathT > 0 && !force) return;
    bot.repathT = 0.9;
    const wp = this.arena.waypoints;
    const from = wp.nearest(bot.pos);
    const to = wp.nearest(bot.goalPos);
    bot.path = findPath(wp, from, to);
    bot.pathI = 0;
  }

  _followPath(bot, dt, speed) {
    const wp = this.arena.waypoints;
    let tx = bot.goalPos.x, ty = bot.goalPos.y, tz = bot.goalPos.z;
    if (bot.path && bot.pathI < bot.path.length) {
      const node = wp.nodes[bot.path[bot.pathI]];
      const dx = node.x - bot.pos.x, dz = node.z - bot.pos.z;
      if (Math.hypot(dx, dz) < 0.7) {
        bot.pathI++;
      } else {
        tx = node.x; ty = node.y; tz = node.z;
      }
    }
    const dx = tx - bot.pos.x, dz = tz - bot.pos.z;
    const dist = Math.hypot(dx, dz);
    const arrived = dist < 0.8 && (!bot.path || bot.pathI >= bot.path.length);
    if (arrived) { bot.speed = 0; return true; }
    const targetYaw = Math.atan2(dx, dz);
    let dy = targetYaw - bot.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    bot.yaw += dy * Math.min(1, dt * 8);
    bot.speed = speed;
    bot.pos.x += Math.sin(bot.yaw) * speed * dt;
    bot.pos.z += Math.cos(bot.yaw) * speed * dt;
    // Плавно к высоте пути
    bot.pos.y += (ty - bot.pos.y) * Math.min(1, dt * 6);
    const bound = this.arena.bounds ?? 28.5; // предел арены (малая арена дуэли — меньше)
    bot.pos.x = Math.max(-bound, Math.min(bound, bot.pos.x));
    bot.pos.z = Math.max(-bound, Math.min(bound, bot.pos.z));
    return false;
  }

  // ---------- Зрение ----------
  _hasLOS(fromPos, toPos, toHeight = 0.9) {
    this._v1.set(fromPos.x, fromPos.y + 1.3, fromPos.z);
    this._v2.set(toPos.x, toPos.y + toHeight, toPos.z).sub(this._v1);
    const dist = this._v2.length();
    if (dist < 0.01) return true;
    this._v2.divideScalar(dist);
    const hit = this.physics.raycast(this._v1, this._v2, dist);
    return !hit || hit.dist > dist - 0.6;
  }

  _scanEnemies(bot, player) {
    let best = null, bestD = VIEW_DIST;
    for (const other of this.bots) {
      if (other === bot || !other.alive || other.team === bot.team) continue;
      const d = Math.hypot(other.pos.x - bot.pos.x, other.pos.z - bot.pos.z);
      if (d < bestD && this._hasLOS(bot.pos, other.pos)) { best = other; bestD = d; }
    }
    if (player && player.alive && this.playerTeam !== bot.team) {
      const pp = player.body.pos;
      const d = Math.hypot(pp.x - bot.pos.x, pp.z - bot.pos.z);
      if (d < bestD && this._hasLOS(bot.pos, pp, 1.2)) {
        best = this._playerProxy(player);
        bestD = d;
      }
    }
    if (best !== bot.enemy) {
      bot.enemy = best;
      bot.reactT = best ? 0.25 + Math.random() * 0.25 : 0;
      bot.burstLeft = 0;
      bot.burstPauseT = 0.2;
    }
    bot.enemyDist = best ? bestD : Infinity;
    // Потерял цель из вида — забыть
    if (bot.enemy && (!bot.enemy.alive || bot.enemyDist === Infinity)) {
      if (bot.enemy && bot.enemy.alive) { /* цель есть, но далеко */ }
      else bot.enemy = null;
    }
  }

  _playerProxy(player) {
    if (!this._pp) {
      const mgr = this;
      this._pp = {
        isPlayer: true, team: this.playerTeam, name: 'ВЫ',
        get alive() { return mgr.player ? mgr.player.alive : false; },
        get pos() { return mgr.player.body.pos; },
        damage: (dmg) => mgr.player?.damage(dmg),
      };
    }
    return this._pp;
  }

  // ---------- Стрельба ----------
  _shoot(bot) {
    const target = bot.enemy;
    if (!target) return;
    const origin = this._v1.set(bot.pos.x, bot.pos.y + 1.3, bot.pos.z);
    const aim = this._v2.set(target.pos.x, target.pos.y + 0.85, target.pos.z).sub(origin);
    const dist = aim.length();
    aim.divideScalar(dist || 1);
    // Точность: хуже с дистанцией; FLOW игрока делает его трудной мишенью
    const flowK = this.flow && target.isPlayer ? 1 + this.flow.flowNorm * 0.7 : 1;
    const err = (0.012 + dist * 0.0011) * flowK * (bot._crouch ? 0.7 : 1); // присед точнее
    aim.x += (Math.random() - 0.5) * 2 * err;
    aim.y += (Math.random() - 0.5) * 2 * err;
    aim.z += (Math.random() - 0.5) * 2 * err;
    aim.normalize();
    this._ray.set(origin, aim);

    const range = 60;
    const worldHit = this.physics.raycast(origin, aim, range);
    let bestDist = worldHit ? worldHit.dist : range;
    let bestTarget = null;
    // По вражеским ботам
    for (const other of this.bots) {
      if (other === bot || !other.alive || other.team === bot.team) continue;
      const hit = other.hitTest(this._ray, bestDist);
      if (hit && hit.dist < bestDist) { bestDist = hit.dist; bestTarget = hit; }
    }
    // По игроку
    let playerHitT = null;
    if (this.player && this.player.alive && this.playerTeam !== bot.team) {
      const pp = this.player.body.pos;
      this._box.min.set(pp.x - 0.35, pp.y, pp.z - 0.35);
      this._box.max.set(pp.x + 0.35, pp.y + 1.7, pp.z + 0.35);
      const t = rayBox3(this._ray, this._box);
      if (t !== null && t < bestDist) { bestDist = t; playerHitT = t; bestTarget = null; }
    }

    const dmgMul = this.flow ? (this.flow.dropActive ? 2 : 1) : 1;
    let end;
    if (playerHitT !== null) {
      end = this._ray.at(playerHitT, this._v3);
      this.player.damage(SHOT_DAMAGE * dmgMul);
      this.sfx?.hit(false);
    } else if (bestTarget) {
      end = bestTarget.point;
      const dmg = SHOT_DAMAGE * (bestTarget.part === 'head' ? 1.8 : 1) * dmgMul;
      bestTarget.target.damage(dmg, aim, bot.team);
    } else if (worldHit) {
      end = worldHit.point;
      // Боты прогрызают разрушаемые стены
      if (worldHit.tag === 'chunk' && this.destruction) {
        this.destruction.applyDamage(worldHit.point, 0.9, 12);
      }
    } else {
      end = this._v3.copy(aim).multiplyScalar(range).add(origin);
    }
    this._spawnTracer(origin, end, bot.teamInfo.color);
    if (this.player) {
      const pd = Math.hypot(bot.pos.x - this.player.body.pos.x, bot.pos.z - this.player.body.pos.z);
      if (pd < 20) this.sfx?.shoot();
    }
    if (bot.model) bot.model.setMode('shoot');
  }

  _spawnTracer(from, to, color) {
    let best = null;
    for (const t of this._tracers) { if (t.life <= 0) { best = t; break; } }
    if (!best) return;
    const pos = best.line.geometry.attributes.position;
    pos.setXYZ(0, from.x, from.y, from.z);
    pos.setXYZ(1, to.x, to.y, to.z);
    pos.needsUpdate = true;
    best.line.material.color.setHex(color);
    best.line.material.opacity = 0.8;
    best.line.visible = true;
    best.life = 0.09;
  }

  // ---------- FSM ----------
  _think(bot, dt, player, mc) {
    // Сканирование врагов с фикс. периодом
    bot.scanT -= dt;
    if (bot.scanT <= 0) {
      bot.scanT = 0.12;
      this._scanEnemies(bot, player);
    }
    if (bot.repathT > 0) bot.repathT -= dt;

    const carrying = mc && mc.carrier === bot;
    bot.carrying = !!carrying;
    const playerCarrying = mc && mc.carrier === 'player';
    const isMate = bot.team === this.playerTeam;

    // --- Выбор состояния (приоритет объективов, ATTACK — по близкой угрозе) ---
    if (carrying && mc && mc.state === CashState.CHANNEL && bot.defendPos) {
      // Идёт загрузка на станции — стоим в точке, иначе сорвём канал
      bot.state = BotState.DEFEND;
    } else if (carrying) {
      // Несём к ближайшей свободной станции; враг вплотную — отстреливаемся
      if (bot.enemy && bot.enemyDist < 10) bot.state = BotState.ATTACK;
      else bot.state = BotState.CARRY;
    } else if (bot.defendPos && mc && mc.defendActiveFor === bot.team) {
      bot.state = BotState.DEFEND;
    } else if (bot.enemy && bot.enemyDist < 14) {
      bot.state = BotState.ATTACK; // близкая угроза важнее объективов
    } else if (isMate && playerCarrying && player && player.alive) {
      bot.state = BotState.DEFEND; // эскорт игрока-носителя
      bot.defendPos = null;
    } else if (mc && mc.boxAvailable) {
      bot.state = BotState.SEEK_BOX;
    } else if (bot.enemy) {
      bot.state = BotState.ATTACK;
    } else {
      bot.state = BotState.IDLE;
    }

    const speedMul = (bot.carrying ? CARRY_SPEED_MUL : 1);

    switch (bot.state) {
      case BotState.SEEK_BOX: {
        if (mc && mc.boxPos) {
          this._setGoal(bot, mc.boxPos.x, mc.boxPos.y, mc.boxPos.z);
          this._followPath(bot, dt, BOT_SPEED * speedMul);
          const d = Math.hypot(bot.pos.x - mc.boxPos.x, bot.pos.z - mc.boxPos.z);
          if (d < 1.5 && this.mode) this.mode.botPickup(bot);
        }
        break;
      }
      case BotState.CARRY: {
        const st = mc ? this._nearestFreeStation(bot, mc) : null;
        if (st) {
          this._setGoal(bot, st.pos.x, st.pos.y, st.pos.z);
          this._followPath(bot, dt, BOT_SPEED * speedMul);
          const d = Math.hypot(bot.pos.x - st.pos.x, bot.pos.z - st.pos.z);
          if (d < 2.2 && this.mode) this.mode.botReachedStation(bot, st);
        }
        break;
      }
      case BotState.DEFEND: {
        // Точка обороны: станция команды или игрок-носитель
        let dp = bot.defendPos;
        if (isMate && playerCarrying && player) dp = player.body.pos;
        if (dp) {
          const d = Math.hypot(bot.pos.x - dp.x, bot.pos.z - dp.z);
          if (d > 5) {
            this._setGoal(bot, dp.x, dp.y, dp.z);
            this._followPath(bot, dt, BOT_SPEED);
          } else {
            bot.speed = 0;
            // Кружение на месте
            bot.yaw += dt * 0.6;
          }
        }
        // Если враг виден — стреляем, не покидая пост
        if (bot.enemy) this._combat(bot, dt, false);
        break;
      }
      case BotState.ATTACK: {
        this._combat(bot, dt, true);
        break;
      }
      default: {
        // IDLE: лёгкое патрулирование к центру
        if (!bot.hasGoal || Math.random() < 0.005) {
          this._setGoal(bot, (Math.random() - 0.5) * 14, 0.1, (Math.random() - 0.5) * 14);
        }
        this._followPath(bot, dt, BOT_SPEED * 0.6);
      }
    }
  }

  _nearestFreeStation(bot, mc) {
    let best = null, bd = Infinity;
    for (const st of mc.stations) {
      if (st.busy) continue;
      const d = Math.hypot(bot.pos.x - st.pos.x, bot.pos.z - st.pos.z);
      if (d < bd) { bd = d; best = st; }
    }
    return best;
  }

  _combat(bot, dt, moveToEnemy) {
    const e = bot.enemy;
    if (!e || !e.alive) { bot.enemy = null; return; }
    // Перепроверка дистанции/видимости раз в скан (уже обновлено)
    const dist = Math.hypot(e.pos.x - bot.pos.x, e.pos.z - bot.pos.z);

    // --- ОТСТУПЛЕНИЕ К УКРЫТИЮ: мало HP → спринт от врага к дальней точке ---
    if (bot.retreatCd > 0) bot.retreatCd -= dt;
    if (bot.hp < 32 && bot.retreatCd <= 0 && dist < 20 && moveToEnemy) {
      bot.retreatCd = 6; bot.retreatT = 1.5;
      const ax = bot.pos.x - e.pos.x, az = bot.pos.z - e.pos.z;
      const l = Math.hypot(ax, az) || 1;
      const bound = this.arena.bounds ?? 28.5;
      const rx = Math.max(-bound, Math.min(bound, bot.pos.x + (ax / l) * 13));
      const rz = Math.max(-bound, Math.min(bound, bot.pos.z + (az / l) * 13));
      this._setGoal(bot, rx, 0.1, rz, true);
    }
    if (bot.retreatT > 0) {
      bot.retreatT -= dt;
      this._followPath(bot, dt, BOT_SPEED * 1.35); // спринт отступления
      // На бегу лицом к врагу (отстрел назад не делаем — бежим)
      const ty = Math.atan2(e.pos.x - bot.pos.x, e.pos.z - bot.pos.z);
      let dyr = ty - bot.yaw;
      while (dyr > Math.PI) dyr -= Math.PI * 2;
      while (dyr < -Math.PI) dyr += Math.PI * 2;
      bot.yaw += dyr * Math.min(1, dt * 8);
      return;
    }

    // Движение: держим дистанцию 8-16м
    if (moveToEnemy) {
      if (dist > 16) {
        this._setGoal(bot, e.pos.x, e.pos.y, e.pos.z);
        this._followPath(bot, dt, BOT_SPEED * 1.35); // спринт сближения
      } else if (dist < 6) {
        // Отступить напрямую
        const dx = bot.pos.x - e.pos.x, dz = bot.pos.z - e.pos.z;
        const l = Math.hypot(dx, dz) || 1;
        bot.pos.x += (dx / l) * BOT_SPEED * 0.8 * dt;
        bot.pos.z += (dz / l) * BOT_SPEED * 0.8 * dt;
        bot.speed = BOT_SPEED * 0.8;
      } else if (!bot._crouch) {
        // Стрейф
        bot.strafeT -= dt;
        if (bot.strafeT <= 0) { bot.strafeT = 0.8 + Math.random() * 1.2; bot.strafeDir *= -1; }
        const dx = e.pos.x - bot.pos.x, dz = e.pos.z - bot.pos.z;
        const l = Math.hypot(dx, dz) || 1;
        bot.pos.x += (-dz / l) * bot.strafeDir * BOT_SPEED * 0.55 * dt;
        bot.pos.z += (dx / l) * bot.strafeDir * BOT_SPEED * 0.55 * dt;
        bot.speed = BOT_SPEED * 0.55;
        bot._lean = bot.strafeDir * 0.8; // наклон корпуса в стрейф
      }
    }
    // Лицом к врагу
    const targetYaw = Math.atan2(e.pos.x - bot.pos.x, e.pos.z - bot.pos.z);
    let dy = targetYaw - bot.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    bot.yaw += dy * Math.min(1, dt * 10);

    // --- УВОРОТ: быстрый боковой рывок (перекрывает обычный стрейф) ---
    if (bot.dodgeCd > 0) bot.dodgeCd -= dt;
    if (bot.dodgeT > 0) {
      bot.dodgeT -= dt;
      const dx = e.pos.x - bot.pos.x, dz = e.pos.z - bot.pos.z;
      const l = Math.hypot(dx, dz) || 1;
      // Рывок строго вбок от линии огня, быстрее обычного стрейфа
      bot.pos.x += (-dz / l) * bot.dodgeDir * BOT_SPEED * 1.7 * dt;
      bot.pos.z += (dx / l) * bot.dodgeDir * BOT_SPEED * 1.7 * dt;
      bot.speed = BOT_SPEED * 1.7;
      bot._lean = bot.dodgeDir;
      return; // во время рывка не стреляем — это и есть «уворот»
    }

    // Реакция
    if (bot.reactT > 0) { bot.reactT -= dt; return; }
    if (bot.enemyDist === Infinity) return; // нет LOS — не стреляем

    // --- ПЕРЕЗАРЯДКА: магазин пуст → пауза огня + анимация смены магазина ---
    if (bot.reloadT > 0) {
      bot.reloadT -= dt;
      if (bot.reloadT <= 0) bot.mag = bot.magSize;
      return;
    }

    // Очереди
    if (bot.burstLeft > 0) {
      // ПРИСЕД при стрельбе на дистанции: точнее и живее выглядит
      bot._crouch = dist > 15 ? 1 : 0;
      bot.shootCd -= dt;
      if (bot.shootCd <= 0) {
        bot.shootCd = 0.11 + Math.random() * 0.05;
        bot.burstLeft--;
        bot.mag--;
        this._shoot(bot);
        if (bot.mag <= 0) {
          bot.burstLeft = 0;
          bot._crouch = 0;
          bot.reloadT = 1.5;
          bot.model?.setMode('reload');
        }
      }
    } else {
      bot._crouch = 0;
      bot.burstPauseT -= dt;
      if (bot.burstPauseT <= 0) {
        bot.burstLeft = 3 + Math.floor(Math.random() * 3);
        bot.burstPauseT = 0.5 + Math.random() * 0.4;
      }
    }
  }

  // ---------- Главный апдейт ----------
  update(dt, player) {
    const mc = this.mode ? this.mode.botContext() : null;
    for (const bot of this.bots) {
      if (!bot.alive) {
        // Мёртвые: death-клип/растворение модели продолжают тикать
        bot.model?.update(dt, 0);
        bot.respawnT -= dt;
        if (bot.respawnT <= 0) this._respawn(bot);
        continue;
      }
      this._think(bot, dt, player, mc);
      // Выпал за арену / улетел в пустоту — гибель трупом (dir-заглушка ≠ взрыв)
      const ah = (this.arena?.size || 60) / 2 + 6;
      if (bot.pos.y < -10 || Math.abs(bot.pos.x) > ah || Math.abs(bot.pos.z) > ah) {
        bot.damage(9999, this._v1.set(0, 0, 0), -1, 'body');
        continue;
      }
      bot.root.rotation.y = bot.yaw;
      if (bot.model) {
        // Боевой слой анимации: наклон в стрейфе/увороте + ярость при контакте + присед
        bot.model.state.leanTarget = bot._lean || 0;
        bot.model.state.aggroTarget = bot.enemy ? 1 : 0;
        bot.model.state.crouchTarget = bot._crouch || 0;
        bot.model.update(dt, bot.speed);
      }
      bot._lean = 0;
      bot.speed = 0;
    }
    // Трассеры
    for (const t of this._tracers) {
      if (t.life > 0) {
        t.life -= dt;
        t.line.material.opacity = Math.max(0, t.life / 0.09) * 0.8;
        if (t.life <= 0) t.line.visible = false;
      }
    }
    // Обломки
    this._updateDebris(dt);
  }

  _updateDebris(dt) {
    for (let i = this._debris.length - 1; i >= 0; i--) {
      const d = this._debris[i];
      d.life -= dt;
      d.vel.y -= 18 * dt;
      d.mesh.position.addScaledVector(d.vel, dt);
      d.mesh.rotation.x += d.angVel.x * dt;
      d.mesh.rotation.y += d.angVel.y * dt;
      if (d.mesh.position.y < 0.1 && d.vel.y < 0) {
        d.mesh.position.y = 0.1;
        d.vel.y *= -0.35;
        d.vel.x *= 0.7; d.vel.z *= 0.7;
      }
      if (d.life <= 0) {
        d.mesh.removeFromParent();
        this._debris.splice(i, 1);
      } else if (d.life < 0.6) {
        d.mesh.scale.multiplyScalar(1 - dt * 1.8);
      }
    }
  }
}
