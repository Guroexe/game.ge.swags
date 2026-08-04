// ===== GEN.SWAGS Multiplayer glue =====
// RemotePlayers: рендер удалённых игроков тем же неко-мех персонажем,
// что и боты (командные цвета, имя+HP спрайт, интерполяция net.samplePlayers).
// Прокси-цели для weapons.targets: hitTest как у ботов, damage() шлёт
// net.sendHit (сервер авторитетен — локально HP не применяем).
// MPCashMirror: зеркалит серверный кеш-режим в поля локального CashoutMode,
// чтобы HUD работал без изменений (локальная логика режима в MP отключена).
import * as THREE from 'three';
import { flatMat, boxGeo, createCyberGirl } from '../engine/models.js';
import { instantiateGirl, TEAM_CHAR } from '../engine/charlib.js';
import { TEAMS, raySphere, rayBox3 } from './bots.js';
import { CashState } from './mode_cashout.js';

const MP_MATCH_TIME = 480;   // косметический таймер матча (сервер без таймера)
const MP_WIN_SCORE = 3;      // 3 кешаута = 3000$
const CASH_PER_POINT = 1000;

// ============================================================
// RemotePlayers
// ============================================================
export class RemotePlayers {
  constructor({ scene, physics, sfx, net }) {
    this.scene = scene;
    this.physics = physics;
    this.sfx = sfx;
    this.net = net;
    this.views = new Map();   // id -> view
    this.targets = [];        // прокси (mutate in place — ссылка у weapons)
    this.sampled = [];        // последний net.samplePlayers()
    this._debris = [];
    this._ray = new THREE.Ray();
    this._v = new THREE.Vector3();
  }

  // ---------- Ростер ----------
  syncRoster(players) {
    const ids = new Set();
    for (const p of players || []) {
      if (p.id === this.net.playerId) continue;
      ids.add(p.id);
      this.ensure(p.id, p);
    }
    for (const id of [...this.views.keys()]) {
      if (!ids.has(id)) this.remove(id);
    }
  }

  ensure(id, info = {}) {
    let v = this.views.get(id);
    if (v) {
      if (info.name !== undefined) v.name = info.name;
      if (info.team !== undefined) v.team = info.team;
      return v;
    }
    const team = TEAMS[(info.team ?? 0) % TEAMS.length];
    // Скелетная GLB-модель (как у ботов), fallback — процедурная
    const model = instantiateGirl(TEAM_CHAR[(info.team ?? 0) % 3], { team: info.team ?? 0 })
      || createCyberGirl({ team: info.team ?? 0 });
    const root = model.root;
    // Командная маркировка (как у ботов): антенна + наплечники в цвете команды
    const matTeam = flatMat(team.color, { emissive: team.color, ei: 2.2 });
    const beacon = new THREE.Mesh(boxGeo(0.07, 0.16, 0.07), matTeam);
    beacon.position.set(0, 1.94, 0);
    const padL = new THREE.Mesh(boxGeo(0.16, 0.06, 0.16), matTeam);
    padL.position.set(-0.22, 1.36, 0);
    const padR = new THREE.Mesh(boxGeo(0.16, 0.06, 0.16), matTeam);
    padR.position.set(0.22, 1.36, 0);
    root.add(beacon, padL, padR);
    root.visible = false; // покажем с первым сэмплом
    this.scene.add(root);

    v = {
      id, model, root,
      name: info.name || id,
      team: info.team ?? 0, teamInfo: team,
      hp: info.hp ?? 100, alive: info.alive ?? true,
      exploded: false, seen: false,
      lastX: 0, lastZ: 0, speed: 0,
      _labelHp: -1, _labelName: '',
    };
    this._makeLabel(v);

    // Прокси-цель для weapons.targets (интерфейс как у бота)
    const mgr = this;
    const proxy = {
      isRemote: true, id,
      get name() { return v.name; },
      get team() { return v.team; },
      get alive() { return v.alive; },
      pos: root.position,
      _headCenter: new THREE.Vector3(),
      _bodyBox: new THREE.Box3(),
      _lastPart: 'body',
      hitTest: (ray, maxDist) => {
        if (!v.alive) return null;
        const p = root.position;
        proxy._headCenter.set(p.x, p.y + 1.58, p.z);
        const headT = raySphere(ray, proxy._headCenter, 0.22);
        proxy._bodyBox.min.set(p.x - 0.30, p.y, p.z - 0.30);
        proxy._bodyBox.max.set(p.x + 0.30, p.y + 1.32, p.z + 0.30);
        const bodyT = rayBox3(ray, proxy._bodyBox);
        if (headT !== null && headT < maxDist && (bodyT === null || headT <= bodyT + 0.01)) {
          proxy._lastPart = 'head';
          return { dist: headT, point: ray.at(headT, new THREE.Vector3()), part: 'head', target: proxy };
        }
        if (bodyT !== null && bodyT < maxDist) {
          proxy._lastPart = 'body';
          return { dist: bodyT, point: ray.at(bodyT, new THREE.Vector3()), part: 'body', target: proxy };
        }
        return null;
      },
      // Сервер авторитетен: локально урон не применяем, шлём hit на сервер.
      // Возвращаем false — «килл» придёт событием 'death'.
      damage: (dmg) => {
        if (!v.alive) return false;
        mgr.net.sendHit(id, Math.round(dmg * 10) / 10, proxy._lastPart || 'body');
        return false;
      },
    };
    v.proxy = proxy;
    this.views.set(id, v);
    this.targets.push(proxy);
    return v;
  }

