// ===== GEN.SWAGS HUD =====
// Полный HUD по DESIGN.md: готическая HP-рамка, патроны, скилы Q/E/F/G,
// счёт 3 команд + таймер, радар, CASH, тиммейты, NOW PLAYING + эквалайзер,
// FLOW-метр, уведомления, kill feed, пульс в бит.
import * as THREE from 'three';
import { TEAMS } from './bots.js';
import { CashState } from './mode_cashout.js';
import { TRACK_NAMES } from './menu.js';

const $ = (id) => document.getElementById(id);

export class HUD {
  constructor(game) {
    this.game = game;
    this._beat = 0;
    this._mateRows = [];
    this._segs = [];
    this._built = false;
  }

  build() {
    // HP-сегменты
    const segs = $('hp-segs');
    if (segs && !segs.children.length) {
      for (let i = 0; i < 10; i++) {
        const s = document.createElement('div');
        s.className = 'seg';
        segs.appendChild(s);
      }
    }
    this._segs = [...(segs?.children || [])];
    this._radar = $('radar');
    this._radarCtx = this._radar?.getContext('2d');
    this._eq = $('np-eq');
    this._eqCtx = this._eq?.getContext('2d');
    this._buildSoundWar();
    this._buildGroove();
    this._built = true;
  }

  // ---------- GROOVE: дуга вокруг прицела + число + aura-пульс ----------
  // DOM из JS (инлайн-стили, css/main.css не трогаем). Шкала 0..100:
  // дуга-прогресс, цвет красный→жёлтый→белый→малиновый glow (>85).
  _buildGroove() {
    const ch = $('crosshair');
    if (!ch || this._grooveSvg) return;
    const R = 42; // радиус дуги (px) — снаружи rhythm-ring (r≤31)
    const C = 2 * Math.PI * R;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.id = 'groove-svg';
    svg.setAttribute('width', '110');
    svg.setAttribute('height', '110');
    svg.setAttribute('viewBox', '0 0 110 110');
    svg.style.cssText = 'position:absolute;left:-55px;top:-55px;pointer-events:none;opacity:.95';
    const mk = (id, stroke, width, dash) => {
      const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      if (id) c.id = id;
      c.setAttribute('cx', '55'); c.setAttribute('cy', '55'); c.setAttribute('r', String(R));
      c.setAttribute('fill', 'none');
      c.setAttribute('stroke', stroke);
      c.setAttribute('stroke-width', String(width));
      if (dash) {
        c.setAttribute('stroke-linecap', 'round');
        c.setAttribute('stroke-dasharray', C.toFixed(2));
        c.setAttribute('stroke-dashoffset', C.toFixed(2));
        c.setAttribute('transform', 'rotate(-90 55 55)');
      }
      svg.appendChild(c);
      return c;
    };
    mk(null, 'rgba(255,255,255,0.10)', 4, false);      // подложка
    this._grooveArc = mk('groove-arc', '#ffc832', 4, true); // прогресс
    ch.appendChild(svg);
    this._grooveSvg = svg;
    this._grooveCirc = C;
    // Число в центре прицела (при изменении >5)
    const num = document.createElement('span');
    num.id = 'groove-num';
    num.style.cssText = 'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);font-family:var(--font-mono);font-size:11px;letter-spacing:1px;color:#fff;opacity:0;pointer-events:none;text-shadow:0 0 6px rgba(255,45,85,.9);transition:opacity .25s';
    ch.appendChild(num);
    this._grooveNum = num;
    this._grooveShown = null;
    this._grooveNumT = 0;
  }

  // Цвет дуги: красный → жёлтый (0..50) → белый (..85) → малиновый (>85)
  _grooveColor(v) {
    const lerp = (a, b, t) => a.map((x, i) => Math.round(x + (b[i] - x) * t));
    const R = [255, 48, 64], Y = [255, 200, 50], W = [255, 255, 255], M = [255, 45, 85];
    const c = v < 0.5 ? lerp(R, Y, v / 0.5)
      : v < 0.85 ? lerp(Y, W, (v - 0.5) / 0.35)
        : lerp(W, M, (v - 0.85) / 0.15);
    return `rgb(${c.join(',')})`;
  }

