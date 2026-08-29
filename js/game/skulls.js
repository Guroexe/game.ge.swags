// ===== GEN.SWAGS Skull Snake (HYPER DEMON style, 18+) =====
// Полупрозрачная ЗМЕЯ из черепов: цепь сегментов за головой. Постоянно
// ПРЕСЛЕДУЕТ ближайшую живую цель (игрока ИЛИ бота — мешает всем).
// УБИВАЕМА: 40 HP (пара попаданий), визуал повреждений (красные глаза).
// Смерть: взрыв, gore, исчезновение. Респавн через 8–12 сек (рандом)
// в случайной точке арены.
// Сквозь здания НЕ проходит: голова проверяет путь рейкастом по статике
// и скользит вдоль стен. Контакт головы/сегментов наносит урон.
// Только соло (в MP авторитет сервера, змея отключена).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createSkull } from '../engine/models.js';
import { raySphere } from './bots.js';

// Скачанная low-poly модель черепа (KayKit Halloween, MIT — CREDITS.md).
// Нормируется к 1 юниту высоты, центр в нуле; лицо смотрит в +Z (lookAt-ready).
let SKULL_GLB = null;
export async function loadSkullTemplate(url = 'assets/models/skull/skull.gltf') {
  try {
    const gltf = await new Promise((res, rej) => new GLTFLoader().load(url, res, undefined, rej));
    const root = gltf.scene;
    const bb = new THREE.Box3().setFromObject(root);
    const size = bb.getSize(new THREE.Vector3());
    const s = 1 / Math.max(size.x, size.y, size.z, 0.001);
    root.scale.setScalar(s);
    const bb2 = new THREE.Box3().setFromObject(root);
    root.position.sub(bb2.getCenter(new THREE.Vector3()));
    const wrap = new THREE.Group();
    wrap.add(root);
    SKULL_GLB = wrap;
  } catch (e) { console.warn('[skull] модель недоступна — процедурный fallback', e); }
}

// Клон шаблона нужного размера (size = «радиус» как у createSkull).
// Возвращает { group, eyeMat } — eyeMat для пульса/вспышки глаз.
function cloneRealSkull(size) {
  const total = size * 2; // шаблон нормирован к высоте 1 → диаметр
  const g = SKULL_GLB.clone(true);
  g.scale.setScalar(total);
  // Горящие глаза в глазницах (координаты в нормированном пространстве шаблона —
  // масштаб наследуется от группы)
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x50ff9a, transparent: true, opacity: 0.95 });
  const eyeGeo = new THREE.SphereGeometry(0.10, 8, 8);
  const l = new THREE.Mesh(eyeGeo, eyeMat); l.position.set(-0.19, 0.10, 0.40); l.scale.setScalar(1 / total);
  const r = new THREE.Mesh(eyeGeo, eyeMat); r.position.set(0.19, 0.10, 0.40); r.scale.setScalar(1 / total);
  l.userData.isEye = r.userData.isEye = true; // ghostify не трогает глаза
  g.add(l, r);
  return { group: g, eyeMat };
}

const SEGMENTS = 9;        // сегментов тела за головой
const SEG_GAP = 0.78;      // дистанция между сегментами
const HEAD_SPEED = 6.8;    // базовая скорость преследования
const HEAD_TURN = 3.2;     // скорость поворота (lerp скорости)
const HIT_R_HEAD = 1.05;   // контакт головы
const HIT_R_SEG = 0.62;    // контакт сегмента
const DMG_HEAD = 30;
const DMG_SEG = 12;
const HIT_CD = 0.9;        // кулдаун урона по одной цели
const RETARGET_MIN = 2.5;  // сек между сменой цели
const RETARGET_MAX = 5.5;
const SNAKE_HP = 40;       // HP змеи — хрупкая (2-3 попадания из АК)
const RESPAWN_MIN = 8;     // респавн через 8–12 сек (рандом) после смерти
const RESPAWN_RAND = 4;

function ghostify(group, opacity) {
  group.traverse((o) => {
    if (!o.isMesh) return;
    if (o.userData.isEye) { o.frustumCulled = false; return; } // глаза — свои материалы
    const m = o.material.clone();
    m.transparent = true;
    m.opacity = opacity;
    m.emissive = new THREE.Color(0x1a3a2a);
    m.emissiveIntensity = 0.55;
    o.material = m;
    o.frustumCulled = false;
  });
}

function makeGlowSprite(color = 'rgba(80,255,170,') {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, color + '0.8)');
  grad.addColorStop(0.4, color + '0.3)');
  grad.addColorStop(1, color + '0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(cv),
    blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.7,
  }));
  return spr;
}

