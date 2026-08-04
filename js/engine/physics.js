// ===== GEN.SWAGS Physics =====
// Гравитация, капсула (AABB-приближение) vs статичные AABB + разрушаемые чанки,
// sweep-перемещение по осям, raycast helper.
import * as THREE from 'three';

export class PhysicsWorld {
  constructor() {
    this.gravity = -22;
    this.statics = [];      // {min:Vector3, max:Vector3, tag}
    this.chunkProvider = null; // функция (aabb)=>массив чанк-AABB разрушаемых
    this._tmpBox = new THREE.Box3();
  }

  addStatic(min, max, tag = 'static') {
    const b = { min: min.clone(), max: max.clone(), tag };
    this.statics.push(b);
    return b;
  }
  addStaticBox(box3, tag = 'static') { return this.addStatic(box3.min, box3.max, tag); }
  removeStatic(b) {
    const i = this.statics.indexOf(b);
    if (i >= 0) this.statics.splice(i, 1);
  }
  clear() { this.statics.length = 0; }

  // AABB тела в позиции pos (pos — ноги/центр-низ), size {x: полширина, y: высота}
  _bodyBox(pos, half, height, out) {
    out.min.set(pos.x - half, pos.y, pos.z - half);
    out.max.set(pos.x + half, pos.y + height, pos.z + half);
    return out;
  }

  // Sweep-перемещение тела (игрока): pos — позиция ног, vel — скорость.
  // Возвращает { onGround, hitCeiling, hitWall, groundTag }
  // АНТИ-ТОННЕЛИНГ: длинный шаг (dash/slide на высокой скорости) делится
  // на подшаги ≤ half — тело не «прошивает» тонкие стены сквозь AABB.
  moveBody(body, dt) {
    const { half, height } = body;
    const res = { onGround: false, hitCeiling: false, hitWall: false, groundTag: null };
    const pos = body.pos, vel = body.vel;
    // Макс. линейный сдвиг за кадр → число подшагов (не даём прыгать дальше полуширины)
    const maxDelta = Math.max(Math.abs(vel.x), Math.abs(vel.y), Math.abs(vel.z)) * dt;
    const steps = Math.min(8, Math.max(1, Math.ceil(maxDelta / Math.max(0.05, half * 0.9))));
    const sdt = dt / steps;
    for (let s = 0; s < steps; s++) this._moveStep(body, sdt, res);
    return res;
  }

  _moveStep(body, dt, res) {
    const { half, height } = body;
    const pos = body.pos, vel = body.vel;

    // По осям отдельно — классический и дешёвый sweep для AABB
    const axes = ['y', 'x', 'z'];
    for (const axis of axes) {
      const delta = vel[axis] * dt;
      if (delta === 0) continue;
      pos[axis] += delta;
      this._bodyBox(pos, half, height, this._tmpBox);
      const hit = this._firstOverlap(this._tmpBox);
      if (hit) {
        if (axis === 'y') {
          if (delta < 0) {
            pos.y = hit.max.y;
            res.onGround = true;
            res.groundTag = hit.tag;
          } else {
            pos.y = hit.min.y - height;
            res.hitCeiling = true;
          }
          vel.y = 0;
        } else {
          res.hitWall = true;
          // Отодвигаем вплотную к стене
          if (delta > 0) pos[axis] = hit.min[axis] - half - 0.001;
          else pos[axis] = hit.max[axis] + half + 0.001;
          vel[axis] = 0;
        }
        this._bodyBox(pos, half, height, this._tmpBox);
      }
    }
    return res;
  }

  _firstOverlap(box) {
    for (const s of this.statics) {
      if (box.min.x < s.max.x && box.max.x > s.min.x &&
          box.min.y < s.max.y && box.max.y > s.min.y &&
          box.min.z < s.max.z && box.max.z > s.min.z) return s;
    }
    if (this.chunkProvider) {
      const chunks = this.chunkProvider(box);
      for (const s of chunks) {
        if (box.min.x < s.max.x && box.max.x > s.min.x &&
            box.min.y < s.max.y && box.max.y > s.min.y &&
            box.min.z < s.max.z && box.max.z > s.min.z) return s;
      }
    }
    return null;
  }

  // Raycast по статике (и опционально по мешам через three Raycaster снаружи).
  // Возвращает {point, normal, dist, tag} или null.
  raycast(origin, dir, maxDist = 100) {
    let best = null;
    let bestT = maxDist;
    const test = (box, tag) => {
      const t = this._rayBox(origin, dir, box);
      if (t !== null && t < bestT) {
        bestT = t;
        best = { dist: t, tag, point: new THREE.Vector3().copy(dir).multiplyScalar(t).add(origin), normal: this._boxNormal(box, origin, dir, t) };
      }
    };
    for (const s of this.statics) test(s, s.tag);
    if (this.chunkProvider) {
      // Большой запрос: AABB вдоль луча
      const end = new THREE.Vector3().copy(dir).multiplyScalar(maxDist).add(origin);
      const q = new THREE.Box3(
        new THREE.Vector3(Math.min(origin.x, end.x), Math.min(origin.y, end.y), Math.min(origin.z, end.z)),
        new THREE.Vector3(Math.max(origin.x, end.x), Math.max(origin.y, end.y), Math.max(origin.z, end.z)),
      );
      for (const c of this.chunkProvider(q)) test(c, c.tag || 'chunk');
    }
    return best;
  }

  _rayBox(o, d, box) {
    let tmin = 0, tmax = Infinity;
    for (const a of ['x', 'y', 'z']) {
      const inv = 1 / d[a];
      let t0 = (box.min[a] - o[a]) * inv;
      let t1 = (box.max[a] - o[a]) * inv;
      if (inv < 0) { const t = t0; t0 = t1; t1 = t; }
      tmin = Math.max(tmin, t0);
      tmax = Math.min(tmax, t1);
      if (tmax < tmin) return null;
    }
    return tmin >= 0 ? tmin : null;
  }

  _boxNormal(box, o, d, t) {
    const p = new THREE.Vector3().copy(d).multiplyScalar(t).add(o);
    const eps = 0.01;
    const n = new THREE.Vector3();
    if (Math.abs(p.x - box.min.x) < eps) n.set(-1, 0, 0);
    else if (Math.abs(p.x - box.max.x) < eps) n.set(1, 0, 0);
    else if (Math.abs(p.y - box.min.y) < eps) n.set(0, -1, 0);
    else if (Math.abs(p.y - box.max.y) < eps) n.set(0, 1, 0);
    else if (Math.abs(p.z - box.min.z) < eps) n.set(0, 0, -1);
    else n.set(0, 0, 1);
    return n;
  }
}