  _drawGroove(dt, groove) {
    if (!this._grooveSvg) return;
    const v = Math.max(0, Math.min(1, groove.g));
    const pct = Math.round(v * 100);
    // Дуга-прогресс
    this._grooveArc.setAttribute('stroke-dashoffset', (this._grooveCirc * (1 - v)).toFixed(2));
    this._grooveArc.setAttribute('stroke', this._grooveColor(v));
    // Aura-пульс в бит при GROOVE > 85: дуга светится, прицел и HUD дышат
    const hot = pct > 85;
    if (hot) {
      const b = this._beat; // 0..1.4, затухает между битами
      this._grooveSvg.style.filter = `drop-shadow(0 0 ${(5 + b * 7).toFixed(1)}px rgba(255,45,85,${(0.65 + b * 0.3).toFixed(2)}))`;
      const ch = $('crosshair');
      if (ch) ch.style.filter = `drop-shadow(0 0 ${(3 + b * 5).toFixed(1)}px rgba(255,45,85,.8))`;
      const hud = $('hud');
      if (hud) hud.style.filter = `brightness(${(1 + b * 0.1).toFixed(3)}) saturate(${(1 + b * 0.18).toFixed(3)})`;
    } else {
      this._grooveSvg.style.filter = pct >= 60 ? 'drop-shadow(0 0 4px rgba(255,255,255,.35))' : '';
      const ch = $('crosshair');
      if (ch) ch.style.filter = '';
      const hud = $('hud');
      if (hud && hud.style.filter) hud.style.filter = '';
    }
    // Число в центре: показываем при изменении >5, затем плавно гаснет
    if (this._grooveShown === null || Math.abs(pct - this._grooveShown) > 5) {
      this._grooveShown = pct;
      this._grooveNum.textContent = String(pct);
      this._grooveNum.style.color = this._grooveColor(v);
      this._grooveNumT = 1.4; // секунды видимости
    }
    if (this._grooveNumT > 0) {
      this._grooveNumT -= dt;
      this._grooveNum.style.opacity = String(Math.max(0, Math.min(1, this._grooveNumT / 0.6)));
    } else {
      this._grooveNum.style.opacity = '0';
    }
  }

  // ---------- SOUND WAR: ENEMY SIGNAL + полоса доминирования + клэш + баннер перехода ----------
  // DOM создаётся из JS (инлайн-стили) — css/main.css не трогаем.
  _buildSoundWar() {
    const tr = $('hud-tr');
    if (tr && !this._esWrap) {
      // Красная вставка «⚠ ENEMY SIGNAL» + мини-эквалайзер врага
      const es = document.createElement('div');
      es.id = 'enemy-signal';
      es.style.cssText = 'display:none;margin-top:8px;padding:5px 7px;border:1px solid rgba(255,48,64,.7);background:rgba(40,4,12,.55)';
      const lab = document.createElement('div');
      lab.id = 'es-label';
      lab.style.cssText = 'font-size:10px;letter-spacing:1px;color:#ff3040;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:150px';
      lab.textContent = '⚠ ENEMY SIGNAL';
      const eq = document.createElement('canvas');
      eq.id = 'es-eq';
      eq.width = 132; eq.height = 14;
      eq.style.cssText = 'display:block;margin-top:3px';
      es.append(lab, eq);
      tr.appendChild(es);
      this._esWrap = es;
      this._esLabel = lab;
      this._esEq = eq;
      this._esEqCtx = eq.getContext('2d');

      // Индикатор доминирования: YOUR SOUND ↔ ENEMY SOUND
      const dom = document.createElement('div');
      dom.id = 'soundwar-dom';
      dom.style.cssText = 'margin-top:6px;font-size:8px;letter-spacing:1px;opacity:.95';
      dom.innerHTML = '<div style="display:flex;justify-content:space-between;color:#41ff9a"><span>YOUR SOUND</span><span style="color:#ff3040">ENEMY SOUND</span></div>';
      const bar = document.createElement('div');
      bar.style.cssText = 'position:relative;height:6px;margin-top:2px;background:rgba(255,48,64,.25);border:1px solid rgba(120,120,140,.4)';
      const fill = document.createElement('div');
      fill.id = 'sw-dom-fill';
      fill.style.cssText = 'position:absolute;left:0;top:0;bottom:0;width:50%;background:linear-gradient(90deg,#41ff9a,#a05cff);transition:width .18s';
      bar.appendChild(fill);
      dom.appendChild(bar);
      tr.appendChild(dom);
      this._domFill = fill;
    }
    const hud = $('hud');
    if (hud && !this._clashTag) {
      // Тег SOUND CLASH под счётом
      const ct = document.createElement('div');
      ct.id = 'clash-tag';
      ct.textContent = '⚡ SOUND CLASH — УРОН +10% ⚡';
      ct.style.cssText = 'display:none;position:absolute;top:86px;left:50%;transform:translateX(-50%);padding:4px 18px;font-size:13px;letter-spacing:3px;font-weight:700;color:#0a0610;background:linear-gradient(90deg,#ff2d55,#a05cff);box-shadow:0 0 22px rgba(255,45,85,.8)';
      hud.appendChild(ct);
      this._clashTag = ct;
      // Баннер перехода между мирами (▲ ВОЗВЫШЕНИЕ / ▼ ПАДЕНИЕ)
      const wb = document.createElement('div');
      wb.id = 'warp-banner';
      wb.style.cssText = 'display:none;position:absolute;top:34%;left:50%;transform:translate(-50%,-50%);font-size:26px;letter-spacing:6px;font-weight:700;color:#e8e8f0;text-shadow:0 0 24px rgba(255,45,85,.9);white-space:nowrap';
      hud.appendChild(wb);
      this._warpBanner = wb;
    }
  }