export class SkullSwarm {
  constructor({ scene, sfx = null, gore = null, physics = null }) {
    this.scene = scene;
    this.sfx = sfx;
    this.gore = gore;
    this.physics = physics;   // для запрета прохода сквозь здания
    this.bounds = 28;
    this.targets = [];        // интерфейс weapons.targets (по одной змее)
    this.onKill = null;       // cb(snake) — смерть змеи (гибсы/счёт в main)
    this.onAttackPlayer = null;
    this._tmp = new THREE.Vector3();
    this._tmp2 = new THREE.Vector3();
    this._tmp3 = new THREE.Vector3();
    this._t = 0;
  }

  spawn(count = 1, bounds = 28) {
    this.bounds = bounds;
    for (let i = 0; i < count; i++) this._spawnSnake();
  }

  _spawnSnake() {
    // Голова — крупный череп, сегменты — мельче к хвосту.
    // Скачанная KayKit-модель; если не загрузилась — процедурный череп.
    let head, eyeMat;
    if (SKULL_GLB) {
      const c = cloneRealSkull(0.62);
      head = c.group; eyeMat = c.eyeMat;
    } else {
      head = createSkull(0.62);
      eyeMat = new THREE.MeshBasicMaterial({ color: 0x50ff9a, transparent: true, opacity: 0.95 });
      const headMeshes = head.children.filter((c) => c.isMesh);
      if (headMeshes.length >= 4) {
        headMeshes[2].material = eyeMat;
        headMeshes[3].material = eyeMat;
      }
    }
    ghostify(head, 0.62);
    const headGlow = makeGlowSprite();
    headGlow.scale.setScalar(2.6);
    headGlow.position.y = 0.4;
    head.add(headGlow);

    const segs = [];
    for (let i = 0; i < SEGMENTS; i++) {
      const s = 0.40 - (i / SEGMENTS) * 0.16;      // тоньше к хвосту
      const seg = SKULL_GLB ? cloneRealSkull(s).group : createSkull(s);
      ghostify(seg, 0.5 - (i / SEGMENTS) * 0.18);  // прозрачнее к хвосту
      const gl = makeGlowSprite();
      gl.scale.setScalar(1.5 - (i / SEGMENTS) * 0.7);
      gl.position.y = s * 0.5;
      seg.add(gl);
      segs.push(seg);
      this.scene.add(seg);
    }

    // Старт: змея вытягивается из-за спины арены
    const ang = Math.random() * Math.PI * 2;
    const r = this.bounds * 0.6;
    head.position.set(Math.cos(ang) * r, 3.2, Math.sin(ang) * r);
    this.scene.add(head);
    for (let i = 0; i < SEGMENTS; i++) {
      segs[i].position.copy(head.position).add(new THREE.Vector3(0, 0, SEG_GAP * (i + 1)));
    }

    const snake = {
      name: 'ЗМЕЯ-ЧЕРЕП',
      team: -99,               // нейтральна: бьёт всех
      alive: true,
      hp: SNAKE_HP,            // убиваема!
      maxHp: SNAKE_HP,
      respawnT: 0,             // таймер респавна
      pos: head.position,      // живая ссылка (интерфейс targets)
      mesh: head,
      head, segs, eyeMat,
      vel: new THREE.Vector3(1, 0, 0),
      victim: null,
      retargetT: 1 + Math.random() * 2,
      weaveT: Math.random() * 10,
      hitCd: new Map(),        // victim → cooldown
      _sphere: new THREE.Vector3(),
      hitTest: (ray, maxDist) => {
        if (!snake.alive) return null;
        snake._sphere.set(snake.pos.x, snake.pos.y + 0.3, snake.pos.z);
        const t = raySphere(ray, snake._sphere, 0.66);
        if (t !== null && t < maxDist) {
          return { dist: t, point: ray.at(t, new THREE.Vector3()), part: 'body', target: snake };
        }
        return null;
      },
      damage: (dmg, dir) => {
        if (!snake.alive) return false;
        snake.hp -= dmg;
        // Визуал урона: чем меньше HP — тем краснее глаза
        const ratio = Math.max(0, snake.hp / snake.maxHp);
        const r = Math.floor(0x50 + (1 - ratio) * 0xaf);
        const g = Math.floor(0xff * ratio);
        const b = Math.floor(0x9a * ratio);
        eyeMat.color.setHex((r << 16) | (g << 8) | b);
        // Вспышка при попадании
        eyeMat.color.setHex(0xffffff);
        setTimeout(() => {
          if (snake.alive) {
            const r2 = Math.floor(0x50 + (1 - ratio) * 0xaf);
            const g2 = Math.floor(0xff * ratio);
            const b2 = Math.floor(0x9a * ratio);
            eyeMat.color.setHex((r2 << 16) | (g2 << 8) | b2);
          }
        }, 110);
        this.gore?.spark({ x: snake.pos.x, y: snake.pos.y + 0.3, z: snake.pos.z }, dir || null);
        if (dir) { snake.vel.x -= dir.x * 1.5; snake.vel.z -= dir.z * 1.5; }
        if (snake.hp <= 0) {
          snake.alive = false;
          snake.respawnT = RESPAWN_MIN + Math.random() * RESPAWN_RAND;
          this.gore?.burst?.(snake.pos);
          this.sfx?.play?.('enemy_destroy');
          if (snake.mesh) snake.mesh.visible = false;
          for (const seg of snake.segs) seg.visible = false;
          this.onKill?.(snake);
          return true; // true = именно УБИЙСТВО (как у ботов), не каждое попадание
        }
        return false;
      },
    };
    this.targets.push(snake);
    return snake;
  }

