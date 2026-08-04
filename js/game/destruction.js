// ===== GEN.SWAGS Destruction =====
// Разрушаемость в стиле The Finals: чанки стен, ослабление соседей,
// обрушение неподдерживаемых (flood-fill от нижнего ряда), обломки.
import * as THREE from 'three';

export class DestructionSystem {
  constructor(scene, sfx) {
    this.scene = scene;
    this.sfx = sfx;
    this.walls = [];        // [{chunks, cols, rows}]
    this.roofs = [];        // крыши, зависящие от опор [{walls, mesh, collider, physics, state}]
    this.debris = [];       // обломки с физикой
    this.onCollapse = null; // cb(chunkCount)
    this.onChunkDestroyed = null; // cb(chunk) — для сетевой рассылки
    this.onRoofCollapse = null;   // cb(pos) — удар крыши о землю (урон по радиусу)
    this._debrisGeo = null;
    this._collapseQueue = [];
  }

  // Полный сброс перед пересборкой арены: стены разрегистрированы,
  // обломки убраны со сцены. Материалы/геометрию стен освобождает disposeArena.
  reset() {
    for (const d of this.debris) d.mesh.removeFromParent?.();
    this.debris.length = 0;
    this.walls.length = 0;
    // Падающие крыши были перенесены в корень сцены — убираем вручную
    for (const r of this.roofs) {
      if (r.state !== 'stand') r.mesh.removeFromParent?.();
    }
    this.roofs.length = 0;
    this._collapseQueue.length = 0;
  }

  // Регистрация стены из models.createDestructibleWall
  registerWall(wall) {
    wall.group.updateMatrixWorld(true);
    const wi = this.walls.length;
    wall.chunks.forEach((c, ci) => {
      c.id = `w${wi}_${ci}`; // детерминированный id для сетевой синхронизации
      c.aabb.setFromObject(c.mesh);
      c.aabb.expandByScalar(-0.02); // зазор, чтобы соседи не цеплялись
      c.aabb.tag = 'chunk';
      c.wallRef = wall;
      c.mesh.userData.baseColor = c.mesh.material.color.clone();
    });
    this.walls.push(wall);
  }

  // Регистрация крыши, зависящей от опор (arena.buildingBlock).
  // walls — 3 стены-опоры; mesh — плита крыши; collider — статик physics (снимаем при падении).
  registerRoof({ walls, mesh, collider, physics }) {
    this.roofs.push({
      walls, mesh, collider, physics,
      state: 'stand', // stand|fall|done
      vel: new THREE.Vector3(),
      angVel: new THREE.Vector3(),
    });
  }

  // Стена «разрушена» как опора, если живых чанков осталось < 40%
  _wallDestroyed(wall) {
    let alive = 0;
    for (const c of wall.chunks) if (c.alive) alive++;
    return alive < wall.chunks.length * 0.4;
  }

  // Потеря 2+ опор → крыша обрушается (фишка геймплея)
  _checkRoofs() {
    for (const r of this.roofs) {
      if (r.state !== 'stand') continue;
      let dead = 0;
      for (const w of r.walls) if (this._wallDestroyed(w)) dead++;
      if (dead >= 2) this._collapseRoof(r);
    }
  }