  // Пульс в бит
  beat(strength = 1) { this._beat = Math.min(1.4, strength); }

  notify(text, cls = 'obj') {
    const box = $('notify');
    if (!box) return;
    const div = document.createElement('div');
    div.className = `ntf ${cls}`;
    div.textContent = text;
    box.prepend(div);
    while (box.children.length > 4) box.lastChild.remove();
    setTimeout(() => { div.classList.add('out'); }, 2600);
    setTimeout(() => div.remove(), 3100);
  }

  killFeed(text) {
    const feed = $('kill-feed');
    if (!feed) return;
    const div = document.createElement('div');
    div.textContent = text;
    feed.prepend(div);
    while (feed.children.length > 5) feed.lastChild.remove();
    setTimeout(() => div.remove(), 4000);
  }

  // Попап цепочки убийств: 二連殺 ×2 … 無双殺 ×5+ (золотой mega)
  chainPopup(count) {
    const el = $('chain-popup');
    if (!el) return;
    const NAMES = {
      2: ['二連殺', 'ДВОЙНОЕ УБИЙСТВО'],
      3: ['三連殺', 'ТРОЙНОЕ УБИЙСТВО'],
      4: ['四連殺', 'ЧЕТВЕРНОЕ УБИЙСТВО'],
    };
    const [jp, ru] = NAMES[count] || ['無双殺', `МЯСОРУБКА ×${count}`];
    $('chain-jp').textContent = jp;
    $('chain-text').textContent = ru;
    el.classList.toggle('mega', count >= 5);
    el.classList.remove('on');
    void el.offsetWidth; // перезапуск transition
    el.classList.add('on');
    clearTimeout(this._chainT);
    this._chainT = setTimeout(() => el.classList.remove('on'), 1400);
  }

  dropFlash(on) {
    $('drop-flash')?.classList.toggle('on', on);
    if (on) this.notify('⚡ DROP! ×2 УРОН ⚡', 'drop');
  }

  // Лента чата в матче (левый низ)
  addChatMsg(msg) {
    const box = $('chat-feed');
    if (!box) return;
    const div = document.createElement('div');
    div.className = 'cm' + (msg.team ? ' team' : '');
    const me = msg.from === this.game.net?.playerId;
    div.innerHTML = `<span class="cn${me ? ' me' : ''}">${msg.team ? '[T] ' : ''}${msg.name}:</span> `;
    div.appendChild(document.createTextNode(msg.text));
    box.appendChild(div);
    while (box.children.length > 7) box.firstChild.remove();
    setTimeout(() => div.classList.add('out'), 6000);
    setTimeout(() => div.remove(), 6700);
  }