  // Ближайшая живая цель: игрок или бот
  _nearestVictim(snake, player, bots) {
    let best = null, bestD = Infinity;
    const consider = (kind, ref) => {
      if (!ref || !ref.alive) return;
      this._victimPos({ kind, ref }, this._tmp3);
      const d = this._tmp3.distanceToSquared(snake.pos);
      if (d < bestD) { bestD = d; best = { kind, ref }; }
    };
    if (player) consider('player', player);
    if (bots) {
      const list = Array.isArray(bots) ? bots : (bots.bots || []);
      for (const b of list) consider('bot', b);
    }
    return best;
  }

  _victimPos(victim, out) {
    if (victim.kind === 'player') {
      out.copy(victim.ref.body.pos); out.y += 0.9;
    } else {
      out.copy(victim.ref.pos); out.y += 1.0;
    }
    return out;
  }

  // Движение головы с запретом прохода сквозь статику (здания/стены)
  _moveHead(snake, dt, desired) {
    const v = snake.vel;
    // Плавный поворот к желаемому направлению
    v.lerp(desired, Math.min(1, dt * HEAD_TURN));
    // Змейное извивание: боковая синусоида перпендикулярно ходу
    snake.weaveT += dt * 5.2;
    this._tmp2.set(-v.z, 0, v.x).normalize().multiplyScalar(Math.sin(snake.weaveT) * 2.2);

    // Проверка пути впереди — сквозь здания не летим
    if (this.physics) {
      this._tmp.copy(v).add(this._tmp2);
      const sp = this._tmp.length();
      if (sp > 0.01) {
        this._tmp.divideScalar(sp);
        const look = Math.max(0.9, sp * dt * 3 + 0.7);
        const hit = this.physics.raycast(snake.pos, this._tmp, look);
        if (hit && hit.point) {
          // Скольжение вдоль стены: убираем компоненту в нормаль
          if (hit.normal) {
            const n = hit.normal;
            const dot = v.x * n.x + v.y * n.y + v.z * n.z;
            v.x -= n.x * dot * 1.7; v.y -= n.y * dot * 1.7; v.z -= n.z * dot * 1.7;
          }
          v.y += 3.5 * dt * 10; // и подъём над препятствием
          if (v.lengthSq() < 4) v.y += 2.0;
        }
      }
    }
    snake.pos.addScaledVector(v, dt);
    snake.pos.addScaledVector(this._tmp2, dt);

    // Границы арены и высоты
    const B = this.bounds - 1;
    snake.pos.x = Math.max(-B, Math.min(B, snake.pos.x));
    snake.pos.z = Math.max(-B, Math.min(B, snake.pos.z));
    snake.pos.y = Math.max(0.75, Math.min(9, snake.pos.y));

    // Мордой по движению
    if (v.lengthSq() > 0.2) {
      this._tmp3.copy(snake.pos).add(v);
      snake.head.lookAt(this._tmp3);
    }
  }

  // Цепь: каждый сегмент держится на SEG_GAP за предыдущим
  _followChain(snake, dt) {
    let prev = snake.head.position;
    for (let i = 0; i < snake.segs.length; i++) {
      const seg = snake.segs[i];
      this._tmp.subVectors(seg.position, prev);
      const d = this._tmp.length();
      if (d > 0.001) {
        this._tmp.divideScalar(d);
        // лёгкое покачивание хвоста
        const sway = Math.sin(this._t * 6 + i * 0.9) * 0.05;
        seg.position.copy(prev).addScaledVector(this._tmp, SEG_GAP);
        seg.position.y += sway;
        // мордой вперёд по цепи
        this._tmp2.copy(prev);
        seg.lookAt(this._tmp2);
      }
      prev = seg.position;
    }
  }

