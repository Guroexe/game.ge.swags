// ============================================================
// skinpreview.js — 3D-превью выбора скина (скелетные GLB-девушки)
// Оверлей с тремя анимированными моделями; клик по модели = выбор.
// ============================================================
import * as THREE from 'three';
import { preloadChars, instantiateGirl, CHAR_IDS, CHAR_INFO } from '../engine/charlib.js';

const CSS = `
#skin-preview{position:fixed;inset:0;z-index:90;display:none;flex-direction:column;
  background:radial-gradient(ellipse at 50% 30%,#181422 0%,#07060c 70%);
  font-family:'Russo One','Oswald',sans-serif;color:#e8e4da}
#skin-preview.open{display:flex}
#skin-preview .sp-head{display:flex;justify-content:space-between;align-items:center;
  padding:14px 18px;border-bottom:1px solid #2a2438}
#skin-preview .sp-title{font-size:clamp(15px,2.4vw,22px);letter-spacing:.14em}
#skin-preview .sp-title .jp{color:#ff2a6a;margin-left:10px}
#skin-preview .sp-close{background:#1a1626;border:1px solid #ff2a6a;color:#ff2a6a;
  padding:8px 16px;font:inherit;font-size:13px;letter-spacing:.1em;cursor:pointer;border-radius:4px}
#skin-preview .sp-stage{flex:1;position:relative;min-height:0}
#skin-preview canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
#skin-preview .sp-names{position:absolute;left:0;right:0;bottom:10px;display:flex;pointer-events:none}
#skin-preview .sp-name{flex:1;text-align:center;font-size:clamp(12px,2vw,17px);letter-spacing:.1em;
  color:#8d87a0;transition:color .2s}
#skin-preview .sp-name .jp{display:block;font-size:1.5em;margin-bottom:2px}
#skin-preview .sp-name .d{display:block;font-size:.68em;color:#5d5870;letter-spacing:.05em;margin-top:3px}
#skin-preview .sp-name.sel{color:#ff2a6a;text-shadow:0 0 14px #ff2a6a88}
#skin-preview .sp-hint{position:absolute;top:10px;left:0;right:0;text-align:center;
  font-size:12px;color:#5d5870;letter-spacing:.18em}
#skin-preview .sp-load{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
  color:#8d87a0;letter-spacing:.2em;font-size:13px}
`;

export class SkinPreview {
  constructor(game) {
    this.game = game;
    this.open = false;
    this._built = false;
    this._raf = 0;
    this._girls = [];
    this._rings = [];
    this._sel = 0;
  }