  // Список тиммейтов (пересоздаём при изменении состава)
  _syncMates() {
    const g = this.game;
    const box = $('mates');
    if (!box) return;
    let key;
    let remoteMates = null;
    if (g.mpActive) {
      // MP: удалённые сокомандники из net.remote
      remoteMates = [...g.net.remote.values()].filter((e) => e.team === g.mode?.playerTeam);
      key = 'mp|' + remoteMates.map((m) => `${m.id}:${m.name}`).join('|');
    } else {
      const mates = (g.botsManager?.bots || []).filter((b) => b.team === g.mode?.playerTeam);
      key = mates.map((m) => m.name).join('|');
      remoteMates = mates;
    }
    if (key === this._matesKey) return;
    this._matesKey = key;
    box.innerHTML = '';
    this._mateRows = [];
    // Игрок
    const mkRow = (name, isYou, id = null) => {
      const row = document.createElement('div');
      row.className = 'mate';
      row.innerHTML = `<span class="mate-skull">☠</span><span class="mate-name">${name}</span><span class="spk">🔊</span><div class="mate-hp"><div></div></div>`;
      box.appendChild(row);
      this._mateRows.push({ row, bar: row.querySelector('.mate-hp > div'), isYou, name, id });
    };
    mkRow('ВЫ', true, g.net?.playerId);
    for (const m of remoteMates) mkRow(m.name, false, g.mpActive ? m.id : null);
  }

  update(dt) {
    if (!this._built) this.build();
    const g = this.game;
    const player = g.player;
    const weapons = g.weapons;
    const mode = g.mode;
    const flow = g.flow;
    const music = g.music;

    // --- Бит-пульс ---
    this._beat = Math.max(0, this._beat - dt * 3.2);
    $('hud')?.style.setProperty('--beatp', this._beat.toFixed(3));

    // --- HP ---
    if (player) {
      const hpFrac = Math.max(0, player.hp / player.maxHp);
      const num = $('hp-num');
      if (num) num.textContent = Math.ceil(player.hp);
      const lit = Math.round(hpFrac * this._segs.length);
      for (let i = 0; i < this._segs.length; i++) {
        this._segs[i].classList.toggle('on', i < lit);
        this._segs[i].classList.toggle('low', hpFrac < 0.3);
      }
      $('hud-bl')?.classList.toggle('critical', hpFrac < 0.3);
    }

    // --- Патроны / гранаты ---
    if (weapons) {
      const w = weapons.weapon;
      const magEl = $('ammo-mag');
      const resEl = $('ammo-reserve');
      if (magEl) magEl.textContent = weapons.reloading ? '---' : String(w.ammo).padStart(3, '0');
      if (resEl) resEl.textContent = '∞'; // бесконечный резерв
      const nameEl = $('weapon-name');
      if (nameEl) nameEl.textContent = w.def.name;
      const nc = $('nade-count');
      if (nc) nc.textContent = `×${weapons.grenades}`;
      $('wi-rifle')?.classList.toggle('hidden', w.kind === 'shotgun');
      $('wi-shotgun')?.classList.toggle('hidden', w.kind === 'shotgun' ? false : true);
    }

    // --- Скилы ---
    if (player) {
      this._skill('skill-q', player.dashCd / 2.2);
      this._skill('skill-e', player.shockCd / 12);
      this._skill('skill-f', player.grapple.cd / 10);
      const gCd = $('skill-g');
      if (gCd && weapons) {
        gCd.querySelector('.sk-count').textContent = weapons.grenades;
        gCd.classList.toggle('empty', weapons.grenades <= 0);
      }
    }

    // --- Счёт / таймер ---
    if (mode) {
      const sv = mode.scores;
      this._text('score-val-a', sv[0]);
      this._text('score-val-b', sv[1]);
      this._text('score-val-c', sv[2]);
      const t = Math.max(0, mode.timeLeft);
      const mm = Math.floor(t / 60);
      const ss = Math.floor(t % 60);
      this._text('match-timer', `${mm}:${String(ss).padStart(2, '0')}`);
      // Статус объективов
      this._objectiveStatus(mode);
      // Маркеры зон A/B/C в мире (ромбы, проекция из 3D — как в референсе)
      this._zoneMarkers(mode);
      // CASH
      this._text('cash-val', sv[mode.playerTeam]);
    }

    // --- Тиммейты ---
    this._syncMates();
    this._updateMates();

    // --- Радар ---
    this._drawRadar();

    // --- NOW PLAYING / эквалайзер ---
    this._drawMusic(music);

    // --- SOUND WAR ---
    this._drawSoundWar(dt);

    // --- FLOW ---
    if (flow) {
      const fill = $('flow-fill');
      if (fill) fill.style.height = `${flow.flowNorm * 100}%`;
      this._text('flow-num', Math.round(flow.value));
      $('flow-wrap')?.classList.toggle('drop', flow.dropActive);
    }

    // --- Ритм-прицел: кольцо сжимается к биту, комбо-стрик, ZE FLOW ---
    const r = g.rhythm;
    if (r) {
      const ring = $('rhythm-ring');
      if (ring) {
        const phase = r.beatPhase(); // 0 — сам бит
        ring.style.setProperty('--rr', (0.55 + phase * 0.85).toFixed(3));
      }
      const combo = $('rhythm-combo');
      if (combo) {
        if (r.zeFlow) { combo.textContent = 'ZE FLOW'; combo.className = 'on ze'; }
        else if (r.streak >= 2) {
          // Комбо-тир с активными баффами от музыки
          const buffs = [];
          if (r.tierDmgMul > 1) buffs.push('УРОН↑');
          if (r.tierSpeedMul > 1) buffs.push('СКОР↑');
          if (r.hpRegen > 0) buffs.push('♥+');
          combo.textContent = `×${r.streak} ${r.comboName}${buffs.length ? ' ' + buffs.join(' ') : ''}`;
          combo.className = 'on';
        }
        else combo.className = '';
      }
      $('hud')?.classList.toggle('zeflow', r.zeFlow);
      // GROOVE: дуга силы вокруг прицела + число + aura-пульс
      if (r.groove) this._drawGroove(dt, r.groove);
    }

    // --- Физика интерфейса (инерция от движения/камеры) ---
    this._phys(dt, player);
  }

