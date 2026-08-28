// ===== GEN.SWAGS Engine Core =====
// Рендерер, сцена, камера, главный цикл, PS2-стиль постпроцесс 2.0:
// низкое разрешение + nearest-апскейл + Bayer-дизеринг + CA + виньетка (база),
// плюс uniform-driven эффекты: RGB-split, glitch-слайсы, радиальный warp/tunnel,
// психоделический палитровый сдвиг (PSY) и дешёвый datamosh (frame-feedback).
// FX API: engine.fx.set({...}), engine.fx.pulse(s), engine.fx.setPsyBreak(on, k).
// Адаптив качества: авто-детект слабого GPU / просадки FPS → без datamosh,
// ниже pixelScale. Режимы: engine.setFxQuality('auto'|'low'|'high').
import * as THREE from 'three';

const POST_VERT = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const POST_FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform sampler2D tPrev;    // предыдущий кадр (полуразрешение) — datamosh
uniform float uTime;
uniform float uCA;        // сила chromatic aberration
uniform float uVignette;  // сила виньетки
uniform float uDither;    // сила дизеринга
uniform vec2  uResolution;
uniform float uRGBSplit;  // энергетический RGB-split (добавок к CA)
uniform float uGlitch;    // вероятность/амплитуда glitch-слайсов 0..1
uniform float uWarp;      // радиальный туннель (psy-break) 0..1+
uniform float uPsy;       // палитровый сдвиг малина/зелень 0..1
uniform float uDatamosh;  // сила смаза frame-feedback 0..1
uniform float uBeat;      // короткий пульс на бите
uniform float uFisheye;   // barrel-distortion («провал сквозь пол») 0..1+
uniform float uMandala;   // сила калейдоскоп-мандалы (additive слой) 0..1
uniform float uMandalaN;  // симметрия (число сегментов калейдоскопа)
uniform float uMandalaRot;// накопленный угол вращения (скорость по beatPhase)
uniform float uMandalaHue;// базовый тон (дрейф + фаза трека)
uniform float uMandalaZoom;// zoom-пульс на битах
uniform float uMandalaBass;// бас-драйв сканлайн-слоя (0..1)