  remove(id) {
    const v = this.views.get(id);
    if (!v) return;
    v.root.removeFromParent();
    const i = this.targets.indexOf(v.proxy);
    if (i >= 0) this.targets.splice(i, 1);
    this.views.delete(id);
  }

  clear() {
    for (const id of [...this.views.keys()]) this.remove(id);
    for (const d of this._debris) d.mesh.removeFromParent();
    this._debris.length = 0;
    this.sampled = [];
  }

  // ---------- Имя + HP над головой ----------
  _makeLabel(v) {
    const cv = document.createElement('canvas');
    cv.width = 160; cv.height = 40;
    const tex = new THREE.CanvasTexture(cv);
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, transparent: true, depthWrite: false,
    }));
    spr.scale.set(1.9, 0.48, 1);
    spr.position.y = 1.98;
    v.root.add(spr);
    v._label = { cv, tex };
    this._updateLabel(v, true);
  }

  _updateLabel(v, force = false) {
    if (!force && v._labelHp === v.hp && v._labelName === v.name) return;
    v._labelHp = v.hp; v._labelName = v.name;
    const ctx = v._label.cv.getContext('2d');
    ctx.clearRect(0, 0, 160, 40);
    ctx.font = 'bold 17px monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(10, 0, 140, 22);
    ctx.fillStyle = v.teamInfo.css;
    ctx.fillText(`${v.teamInfo.name} · ${v.name}`, 80, 16);
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(20, 26, 120, 8);
    ctx.fillStyle = v.hp > 40 ? v.teamInfo.css : '#ff3040';
    ctx.fillRect(21, 27, 118 * Math.max(0, v.hp / 100), 6);
    v._label.tex.needsUpdate = true;
  }

  // ---------- Смерть/респавн (по флагу alive из снапшотов) ----------
  _explode(v) {
    v.exploded = true;
    const debris = v.model.explode(this.scene);
    for (const d of debris) this._debris.push(d);
    this._updateLabel(v, true);
  }

  _respawn(v) {
    v.exploded = false;
    v.model.reset();
    this._updateLabel(v, true);
  }

  // ---------- Чужой выстрел: трассер + звук ----------
  remoteShot(msg, playerPos) {
    const origin = this._v.set(msg.origin[0], msg.origin[1], msg.origin[2]).clone();
    const dir = new THREE.Vector3(msg.dir[0], msg.dir[1], msg.dir[2]);
    if (dir.lengthSq() < 0.01) return;
    dir.normalize();
    const hit = this.physics.raycast(origin, dir, 120);
    const end = hit ? hit.point : dir.clone().multiplyScalar(120).add(origin);
    this.onTracer?.(origin, end);
    if (playerPos) {
      const d = Math.hypot(origin.x - playerPos.x, origin.z - playerPos.z);
      if (d < 26) {
        if (msg.weapon === 'shotgun') this.sfx?.shotgun();
        else this.sfx?.shoot();
      }
    }
    // Анимация стрельбы у автора
    const v = this.views.get(msg.id);
    if (v) v.model.setMode('shoot');
  }

  // ---------- Главный апдейт ----------
  update(dt) {
    this.sampled = this.net.samplePlayers();
    for (const s of this.sampled) {
      const v = this.ensure(s.id, s);
      // Синк метаданных из снапшота
      v.team = s.team;
      v.teamInfo = TEAMS[s.team % TEAMS.length];
      if (s.hp < v.hp && s.alive) v.model.setMode('hit'); // hit-реакция
      v.hp = s.hp;
      v.alive = s.alive;
      if (s.name) v.name = s.name;
      // Позиция/поворот (уже интерполированы net'ом на 100мс в прошлом)
      const p = v.root.position;
      if (!v.seen) { v.seen = true; v.lastX = s.pos[0]; v.lastZ = s.pos[2]; }
      const dx = s.pos[0] - v.lastX, dz = s.pos[2] - v.lastZ;
      v.speed = v.speed * 0.7 + (Math.hypot(dx, dz) / Math.max(dt, 0.001)) * 0.3;
      v.lastX = s.pos[0]; v.lastZ = s.pos[2];
      p.set(s.pos[0], s.pos[1], s.pos[2]);
      v.root.rotation.y = s.yaw;
      // Смерть/респавн по флагу
      if (!s.alive && !v.exploded) this._explode(v);
      else if (s.alive && v.exploded) this._respawn(v);
      if (s.alive) {
        v.root.visible = true;
        v.model.update(dt, v.speed);
      } else {
        // Мёртвые: death-клип/растворение продолжают тикать
        v.model.update(dt, 0);
      }
      this._updateLabel(v);
    }
    // Обломки смертей
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

// ============================================================
// MPCashMirror — сервер авторитетен, локальный режим только визуал
// ============================================================
export class MPCashMirror {
  constructor(game) {
    this.game = game;
    this.cash = null;          // последнее cashState сервера
    this.timeLeft = MP_MATCH_TIME;
    this._holderProxy = { pos: { x: 0, y: 0, z: 0 }, name: '', isRemoteCarrier: true };
    this._ended = false;
  }

  attach(cash) {
    this.cash = cash || null;
    this.timeLeft = MP_MATCH_TIME;
    this._ended = false;
    this._apply();
  }

  onCash(msg) {
    this.cash = msg;
    this._apply();
    const g = this.game;
    const myId = g.net.playerId;
    const nameOf = (id) => (id === myId ? 'ВЫ' : (g.net.remote.get(id)?.name || 'ИГРОК'));
    switch (msg.event) {
      case 'pickup':
        g.hud?.notify(msg.id === myId ? 'КЕШБОКС ПОДОБРАН (ВЫ)' : `${nameOf(msg.id)} ПОДОБРАЛ КЕШБОКС`,
          msg.id === myId ? 'good' : 'obj');
        g.sfx?.ui();
        break;
      case 'drop':
        g.hud?.notify('КЕШБОКС ВЫПАЛ', 'obj');
        break;
      case 'depositStart':
        g.hud?.notify(`ЗАГРУЗКА НА СТАНЦИИ ${msg.station} — 5С`, 'obj');
        break;
      case 'cashout': {
        const mine = msg.team === g.mode?.playerTeam;
        g.hud?.notify(mine ? `+${CASH_PER_POINT}$ ВАШЕЙ КОМАНДЕ!` : `ПРОТИВНИК ПОЛУЧИЛ +${CASH_PER_POINT}$`,
          mine ? 'good' : 'bad');
        g.sfx?.cashout?.();
        break;
      }
      default:
        break;
    }
  }

  // Проброс серверного состояния в поля локального режима (для HUD)
  _apply() {
    const g = this.game;
    const mode = g.mode;
    if (!mode || !this.cash) return;
    const raw = this.cash.scores || [0, 0, 0];
    mode.scores = raw.map((s) => s * CASH_PER_POINT);
    this.rawScores = raw;
    for (const st of this.cash.stations || []) {
      const m = mode.stations.find((x) => x.letter === st.letter);
      if (m) {
        m.busy = !!st.by;
        m.team = st.owner ?? -1;
      }
    }
  }

  update(dt) {
    const g = this.game;
    const mode = g.mode;
    if (!mode) return;
    const cash = this.cash;

    // Косметический таймер матча
    if (!this._ended && !g.matchEnded) {
      this.timeLeft = Math.max(0, this.timeLeft - dt);
    }
    mode.timeLeft = this.timeLeft;

    // Кешбокс
    const holder = cash?.cashbox?.holder ?? null;
    const boxArr = cash?.cashbox?.pos || [0, 0.4, -2];
    const holderIsMe = holder === g.net.playerId;
    mode.playerCarrying = holderIsMe;
    if (holder && !holderIsMe) {
      // Позиция носителя — из интерполированных сэмплов
      const s = g.remotePlayers?.sampled.find((x) => x.id === holder);
      if (s) {
        this._holderProxy.pos.x = s.pos[0];
        this._holderProxy.pos.y = s.pos[1];
        this._holderProxy.pos.z = s.pos[2];
      } else {
        this._holderProxy.pos.x = boxArr[0];
        this._holderProxy.pos.y = boxArr[1];
        this._holderProxy.pos.z = boxArr[2];
      }
      this._holderProxy.name = g.net.remote.get(holder)?.name || holder;
      mode.carrier = this._holderProxy;
    } else {
      mode.carrier = holderIsMe ? 'player' : null;
    }
    mode.boxPos.set(boxArr[0], boxArr[1], boxArr[2]);

    // Станция в работе → статус объектива в HUD
    const active = (cash?.stations || []).find((s) => s.by);
    if (active) {
      mode.state = CashState.CHANNEL;
      mode.channelStation = mode.stations.find((x) => x.letter === active.letter) || null;
      mode.channelT = Math.max(0, (1 - active.progress) * 5);
    } else {
      mode.state = holder ? CashState.CARRIED : CashState.IDLE;
      mode.channelStation = null;
    }

    // Визуал кешбокса (скрытие при загрузке/следование за носителем)
    mode._syncBoxVisual();

    // Косметический конец матча (сервер матч не завершает)
    if (!this._ended && !g.matchEnded && g.state === 'GAME') {
      const raw = this.rawScores || [0, 0, 0];
      let winner = 0;
      for (let i = 1; i < 3; i++) if (raw[i] > raw[winner]) winner = i;
      const winByScore = raw[winner] >= MP_WIN_SCORE;
      if (winByScore || this.timeLeft <= 0) {
        this._ended = true;
        g._mpEndLocal(winner);
      }
    }
  }
}