  // ---------- Физика HUD: блоки «отстают» от камеры и движения ----------
  // Пишет CSS-переменные --phx/--phy/--phr/--phk на #hud; блоки HUD
  // потребляют их в transform (css/main.css, класс .pulse и медиа-правила).
  _phys(dt, player) {
    const hud = $('hud');
    if (!hud) return;
    if (!this._ph) {
      this._ph = { x: 0, y: 0, r: 0, k: 0, lastYaw: null };
    }
    const p = this._ph;
    let tx = 0, ty = 0, tr = 0, tk = 0;
    if (player && player.hp > 0) {
      const yaw = player.look.yaw;
      if (p.lastYaw === null) p.lastYaw = yaw;
      let dyaw = yaw - p.lastYaw;
      if (dyaw > Math.PI) dyaw -= Math.PI * 2;
      if (dyaw < -Math.PI) dyaw += Math.PI * 2;
      p.lastYaw = yaw;
      const yawV = dyaw / Math.max(dt, 1e-4);      // рад/с поворота камеры
      const sp = player.speed || 0;
      tk = Math.max(-3.0, Math.min(3.0, -yawV * 0.55));   // skew против поворота
      tr = Math.max(-1.5, Math.min(1.5, -yawV * 0.30));   // лёгкий крен
      tx = Math.max(-8, Math.min(8, -yawV * 3.4));        // отставание по X
      ty = Math.min(5, sp * 0.30);                        // просадка от бега
      if (player.landImpact > 0.01) ty += player.landImpact * 9; // удар приземления
      if (player.sliding) { tr += 1.8; tk += 2.4; }       // подкат кренит HUD
    } else {
      p.lastYaw = null;
    }
    const k = Math.min(1, dt * 9); // пружина возврата
    p.x += (tx - p.x) * k;
    p.y += (ty - p.y) * k;
    p.r += (tr - p.r) * k;
    p.k += (tk - p.k) * k;
    hud.style.setProperty('--phx', p.x.toFixed(2) + 'px');
    hud.style.setProperty('--phy', p.y.toFixed(2) + 'px');
    hud.style.setProperty('--phr', p.r.toFixed(2) + 'deg');
    hud.style.setProperty('--phk', p.k.toFixed(2) + 'deg');
  }

  // Оценка ритм-действия: вспышка кольца прицела + всплывающий текст
  rhythmJudge(j) {
    if (!j || j === 'miss') return;
    const ring = $('rhythm-ring');
    if (ring) {
      ring.classList.remove('perfect', 'good');
      void ring.offsetWidth; // перезапуск вспышки
      ring.classList.add(j);
      clearTimeout(this._ringT);
      this._ringT = setTimeout(() => ring.classList.remove('perfect', 'good'), 190);
    }
    const el = $('rhythm-judge');
    if (el) {
      // GROOVE: рядом с оценкой — применённый множитель силы этого действия
      // (тип действия берём из groove.lastAction: shoot→урон, dash→дальность…)
      const la = this.game.rhythm?.groove?.lastAction;
      const multTxt = la && la.judge === j ? ` ×${la.mult.toFixed(2)}` : '';
      el.textContent = (j === 'perfect' ? 'PERFECT' : 'GOOD') + multTxt;
      el.className = '';
      void el.offsetWidth; // перезапуск анимации
      el.classList.add('show', j);
    }
  }