  _contactDamage(snake, player, bots, dt) {
    for (const [vic, cd] of snake.hitCd) {
      if (cd > 0) snake.hitCd.set(vic, cd - dt);
    }
    const tryHit = (victim, point, r, dmg) => {
      if (!victim) return;
      const alive = victim.kind === 'player' ? victim.ref.alive : victim.ref.alive;
      if (!alive) return;
      if ((snake.hitCd.get(victim.ref) || 0) > 0) return;
      this._victimPos(victim, this._tmp3);
      this._tmp3.y = point.y < this._tmp3.y ? this._tmp3.y : point.y; // честная высота
      const dx = point.x - this._tmp3.x, dz = point.z - this._tmp3.z;
      const dy = point.y - this._tmp3.y;
      if (dx * dx + dz * dz + dy * dy * 0.4 < r * r) {
        snake.hitCd.set(victim.ref, HIT_CD);
        if (victim.kind === 'player') {
          victim.ref.damage(dmg);
          this.onAttackPlayer?.(dmg);
        } else {
          victim.ref.damage(dmg, null, -1);
        }
        this.gore?.burst({ x: point.x, y: point.y, z: point.z }, null, {});
        this.sfx?.skullScreech?.();
      }
    };
    // Голова бьёт сильно
    const cur = snake.victim || this._nearestVictim(snake, player, bots);
    tryHit(cur, snake.head.position, HIT_R_HEAD, DMG_HEAD);
    // Сегменты царапают
    const near = this._nearestVictim(snake, player, bots);
    for (const seg of snake.segs) tryHit(near, seg.position, HIT_R_SEG, DMG_SEG);
  }

  // Респавн змеи после смерти: случайная точка по краю арены, полный сброс
  _respawnSnake(s) {
    const ang = Math.random() * Math.PI * 2;
    const r = this.bounds * 0.6;
    s.head.position.set(Math.cos(ang) * r, 3.2, Math.sin(ang) * r);
    for (let i = 0; i < s.segs.length; i++) {
      s.segs[i].position.copy(s.head.position).add(this._tmp.set(0, 0, SEG_GAP * (i + 1)));
    }
    s.hp = s.maxHp;
    s.alive = true;
    s.victim = null;
    s.hitCd.clear();
    s.vel.set(1, 0, 0);
    s.retargetT = 0; // цель выберется в этом же тике
    s.head.visible = true;
    for (const seg of s.segs) seg.visible = true;
    s.eyeMat.color.setHex(0x50ff9a); // глаза снова зелёные
  }

  update(dt, player, bots) {
    this._t += dt;
    for (const s of this.targets) {
      // Мёртвая змея: невидима, не двигается, не бьёт — ждёт респавна
      if (!s.alive) {
        s.respawnT -= dt;
        if (s.respawnT <= 0) this._respawnSnake(s);
        continue;
      }
      // Смена/валидация цели
      s.retargetT -= dt;
      const vAlive = s.victim && (s.victim.kind === 'player' ? s.victim.ref.alive : s.victim.ref.alive);
      if (s.retargetT <= 0 || !vAlive) {
        s.victim = this._nearestVictim(s, player, bots);
        s.retargetT = RETARGET_MIN + Math.random() * (RETARGET_MAX - RETARGET_MIN);
      }
      // Желаемая скорость — к цели (преследование)
      if (s.victim) {
        this._victimPos(s.victim, this._tmp);
        this._tmp.sub(s.pos).normalize().multiplyScalar(HEAD_SPEED);
      } else {
        // нет целей — медленный круг по арене
        this._tmp.set(Math.cos(this._t * 0.3), 0.1, Math.sin(this._t * 0.3)).multiplyScalar(HEAD_SPEED * 0.5);
      }
      this._moveHead(s, dt, this._tmp);
      this._followChain(s, dt);
      this._contactDamage(s, player, bots, dt);
      // Пульс свечения глаз
      s.eyeMat.opacity = 0.75 + Math.sin(this._t * 7) * 0.2;
    }
  }

  reset() {
    for (const s of this.targets) {
      this.scene.remove(s.head);
      for (const seg of s.segs) this.scene.remove(seg);
    }
    this.targets.length = 0;
  }
}