// Матрица Байера 4x4
float bayer4(vec2 p) {
  int x = int(mod(p.x, 4.0));
  int y = int(mod(p.y, 4.0));
  int i = y * 4 + x;
  // 0 8 2 10 / 12 4 14 6 / 3 11 1 9 / 15 7 13 5
  float m[16];
  m[0]=0.0;  m[1]=8.0;  m[2]=2.0;  m[3]=10.0;
  m[4]=12.0; m[5]=4.0;  m[6]=14.0; m[7]=6.0;
  m[8]=3.0;  m[9]=11.0; m[10]=1.0; m[11]=9.0;
  m[12]=15.0;m[13]=7.0; m[14]=13.0;m[15]=5.0;
  for (int k = 0; k < 16; k++) { if (k == i) return m[k] / 16.0; }
  return 0.0;
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec3 hsl2rgb(vec3 c) {
  vec3 rgb = clamp(abs(mod(c.x * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  return c.z + c.y * (rgb - 0.5) * (1.0 - abs(2.0 * c.z - 1.0));
}

void main() {
  vec2 uv = vUv;
  vec2 centered = uv - 0.5;
  float dist = length(centered);

  // --- Радиальный warp/tunnel: закрутка + пульсирующие кольца от центра ---
  if (uWarp > 0.001) {
    float ang = atan(centered.y, centered.x);
    float r = dist;
    ang += uWarp * 1.05 * (0.62 - r) + sin(uTime * 0.6) * uWarp * 0.1;
    r *= 1.0 - uWarp * 0.3 * sin(r * 14.0 - uTime * 2.8);
    r *= 1.0 - uWarp * 0.1;
    uv = 0.5 + vec2(cos(ang), sin(ang)) * r;
    centered = uv - 0.5;
    dist = length(centered);
  }

  // --- Fisheye: баррель-искажение (переход между мирами) ---
  if (uFisheye > 0.001) {
    float r2 = dot(centered, centered);
    float bulge = 1.0 + uFisheye * (r2 * 1.9 - 0.28);
    uv = 0.5 + centered * bulge;
    centered = uv - 0.5;
    dist = length(centered);
  }

  // --- Glitch-слайсы: горизонтальные полосы-сдвиги ---
  if (uGlitch > 0.001) {
    float band = floor(uv.y * 28.0);
    float t = floor(uTime * 18.0);
    float n = hash12(vec2(band, t));
    float on = step(1.0 - uGlitch * 0.55, n);
    uv.x = fract(uv.x + on * (hash12(vec2(band, t + 7.0)) - 0.5) * 0.22);
    // редкие вертикальные блок-сдвиги (датамош-блоки)
    float bn = hash12(vec2(floor(uv.x * 9.0) + band * 0.13, t + 3.0));
    uv.y = fract(uv.y + step(1.0 - uGlitch * 0.18, bn) * (bn - 0.5) * 0.05);
  }

  // --- RGB-split: краевой хроматизм всегда чуть-чуть + энергия/psy ---
  float split = uRGBSplit + uPsy * 0.02;
  vec2 caOff = centered * dist * uCA + centered * split * (0.35 + dist * 1.7);
  float rr = texture2D(tDiffuse, uv + caOff).r;
  float gg = texture2D(tDiffuse, uv).g;
  float bb = texture2D(tDiffuse, uv - caOff).b;
  vec3 col = vec3(rr, gg, bb);

  // --- Datamosh: blend с предыдущим кадром (яркостный smear) ---
  if (uDatamosh > 0.001) {
    vec2 smear = -centered * 0.05 * uDatamosh;
    smear.x += (hash12(vec2(floor(uv.y * 24.0), floor(uTime * 6.0))) - 0.5) * 0.03 * uDatamosh;
    vec3 prev = texture2D(tPrev, uv + smear).rgb;
    float lp = dot(prev, vec3(0.299, 0.587, 0.114));
    float lc = dot(col, vec3(0.299, 0.587, 0.114));
    float w = uDatamosh * smoothstep(-0.04, 0.3, lp - lc + 0.12);
    col = mix(col, prev, clamp(w, 0.0, 0.93));
  }

  // --- PSY: люма → малиново-зелёная психоделика + постеризация ---
  if (uPsy > 0.001) {
    float lum = dot(col, vec3(0.299, 0.587, 0.114));
    float steps = mix(12.0, 4.0, uPsy);
    lum = floor(lum * steps + 0.5) / steps;
    // таящие/плывущие цвета: люма «течёт» со временем
    lum = fract(lum + uPsy * 0.07 * sin(uTime * 0.8 + lum * 14.0 + vUv.y * 5.0 + vUv.x * 3.0));
    vec3 drk = vec3(0.03, 0.0, 0.05);
    vec3 mag = vec3(0.92, 0.07, 0.42);
    vec3 grn = vec3(0.10, 0.98, 0.34);
    vec3 psyCol = mix(drk, mag, smoothstep(0.06, 0.6, lum));
    psyCol = mix(psyCol, grn, smoothstep(0.5, 0.98, lum) * 0.9);
    col = mix(col, psyCol, uPsy * 0.92);
  }

  // --- МАНДАЛА 3.0: многослойный психодел по КРАЯМ экрана (центр чист для прицела) ---
  // L1: калейдоскоп кольца/лепестки (двойной, контр-вращение) ·
  // L2: пиксельная сетка — квантованные ячейки со степ-анимацией ·
  // L3: сканлайн-полосы от баса. Всё аддитивно × краевая маска.
  if (uMandala > 0.001) {
    // Краевая маска в экранном пространстве: 0 в центре → 1 к краям
    float edge = smoothstep(0.30, 0.60, dist);
    if (edge > 0.001) {
      vec2 mp = (vUv - 0.5) * (2.2 - clamp(uMandalaZoom, 0.0, 1.5) * 0.4);
      mp.x *= uResolution.x / max(uResolution.y, 1.0); // круги, не эллипсы
      float mr = length(mp);
      float ma = atan(mp.y, mp.x) + uMandalaRot;
      float seg = 6.2831853 / max(uMandalaN, 3.0);
      ma = mod(ma, seg);
      ma = abs(ma - seg * 0.5); // зеркальный fold внутри сегмента

      // L1: калейдоскоп (кольца × лепестки) + контр-вращающийся слой
      float rings = sin(mr * 22.0 - uTime * 1.6 + ma * uMandalaN * 1.5);
      float petals = cos(ma * uMandalaN * 2.0 + mr * 7.0 - uTime * 0.9);
      float m1 = smoothstep(0.35, 0.95, rings * petals * 0.5 + 0.5);
      vec3 mcol1 = hsl2rgb(vec3(fract(uMandalaHue + ma * uMandalaN * 0.08 + mr * 0.15), 0.85, 0.55));
      float rings2 = sin(mr * 34.0 + uTime * 1.1 - ma * uMandalaN * 2.2);
      float petals2 = cos(ma * uMandalaN * 3.0 - mr * 11.0 + uTime * 1.3);
      float m1b = smoothstep(0.45, 0.95, rings2 * petals2 * 0.5 + 0.5);
      vec3 mcol1b = hsl2rgb(vec3(fract(uMandalaHue + 0.5 - ma * uMandalaN * 0.06 - mr * 0.22), 0.9, 0.6));

      // L2: пиксельная сетка — экран квантуется на ячейки, паттерн шагает
      // дискретными кадрами (ускоряется на битах/выстрелах через uMandalaZoom)
      float cells = 42.0 + uMandalaN * 4.0;
      vec2 cell = floor(gl_FragCoord.xy / max(uResolution.y / cells, 1.0));
      float tick = floor(uTime * (5.0 + uMandalaZoom * 9.0));
      float px = hash12(cell + tick * 0.37);
      float px2 = hash12(cell * 1.71 - tick * 0.23);
      float m2 = smoothstep(0.60, 0.97, px * px2 * 1.7); // редкие вспыхивающие ячейки
      vec3 mcol2 = hsl2rgb(vec3(fract(uMandalaHue + px * 0.45 + tick * 0.018), 0.9, 0.58));

      // L3: сканлайн-полосы от баса (тонкие, дышащие)
      float scan = sin(gl_FragCoord.y * 0.9 + uTime * 3.0);
      float m3 = smoothstep(0.88, 1.0, scan) * clamp(uMandalaBass, 0.0, 1.0);
      vec3 mcol3 = hsl2rgb(vec3(fract(uMandalaHue + 0.8), 0.7, 0.5));

      col += (mcol1 * m1 + mcol1b * m1b * 0.7 + mcol2 * m2 * 0.9 + mcol3 * m3 * 0.5)
        * uMandala * edge * 1.55;
    }
  }

  // Пульс на бите — лёгкая вспышка экспозиции
  col *= 1.0 + uBeat * 0.11;

  // Ordered Bayer дизеринг (в пикселях экрана — после апскейла смотрится как PS2)
  float d = bayer4(gl_FragCoord.xy) - 0.5;
  col += d * uDither;

  // Лёгкая квантизация цвета для «приставочного» вида
  col = floor(col * 48.0 + 0.5 + d * 0.9) / 48.0;

  // Виньетка
  float vig = smoothstep(0.85, 0.35, dist * (1.0 + uVignette));
  col *= mix(1.0, vig, uVignette);

  // Лёгкий scanline-шиммер
  col *= 1.0 - 0.03 * sin(gl_FragCoord.y * 3.14159 + uTime * 2.0);

  gl_FragColor = vec4(col, 1.0);
}`;

// ============================================================
// FX-контроллер: плавные (lerp) переходы к целевым значениям,
// музыкальный драйв (энергия/бас/FLOW/бит), пульсы, psy-break.
// ============================================================
export class FXController {
  constructor(engine) {
    this.engine = engine;
    // Целевые значения (то, что просит игра)
    this.target = { rgbSplit: 0, glitch: 0, warp: 0, psy: 0, datamosh: 0, fisheye: 0 };
    // Текущие (плавно догоняют целевые)
    this.current = { rgbSplit: 0, glitch: 0, warp: 0, psy: 0, datamosh: 0, fisheye: 0 };
    this.pulseV = 0;         // затухающий пульс (бит/событие)
    this.psyBreak = false;   // состояние psy-break
    this._psyK = 0;
    this.baseFisheye = 0;    // постоянный fisheye от настройки FOV > 180 (псевдо-360)
    // Мандала-слой: целевые параметры (задаёт игра через setMandala)
    this.mandala = { strength: 0.05, symmetry: 0, speed: 0.2 }; // symmetry 0 = авто (6+energy*10)
    this._mandalaStrength = 0; // плавно догоняет целевую
    this._mandalaN = 8;        // плавная (float) симметрия
    this._mandalaRot = 0;      // накопленный угол вращения
    this._mandalaHue = 0.78;   // тон (фиолет), медленно дрейфует
  }

  // Установить целевые уровни эффектов (любой поднабор)
  set(patch = {}) {
    for (const k of ['rgbSplit', 'glitch', 'warp', 'psy', 'datamosh', 'fisheye']) {
      if (patch[k] != null && isFinite(patch[k])) this.target[k] = patch[k];
    }
  }

  // Короткий пульс на бите (складывается)
  pulse(strength = 1) { this.pulseV = Math.min(2, this.pulseV + strength); }

  // Мандала-слой: {strength 0..1, symmetry (0 = авто 6+floor(energy*10)), speed}
  setMandala(patch = {}) {
    if (patch.strength != null && isFinite(patch.strength)) {
      this.mandala.strength = Math.min(1, Math.max(0, patch.strength));
    }
    if (patch.symmetry != null && isFinite(patch.symmetry)) {
      this.mandala.symmetry = Math.min(24, Math.max(0, patch.symmetry));
    }
    if (patch.speed != null && isFinite(patch.speed)) {
      this.mandala.speed = Math.min(3, Math.max(0, patch.speed));
    }
  }

  // Психологический разрыв: полный пресет (малина/зелень + туннель + смаз)
  setPsyBreak(on, intensity = 1) {
    this.psyBreak = !!on;
    this._psyK = on ? Math.min(1.5, Math.max(0, intensity)) : 0;
    if (on) {
      this.set({
        psy: this._psyK,
        warp: 0.62 * this._psyK,
        datamosh: 0.6 * this._psyK,
        rgbSplit: 0.02 * this._psyK,
        glitch: 0.35 * this._psyK,
      });
      this.setMandala({ strength: 0.75 * this._psyK }); // psy-break: мандала на максимум
    } else {
      this.set({ psy: 0, warp: 0, datamosh: 0, rgbSplit: 0, glitch: 0, fisheye: 0 });
      this.setMandala({ strength: 0.05 }); // вернуть тонкий фоновый вайб
    }
  }

  // Вызывать каждый рендер-кадр.
  // drive: {energy, bass, flow} 0..1 + phase (прогресс трека 0..1)
  //        + beatPhase (0 — сам бит .. 1 — следующий бит)
  update(dt, drive = {}) {
    this.pulseV = Math.max(0, this.pulseV - dt * 3.2);
    const k = Math.min(1, dt * 4.5); // плавность переходов
    for (const key of Object.keys(this.target)) {
      this.current[key] += (this.target[key] - this.current[key]) * k;
    }
    const energy = Math.min(1, drive.energy ?? 0);
    const bass = Math.min(1, drive.bass ?? 0);
    const high = Math.min(1, drive.high ?? 0);
    const flow = Math.min(1, drive.flow ?? 0);
    const phase = Math.min(1, Math.max(0, drive.phase ?? 0));
    const beatPhase = Math.min(1, Math.max(0, drive.beatPhase ?? 0.999));
    // Темп трека: чем выше BPM (100→190), тем агрессивнее живёт мандала
    const bpmNorm = Math.min(1, Math.max(0, ((drive.bpm ?? 0) - 100) / 90));
    const u = this.engine._postMat.uniforms;
    const c = this.current;
    // Хроматизм по краям — всегда чуть-чуть (0.0035), дальше — музыка/бит.
    // Высокие (хэты/трещотки) добавляют «искру» в сплит и глитч-искажения.
    u.uRGBSplit.value = 0.0035 + energy * 0.0045 + flow * 0.003 + this.pulseV * 0.005 + c.rgbSplit + high * 0.003;
    // Глитч — ручной уровень + бас (вероятность/амплитуда от баса) + хэты
    u.uGlitch.value = Math.min(1, c.glitch + Math.max(0, bass - 0.48) * 1.1 + Math.max(0, high - 0.55) * 0.7 + this.pulseV * 0.1);
    // Варп слегка дышит общей энергией (кроме ручных целей)
    u.uWarp.value = Math.min(1.2, Math.max(0, c.warp + energy * 0.05));
    u.uPsy.value = Math.min(1, Math.max(0, c.psy));
    // Datamosh только если позволяет тир качества
    u.uDatamosh.value = this.engine.datamoshAvailable() ? Math.min(1, Math.max(0, c.datamosh)) : 0;
    u.uBeat.value = this.pulseV;
    // Fisheye — переход между мирами (смерть/конец матча) + постоянная база
    // от настройки FOV > 180° (псевдо-360, задаёт меню через fx.baseFisheye)
    u.uFisheye.value = Math.min(1.3, Math.max(0, c.fisheye + this.baseFisheye));

    // --- Мандала-слой (тот же fullscreen проход; на low-тире — off) ---
    this._mandalaStrength += (this.mandala.strength - this._mandalaStrength) * k;
    // Симметрия: авто N = 6+floor(energy*10) или ручная база + энергия;
    // быстрый темп (BPM) добавляет сегменты — калейдоскоп «густеет»
    const targetN = (this.mandala.symmetry > 0 ? this.mandala.symmetry : 6)
      + Math.floor(energy * 10) + Math.floor(bpmNorm * 4);
    this._mandalaN += (targetN - this._mandalaN) * Math.min(1, dt * 2.0);
    // Вращение: скорость дышит по фазе бита (рывок сразу после удара);
    // множитель темпа 1..1.6 — быстрые треки крутят заметно живее
    this._mandalaRot += this.mandala.speed * (0.4 + (1 - beatPhase) * 1.6) * (1 + bpmNorm * 0.6) * dt;
    // Тон: дрейф ускоряется от темпа + фаза трека сдвигает палитру
    this._mandalaHue = (this._mandalaHue + dt * 0.012 * (0.6 + bpmNorm)) % 1;
    u.uMandala.value = this.engine.mandalaAvailable() ? this._mandalaStrength : 0;
    u.uMandalaN.value = this._mandalaN;
    u.uMandalaRot.value = this._mandalaRot;
    u.uMandalaHue.value = (this._mandalaHue + phase * 0.35) % 1;
    u.uMandalaZoom.value = this.pulseV; // zoom-пульс на битах (и выстрелах)
    u.uMandalaBass.value = Math.max(0, bass - 0.35) * 1.6; // сканлайн-слой от баса
  }
}

// ============================================================
export class Engine {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: false, powerPreference: 'high-performance', stencil: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.35;
    this.renderer.shadowMap.enabled = false; // 60 FPS: тени — fake AO

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(75, 1, 0.05, 600);

    // Базовый туман (белая арена): светлый FogExp2 — часть новой эстетики
    this.baseFogColor = 0xdfe1ec;
    this.baseFogDensity = 0.0085;
    this.scene.fog = new THREE.FogExp2(this.baseFogColor, this.baseFogDensity);
    this.scene.background = new THREE.Color(this.baseFogColor);

    // Низкоразрешённый рендер-таргет (пикселизация)
    this.pixelScale = 0.5; // 0.5× от экрана
    this._rt = null;
    this._rtPrev = null;   // полуразрешённый feedback-таргет (datamosh)
    this._postScene = new THREE.Scene();
    this._postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._postMat = new THREE.ShaderMaterial({
      vertexShader: POST_VERT,
      fragmentShader: POST_FRAG,
      uniforms: {
        tDiffuse: { value: null },
        tPrev: { value: null },
        uTime: { value: 0 },
        uCA: { value: 0.012 },
        uVignette: { value: 0.55 },
        uDither: { value: 0.045 },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uRGBSplit: { value: 0.0035 },
        uGlitch: { value: 0 },
        uWarp: { value: 0 },
        uPsy: { value: 0 },
        uDatamosh: { value: 0 },
        uBeat: { value: 0 },
        uFisheye: { value: 0 },
        uMandala: { value: 0 },
        uMandalaN: { value: 8 },
        uMandalaRot: { value: 0 },
        uMandalaHue: { value: 0.78 },
        uMandalaZoom: { value: 0 },
        uMandalaBass: { value: 0 },
      },
      depthTest: false, depthWrite: false,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this._postMat);
    quad.frustumCulled = false;
    this._postScene.add(quad);

    // Copy-проход: даунсэмпл текущего кадра в feedback-таргет
    this._copyScene = new THREE.Scene();
    this._copyMat = new THREE.MeshBasicMaterial({ depthTest: false, depthWrite: false });
    const copyQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this._copyMat);
    copyQuad.frustumCulled = false;
    this._copyScene.add(copyQuad);

    // FX-контроллер (публичный API)
    this.fx = new FXController(this);

    // --- Адаптив качества ---
    this.fxQualityMode = 'auto';  // auto | low | high
    this.onQualityChange = null;  // cb(tier: 'high'|'low')
    const _ua = navigator.userAgent || '';
    // iOS, включая iPadOS, которая притворяется «Macintosh» (тач + MacIntel)
    this._isIOS = /iPhone|iPad|iPod/i.test(_ua)
      || (navigator.platform === 'MacIntel' && (navigator.maxTouchPoints || 0) > 1);
    this._isMobile = this._isIOS || /Android|Mobile/i.test(_ua)
      || ((navigator.hardwareConcurrency || 8) <= 4 && (navigator.maxTouchPoints || 0) > 0);
    this.qualityTier = this._isMobile ? 'low' : 'high';
    this._fpsEma = 60;
    this._lowFpsT = 0;   // сколько секунд подряд FPS < 45

    // Цикл с фиксированным dt
    this.fixedDt = 1 / 60;
    this._accum = 0;
    this._last = 0;
    this._running = false;
    this.time = 0;
    this._updateCbs = [];   // фиксированный апдейт (физика/игра)
    this._renderCbs = [];   // пер-кадр (визуал)

    this._onResize = this._resize.bind(this);
    window.addEventListener('resize', this._onResize);
    this._resize();
  }

  // Datamosh/Reflector доступны только на высоком тире
  datamoshAvailable() { return this.qualityTier === 'high'; }

  // Мандала-слой — тоже только на высоком тире (дешёвый, но на слабом GPU — off)
  mandalaAvailable() { return this.qualityTier === 'high'; }

  // Режим качества эффектов: 'auto' | 'low' | 'high'
  setFxQuality(mode) {
    if (!['auto', 'low', 'high'].includes(mode)) return;
    this.fxQualityMode = mode;
    this._lowFpsT = 0;
    if (mode === 'low') this._setTier('low');
    else if (mode === 'high') this._setTier('high');
    else this._setTier(this._isMobile ? 'low' : 'high');
  }

  _setTier(tier) {
    if (this.qualityTier === tier) return;
    this.qualityTier = tier;
    if (tier === 'low') {
      // Снижаем пиксель-скейл (не ниже 0.35) и гасим datamosh
      this.setPixelScale(Math.max(0.35, this.pixelScale - 0.12));
    }
    this.onQualityChange?.(tier);
  }

  // Авто-детект просадки: FPS < 45 в течение 3 сек → low tier
  _autoQuality(frameDt) {
    if (frameDt > 0) this._fpsEma += (1 / frameDt - this._fpsEma) * 0.05;
    if (this.fxQualityMode !== 'auto' || this.qualityTier !== 'high') return;
    if (this._fpsEma < 45) {
      this._lowFpsT += frameDt;
      if (this._lowFpsT >= 3) {
        this._lowFpsT = 0;
        this._setTier('low');
      }
    } else {
      this._lowFpsT = Math.max(0, this._lowFpsT - frameDt);
    }
  }

  get fps() { return this._fpsEma; }

  // Установить пиксельный масштаб (0.25..1)
  setPixelScale(s) {
    this.pixelScale = Math.min(1, Math.max(0.2, s));
    this._resize();
  }

  _resize() {
    const w = window.innerWidth, h = window.innerHeight;
    // На iOS DPR 3 — главный убийца FPS; кап 1.5 вместо 2 (~-44% пикселей)
    const dpr = Math.min(window.devicePixelRatio || 1, this._isIOS ? 1.5 : 2);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();

    const rw = Math.max(160, Math.floor(w * dpr * this.pixelScale));
    const rh = Math.max(90, Math.floor(h * dpr * this.pixelScale));
    if (this._rt) this._rt.dispose();
    this._rt = new THREE.WebGLRenderTarget(rw, rh, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter, // nearest-апскейл => пиксели
      depthBuffer: true,
    });
    // Feedback-таргет в ПОЛОВИННОМ разрешении (дешёвый datamosh)
    const pw = Math.max(80, rw >> 1);
    const ph = Math.max(45, rh >> 1);
    if (this._rtPrev) this._rtPrev.dispose();
    this._rtPrev = new THREE.WebGLRenderTarget(pw, ph, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter, // линейный даунсэмпл = мягкий смаз
      depthBuffer: false,
    });
    this._postMat.uniforms.tDiffuse.value = this._rt.texture;
    this._postMat.uniforms.tPrev.value = this._rtPrev.texture;
    this._postMat.uniforms.uResolution.value.set(rw, rh);
  }

  onUpdate(cb) { this._updateCbs.push(cb); }
  onRender(cb) { this._renderCbs.push(cb); }

  start() {
    if (this._running) return;
    this._running = true;
    this._last = performance.now();
    const loop = (now) => {
      if (!this._running) return;
      requestAnimationFrame(loop);
      let frame = (now - this._last) / 1000;
      this._last = now;
      if (frame > 0.25) frame = 0.25; // защита от спирали
      this._autoQuality(frame);
      this._accum += frame;
      // Фиксированный шаг симуляции
      let steps = 0;
      while (this._accum >= this.fixedDt && steps < 5) {
        this.time += this.fixedDt;
        for (const cb of this._updateCbs) cb(this.fixedDt);
        this._accum -= this.fixedDt;
        steps++;
      }
      for (const cb of this._renderCbs) cb(frame);
      this.render();
    };
    requestAnimationFrame(loop);
  }

  stop() { this._running = false; }

  render() {
    this._postMat.uniforms.uTime.value = this.time;
    // 1. Сцена → низкоразрешённый таргет
    this.renderer.setRenderTarget(this._rt);
    this.renderer.render(this.scene, this.camera);
    // 2. Постпроцесс → экран (tPrev ещё хранит прошлый кадр)
    this.renderer.setRenderTarget(null);
    this.renderer.render(this._postScene, this._postCam);
    // 3. Даунсэмпл текущего кадра в feedback-таргет (для datamosh след. кадра)
    if (this.datamoshAvailable()) {
      this._copyMat.map = this._rt.texture;
      this.renderer.setRenderTarget(this._rtPrev);
      this.renderer.render(this._copyScene, this._postCam);
      this.renderer.setRenderTarget(null);
      this._copyMat.map = null;
    }
  }

  dispose() {
    this.stop();
    window.removeEventListener('resize', this._onResize);
    if (this._rt) this._rt.dispose();
    if (this._rtPrev) this._rtPrev.dispose();
    this.renderer.dispose();
  }
}