  // Мелкий ранг у счёта
  setRank(rank, rating) {
    this._text('hud-rank', `${rank} · ${rating}`);
  }

  _text(id, v) {
    const el = $(id);
    if (el && el.textContent !== String(v)) el.textContent = v;
  }

  _skill(id, frac) {
    const el = $(id);
    if (!el) return;
    const f = Math.max(0, Math.min(1, frac));
    el.querySelector('.sk-cd').style.transform = `scaleY(${f})`;
    el.classList.toggle('ready', f <= 0);
  }

  // Маркеры зон A/B/C: проекция 3D-позиций станций в экранные ромбы.
  // Цвет — по владельцу (team), иначе по букве; за камерой/вне экрана — скрыт.
  _zoneMarkers(mode) {
    const wrap = $('zone-markers');
    if (!wrap) return;
    const stations = mode.stations || [];
    if (!this._zmPool) this._zmPool = [];
    const cam = this.game.engine?.camera;
    if (!cam) { wrap.style.display = 'none'; return; }
    wrap.style.display = '';
    if (!this._zmV) this._zmV = new THREE.Vector3();
    const W = window.innerWidth, H = window.innerHeight;
    for (let i = 0; i < stations.length; i++) {
      const st = stations[i];
      let el = this._zmPool[i];
      if (!el) {
        el = document.createElement('div');
        el.className = 'zm';
        el.innerHTML = '<div class="zm-d"><span></span></div><div class="zm-sub"></div>';
        wrap.appendChild(el);
        this._zmPool[i] = el;
      }
      const v = this._zmV.set(st.pos.x, st.pos.y + 3.2, st.pos.z).project(cam);
      const onScreen = v.z < 1 && v.x > -1.05 && v.x < 1.05 && v.y > -1.05 && v.y < 1.05;
      if (!onScreen) { el.style.display = 'none'; continue; }
      el.style.display = '';
      el.style.left = `${((v.x + 1) / 2 * W).toFixed(0)}px`;
      el.style.top = `${((1 - v.y) / 2 * H).toFixed(0)}px`;
      el.className = `zm ${st.team === 1 ? 'tb' : st.team === 2 ? 'tc' : ''}`;
      el.querySelector('.zm-d span').textContent = st.letter || '?';
      el.querySelector('.zm-sub').textContent = st.busy ? 'ЗАХВАТ' : 'ЗОНА';
    }
    // Лишние маркеры скрываем
    for (let i = stations.length; i < this._zmPool.length; i++) {
      this._zmPool[i].style.display = 'none';
    }
  }

  _objectiveStatus(mode) {
    const wrap = $('obj-status');
    if (!wrap) return;
    const st = mode.state;
    const label = $('obj-status-label');
    const fill = $('obj-status-fill');
    if (st === CashState.CHANNEL) {
      wrap.classList.add('visible');
      const p = 1 - mode.channelT / 6;
      label.textContent = `ЗАГРУЗКА ${Math.ceil(mode.channelT)}С`;
      fill.style.width = `${p * 100}%`;
      fill.style.background = '#ffc832';
    } else if (st === CashState.DEPOSIT) {
      wrap.classList.add('visible');
      const p = 1 - mode.depositT / 20;
      const mine = mode.channelStation?.team === mode.playerTeam;
      label.textContent = mode.stealT > 0.2
        ? 'ПЕРЕХВАТ СТАНЦИИ!'
        : `ДЕПОЗИТ ${Math.ceil(mode.depositT)}С ${mine ? '(ВАШ)' : '(ВРАГ)'}`;
      fill.style.width = `${p * 100}%`;
      fill.style.background = mine ? '#ff2d55' : '#a05cff';
    } else {
      wrap.classList.remove('visible');
    }
  }

