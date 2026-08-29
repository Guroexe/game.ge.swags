// ===== GEN.SWAGS Physics =====
// Гравитация, капсула (AABB-приближение) vs статичные AABB + разрушаемые чанки,
// sweep-перемещение по осям, raycast helper.
import * as THREE from 'three';

export class PhysicsWorld {
  constructor() {
    this.gravity = -22;
    this.statics = [];      // {min:Vector3, max:Vector3, tag, deleted?, _gkeys?}
    this.chunkProvider = null; // функция (aabb)=>массив чанк-AABB разрушаемых
    this._tmpBox = new THREE.Box3();
    // Пространственная хэш-сетка по XZ: на больших GLB-картах (30-160к
    // коллайдеров) линейный обход всех статиков за кадр был бы слишком дорогим.
    this._cell = 4;              // м на ячейку
    this._grid = new Map();      // "cx|cz" -> int[] (индексы statics)
  }

  _gKeys(box) {
    const keys = [];
    const x0 = Math.floor(box.min.x / this._cell), x1 = Math.floor(box.max.x / this._cell);
    const z0 = Math.floor(box.min.z / this._cell), z1 = Math.floor(box.max.z / this._cell);
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) keys.push(x + '|' + z);
    return keys;
  }

  addStatic(min, max, tag = 'static') {
    const b = { min: min.clone(), max: max.clone(), tag };
    const idx = this.statics.length;
    this.statics.push(b);
    b._gkeys = this._gKeys(b);
    for (const k of b._gkeys) {
      let arr = this._grid.get(k);
      if (!arr) this._grid.set(k, arr = []);
      arr.push(idx);
    }
    return b;
  }
  addStaticBox(box3, tag = 'static') { return this.addStatic(box3.min, box3.max, tag); }

  // Удаление — пометкой (deleted): индексы в сетке не сдвигаются
  removeStatic(b) {
    const i = this.statics.indexOf(b);
    if (i < 0) return;
    b.deleted = true;
    if (b._gkeys) {
      for (const k of b._gkeys) {
        const arr = this._grid.get(k);
        if (!arr) continue;
        const j = arr.indexOf(i);
        if (j >= 0) arr.splice(j, 1);
      }
      b._gkeys = null;
    }
  }

  // Перерегистрация после изменения min/max (станции на GLB-картах)
  updateStatic(b) {
    const i = this.statics.indexOf(b);
    if (i < 0) return;
    if (b._gkeys) {
      for (const k of b._gkeys) {
        const arr = this._grid.get(k);
        if (!arr) continue;
        const j = arr.indexOf(i);
        if (j >= 0) arr.splice(j, 1);
      }
    }
    b._gkeys = this._gKeys(b);
    for (const k of b._gkeys) {
      let arr = this._grid.get(k);
      if (!arr) this._grid.set(k, arr = []);
      arr.push(i);
    }
  }

  clear() { this.statics.length = 0; this._grid.clear(); }

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
    // Кандидаты только из ячеек сетки под боксом (а не все статики)
    const x0 = Math.floor(box.min.x / this._cell), x1 = Math.floor(box.max.x / this._cell);
    const z0 = Math.floor(box.min.z / this._cell), z1 = Math.floor(box.max.z / this._cell);
    for (let x = x0; x <= x1; x++) {
      for (let z = z0; z <= z1; z++) {
        const arr = this._grid.get(x + '|' + z);
        if (!arr) continue;
        for (const i of arr) {
          const s = this.statics[i];
          if (s.deleted) continue;
          if (box.min.x < s.max.x && box.max.x > s.min.x &&
              box.min.y < s.max.y && box.max.y > s.min.y &&
              box.min.z < s.max.z && box.max.z > s.min.z) return s;
        }
      }
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

  // Raycast по статике: DDA-обход сетки вдоль луча (только ячейки на пути),
  // чанки разрушаемых — по AABB луча. Возвращает {point, normal, dist, tag} или null.
  raycast(origin, dir, maxDist = 100) {
    let best = null;
    let bestT = maxDist;
    const test = (box, tag) => {
      if (box.deleted) return;
      const t = this._rayBox(origin, dir, box);
      if (t !== null && t < bestT) {
        bestT = t;
        best = { dist: t, tag, point: new THREE.Vector3().copy(dir).multiplyScalar(t).add(origin), normal: this._boxNormal(box, origin, dir, t) };
      }
    };
    const cs = this._cell;
    const adx = Math.abs(dir.x), adz = Math.abs(dir.z);
    if (adx < 1e-9 && adz < 1e-9) {
      // Вертикальный луч — живёт в одной XZ-ячейке
      const arr = this._grid.get(Math.floor(origin.x / cs) + '|' + Math.floor(origin.z / cs));
      if (arr) for (const i of arr) test(this.statics[i], this.statics[i].tag);
    } else {
      // DDA: шагаем по ячейкам вдоль луча, пока не дальше лучшего попадания
      let cx = Math.floor(origin.x / cs), cz = Math.floor(origin.z / cs);
      const stepX = dir.x > 0 ? 1 : -1, stepZ = dir.z > 0 ? 1 : -1;
      const tDX = adx < 1e-9 ? Infinity : cs / adx;
      const tDZ = adz < 1e-9 ? Infinity : cs / adz;
      let tMaxX = adx < 1e-9 ? Infinity : (((dir.x > 0 ? cx + 1 : cx) * cs) - origin.x) / dir.x;
      let tMaxZ = adz < 1e-9 ? Infinity : (((dir.z > 0 ? cz + 1 : cz) * cs) - origin.z) / dir.z;
      let t = 0;
      let guard = 0;
      while (t <= bestT && guard++ < 512) {
        const arr = this._grid.get(cx + '|' + cz);
        if (arr) for (const i of arr) test(this.statics[i], this.statics[i].tag);
        if (tMaxX < tMaxZ) { t = tMaxX; tMaxX += tDX; cx += stepX; }
        else { t = tMaxZ; tMaxZ += tDZ; cz += stepZ; }
      }
    }
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