  _collapseRoof(r) {
    r.state = 'fall';
    r.physics?.removeStatic?.(r.collider);
    // Переносим плиту в корень сцены с мировым трансформом (как _collapseChunk)
    r.mesh.updateMatrixWorld(true);
    const wp = new THREE.Vector3(), wq = new THREE.Quaternion(), ws = new THREE.Vector3();
    r.mesh.matrixWorld.decompose(wp, wq, ws);
    r.mesh.removeFromParent();
    r.mesh.position.copy(wp); r.mesh.quaternion.copy(wq); r.mesh.scale.copy(ws);
    this.scene.add(r.mesh);
    r.vel.set(0, -0.8, 0);
    // Наклон при падении — крыша «съезжает» с ослабленной опоры
    r.angVel.set((Math.random() - 0.5) * 1.1, (Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 1.1);
    this.sfx?.collapse();
  }

  // Провайдер AABB живых чанков для physics (пересечение с запросным боксом)
  chunkProvider = (queryBox) => {
    const out = [];
    for (const wall of this.walls) {
      // Быстрый отсев по боксу всей стены
      if (!wall._worldBox) {
        wall._worldBox = new THREE.Box3().setFromObject(wall.group);
        wall._worldBox.expandByScalar(1);
      }
      if (!queryBox.intersectsBox(wall._worldBox)) continue;
      for (const c of wall.chunks) {
        if (c.alive && queryBox.intersectsBox(c.aabb)) out.push(c.aabb);
      }
    }
    return out;
  };

  // Нанести урон в точке мира: радиус + урон. Пули: radius ~0.9, взрыв: 2.5+
  applyDamage(worldPoint, radius, damage) {
    const p = worldPoint;
    let damaged = [];
    for (const wall of this.walls) {
      if (!wall._worldBox) continue;
      // Точка близко к стене?
      const clamped = p.clone().clamp(wall._worldBox.min, wall._worldBox.max);
      if (clamped.distanceToSquared(p) > (radius + 2) * (radius + 2)) continue;
      for (const c of wall.chunks) {
        if (!c.alive) continue;
        const cp = p.clone().clamp(c.aabb.min, c.aabb.max);
        const dist = cp.distanceTo(p);
        if (dist <= radius) {
          const falloff = 1 - (dist / radius) * 0.6;
          c.hp -= damage * falloff;
          damaged.push(c);
        }
      }
    }
    let destroyedAny = false;
    for (const c of damaged) {
      if (c.hp <= 0 && c.alive) {
        this._destroyChunk(c, true);
        destroyedAny = true;
      } else if (c.alive) {
        this._crackChunk(c);
      }
    }
    if (destroyedAny) this._checkSupportAll();
    return damaged.length;
  }

  // Визуальные трещины — затемнение материала
  _crackChunk(c) {
    const k = Math.max(0.25, c.hp / c.maxHp);
    c.mesh.material.color.copy(c.mesh.userData.baseColor || c.mesh.material.color).multiplyScalar(0.45 + 0.55 * k);
  }

  _destroyChunk(c, makeDebris) {
    c.alive = false;
    c.mesh.visible = false;
    if (makeDebris) this._spawnDebris(c);
    if (this.onChunkDestroyed) this.onChunkDestroyed(c);
  }

  // Сетевое разрушение по id (идемпотентно): сервер прислал 'chunk'.
  // Своя копия уже мертва → возвращаем false. Затем прогоняем проверку
  // связности, чтобы зеркалить обрушения.
  applyChunkId(id) {
    for (const wall of this.walls) {
      for (const c of wall.chunks) {
        if (c.id === id) {
          if (!c.alive) return false;
          c.alive = false;
          c.mesh.visible = false;
          this._spawnDebris(c);
          this._checkSupportAll();
          return true;
        }
      }
    }
    return false;
  }

  // Проверка связности: flood-fill от нижнего ряда (row=0). Недостижимые обрушиваются.
  _checkSupportAll() {
    for (const wall of this.walls) {
      const { chunks, cols, rows } = wall;
      const supported = new Set();
      const stack = [];
      for (const c of chunks) {
        if (c.alive && c.row === 0) { supported.add(c); stack.push(c); }
      }
      while (stack.length) {
        const c = stack.pop();
        // 4-соседство
        for (const n of chunks) {
          if (!n.alive || supported.has(n)) continue;
          const dc = Math.abs(n.col - c.col), dr = Math.abs(n.row - c.row);
          if (dc + dr === 1) { supported.add(n); stack.push(n); }
        }
      }
      let collapseCount = 0;
      for (const c of chunks) {
        if (c.alive && !supported.has(c)) {
          this._collapseChunk(c);
          collapseCount++;
        }
      }
      if (collapseCount > 0) {
        this.sfx?.collapse();
        if (this.onCollapse) this.onCollapse(collapseCount, wall);
      }
    }
    // Крыши: потеря 2+ опор → обрушение плиты
    this._checkRoofs();
  }

  // Обрушение: чанк падает как обломок (остаётся mesh, но с физикой)
  _collapseChunk(c) {
    c.alive = false;
    if (this.onChunkDestroyed) this.onChunkDestroyed(c);
    const m = c.mesh;
    this.debris.push({
      mesh: m,
      vel: new THREE.Vector3((Math.random() - 0.5) * 1.5, -0.5, (Math.random() - 0.5) * 1.5),
      angVel: new THREE.Vector3((Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3),
      life: 3.5,
      world: true, // меш уже в мировых координатах группы — переведём
    });
    // Переносим меш в корень сцены с мировым трансформом
    c.mesh.updateMatrixWorld(true);
    const wp = new THREE.Vector3(), wq = new THREE.Quaternion(), ws = new THREE.Vector3();
    c.mesh.matrixWorld.decompose(wp, wq, ws);
    c.mesh.removeFromParent();
    m.position.copy(wp); m.quaternion.copy(wq); m.scale.copy(ws);
    this.scene.add(m);
  }

  _spawnDebris(c) {
    if (!this._debrisGeo) this._debrisGeo = new THREE.BoxGeometry(0.3, 0.3, 0.3);
    const m = c.mesh;
    const wp = new THREE.Vector3();
    m.getWorldPosition(wp);
    // 3 мелких обломка вместо целого чанка — дешевле и живописнее
    for (let i = 0; i < 3; i++) {
      const d = new THREE.Mesh(this._debrisGeo, m.material);
      d.position.copy(wp).add(new THREE.Vector3((Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.4));
      d.scale.setScalar(0.6 + Math.random() * 0.9);
      this.scene.add(d);
      this.debris.push({
        mesh: d,
        vel: new THREE.Vector3((Math.random() - 0.5) * 4, 1 + Math.random() * 3, (Math.random() - 0.5) * 4),
        angVel: new THREE.Vector3(Math.random() * 9 - 4.5, Math.random() * 9 - 4.5, Math.random() * 9 - 4.5),
        life: 2 + Math.random(),
      });
    }
  }

  // Восстановить стену: воскрешает чанки, чей меш ещё в группе стены
  // (обрушенные в мир обломки не возвращаются — они уже самостоятельные).
  restoreWall(wall) {
    let restored = 0;
    for (const c of wall.chunks) {
      if (c.alive) continue;
      if (c.mesh.parent !== wall.group) continue; // обрушен — не трогаем
      c.alive = true;
      c.hp = c.maxHp;
      c.mesh.visible = true;
      if (c.mesh.userData.baseColor) c.mesh.material.color.copy(c.mesh.userData.baseColor);
      restored++;
    }
    return restored;
  }

  // Переместить стену (пересборка арены): сдвиг/поворот группы + пересчёт AABB чанков.
  moveWall(wall, x, z, rotY = null) {
    wall.group.position.x = x;
    wall.group.position.z = z;
    if (rotY !== null) wall.group.rotation.y = rotY;
    wall.group.updateMatrixWorld(true);
    for (const c of wall.chunks) {
      if (c.mesh.parent !== wall.group) continue;
      c.aabb.setFromObject(c.mesh);
      c.aabb.expandByScalar(-0.02);
      c.aabb.tag = 'chunk';
    }
    wall._worldBox = null; // пересчитается в chunkProvider
  }

  // Апдейт обломков: гравитация, вращение, остановка на y=0, исчезновение
  update(dt) {
    // Падающие крыши: гравитация + наклон, удар о землю → обломки + урон
    for (const r of this.roofs) {
      if (r.state !== 'fall') continue;
      r.vel.y -= 22 * dt;
      r.mesh.position.addScaledVector(r.vel, dt);
      r.mesh.rotation.x += r.angVel.x * dt;
      r.mesh.rotation.y += r.angVel.y * dt;
      r.mesh.rotation.z += r.angVel.z * dt;
      if (r.mesh.position.y <= 0.45 && r.vel.y < 0) {
        r.state = 'done';
        const impactPos = r.mesh.position.clone();
        impactPos.y = 0.3;
        // Распад плиты на крупные обломки
        if (!this._debrisGeo) this._debrisGeo = new THREE.BoxGeometry(0.3, 0.3, 0.3);
        for (let i = 0; i < 9; i++) {
          const d = new THREE.Mesh(this._debrisGeo, r.mesh.material);
          d.position.copy(impactPos).add(new THREE.Vector3((Math.random() - 0.5) * 5, 0.4 + Math.random(), (Math.random() - 0.5) * 5));
          d.scale.setScalar(1.5 + Math.random() * 2.5);
          this.scene.add(d);
          this.debris.push({
            mesh: d,
            vel: new THREE.Vector3((Math.random() - 0.5) * 7, 2 + Math.random() * 4, (Math.random() - 0.5) * 7),
            angVel: new THREE.Vector3(Math.random() * 9 - 4.5, Math.random() * 9 - 4.5, Math.random() * 9 - 4.5),
            life: 3 + Math.random(),
          });
        }
        r.mesh.removeFromParent();
        this.sfx?.collapse();
        if (this.onRoofCollapse) this.onRoofCollapse(impactPos);
      }
    }
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.life -= dt;
      d.vel.y -= 20 * dt;
      d.mesh.position.addScaledVector(d.vel, dt);
      d.mesh.rotation.x += d.angVel.x * dt;
      d.mesh.rotation.y += d.angVel.y * dt;
      d.mesh.rotation.z += d.angVel.z * dt;
      if (d.mesh.position.y < 0.15 && d.vel.y < 0) {
        d.mesh.position.y = 0.15;
        d.vel.y *= -0.3;
        d.vel.x *= 0.7; d.vel.z *= 0.7;
        d.angVel.multiplyScalar(0.6);
      }
      if (d.life <= 0) {
        d.mesh.removeFromParent();
        this.debris.splice(i, 1);
      } else if (d.life < 0.5) {
        d.mesh.scale.multiplyScalar(1 - dt * 2);
      }
    }
  }
}