  _updateMates() {
    const g = this.game;
    for (const r of this._mateRows) {
      let frac = 1;
      if (r.isYou) frac = g.player ? g.player.hp / g.player.maxHp : 1;
      else if (g.mpActive && r.id) {
        const e = g.net.remote.get(r.id);
        frac = e ? (e.alive ? e.hp / 100 : 0) : 0;
      } else {
        const bot = g.botsManager?.bots.find((b) => b.name === r.name);
        frac = bot ? (bot.alive ? bot.hp / bot.maxHp : 0) : 0;
      }
      r.bar.style.width = `${Math.max(0, frac) * 100}%`;
      r.bar.style.background = frac < 0.3 ? '#ff3040' : 'var(--accent)';
      // Индикатор говорящего (голосовой чат)
      if (g.mpActive && g._speaking) {
        const sid = r.isYou ? 'me' : r.id;
        r.row.classList.toggle('speaking', !!g._speaking.get(sid));
      }
    }
  }

  // ---------- Радар ----------
  _drawRadar() {
    const ctx = this._radarCtx;
    if (!ctx) return;
    const g = this.game;
    const player = g.player;
    if (!player) return;
    const S = this._radar.width;
    const C = S / 2;
    const range = 34;                 // метров на полный радиус
    const scale = (C * 0.76) / range; // рисуем внутри «стекла» PNG-кольца
    const yaw = player.look.yaw;

    ctx.clearRect(0, 0, S, S);
    // Фон — лёгкий тинт, чтобы сквозь него читался PNG-радар
    ctx.save();
    ctx.beginPath();
    ctx.arc(C, C, C * 0.82, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = 'rgba(8,6,12,0.30)';
    ctx.fillRect(0, 0, S, S);
    // Кольца
    ctx.strokeStyle = 'rgba(255,45,85,0.25)';
    ctx.lineWidth = 1;
    for (const r of [0.33, 0.66, 1]) {
      ctx.beginPath();
      ctx.arc(C, C, C * 0.76 * r, 0, Math.PI * 2);
      ctx.stroke();
    }
    // Направление взгляда — «вверх» радара: поворачиваем мир на -yaw
    const px = player.body.pos.x, pz = player.body.pos.z;
    const put = (wx, wz, draw) => {
      const dx = wx - px, dz = wz - pz;
      // Поворот так, чтобы взгляд (forward=-sin,-cos) смотрел вверх
      const rx = dx * Math.cos(-yaw) - dz * Math.sin(-yaw);
      const rz = dx * Math.sin(-yaw) + dz * Math.cos(-yaw);
      const sx = C + rx * scale;
      const sy = C + rz * scale;
      if ((sx - C) ** 2 + (sy - C) ** 2 > (C * 0.78) ** 2) return;
      draw(sx, sy);
    };
    // Станции
    if (g.mode) {
      for (const st of g.mode.stations) {
        put(st.pos.x, st.pos.z, (x, y) => {
          ctx.fillStyle = st.busy ? '#ffc832' : 'rgba(160,92,255,0.9)';
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(Math.PI / 4);
          ctx.fillRect(-3.5, -3.5, 7, 7);
          ctx.restore();
        });
      }
      // Кешбокс
      const bp = g.mode.boxPos;
      put(bp.x, bp.z, (x, y) => {
        ctx.fillStyle = '#ffc832';
        ctx.fillRect(x - 3, y - 3, 6, 6);
        ctx.strokeStyle = '#fff';
        ctx.strokeRect(x - 3.5, y - 3.5, 7, 7);
      });
    }
    // Боты (соло) или удалённые игроки (MP)
    if (g.mpActive) {
      for (const s of g.remotePlayers?.sampled || []) {
        if (!s.alive) continue;
        put(s.pos[0], s.pos[2], (x, y) => {
          ctx.fillStyle = s.team === g.mode?.playerTeam ? '#41ff9a' : TEAMS[s.team % 3].css;
          ctx.beginPath();
          ctx.arc(x, y, 3, 0, Math.PI * 2);
          ctx.fill();
        });
      }
    } else {
      for (const b of g.botsManager?.bots || []) {
        if (!b.alive) continue;
        put(b.pos.x, b.pos.z, (x, y) => {
          ctx.fillStyle = b.team === g.mode?.playerTeam ? '#41ff9a' : TEAMS[b.team].css;
          ctx.beginPath();
          ctx.arc(x, y, 3, 0, Math.PI * 2);
          ctx.fill();
        });
      }
    }
    // Игрок — центр
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(C, C - 6);
    ctx.lineTo(C - 4, C + 5);
    ctx.lineTo(C + 4, C + 5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    // Внешнее кольцо рисует PNG-спрайт радара (металлический обод)
  }

  // ---------- SOUND WAR виджеты ----------
  _drawSoundWar(dt) {
    const g = this.game;
    const sw = g.soundWar;
    const st = sw?.state?.();
    // ENEMY SIGNAL: показываем, когда вражеский трек реально слышен
    if (this._esWrap) {
      const show = !!(st && st.enemyTitle && st.enemyNorm > 0.1);
      this._esWrap.style.display = show ? 'block' : 'none';
      if (show) {
        this._esLabel.textContent = `⚠ ENEMY SIGNAL: ${st.enemyTitle}`;
        // Мини-эквалайзер врага: частоты своего анализатора, красная палитра,
        // масштаб = присутствие вражеского потока
        const ctx = this._esEqCtx;
        if (ctx) {
          const W = this._esEq.width, H = this._esEq.height;
          ctx.clearRect(0, 0, W, H);
          const freq = g.music?._freq;
          const bars = 12;
          for (let i = 0; i < bars; i++) {
            let v = 0.15;
            if (freq && g.music.playing) {
              const bin = Math.floor(Math.pow(i / bars, 1.6) * freq.length * 0.6) + 1;
              v = Math.max(0.1, (freq[bin] || 0) / 255);
            }
            const bh = Math.max(1.5, v * H * Math.min(1, 0.3 + st.enemyNorm));
            ctx.fillStyle = i % 2 ? '#ff3040' : '#ff7a4d';
            ctx.fillRect((i / bars) * W + 1, H - bh, W / bars - 2, bh);
          }
        }
      }
    }
    // Полоса доминирования: -1 (враг) .. +1 (ты) → ширина твоей доли
    if (this._domFill && st) {
      const mine = Math.max(0.03, Math.min(0.97, (st.dominance + 1) / 2));
      this._domFill.style.width = `${mine * 100}%`;
      this._domFill.style.background = st.enemyDominant
        ? 'linear-gradient(90deg,#ff3040,#a05cff)'
        : 'linear-gradient(90deg,#41ff9a,#a05cff)';
    }
    // SOUND CLASH тег
    if (this._clashTag) {
      this._clashTag.style.display = st?.clash ? 'block' : 'none';
      if (st?.clash) this._clashTag.textContent = `⚡ SOUND CLASH ${Math.ceil(st.clashT)} — УРОН +10% ⚡`;
    }
    // Баннер перехода между мирами
    if (this._warpBanner) {
      const tr = g.transition;
      const show = !!(tr?.active && tr.banner);
      this._warpBanner.style.display = show ? 'block' : 'none';
      if (show) {
        this._warpBanner.textContent = tr.banner;
        this._warpBanner.style.color = tr.dir > 0 ? '#d8ffe9' : '#ffd4d4';
        // Лёгкая пульсация в бит
        const s = 1 + this._beat * 0.06;
        this._warpBanner.style.transform = `translate(-50%,-50%) scale(${s.toFixed(3)})`;
      }
    }
  }

  // ---------- Музыка ----------
  _drawMusic(music) {
    if (!music) return;
    const t = music.playlist?.[music.trackIndex];
    const name = t ? (TRACK_NAMES[t.name] || t.name) : '—';
    this._text('np-track', name);
    this._text('np-bpm', music.bpm ? `♪ ${music.bpm} BPM` : '');
    const prog = $('np-progress-fill');
    if (prog) prog.style.width = `${(music.trackProgress?.() || 0) * 100}%`;

    const ctx = this._eqCtx;
    if (!ctx) return;
    const W = this._eq.width, H = this._eq.height;
    ctx.clearRect(0, 0, W, H);
    const bars = 16;
    const freq = music._freq;
    for (let i = 0; i < bars; i++) {
      let v = 0;
      if (freq && music.playing) {
        // Лог-распределение бинов
        const bin = Math.floor(Math.pow(i / bars, 1.8) * freq.length * 0.7) + 1;
        v = (freq[bin] || 0) / 255;
      }
      const bh = Math.max(2, v * H);
      const x = (i / bars) * W;
      ctx.fillStyle = i % 2 ? '#ff2d55' : '#a05cff';
      ctx.fillRect(x + 1, H - bh, W / bars - 2, bh);
    }
  }
}