  _build() {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    const el = document.createElement('div');
    el.id = 'skin-preview';
    el.innerHTML =
      `<div class="sp-head"><div class="sp-title">ВЫБОР СКИНА КОМАНДЫ<span class="jp">選択</span></div>` +
      `<button class="sp-close">ДАЛЕЕ: ТРЕК ▶</button></div>` +
      `<div class="sp-stage"><canvas></canvas>` +
      `<div class="sp-hint">НАЖМИ НА МОДЕЛЬ, ЧТОБЫ ВЫБРАТЬ</div>` +
      `<div class="sp-load">ЗАГРУЗКА МОДЕЛЕЙ…</div>` +
      `<div class="sp-names">${CHAR_IDS.map((id) =>
        `<div class="sp-name" data-id="${id}"><span class="jp">${CHAR_INFO[id].jp}</span>${CHAR_INFO[id].name}<span class="d">${CHAR_INFO[id].desc}</span></div>`).join('')}</div>` +
      `</div>`;
    document.body.appendChild(el);
    el.querySelector('.sp-close').addEventListener('click', () => { this.game.sfx?.ui?.(); this.hide(); });

    const canvas = el.querySelector('canvas');
    const stage = el.querySelector('.sp-stage');
    this._renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this._renderer.outputColorSpace = THREE.SRGBColorSpace;
    this._scene = new THREE.Scene();
    this._scene.add(new THREE.AmbientLight(0x9a90c0, 1.1));
    const key = new THREE.DirectionalLight(0xffffff, 2.0); key.position.set(2, 4, 3); this._scene.add(key);
    const rim = new THREE.DirectionalLight(0xff2a6a, 1.6); rim.position.set(-3, 2, -2); this._scene.add(rim);
    const fill = new THREE.PointLight(0x3a6aff, 12, 20); fill.position.set(0, 0.4, 2.5); this._scene.add(fill);
    // пол — тёмная плита с неоновой окантовкой
    const floor = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.4, 0.06, 48),
      new THREE.MeshStandardMaterial({ color: 0x0d0b14, roughness: 0.4, metalness: 0.6 }));
    floor.position.y = -0.03; this._scene.add(floor);
    const edge = new THREE.Mesh(new THREE.TorusGeometry(3.4, 0.015, 8, 64),
      new THREE.MeshBasicMaterial({ color: 0xff2a6a }));
    edge.rotation.x = Math.PI / 2; edge.position.y = 0.005; this._scene.add(edge);
    if (new URLSearchParams(location.search).get('debug') === '1') {
      this._scene.add(new THREE.GridHelper(10, 20, 0xff0000, 0x334));
    }
    this._camera = new THREE.PerspectiveCamera(38, 1, 0.1, 50);
    this._camera.position.set(0, 1.35, 4.6);
    this._camera.lookAt(0, 0.95, 0);

    canvas.addEventListener('pointerdown', (e) => {
      const r = canvas.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width;
      const i = Math.max(0, Math.min(2, Math.floor(x * 3)));
      this._select(i);
    });
    this._el = el;
    this._stage = stage;
    this._built = true;
  }

  async show(onClose = null) {
    this._onClose = onClose;
    if (!this._built) this._build();
    this.open = true;
    this._el.classList.add('open');
    this._resize();
    this._onResize = () => this._resize();
    window.addEventListener('resize', this._onResize);
    const menu = this.game.menu;
    const cur = menu?.settings?.skin || 'c1';
    this._sel = Math.max(0, CHAR_IDS.indexOf(cur));
    this._syncSel();

    await preloadChars();
    this._el.querySelector('.sp-load')?.remove();
    if (!this._girls.length) {
      CHAR_IDS.forEach((id, i) => {
        const g = instantiateGirl(id, { team: i });
        if (!g) return;
        g.root.position.set((i - 1) * 1.5, 0, 0);
        this._scene.add(g.root);
        this._girls.push(g);
        // кольцо выбора
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.02, 8, 40),
          new THREE.MeshBasicMaterial({ color: 0xff2a6a, transparent: true, opacity: 0 }));
        ring.rotation.x = Math.PI / 2;
        ring.position.set((i - 1) * 1.5, 0.02, 0);
        this._scene.add(ring);
        this._rings.push(ring);
      });
      this._syncSel();
    }
    const clock = new THREE.Clock();
    const loop = () => {
      if (!this.open) return;
      const dt = Math.min(clock.getDelta(), 0.05);
      const t = clock.elapsedTime;
      this._girls.forEach((g, i) => {
        g.root.rotation.y = Math.sin(t * 0.4 + i * 2) * 0.55; // медленный поворот «витрина»
        g.update(dt, 0);
      });
      this._rings.forEach((r, i) => { if (i === this._sel) r.material.opacity = 0.7 + Math.sin(t * 5) * 0.3; });
      this._renderer.render(this._scene, this._camera);
      this._raf = requestAnimationFrame(loop);
    };
    loop();
  }

  hide() {
    this.open = false;
    cancelAnimationFrame(this._raf);
    window.removeEventListener('resize', this._onResize);
    this._el?.classList.remove('open');
    this.game.menu?._syncPickGrids?.();
    const cb = this._onClose; this._onClose = null;
    cb?.(); // цепочка старта: после скинов — выбор трека
  }

  _select(i) {
    this._sel = i;
    const id = CHAR_IDS[i];
    const menu = this.game.menu;
    if (menu) {
      menu.settings.skin = id;
      menu.save(); menu.apply();
    }
    this.game.sfx?.ui?.();
    this._syncSel();
  }

  _syncSel() {
    this._el?.querySelectorAll('.sp-name').forEach((n, i) => n.classList.toggle('sel', i === this._sel));
    this._rings?.forEach((r, i) => { if (i !== this._sel) r.material.opacity = 0; });
  }

  _resize() {
    if (!this._stage) return;
    const w = this._stage.clientWidth || innerWidth;
    const h = this._stage.clientHeight || innerHeight;
    this._renderer.setSize(w, h, false);
    this._renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this._camera.aspect = w / h;
    this._camera.updateProjectionMatrix();
  }
}
