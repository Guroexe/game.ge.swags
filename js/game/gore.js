// ===== GEN.SWAGS Gore (18+) =====
// Кровь: бурсты частиц при попаданиях, фонтан при хедшоте/убийстве,
// долгоживущие сплаты на полу. Пулы без аллокаций в горячем цикле.
import * as THREE from 'three';

// Процедурная текстура сплата: тёмно-красные кляксы с брызгами
function makeSplatTexture(size = 256) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  const cx = size / 2, cy = size / 2;
  // Центральное пятно — несколько наслоённых эллипсов
  for (let i = 0; i < 14; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * size * 0.16;
    const w = size * (0.10 + Math.random() * 0.14);
    const h = w * (0.55 + Math.random() * 0.6);
    ctx.fillStyle = `rgba(${90 + Math.random() * 60 | 0},${4 + Math.random() * 10 | 0},${12 + Math.random() * 14 | 0},${0.55 + Math.random() * 0.35})`;
    ctx.beginPath();
    ctx.ellipse(cx + Math.cos(a) * r, cy + Math.sin(a) * r, w, h, a, 0, Math.PI * 2);
    ctx.fill();
  }
  // Брызги-капли по краям
  for (let i = 0; i < 46; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = size * (0.14 + Math.random() * 0.32);
    const s = 1 + Math.random() * (Math.random() < 0.2 ? 9 : 4);
    ctx.fillStyle = `rgba(${70 + Math.random() * 70 | 0},3,10,${0.5 + Math.random() * 0.45})`;
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, s, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const BURSTS = 20;      // пул бурстов
const PER_BURST = 30;   // частиц в бурсте
const SPLATS = 22;      // пул сплатов на полу
const SPARK_BURSTS = 12;   // пул искр (попадания в мир)
const PER_SPARK = 16;
const WISPS = 10;          // пул душ-виспов (убийства)
const PER_WISP = 12;
const GIBS = 24;           // пул оторванных частей тела (расчленёнка 18+)

export class GoreSystem {
  constructor(scene) {
    this.scene = scene;
    this.enabled = true;

    // --- Бурсты частиц (один Points на бурст) ---
    this._bursts = [];
    for (let i = 0; i < BURSTS; i++) {
      const geo = new THREE.BufferGeometry();
      const pos = new Float32Array(PER_BURST * 3);
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const mat = new THREE.PointsMaterial({
        color: 0xb30620, size: 0.11, transparent: true, opacity: 0.95,
        depthWrite: false, sizeAttenuation: true,
      });
      const pts = new THREE.Points(geo, mat);
      pts.visible = false;
      pts.frustumCulled = false;
      scene.add(pts);
      this._bursts.push({
        pts, life: 0,
        vel: new Float32Array(PER_BURST * 3),
      });
    }
    this._burstIdx = 0;

    // --- Сплаты на полу (пул плоскостей) ---
    const splatTex = makeSplatTexture(256);
    this._splats = [];
    for (let i = 0; i < SPLATS; i++) {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({
          map: splatTex, transparent: true, opacity: 0,
          depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2,
        }),
      );
      m.rotation.x = -Math.PI / 2;
      m.visible = false;
      m.renderOrder = 2;
      scene.add(m);
      this._splats.push({ mesh: m, life: 0, max: 1 });
    }
    this._splatIdx = 0;

    // --- Искры (аддитивные, попадания в стены/мир) ---
    this._sparks = [];
    for (let i = 0; i < SPARK_BURSTS; i++) {
      const geo = new THREE.BufferGeometry();
      const pos = new Float32Array(PER_SPARK * 3);
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const mat = new THREE.PointsMaterial({
        color: 0xffc46b, size: 0.06, transparent: true, opacity: 1,
        blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
      });
      const pts = new THREE.Points(geo, mat);
      pts.visible = false;
      pts.frustumCulled = false;
      scene.add(pts);
      this._sparks.push({ pts, life: 0, vel: new Float32Array(PER_SPARK * 3) });
    }
    this._sparkIdx = 0;

    // --- Души-виспы (убийства: бело-красные огоньки, поднимаются вверх) ---
    this._wisps = [];
    for (let i = 0; i < WISPS; i++) {
      const geo = new THREE.BufferGeometry();
      const pos = new Float32Array(PER_WISP * 3);
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const mat = new THREE.PointsMaterial({
        color: 0xffd8dc, size: 0.14, transparent: true, opacity: 0.9,
        blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
      });
      const pts = new THREE.Points(geo, mat);
      pts.visible = false;
      pts.frustumCulled = false;
      scene.add(pts);
      this._wisps.push({
        pts, life: 0, seed: Math.random() * 100,
        vel: new Float32Array(PER_WISP * 3),
      });
    }
    this._wispIdx = 0;
    this._t = 0;

    // --- Гибсы: оторванные конечности/головы (18+), меши с баллистикой ---
    this._gibGeos = [
      new THREE.CapsuleGeometry(0.08, 0.32, 3, 6),   // рука/нога
      new THREE.BoxGeometry(0.26, 0.18, 0.16),       // кусок торса
      new THREE.SphereGeometry(0.11, 8, 6),          // голова
      new THREE.TorusGeometry(0.10, 0.038, 6, 12),   // кольцо кишок (18+)
    ];
    this._gibMats = [
      new THREE.MeshStandardMaterial({ color: 0x6e0a14, roughness: 0.55, metalness: 0.1 }),  // плоть
      new THREE.MeshStandardMaterial({ color: 0xd8cfc2, roughness: 0.7, metalness: 0.0 }),   // кость
      new THREE.MeshStandardMaterial({ color: 0x3a3f4a, roughness: 0.35, metalness: 0.85 }), // кибер-хром
      new THREE.MeshStandardMaterial({ color: 0xb0485a, roughness: 0.62, metalness: 0.05 }), // внутренности
    ];
    this._gibs = [];
    for (let i = 0; i < GIBS; i++) {
      const m = new THREE.Mesh(this._gibGeos[0], this._gibMats[0]);
      m.visible = false;
      scene.add(m);
      this._gibs.push({
        mesh: m, life: 0, bounced: false,
        vel: new THREE.Vector3(), rot: new THREE.Vector3(), r: 0.1,
      });
    }
    this._gibIdx = 0;
  }

  // Искры в точке попадания (стены, броня): короткие аддитивные брызги
  spark(point, dir = null) {
    if (!this.enabled) return;
    const s = this._sparks[this._sparkIdx];
    this._sparkIdx = (this._sparkIdx + 1) % SPARK_BURSTS;
    const arr = s.pts.geometry.attributes.position.array;
    for (let i = 0; i < PER_SPARK; i++) {
      arr[i * 3] = point.x; arr[i * 3 + 1] = point.y; arr[i * 3 + 2] = point.z;
      const a = Math.random() * Math.PI * 2;
      const up = Math.random() * Math.PI - Math.PI / 2;
      const sp = 1.5 + Math.random() * 3.5;
      // Разлёт преимущественно ОТ поверхности (dir — нормаль/направление отскока)
      const bx = dir ? dir.x : 0, by = dir ? Math.abs(dir.y) + 0.4 : 0.5, bz = dir ? dir.z : 0;
      s.vel[i * 3] = Math.cos(a) * Math.cos(up) * sp * 0.6 + bx * sp;
      s.vel[i * 3 + 1] = Math.abs(Math.sin(up)) * sp * 0.7 + by * sp * 0.4;
      s.vel[i * 3 + 2] = Math.sin(a) * Math.cos(up) * sp * 0.6 + bz * sp;
    }
    s.pts.geometry.attributes.position.needsUpdate = true;
    s.pts.material.opacity = 1;
    s.pts.visible = true;
    s.life = 0.38;
  }

  // Душа убитого: столбик огоньков, вьющийся вверх (~1.6с)
  wisp(point) {
    if (!this.enabled) return;
    const w = this._wisps[this._wispIdx];
    this._wispIdx = (this._wispIdx + 1) % WISPS;
    const arr = w.pts.geometry.attributes.position.array;
    for (let i = 0; i < PER_WISP; i++) {
      arr[i * 3] = point.x + (Math.random() - 0.5) * 0.5;
      arr[i * 3 + 1] = point.y + Math.random() * 0.6;
      arr[i * 3 + 2] = point.z + (Math.random() - 0.5) * 0.5;
      w.vel[i * 3] = (Math.random() - 0.5) * 0.5;
      w.vel[i * 3 + 1] = 1.2 + Math.random() * 1.6;
      w.vel[i * 3 + 2] = (Math.random() - 0.5) * 0.5;
    }
    w.pts.geometry.attributes.position.needsUpdate = true;
    w.pts.material.opacity = 0.9;
    w.pts.visible = true;
    w.life = 1.6;
    w.seed = Math.random() * 100;
  }

  // Расчленёнка: count кусков разлетаются из точки, отскакивают от пола,
  // оставляют сплаты, растворяются. dir — направление выстрела (разлёт по нему).
  // heads=false — без головы (напр. труп остался целым).
  gib(point, dir = null, count = 5, { heads = true } = {}) {
    if (!this.enabled) return;
    for (let n = 0; n < count; n++) {
      const g = this._gibs[this._gibIdx];
      this._gibIdx = (this._gibIdx + 1) % GIBS;
      const kind = (n === 0 && heads) ? 2 : (Math.random() < 0.55 ? 0 : 1); // первый — голова
      g.mesh.geometry = this._gibGeos[kind];
      g.mesh.material = this._gibMats[kind === 2 ? (Math.random() < 0.5 ? 0 : 1) : (Math.random() * 3 | 0)];
      g.r = kind === 2 ? 0.11 : kind === 1 ? 0.14 : 0.09;
      g.mesh.position.set(
        point.x + (Math.random() - 0.5) * 0.4,
        point.y + (Math.random() - 0.5) * 0.5,
        point.z + (Math.random() - 0.5) * 0.4,
      );
      const a = Math.random() * Math.PI * 2;
      const sp = 2.2 + Math.random() * 3.6;
      g.vel.set(
        Math.cos(a) * sp * 0.7 + (dir ? dir.x * 3.2 : 0),
        2.4 + Math.random() * 3.4,
        Math.sin(a) * sp * 0.7 + (dir ? dir.z * 3.2 : 0),
      );
      g.rot.set(Math.random() * 12 - 6, Math.random() * 12 - 6, Math.random() * 12 - 6);
      g.bounced = false;
      g.life = 5.5 + Math.random() * 1.5;
      g.mesh.scale.setScalar(1);
      g.mesh.visible = true;
    }
  }

  // Кишки: разрыв живота — петли внутренностей вываливаются наружу (18+).
  // Низкий разброс (не летят вверх), долгая жизнь, крупный сплат под трупом.
  intestines(point) {
    if (!this.enabled) return;
    for (let n = 0; n < 5; n++) {
      const g = this._gibs[this._gibIdx];
      this._gibIdx = (this._gibIdx + 1) % GIBS;
      g.mesh.geometry = this._gibGeos[3];
      g.mesh.material = this._gibMats[3];
      g.r = 0.12;
      g.mesh.position.set(
        point.x + (Math.random() - 0.5) * 0.3,
        point.y + (Math.random() - 0.5) * 0.25,
        point.z + (Math.random() - 0.5) * 0.3,
      );
      g.vel.set(
        (Math.random() - 0.5) * 2.6,
        0.6 + Math.random() * 1.6,
        (Math.random() - 0.5) * 2.6,
      );
      g.rot.set(Math.random() * 10 - 5, Math.random() * 10 - 5, Math.random() * 10 - 5);
      g.bounced = false;
      g.life = 7 + Math.random() * 2;
      g.mesh.scale.setScalar(1);
      g.mesh.visible = true;
    }
    this.splat(point.x, point.z, 2.8);
  }

  // Кровавый бурст в точке. head — больше и выше; kill — фонтан.
  burst(point, dir = null, { head = false, kill = false } = {}) {
    if (!this.enabled) return;
    const b = this._bursts[this._burstIdx];
    this._burstIdx = (this._burstIdx + 1) % BURSTS;
    const arr = b.pts.geometry.attributes.position.array;
    const power = kill ? 5.2 : head ? 4.2 : 2.6;
    const up = kill ? 4.6 : head ? 3.2 : 1.6;
    for (let i = 0; i < PER_BURST; i++) {
      arr[i * 3] = point.x; arr[i * 3 + 1] = point.y; arr[i * 3 + 2] = point.z;
      const a = Math.random() * Math.PI * 2;
      const spread = kill ? 1.0 : 0.55;
      b.vel[i * 3] = Math.cos(a) * power * Math.random() * spread + (dir ? dir.x * power * 0.5 : 0);
      b.vel[i * 3 + 1] = Math.random() * up + 0.4;
      b.vel[i * 3 + 2] = Math.sin(a) * power * Math.random() * spread + (dir ? dir.z * power * 0.5 : 0);
    }
    b.pts.geometry.attributes.position.needsUpdate = true;
    b.pts.material.size = kill ? 0.15 : head ? 0.13 : 0.10;
    b.pts.material.opacity = 0.95;
    b.pts.visible = true;
    b.life = kill ? 1.1 : 0.7;

    // Сплат на полу под попаданием (на хедшот/убийство — крупнее)
    if (head || kill || Math.random() < 0.4) {
      this.splat(point.x, point.z, kill ? 2.6 : head ? 1.8 : 1.1);
    }
  }

  // Клякса на полу (x, z), scale ~1..3
  splat(x, z, scale = 1.4) {
    if (!this.enabled) return;
    const s = this._splats[this._splatIdx];
    this._splatIdx = (this._splatIdx + 1) % SPLATS;
    s.mesh.visible = true;
    s.mesh.position.set(x + (Math.random() - 0.5) * 0.4, 0.025 + this._splatIdx * 0.0004, z + (Math.random() - 0.5) * 0.4);
    s.mesh.rotation.z = Math.random() * Math.PI * 2;
    const sc = scale * (0.8 + Math.random() * 0.5);
    s.mesh.scale.set(sc, sc, 1);
    s.mesh.material.opacity = 0.9;
    s.max = 18 + Math.random() * 10; // живёт ~20-30 секунд
    s.life = s.max;
  }

  update(dt) {
    this._t += dt;
    for (const b of this._bursts) {
      if (b.life <= 0) continue;
      b.life -= dt;
      const arr = b.pts.geometry.attributes.position.array;
      for (let i = 0; i < PER_BURST; i++) {
        b.vel[i * 3 + 1] -= 16 * dt; // гравитация капель
        arr[i * 3] += b.vel[i * 3] * dt;
        arr[i * 3 + 1] += b.vel[i * 3 + 1] * dt;
        arr[i * 3 + 2] += b.vel[i * 3 + 2] * dt;
        if (arr[i * 3 + 1] < 0.02) { arr[i * 3 + 1] = 0.02; b.vel[i * 3 + 1] = 0; b.vel[i * 3] *= 0.9; b.vel[i * 3 + 2] *= 0.9; }
      }
      b.pts.geometry.attributes.position.needsUpdate = true;
      b.pts.material.opacity = Math.max(0, Math.min(0.95, b.life * 1.6));
      if (b.life <= 0) b.pts.visible = false;
    }
    for (const s of this._splats) {
      if (s.life <= 0) continue;
      s.life -= dt;
      if (s.life < 4) s.mesh.material.opacity = Math.max(0, (s.life / 4) * 0.9);
      if (s.life <= 0) s.mesh.visible = false;
    }
    // Искры: быстрые, с гравитацией и затуханием
    for (const s of this._sparks) {
      if (s.life <= 0) continue;
      s.life -= dt;
      const arr = s.pts.geometry.attributes.position.array;
      for (let i = 0; i < PER_SPARK; i++) {
        s.vel[i * 3 + 1] -= 9 * dt;
        arr[i * 3] += s.vel[i * 3] * dt;
        arr[i * 3 + 1] += s.vel[i * 3 + 1] * dt;
        arr[i * 3 + 2] += s.vel[i * 3 + 2] * dt;
      }
      s.pts.geometry.attributes.position.needsUpdate = true;
      s.pts.material.opacity = Math.max(0, s.life / 0.38);
      if (s.life <= 0) s.pts.visible = false;
    }
    // Виспы: подъём + вихревое покачивание, растворение
    for (const w of this._wisps) {
      if (w.life <= 0) continue;
      w.life -= dt;
      const arr = w.pts.geometry.attributes.position.array;
      for (let i = 0; i < PER_WISP; i++) {
        const sw = Math.sin(this._t * 5 + w.seed + i * 1.7) * 0.5 * dt;
        arr[i * 3] += (w.vel[i * 3] + sw * 2) * dt;
        arr[i * 3 + 1] += w.vel[i * 3 + 1] * dt;
        arr[i * 3 + 2] += (w.vel[i * 3 + 2] + Math.cos(this._t * 4.4 + w.seed + i) * 0.5 * dt * 2) * dt;
      }
      w.pts.geometry.attributes.position.needsUpdate = true;
      w.pts.material.opacity = Math.max(0, Math.min(0.9, w.life * 0.8));
      if (w.life <= 0) w.pts.visible = false;
    }
    // Гибсы: баллистика, один отскок со сплатом, затухание масштабом
    for (const g of this._gibs) {
      if (g.life <= 0) continue;
      g.life -= dt;
      g.vel.y -= 18 * dt;
      g.mesh.position.addScaledVector(g.vel, dt);
      g.mesh.rotation.x += g.rot.x * dt;
      g.mesh.rotation.y += g.rot.y * dt;
      g.mesh.rotation.z += g.rot.z * dt;
      if (g.mesh.position.y < g.r) {
        g.mesh.position.y = g.r;
        if (!g.bounced) {
          g.bounced = true;
          this.splat(g.mesh.position.x, g.mesh.position.z, 0.9 + Math.random() * 0.7);
          g.vel.y *= -0.35;
          g.vel.x *= 0.55; g.vel.z *= 0.55;
          g.rot.multiplyScalar(0.5);
        } else {
          g.vel.set(0, 0, 0);
          g.rot.multiplyScalar(0.85);
        }
      }
      if (g.life < 1.2) g.mesh.scale.setScalar(Math.max(0.01, g.life / 1.2));
      if (g.life <= 0) g.mesh.visible = false;
    }
  }

  // Сброс пула (пересборка арены / новый матч)
  reset() {
    for (const b of this._bursts) { b.life = 0; b.pts.visible = false; }
    for (const s of this._splats) { s.life = 0; s.mesh.visible = false; }
    for (const s of this._sparks) { s.life = 0; s.pts.visible = false; }
    for (const w of this._wisps) { w.life = 0; w.pts.visible = false; }
    for (const g of this._gibs) { g.life = 0; g.mesh.visible = false; }
  }
}
