// ===== GEN.SWAGS Arena (визуал v2 + варианты) =====
// Крытый каньон: мраморный пол с отражениями (Reflector 512px, на слабом
// тире — fake gloss), верхний свет, кристаллический взрыв в центре,
// биохазард-декали, руины небоскрёбов, разрушаемые блоки, платформы,
// зоны A/B/C, кешаут-станции, кешбокс, waypoint-сетка для ботов.
//
// Варианты (мета-ротация): 'cathedral' — HUB_1 «СОБОР» (белая),
// 'abyss' — «БЕЗДНА» (чёрно-малиновый хоррор, кровавый туман),
// 'necro' — «НЕКРО-ЗАВОД» (тёмная, зелёный туман, металл),
// 'shrine' — «ХРАМ ЖЕЛЕЗА» (тёмный красно-оранжевый, ступени храма),
// 'desert' — «ПУСТЫНЯ ДАННЫХ» (оранжево-фиолетовая, иной центр).
// size — масштаб арены (дуэль играет на уменьшенной, 34м).
// disposeArena() — полная очистка перед пересборкой.
import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import {
  PALETTE, flatMat, boxGeo,
  createDestructibleWall, createColumn, createPlatform,
  createCashbox, createCashoutStation, createObjectiveZone,
  createRuinedTower, createCrystalSpike, createSkull, createSpotlightBeam,
  createCrystalExplosion, createMarbleTexture, createBiohazardDecal,
  createSunGlareTexture, getTextureSet, applyTextureSet,
} from '../engine/models.js';
import { loadGLBArena, applyGLBPhysics, findFloorY } from '../engine/arenaLoader.js';
import { createRealGun } from '../engine/realguns.js';

const ARENA_SIZE = 72; // базовый размер 72×72 м (карты стали больше)

// Пикапы оружия по умолчанию (варианты без своего списка): akimbo при подборе
const DEFAULT_PICKUPS = [
  { x: -20, z: 6, kind: 'lmg' },
  { x: 20, z: -6, kind: 'rocket' },
  { x: 0, z: 22, kind: 'dmr' },
];

// ---------- Визуальные пресеты вариантов ----------
export const ARENA_VARIANTS = {
  eden: { // «РАЙ-7» 楽園 — белоснежный рай будущего: мрамор, стекло, золото
    fog: 0xeef1f8, fogDensity: 0.0075,
    hemiSky: 0xffffff, hemiGround: 0xd8d4e8, hemiInt: 1.6,
    sun: 0xfff4e0, sunInt: 3.2, rim: 0xbfe8ff, rimInt: 0.9,
    floor: 0xf4f3f8, glossEmissive: 0x2a2a30, veilTint: 0xffffff, veilOpacity: 0.5,
    reflectorColor: 0xb8c0d8,
    strip: 0xffd77a,
    zoneL1: 0xffd77a, zoneL2: 0x7ac8ff,
    glareColor: 0xffffff, glare2Color: 0xfff0c8,
    particles: 0xffffff, sparks: 0xffd77a,
    spotColors: [0xffffff, 0xffe8b0, 0xcfe8ff],
    bio: { base: 0xd8b060, glow: 0xffd77a },
    showHue: 0.12, // золото
    floorTex: 'marble', wallTex: 'concrete',
    blocks: [[-14, -8, 0], [14, 8, 0.2], [12, -14, -0.15]],
    platforms: [
      { x: -6, y: 2.2, z: 0, w: 5, d: 5 },
      { x: 6, y: 3.2, z: -4, w: 4, d: 4 },
      { x: 0, y: 1.4, z: 16, w: 6, d: 4 },
      { x: -18, y: 2.8, z: 2, w: 4, d: 6 },
      { x: 16, y: 4.6, z: 16, w: 5, d: 5 },   // высокая — только джамп-падом
      { x: -16, y: 5.4, z: -18, w: 4, d: 4 }, // высокая — только джамп-падом
      // НЕБЕСНАЯ ВЕРТИКАЛЬ (The Finals): ступени вверх + парящие острова
      { x: 3, y: 4.4, z: -10, w: 4, d: 4 },   // ступень к северной вышке
      { x: 0, y: 6.8, z: -15, w: 5, d: 5 },   // северная вышка — мега-пад
      { x: -10, y: 8.0, z: 22, w: 4, d: 4 },  // небесный насест — самый высокий
      { x: 22, y: 6.2, z: -2, w: 4, d: 4, float: true },  // парящий остров
      { x: -24, y: 5.6, z: -6, w: 4, d: 4, float: true }, // парящий остров
    ],
    pads: [
      { x: 13, z: 13, power: 17 },   // → платформа 4.6
      { x: -13, z: -15, power: 18 }, // → платформа 5.4
      { x: 0, z: 8, power: 15 },     // центральный подброс
      { x: -2, z: -11, power: 20 },  // МЕГА → северная вышка 6.8
      { x: -8, z: 19, power: 22 },   // МЕГА → небесный насест 8.0
    ],
    interiors: [[-22, 12, 0], [20, -18, Math.PI / 2]],
    towers: [],
    pickups: [ // akimbo-пикапы: ракетница запад, AWP север, СВД восток
      { x: -26, z: 6, kind: 'rocket' },
      { x: 0, z: -24, kind: 'awp' },
      { x: 24, z: -6, kind: 'dmr' },
    ],
  },
  hell: { // «ГЕЕННА» 地獄 — ад: мегаструктуры, биомасса, кровавый туман
    fog: 0x160608, fogDensity: 0.019,
    hemiSky: 0x8a2438, hemiGround: 0x0c0408, hemiInt: 1.0,
    sun: 0xc02840, sunInt: 1.6, rim: 0xff2d55, rimInt: 1.1,
    floor: 0x1c0a10, glossEmissive: 0x20030c, veilTint: 0x5c1424, veilOpacity: 0.6,
    reflectorColor: 0x30101a,
    strip: 0xff5a1a,
    zoneL1: 0xff2d55, zoneL2: 0xff8c1a,
    glareColor: 0xff4a3c, glare2Color: 0xffa01a,
    particles: 0xc06a5e, sparks: 0xff5a1a,
    spotColors: [0xff2d55, 0xff8c1a, 0x8a00ff],
    bio: { base: 0x7a0a1a, glow: 0xff3018 },
    showHue: 0.0, // красный
    floorTex: 'ground', wallTex: 'metalPlates',
    blocks: [[-12, -10, 0.3], [12, 10, -0.3]],
    platforms: [
      { x: 0, y: 3.0, z: 12, w: 6, d: 5 },
      { x: -14, y: 2.0, z: 12, w: 4, d: 5 },
      { x: 14, y: 3.6, z: -12, w: 4, d: 4 },
      { x: -20, y: 2.4, z: -10, w: 5, d: 4 },
      { x: 18, y: 5.0, z: 10, w: 4, d: 5 },  // высокая — джамп-пад
      { x: -4, y: 4.2, z: -20, w: 5, d: 4 }, // высокая — джамп-пад
      // АДСКАЯ ВЕРТИКАЛЬ: костяные насесты + парящие плиты плоти
      { x: 8, y: 5.6, z: -18, w: 4, d: 4 },   // ступень к костяному насесту
      { x: -2, y: 7.0, z: 2, w: 4, d: 4 },    // костяной насест у центра — мега-пад
      { x: 22, y: 6.4, z: -20, w: 4, d: 4, float: true }, // парящая плита
      { x: -24, y: 6.8, z: 18, w: 4, d: 4, float: true }, // парящая плита
    ],
    pads: [
      { x: 15, z: 6, power: 18 },   // → платформа 5.0
      { x: -1, z: -16, power: 17 }, // → платформа 4.2
      { x: 2, z: -2, power: 21 },   // МЕГА → костяной насест 7.0
      { x: -20, z: 14, power: 20 }, // МЕГА → парящая плита 6.8
    ],
    interiors: [[-24, -2, Math.PI / 2], [8, 22, 0]],
    towers: [[0, -24, 0, 2]], // рёберная мега-арка из разрушаемых сегментов
    pickups: [ // огнемёт юг, ракетница восток, гранатомёт запад
      { x: -8, z: 20, kind: 'flamer' },
      { x: 20, z: -4, kind: 'rocket' },
      { x: -22, z: 6, kind: 'gl' },
    ],
  },
  sng: { // «СЕКТОР-9» 區 — СНГ: панельки (разрушаемые) + стеклянный люкс
    fog: 0x9aa4b4, fogDensity: 0.011,
    hemiSky: 0xd8e4f2, hemiGround: 0x3a3f4c, hemiInt: 1.25,
    sun: 0xe8f0ff, sunInt: 2.5, rim: 0x6ab0ff, rimInt: 0.85,
    floor: 0x8a8f9a, glossEmissive: 0x14161c, veilTint: 0xaab2c0, veilOpacity: 0.5,
    reflectorColor: 0x6a7488,
    strip: 0x6ab0ff,
    zoneL1: 0x6ab0ff, zoneL2: 0xffd77a,
    glareColor: 0xe8f0ff, glare2Color: 0x9ac8ff,
    particles: 0xc8d4e8, sparks: 0x6ab0ff,
    spotColors: [0x6ab0ff, 0xffd77a, 0xe8f0ff],
    bio: { base: 0x3a5a8a, glow: 0x6ab0ff },
    showHue: 0.58, // холодный синий
    floorTex: 'concrete', wallTex: 'concrete',
    blocks: [[-14, 10, 0.4], [14, -10, -0.2]],
    platforms: [
      { x: -8, y: 2.4, z: 6, w: 5, d: 5 },
      { x: 8, y: 3.0, z: 8, w: 4, d: 4 },
      { x: 0, y: 1.6, z: -14, w: 6, d: 4 },
      { x: 20, y: 3.8, z: 14, w: 5, d: 5 },  // балкон люкса — джамп-пад
      // ДВОРОВАЯ ВЕРТИКАЛЬ: крыши гаражей, балконы, парящая плита
      { x: -14, y: 5.2, z: 8, w: 5, d: 4 },   // крыша гаражного ряда
      { x: 6, y: 6.4, z: -6, w: 4, d: 4 },    // высокий балкон — мега-пад
      { x: 24, y: 7.2, z: 20, w: 4, d: 5 },   // крыша пристройки люкса
      { x: -24, y: 4.6, z: -20, w: 4, d: 4, float: true }, // парящая плита
    ],
    pads: [
      { x: 16, z: 11, power: 16 },  // → балкон 3.8
      { x: -18, z: -14, power: 15 },
      { x: -11, z: 5, power: 18 },  // → крыша гаражей 5.2
      { x: 3, z: -3, power: 20 },   // МЕГА → балкон 6.4
    ],
    interiors: [[-20, -4, 0]],
    towers: [[-22, 18, 0.1, 3], [18, -20, -0.15, 3], [24, 2, Math.PI / 2, 2]], // панельки
    pickups: [ // ПКМ юг, гранатомёт запад, AWP восток
      { x: 0, z: 18, kind: 'lmg' },
      { x: -22, z: -10, kind: 'gl' },
      { x: 22, z: -8, kind: 'awp' },
    ],
  },
  necro: { // «НЕКРО-ЗАВОД» — темнее, зеленоватый туман, металл
    fog: 0x0e1b13, fogDensity: 0.017,
    hemiSky: 0xbfffd9, hemiGround: 0x141f18, hemiInt: 1.05,
    sun: 0xd8ffe8, sunInt: 1.85, rim: 0x62ff9a, rimInt: 0.7,
    floor: 0x232826, glossEmissive: 0x0a120d, veilTint: 0x51705e, veilOpacity: 0.5,
    reflectorColor: 0x37453c,
    strip: 0x62ff9a,
    zoneL1: 0x62ff9a, zoneL2: 0xff2d55,
    glareColor: 0xbfffd9, glare2Color: 0x62ff9a,
    particles: 0x9fd8b0, sparks: 0x62ff9a,
    spotColors: [0xbfffd9, 0x62ff9a, 0xd8ffe8],
    bio: { base: 0x1f7a38, glow: 0x62ff9a },
    showHue: 0.38, // базовый тон светового шоу (токсичная зелень)
    floorTex: 'metalPlates', wallTex: 'metalPlates',
    blocks: [[-14, -8, 0], [14, 8, 0.2], [12, -14, -0.15]],
    platforms: [
      { x: -6, y: 2.2, z: 0, w: 5, d: 5 },
      { x: 6, y: 3.2, z: -4, w: 4, d: 4 },
      { x: 0, y: 1.4, z: 16, w: 6, d: 4 },
      { x: -18, y: 2.8, z: 2, w: 4, d: 6 },
      { x: 14, y: 5.4, z: -18, w: 4, d: 4 },  // заводской насест — мега-пад
      { x: -2, y: 6.2, z: -10, w: 4, d: 4, float: true }, // парящая плита
    ],
    pads: [
      { x: 0, z: -8, power: 17 },
      { x: -12, z: 10, power: 16 },
      { x: 12, z: -14, power: 20 }, // МЕГА → заводской насест 5.4
    ],
  },
  abyss: { // «БЕЗДНА» 深淵 — чёрно-малиновый хоррор, кровавый туман, металл
    fog: 0x0b0408, fogDensity: 0.019,
    hemiSky: 0x6e2238, hemiGround: 0x0a0510, hemiInt: 0.95,
    sun: 0xa02840, sunInt: 1.5, rim: 0xff2d55, rimInt: 1.05,
    floor: 0x140a11, glossEmissive: 0x1c030c, veilTint: 0x511222, veilOpacity: 0.62,
    reflectorColor: 0x2a0f18,
    strip: 0xff2d55,
    zoneL1: 0xff2d55, zoneL2: 0x8a00ff,
    glareColor: 0xff4a66, glare2Color: 0x8a00ff,
    particles: 0x9a4a5e, sparks: 0xff2d55,
    spotColors: [0xff2d55, 0x8a00ff, 0xff5a3c],
    bio: { base: 0x6a0a1a, glow: 0xff1830 },
    showHue: 0.96, // базовый тон светового шоу (малиновый)
    floorTex: 'metalPlates', wallTex: 'metalPlates',
    blocks: [[-10, -10, 0.3], [10, 10, -0.3], [0, 14, 0]],
    platforms: [
      { x: 0, y: 3.0, z: 10, w: 6, d: 5 },
      { x: -12, y: 1.8, z: 12, w: 4, d: 5 },
      { x: 12, y: 3.4, z: -12, w: 4, d: 4 },
      { x: -20, y: 2.4, z: -8, w: 5, d: 4 },
      { x: 18, y: 2.0, z: 8, w: 4, d: 6 },
      { x: 4, y: 6.6, z: 4, w: 4, d: 4, float: true }, // парящий фрагмент бездны
      { x: -6, y: 5.2, z: -18, w: 4, d: 4 },           // высокий насест — джамп-пад
    ],
    pads: [
      { x: 2, z: 1, power: 20 },   // МЕГА → парящий фрагмент 6.6
      { x: -4, z: -14, power: 17 }, // → насест 5.2
    ],
  },
  shrine: { // «ХРАМ ЖЕЛЕЗА» 鉄ノ社 — тёмный красно-оранжевый, ступени к центру
    fog: 0x160705, fogDensity: 0.016,
    hemiSky: 0xff9a5a, hemiGround: 0x140404, hemiInt: 0.92,
    sun: 0xffb070, sunInt: 1.65, rim: 0xff5a2a, rimInt: 0.95,
    floor: 0x1d0f0a, glossEmissive: 0x180502, veilTint: 0x732c16, veilOpacity: 0.55,
    reflectorColor: 0x37160c,
    strip: 0xff8c42,
    zoneL1: 0xff8c42, zoneL2: 0xff2d55,
    glareColor: 0xffb070, glare2Color: 0xff5a2a,
    particles: 0xd88a5a, sparks: 0xffa050,
    spotColors: [0xffb070, 0xff5a2a, 0xffd090],
    bio: { base: 0x7a1a08, glow: 0xff5a1a },
    showHue: 0.05, // базовый тон светового шоу (оранж)
    floorTex: 'ground', wallTex: 'concrete',
    blocks: [[-13, 0, 0], [13, 0, 0], [0, -18, 0.2]],
    platforms: [ // симметричные «ступени» храма к центральному возвышению
      { x: -6, y: 1.4, z: 8, w: 6, d: 4 },
      { x: 6, y: 1.4, z: 8, w: 6, d: 4 },
      { x: 0, y: 2.8, z: -6, w: 7, d: 5 },
      { x: -16, y: 2.2, z: -14, w: 4, d: 4 },
      { x: 16, y: 2.2, z: -14, w: 4, d: 4 },
      { x: 0, y: 6.0, z: -14, w: 5, d: 4 },   // верхняя ступень храма — мега-пад
    ],
    pads: [
      { x: 0, z: -11, power: 19 },  // → верхняя ступень 6.0
      { x: -16, z: -11, power: 15 },
      { x: 16, z: -11, power: 15 },
    ],
  },
  desert: { // «ПУСТЫНЯ ДАННЫХ» — оранжево-фиолетовая, другая планировка центра
    fog: 0x2b1530, fogDensity: 0.014,
    hemiSky: 0xffb070, hemiGround: 0x2a1240, hemiInt: 1.1,
    sun: 0xffc890, sunInt: 2.2, rim: 0xa05cff, rimInt: 1.0,
    floor: 0x452a3a, glossEmissive: 0x180c16, veilTint: 0x9a6a7a, veilOpacity: 0.5,
    reflectorColor: 0x54384a,
    strip: 0xff8c42,
    zoneL1: 0xff8c42, zoneL2: 0xa05cff,
    glareColor: 0xffb070, glare2Color: 0xa05cff,
    particles: 0xffc890, sparks: 0xff8c42,
    spotColors: [0xffb070, 0xa05cff, 0xff8c42],
    bio: { base: 0xa01226, glow: 0xff1830 },
    showHue: 0.06, // базовый тон светового шоу (оранж)
    floorTex: 'ground', wallTex: 'concrete',
    blocks: [[-12, 10, 0.4], [12, 12, -0.2], [0, -16, 0.9]],
    platforms: [
      { x: -8, y: 2.4, z: 6, w: 5, d: 5 },
      { x: 8, y: 3.0, z: 8, w: 4, d: 4 },
      { x: 0, y: 1.6, z: -12, w: 6, d: 4 },
      { x: 16, y: 2.6, z: -4, w: 4, d: 6 },
      { x: -4, y: 6.2, z: -2, w: 4, d: 4, float: true }, // парящая плита данных
    ],
    pads: [
      { x: -2, z: 2, power: 19 }, // МЕГА → парящая плита 6.2
      { x: 14, z: 0, power: 15 },
    ],
  },
  ruins: { // «РУИНЫ» — GLB-карта: постапокалиптический город, загружается из файла
    glb: 'assets/models/arena/ruined_city_free_5.glb',
    fog: 0x8a8a92, fogDensity: 0.012,
    hemiSky: 0xc0c8d8, hemiGround: 0x4a4a52, hemiInt: 1.2,
    sun: 0xe8e0d0, sunInt: 2.8, rim: 0x8a9aaa, rimInt: 0.7,
    floor: 0x5a5a5a, glossEmissive: 0x1a1a1a, veilTint: 0x7a7a7a, veilOpacity: 0.4,
    reflectorColor: 0x5a5a62,
    strip: 0xff6a3a,
    zoneL1: 0xff6a3a, zoneL2: 0x4a9aff,
    glareColor: 0xe8e0d0, glare2Color: 0xc0b8a0,
    particles: 0xb0b0b0, sparks: 0xff6a3a,
    spotColors: [0xff6a3a, 0x4a9aff, 0xe8e0d0],
    bio: { base: 0x5a3a1a, glow: 0xff6a3a },
    showHue: 0.05, // базовый тон светового шоу (оранж)
    floorTex: 'ground', wallTex: 'concrete',
    blocks: [],
    platforms: [],
    pads: [],
    interiors: [],
    towers: [],
    pickups: [ // мировые координаты, Y — лучом вниз после загрузки GLB
      { x: 15, z: 15, kind: 'dmr' },
      { x: -15, z: -15, kind: 'rocket' },
      { x: 0, z: 18, kind: 'lmg' },
    ],
  },
  dust2: { // «ДАСТ-2» — легендарная CS-карта de_dust2 (GLB)
    glb: 'assets/models/arena/de_dust2_-_cs_map.glb',
    fog: 0xd8c8a0, fogDensity: 0.010,
    hemiSky: 0xffe8c0, hemiGround: 0x8a7a5a, hemiInt: 1.1,
    sun: 0xfff0d0, sunInt: 2.2, rim: 0xd8b070, rimInt: 0.6,
    floor: 0xa89878, glossEmissive: 0x1a1408, veilTint: 0x8a7a5a, veilOpacity: 0.4,
    reflectorColor: 0x6a5a40,
    strip: 0xffd080,
    zoneL1: 0xffd080, zoneL2: 0xff8040,
    glareColor: 0xfff0d0, glare2Color: 0xffd080,
    particles: 0xd8c8a0, sparks: 0xffd080,
    spotColors: [0xfff0d0, 0xffd080, 0xd8b070],
    bio: { base: 0x8a7a5a, glow: 0xffd080 },
    showHue: 0.08,
    floorTex: 'ground', wallTex: 'concrete',
    blocks: [],
    platforms: [],
    pads: [],
    interiors: [],
    towers: [],
    pickups: [ // AWP центр-север, ПКМ запад, СВД восток
      { x: 10, z: 12, kind: 'awp' },
      { x: -14, z: -8, kind: 'lmg' },
      { x: 0, z: -18, kind: 'dmr' },
    ],
  },
  goldencity: { // «ЗОЛОТОЙ ГОРОД» — неоновый мегаполис (GLB)
    glb: 'assets/models/arena/gm_golden_city.glb',
    fog: 0x1a0a2a, fogDensity: 0.014,
    hemiSky: 0xffd080, hemiGround: 0x2a1a3a, hemiInt: 0.95,
    sun: 0xffe0a0, sunInt: 1.8, rim: 0xff60ff, rimInt: 0.8,
    floor: 0x2a1a3a, glossEmissive: 0x0a0518, veilTint: 0x6a4a8a, veilOpacity: 0.5,
    reflectorColor: 0x3a2a5a,
    strip: 0xffd080,
    zoneL1: 0xffd080, zoneL2: 0xff60ff,
    glareColor: 0xffe0a0, glare2Color: 0xff60ff,
    particles: 0xffd080, sparks: 0xff60ff,
    spotColors: [0xffe0a0, 0xffd080, 0xff60ff],
    bio: { base: 0x4a2a6a, glow: 0xff60ff },
    showHue: 0.85,
    floorTex: 'metalPlates', wallTex: 'metalPlates',
    blocks: [],
    platforms: [],
    pads: [],
    interiors: [],
    towers: [],
    pickups: [ // ракетница восток, огнемёт запад, AWP север
      { x: 14, z: 10, kind: 'rocket' },
      { x: -14, z: 10, kind: 'flamer' },
      { x: 0, z: -16, kind: 'awp' },
    ],
  },
};

export function buildArena(scene, physics, destruction, {
  reflector: useReflector = true, variant = 'eden', size = ARENA_SIZE,
} = {}) {
  const V = ARENA_VARIANTS[variant] || ARENA_VARIANTS.eden;
  const SIZE = size;
  const K = SIZE / ARENA_SIZE; // масштаб координат от базовой арены
  // Всё содержимое арены — в одной группе: пересборка = dispose группы
  const root = new THREE.Group();
  root.name = `arena:${variant}`;
  scene.add(root);

  const colliders = [];       // AABB статики (уже в physics)
  const destructibles = [];   // стены для destruction
  const spawns = [];          // точки спавна 3 команд
  const cashoutStations = [];
  const dynamicUpdaters = [];
  let beatNow = 0;            // пульс бита (пробрасывается в update)
  // Драйв светового шоу (заполняет main.js через update(dt, beat, show))
  const showNow = { energy: 0, phase: 0, beatPhase: 0.999, drop: 0, low: false };

  // ---------- Скачанные PBR-текстуры (ambientCG CC0; null → процедурный fallback) ----------
  const floorTexSet = V.floorTex ? getTextureSet(V.floorTex, [5, 5]) : null;
  const wallTexSet = V.wallTex ? getTextureSet(V.wallTex, [2, 2]) : null;
  const panelTexSet = getTextureSet('panel', [1, 1]);

  // ---------- Освещение ----------
  root.add(new THREE.HemisphereLight(V.hemiSky, V.hemiGround, V.hemiInt));
  const sun = new THREE.DirectionalLight(V.sun, V.sunInt);
  sun.position.set(6, 80, 12);
  root.add(sun);
  const rim = new THREE.DirectionalLight(V.rim, V.rimInt);
  rim.position.set(-25, 30, -30);
  root.add(rim);
  // Точечные акценты у зон
  const zoneLight = new THREE.PointLight(V.zoneL1, 26, 30, 2);
  zoneLight.position.set(-18 * K, 5, 14 * K);
  root.add(zoneLight);
  const zoneLight2 = new THREE.PointLight(V.zoneL2, 26, 30, 2);
  zoneLight2.position.set(18 * K, 5, -14 * K);
  root.add(zoneLight2);

  // Блик-солнце: additive-спрайты высоко в «небе» (без тяжёлого bloom)
  const glareTex = createSunGlareTexture(256);
  const glare = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glareTex, color: V.glareColor, transparent: true, opacity: 0.95,
    blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false,
  }));
  glare.scale.set(120, 120, 1);
  glare.position.set(14, 78, -34);
  glare.renderOrder = 999;
  root.add(glare);
  const glare2 = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glareTex, color: V.glare2Color, transparent: true, opacity: 0.4,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  glare2.scale.set(46, 46, 1);
  glare2.position.set(-30, 40, 50);
  root.add(glare2);
  dynamicUpdaters.push((dt, t) => {
    glare.material.opacity = 0.85 + Math.sin(t * 0.8) * 0.1 + beatNow * 0.15;
  });

  // ---------- Пол + зеркальное отражение ----------
  const floorBaseMat = flatMat(V.floor, { rough: 0.6, noCache: true });
  if (floorTexSet) {
    applyTextureSet(floorBaseMat, floorTexSet, { baseRough: 0.6, baseMetal: 0.15 });
    floorBaseMat.color.setHex(V.floor).lerp(new THREE.Color(0xffffff), 0.5);
  }
  const floorBase = new THREE.Mesh(boxGeo(SIZE, 1, SIZE), floorBaseMat);
  floorBase.position.y = -0.5;
  root.add(floorBase);
  physics.addStatic(new THREE.Vector3(-SIZE / 2, -1, -SIZE / 2), new THREE.Vector3(SIZE / 2, 0, SIZE / 2), 'floor');

  // Reflector (PS2-дешёвый: 512px, половинное разрешение)
  const reflector = new Reflector(new THREE.PlaneGeometry(SIZE, SIZE), {
    clipBias: 0.003,
    textureWidth: 512,
    textureHeight: 512,
    color: V.reflectorColor,
  });
  reflector.rotation.x = -Math.PI / 2;
  reflector.position.y = 0.001;
  reflector.visible = useReflector;
  root.add(reflector);

  // Fake-gloss пол для слабого тира (мрамор + низкая шероховатость = блики)
  // Скачанный мрамор (ambientCG): albedo+roughness; fallback — процедурный canvas.
  const marbleTex = createMarbleTexture(1024, 4);
  marbleTex.repeat.set(5, 5);
  const glossMat = new THREE.MeshStandardMaterial({
    map: marbleTex, color: V.veilTint, roughness: 0.16, metalness: 0.35,
    emissive: V.glossEmissive, emissiveIntensity: 0.35,
  });
  if (floorTexSet) {
    glossMat.map = floorTexSet.map; // albedo — скачанный; глосс (roughness 0.16) сохраняем
    if (floorTexSet.normalMap) glossMat.normalMap = floorTexSet.normalMap;
    // albedo тёмная/тёплая: tint варианта осветляем к белому, чтобы текстура читалась
    glossMat.color.setHex(V.veilTint).lerp(new THREE.Color(0xffffff), 0.6);
    glossMat.needsUpdate = true;
  }
  const glossFloor = new THREE.Mesh(new THREE.PlaneGeometry(SIZE, SIZE), glossMat);
  glossFloor.rotation.x = -Math.PI / 2;
  glossFloor.position.y = 0.001;
  glossFloor.visible = !useReflector;
  root.add(glossFloor);

  // Мраморная вуаль поверх отражения (полупрозрачная: отражение просвечивает)
  const veilMat = new THREE.MeshStandardMaterial({
    map: marbleTex, color: V.veilTint, transparent: true, opacity: V.veilOpacity,
    roughness: 0.35, metalness: 0.08, depthWrite: false,
  });
  if (floorTexSet) {
    veilMat.map = floorTexSet.map;
    if (floorTexSet.roughnessMap) { veilMat.roughnessMap = floorTexSet.roughnessMap; veilMat.roughness = 1.0; }
    if (floorTexSet.normalMap) veilMat.normalMap = floorTexSet.normalMap;
    veilMat.color.setHex(V.veilTint).lerp(new THREE.Color(0xffffff), 0.6);
    veilMat.needsUpdate = true;
  }
  const marbleVeil = new THREE.Mesh(new THREE.PlaneGeometry(SIZE, SIZE), veilMat);
  marbleVeil.rotation.x = -Math.PI / 2;
  marbleVeil.position.y = 0.02;
  root.add(marbleVeil);

  // Переключение отражения (авто-качество)
  function setReflector(on) {
    reflector.visible = !!on;
    glossFloor.visible = !on;
  }

  // Декоративные полосы пола
  const stripMat = flatMat(V.strip, { emissive: V.strip, ei: 1.1 });
  for (let i = -1; i <= 1; i++) {
    const strip = new THREE.Mesh(boxGeo(SIZE * 0.9, 0.02, 0.15), stripMat);
    strip.position.set(0, 0.03, i * 18 * K);
    root.add(strip);
  }

  // ---------- Периметр: стены-руины (частично разрушаемые) ----------
  const half = SIZE / 2;
  function perimeterWall(x, z, rotY, len = 20, h = 6) {
    const wall = createDestructibleWall({ width: len, height: h, cols: 10, rows: 5, depth: 0.8, tex: wallTexSet });
    wall.group.position.set(x, 0, z);
    wall.group.rotation.y = rotY;
    root.add(wall.group);
    destruction.registerWall(wall);
    destructibles.push(wall);
    return wall;
  }
  // По периметру — сегменты с проходами
  perimeterWall(-half + 10 * K, -half + 0.4, 0, 20 * K, 6);
  perimeterWall(half - 10 * K, -half + 0.4, 0, 20 * K, 6);
  perimeterWall(-half + 0.4, -half + 16 * K, Math.PI / 2, 12 * K, 6);
  perimeterWall(-half + 0.4, half - 16 * K, Math.PI / 2, 12 * K, 6);
  perimeterWall(half - 0.4, -half + 16 * K, -Math.PI / 2, 12 * K, 6);
  perimeterWall(half - 0.4, half - 16 * K, -Math.PI / 2, 12 * K, 6);
  perimeterWall(-half + 12 * K, half - 0.4, Math.PI, 16 * K, 5);
  perimeterWall(half - 12 * K, half - 0.4, Math.PI, 16 * K, 5);

  // ---------- БИОХАЗАРД-декали (в psy-break светятся) ----------
  const bioDecals = [];
  function addBioDecal(x, y, z, rotY, size = 6) {
    const d = createBiohazardDecal(size);
    d.position.set(x, y, z);
    d.rotation.y = rotY;
    root.add(d);
    bioDecals.push(d);
    return d;
  }
  addBioDecal(-half + 17 * K, 3.4, -half + 0.86, 0, 7);            // большая на северной стене
  addBioDecal(half - 0.86, 3.2, -half + 16 * K, -Math.PI / 2, 5.5); // восточная
  addBioDecal(-half + 0.86, 3.2, half - 16 * K, Math.PI / 2, 5.5);  // западная
  addBioDecal(half - 12 * K, 2.8, half - 0.86, Math.PI, 5);        // южная

  // Psy-break: биохазард светится (оттенки — по варианту арены)
  const _bioBase = new THREE.Color(V.bio.base);
  const _bioGlow = new THREE.Color(V.bio.glow);
  function setPsy(v) {
    for (const d of bioDecals) {
      d.material.color.copy(_bioBase).lerp(_bioGlow, v);
      if (v > 0.01) d.material.color.multiplyScalar(1 + v * 1.6); // HDR-свечение через тонмаппинг
      d.material.opacity = 0.92 + v * 0.08;
    }
  }

  // ---------- Центральные разрушаемые блоки-здания ----------
  const centerWalls = []; // для «пересборки» арены режимом
  const edgeStripMat = flatMat(V.strip, { emissive: V.strip, ei: 1.6, noCache: true });
  function buildingBlock(x, z, rotY) {
    const w1 = createDestructibleWall({ width: 8, height: 4, cols: 8, rows: 4, depth: 0.6, tex: wallTexSet });
    w1.group.position.set(x, 0, z - 4);
    w1.group.rotation.y = rotY;
    const w2 = createDestructibleWall({ width: 8, height: 4, cols: 8, rows: 4, depth: 0.6, tex: wallTexSet });
    w2.group.position.set(x, 0, z + 4);
    w2.group.rotation.y = rotY;
    const w3 = createDestructibleWall({ width: 8, height: 4, cols: 8, rows: 4, depth: 0.6, tex: wallTexSet });
    w3.group.position.set(x - 4, 0, z);
    w3.group.rotation.y = rotY + Math.PI / 2;
    for (const w of [w1, w2, w3]) {
      root.add(w.group);
      destruction.registerWall(w);
      destructibles.push(w);
      centerWalls.push(w);
    }
    // Крыша-платформа (статика, пока опоры живы; обрушается при потере 2+ стен)
    const roof = createPlatform(8.6, 8.6, 0.4);
    roof.position.set(x, 4, z);
    roof.rotation.y = rotY;
    root.add(roof);
    const roofCollider = physics.addStatic(new THREE.Vector3(x - 4.3, 4, z - 4.3), new THREE.Vector3(x + 4.3, 4.4, z + 4.3), 'roof');
    // Светящиеся канты крыши (PS2-читаемость силуэта в темноте)
    for (const [lx, lz, ew, ed] of [[0, -4.30, 8.7, 0.1], [0, 4.30, 8.7, 0.1], [-4.30, 0, 0.1, 8.7], [4.30, 0, 0.1, 8.7]]) {
      const es = new THREE.Mesh(boxGeo(ew, 0.05, ed), edgeStripMat);
      es.position.set(lx, 0.23, lz);
      roof.add(es);
    }
    // Фишка геймплея: крыша зависит от опор (destruction следит и роняет)
    destruction.registerRoof({ walls: [w1, w2, w3], mesh: roof, collider: roofCollider, physics });
    return { x, z };
  }
  for (const [bx, bz, brot] of V.blocks) buildingBlock(bx * K, bz * K, brot);

  // ---------- МНОГОЭТАЖНЫЕ РАЗРУШАЕМЫЕ БАШНИ (панельки СНГ / рёбра ада) ----------
  // Каждый этаж: 4 стены-чанка + плита; плита этажа обрушается при потере 2+
  // стен этого этажа (registerRoof), обломки падают физически.
  function panelTower(x, z, rotY, floors = 3) {
    const W = 8, H = 3, D = 0.55;
    for (let f = 0; f < floors; f++) {
      const yBase = f * H;
      const floorWalls = [];
      for (const [ox, oz, ry] of [[0, -W / 2, 0], [0, W / 2, 0], [-W / 2, 0, Math.PI / 2], [W / 2, 0, Math.PI / 2]]) {
        const w = createDestructibleWall({ width: W, height: H, cols: 8, rows: 3, depth: D, tex: wallTexSet });
        const lx = ox * Math.cos(rotY) - oz * Math.sin(rotY);
        const lz = ox * Math.sin(rotY) + oz * Math.cos(rotY);
        w.group.position.set(x + lx, yBase, z + lz);
        w.group.rotation.y = rotY + ry;
        root.add(w.group);
        destruction.registerWall(w);
        destructibles.push(w);
        floorWalls.push(w);
      }
      // Плита этажа (над стенами этого этажа)
      const slab = createPlatform(W + 0.7, W + 0.7, 0.4);
      slab.position.set(x, yBase + H, z);
      slab.rotation.y = rotY;
      root.add(slab);
      const slabCol = physics.addStatic(
        new THREE.Vector3(x - (W + 0.7) / 2, yBase + H, z - (W + 0.7) / 2),
        new THREE.Vector3(x + (W + 0.7) / 2, yBase + H + 0.4, z + (W + 0.7) / 2), 'tower-slab');
      destruction.registerRoof({ walls: floorWalls, mesh: slab, collider: slabCol, physics });
    }
  }
  for (const [tx, tz, tr, tf] of V.towers || []) panelTower(tx * K, tz * K, tr, tf);

  // ---------- УЗКИЕ ИНТЕРЬЕРЫ (коридоры The Finals: теснота vs открытые зоны) ----------
  // П-образный коридор 10×2.4м: две длинные стены + торец с дверным проёмом,
  // статичный потолок на 3.1м. Стены разрушаемые — проходы можно «пробить».
  function interiorBlock(x, z, rotY) {
    const LEN = 10, GAP = 2.4, H = 3.1, DOOR = 2.2;
    const mk = (lx, lz, ry, w) => {
      const wall = createDestructibleWall({ width: w, height: H, cols: Math.max(4, Math.round(w)), rows: 3, depth: 0.5, tex: wallTexSet });
      const wx = x + lx * Math.cos(rotY) - lz * Math.sin(rotY);
      const wz = z + lx * Math.sin(rotY) + lz * Math.cos(rotY);
      wall.group.position.set(wx, 0, wz);
      wall.group.rotation.y = rotY + ry;
      root.add(wall.group);
      destruction.registerWall(wall);
      destructibles.push(wall);
    };
    // Длинные стороны
    mk(0, -GAP / 2 - 0.25, 0, LEN);
    mk(0, GAP / 2 + 0.25, 0, LEN);
    // Торец с дверным проёмом (два сегмента по краям)
    const seg = (GAP + 0.5 - DOOR) / 2;
    mk(-LEN / 2 - 0.25, -(DOOR / 2 + seg / 2), Math.PI / 2, seg);
    mk(-LEN / 2 - 0.25, DOOR / 2 + seg / 2, Math.PI / 2, seg);
    // Потолок (статик — по крыше можно бегать, waypoints лягут сверху)
    const ceil = createPlatform(LEN + 1, GAP + 1.6, 0.35);
    ceil.position.set(x, H, z);
    ceil.rotation.y = rotY;
    root.add(ceil);
    physics.addStatic(
      new THREE.Vector3(x - (LEN + 1) / 2, H, z - (GAP + 1.6) / 2),
      new THREE.Vector3(x + (LEN + 1) / 2, H + 0.35, z + (GAP + 1.6) / 2), 'interior-ceil');
  }
  for (const [ix, iz, ir] of V.interiors || []) interiorBlock(ix * K, iz * K, ir);

  // ---------- ДЖАМП-ПАДЫ (The Finals: мощные подбросы на уровни карты) ----------
  // МЕГА-пады (power ≥ 20): больше диск, выше колонна шевронов, шире радиус.
  const jumpPads = [];
  for (const pd of V.pads || []) {
    const px = pd.x * K, pz = pd.z * K;
    const mega = pd.power >= 20;
    const R = mega ? 2.1 : 1.5;
    const g = new THREE.Group();
    g.position.set(px, 0, pz);
    // светящийся диск
    const discMat = flatMat(V.strip, { emissive: V.strip, ei: mega ? 2.6 : 1.8, noCache: true });
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(R, R * 1.13, 0.14, 18), discMat);
    disc.position.y = 0.07;
    g.add(disc);
    const ringM = new THREE.Mesh(
      new THREE.RingGeometry(R + 0.05, R + 0.35, 24),
      new THREE.MeshBasicMaterial({ color: V.zoneL2, transparent: true, opacity: 0.8, side: THREE.DoubleSide }));
    ringM.rotation.x = -Math.PI / 2;
    ringM.position.y = 0.05;
    g.add(ringM);
    // шевроны, бегущие вверх (подсказка «сюда запустит»)
    const chevMat = new THREE.MeshBasicMaterial({
      color: V.zoneL2, transparent: true, opacity: 0.75,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const chevrons = [];
    const chevCount = mega ? 6 : 3;
    for (let ci = 0; ci < chevCount; ci++) {
      const ch = new THREE.Mesh(new THREE.ConeGeometry(mega ? 0.55 : 0.42, 0.34, 4), chevMat.clone());
      ch.rotation.x = 0; ch.rotation.y = Math.PI / 4;
      g.add(ch);
      chevrons.push(ch);
    }
    root.add(g);
    const seed = px * 0.7 + pz * 1.3;
    const span = mega ? 5.2 : 2.6; // высота колонны шевронов
    dynamicUpdaters.push((dt, t) => {
      discMat.emissiveIntensity = (mega ? 2.2 : 1.5) + Math.sin(t * 3 + seed) * 0.5 + beatNow * 0.7;
      for (let ci = 0; ci < chevrons.length; ci++) {
        const ph = (t * (mega ? 1.8 : 1.4) + seed + ci / chevrons.length) % 1;
        chevrons[ci].position.y = 0.4 + ph * span;
        chevrons[ci].material.opacity = 0.85 * (1 - ph);
      }
    });
    jumpPads.push({ x: px, y: 0, z: pz, r: mega ? 2.4 : 1.7, power: pd.power });
  }

  // ---------- Колонны ----------
  const columnPositions = [[-22, 12], [22, -6], [-8, 20], [8, -22], [0, 12], [-20, -20]];
  for (const [cx, cz] of columnPositions) {
    const x = cx * K, z = cz * K;
    const col = createColumn(7, 0.7);
    col.position.set(x, 0, z);
    root.add(col);
    physics.addStatic(new THREE.Vector3(x - 0.8, 0, z - 0.8), new THREE.Vector3(x + 0.8, 7, z + 0.8), 'column');
  }

  // ---------- Платформы (вертикальный геймплей) ----------
  for (const p of V.platforms) {
    const px = p.x * K, pz = p.z * K;
    const plat = createPlatform(p.w, p.d, 0.35);
    plat.position.set(px, p.y, pz);
    root.add(plat);
    // светящийся кант по периметру (читаемость в темноте)
    for (const [lx, lz, ew, ed] of [[0, -p.d / 2, p.w, 0.08], [0, p.d / 2, p.w, 0.08], [-p.w / 2, 0, 0.08, p.d], [p.w / 2, 0, 0.08, p.d]]) {
      const es = new THREE.Mesh(boxGeo(ew, 0.04, ed), edgeStripMat);
      es.position.set(lx, 0.19, lz);
      plat.add(es);
    }
    physics.addStatic(
      new THREE.Vector3(px - p.w / 2, p.y, pz - p.d / 2),
      new THREE.Vector3(px + p.w / 2, p.y + 0.35, pz + p.d / 2), 'platform');
    if (p.float) {
      // ПАРЯЩАЯ плита (The Finals): без опор, медленная левитация ±0.12
      // (физика — статик на базовой высоте, качание чисто визуальное, незаметно ногам)
      const seedF = px * 1.7 + pz * 0.9;
      dynamicUpdaters.push((dt, t) => {
        plat.position.y = p.y + Math.sin(t * 0.9 + seedF) * 0.12;
        plat.rotation.y = Math.sin(t * 0.23 + seedF) * 0.03;
      });
      // левитирующее свечение под плитой
      const glowR = Math.min(p.w, p.d) * 0.42;
      const glow = new THREE.Mesh(
        new THREE.CircleGeometry(glowR, 20),
        new THREE.MeshBasicMaterial({
          color: V.zoneL2, transparent: true, opacity: 0.16,
          blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
        }));
      glow.rotation.x = -Math.PI / 2;
      glow.position.set(px, 0.06, pz);
      root.add(glow);
      dynamicUpdaters.push((dt, t) => {
        glow.material.opacity = 0.12 + Math.sin(t * 1.8 + seedF) * 0.05 + beatNow * 0.1;
      });
    } else {
      // Опоры (светлый бетон; со скачанной текстурой — PBR)
      const supMat = flatMat(0xc4c7d2, { rough: 0.7, metal: 0.05, noCache: true });
      if (wallTexSet) applyTextureSet(supMat, wallTexSet, { baseRough: 0.7, baseMetal: 0.05 });
      const sup = new THREE.Mesh(boxGeo(0.4, p.y, 0.4), supMat);
      sup.position.set(px, p.y / 2, pz);
      root.add(sup);
    }
  }

  // ---------- КРИСТАЛЛИЧЕСКИЙ ВЗРЫВ (центр арены) ----------
  // Эпицентр чуть приподнят: кешбокс парит под ним (спавн кешбокса не трогаем —
  // он синхронизирован с MP-сервером).
  const explosion = createCrystalExplosion({ count: 110, radius: 15 * K });
  explosion.group.position.set(0, 1.3, -2 * K);
  root.add(explosion.group);
  dynamicUpdaters.push((dt, t) => explosion.update(dt, t, beatNow));

  // ---------- Зоны-объективы A/B/C ----------
  const zoneDefs = [
    { letter: 'A', x: -18, z: 14, color: 0xff2d55 },
    { letter: 'B', x: 0, z: -2, color: 0xa05cff },
    { letter: 'C', x: 18, z: -14, color: 0x2dd4ff },
  ];
  const objectives = [];
  for (const zd of zoneDefs) {
    const zone = createObjectiveZone(zd.letter, zd.color, panelTexSet);
    zone.position.set(zd.x * K, 0, zd.z * K);
    root.add(zone);
    objectives.push({ letter: zd.letter, pos: new THREE.Vector3(zd.x * K, 0, zd.z * K), zone });
    dynamicUpdaters.push((dt, t) => {
      zone.userData.ring.material.opacity = 0.4 + Math.sin(t * 2.5) * 0.2;
      zone.userData.flag.rotation.y = t * 0.8;
    });
  }

  // ---------- Кешаут-станции (3 шт) ----------
  const stationDefs = [
    { letter: 'A', x: -24, z: -18 },
    { letter: 'B', x: 24, z: 18 },
    { letter: 'C', x: 20, z: 22 },
  ];
  for (const sd of stationDefs) {
    const st = createCashoutStation(sd.letter, panelTexSet);
    st.position.set(sd.x * K, 0, sd.z * K);
    root.add(st);
    physics.addStatic(new THREE.Vector3(sd.x * K - 0.7, 0, sd.z * K - 0.7), new THREE.Vector3(sd.x * K + 0.7, 1.3, sd.z * K + 0.7), 'station');
    cashoutStations.push({ letter: sd.letter, pos: new THREE.Vector3(sd.x * K, 0, sd.z * K), station: st });
    dynamicUpdaters.push((dt, t) => {
      const holo = st.userData.holo;
      holo.rotation.y = t * 1.5;
      holo.position.y = 2.1 + Math.sin(t * 2 + sd.x) * 0.15;
    });
  }

  // ---------- Кешбокс в центре (под эпицентром взрыва) ----------
  const cashbox = createCashbox();
  const cashboxSpawn = new THREE.Vector3(0, 0.4, -2 * K);
  cashbox.position.copy(cashboxSpawn);
  root.add(cashbox);
  dynamicUpdaters.push((dt, t) => {
    cashbox.rotation.y = t * 0.9;
    // freeY задаёт режим (носитель/станция); иначе — парение над точкой спавна
    if (cashbox.userData.freeY == null) {
      cashbox.position.y = cashboxSpawn.y + Math.sin(t * 1.8) * 0.12;
    }
  });

  // ---------- Спавны 3 команд (треугольник) ----------
  const R = 24 * K;
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + Math.PI / 2;
    const pos = new THREE.Vector3(Math.cos(a) * R, 0.1, Math.sin(a) * R);
    const yaw = Math.atan2(-(0 - pos.x), -(0 - pos.z)); // смотрим в центр
    spawns.push({ team: i, pos, yaw });
    // Маркер спавна
    const marker = new THREE.Mesh(
      new THREE.RingGeometry(0.8, 1.1, 20),
      new THREE.MeshBasicMaterial({ color: [0xff2d55, 0xa05cff, 0x2dd4ff][i], transparent: true, opacity: 0.5, side: THREE.DoubleSide }),
    );
    marker.rotation.x = -Math.PI / 2;
    marker.position.set(pos.x, 0.04, pos.z);
    root.add(marker);
  }

  // ---------- GLB-арена (вариант 'ruins'): асинхронная загрузка внешней карты ----------
  // Подгружаем GLB, масштабируем под SIZE, извлекаем коллизии в physics,
  // заменяем спавны/зоны/станции на GLB-точки. Процедурные элементы варианта
  // ruins пусты (blocks/platforms/pads/interiors/towers = []), так что
  // процедурная база не мешает.
  let glbArena = null;
  if (V.glb) {
    loadGLBArena(V.glb, SIZE).then((arena) => {
      glbArena = arena;
      root.add(arena.scene);
      applyGLBPhysics(physics, arena);
      if (arena.spawns?.length) {
        spawns.length = 0;
        for (const s of arena.spawns) spawns.push({ team: s.team, pos: s.pos.clone(), yaw: s.yaw });
      }
      if (arena.zones?.length) {
        objectives.length = 0;
        for (const z of arena.zones) {
          const zone = createObjectiveZone(z.letter, 0xff6a3a, panelTexSet);
          zone.position.copy(z.pos);
          root.add(zone);
          objectives.push({ letter: z.letter, pos: z.pos.clone(), zone });
        }
      }
      // Пикапы оружия на GLB-карте: Y — лучом вниз по геометрии карты
      for (const pd of (V.pickups || DEFAULT_PICKUPS)) {
        const px = pd.x * K, pz = pd.z * K;
        addWeaponPickup(px, findFloorY(arena, px, pz), pz, pd.kind);
      }
    }).catch((err) => {
      console.error('[arena] GLB load failed, fallback to procedural:', err);
    });
  }

  // ---------- Фон: гигантские руины небоскрёбов ----------
  const towers = [
    { x: -70, z: -60, w: 14, h: 85, d: 14 }, { x: 65, z: -70, w: 12, h: 72, d: 12 },
    { x: -75, z: 40, w: 16, h: 100, d: 16 }, { x: 70, z: 60, w: 10, h: 64, d: 10 },
    { x: 0, z: -85, w: 18, h: 90, d: 14 }, { x: -40, z: 80, w: 12, h: 76, d: 12 },
    { x: 55, z: 5, w: 10, h: 58, d: 10 }, { x: -55, z: -15, w: 11, h: 66, d: 11 },
  ];
  for (const t of towers) {
    const tower = createRuinedTower(t.w, t.h, t.d);
    tower.position.set(t.x, 0, t.z);
    tower.rotation.y = Math.random() * Math.PI;
    root.add(tower);
  }

  // ---------- Кристаллические всплески ----------
  const spikePositions = [[-26, 8], [26, 4], [10, 24], [-12, -26], [26, -24], [-4, -20]];
  for (const [sx, sz] of spikePositions) {
    const spike = createCrystalSpike(2.5 + Math.random() * 3);
    spike.position.set(sx * K, 0, sz * K);
    root.add(spike);
  }

  // ---------- Черепа-украшения ----------
  for (let i = 0; i < 10; i++) {
    const skull = createSkull(0.25 + Math.random() * 0.15);
    skull.position.set((Math.random() - 0.5) * 50 * K, 0, (Math.random() - 0.5) * 50 * K);
    skull.rotation.y = Math.random() * Math.PI * 2;
    root.add(skull);
  }

  // ---------- Пропсы по варианту (PS2-детализация силуэтов) ----------
  if (variant === 'shrine') {
    // Тории-ворота 鳥居: 4 штуки по сторонам света, тёмное дерево + неон
    const toriiMat = flatMat(0x380c06, { rough: 0.6, metal: 0.25, noCache: true });
    const toriiNeon = flatMat(0xff5a2a, { emissive: 0xff5a2a, ei: 1.9 });
    for (const [tx, tz, tr] of [[0, 22, 0], [0, -22, Math.PI], [-22, 0, Math.PI / 2], [22, 0, -Math.PI / 2]]) {
      const g = new THREE.Group();
      g.position.set(tx * K, 0, tz * K);
      g.rotation.y = tr;
      for (const sx of [-1.9, 1.9]) {
        const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.30, 5.4, 8), toriiMat);
        pillar.position.set(sx, 2.7, 0);
        g.add(pillar);
        physics.addStatic(
          new THREE.Vector3(tx * K + sx - 0.3, 0, tz * K - 0.3),
          new THREE.Vector3(tx * K + sx + 0.3, 5.4, tz * K + 0.3), 'torii');
      }
      const kasagi = new THREE.Mesh(boxGeo(5.6, 0.42, 0.55), toriiMat);
      kasagi.position.y = 5.5;
      g.add(kasagi);
      const kasagiNeon = new THREE.Mesh(boxGeo(5.7, 0.07, 0.60), toriiNeon);
      kasagiNeon.position.y = 5.26;
      g.add(kasagiNeon);
      const nuki = new THREE.Mesh(boxGeo(4.4, 0.26, 0.3), toriiMat);
      nuki.position.y = 4.3;
      g.add(nuki);
      root.add(g);
    }
    // Фонари-тёро: светящиеся шары на столбиках вдоль ступеней
    const postMat = flatMat(0x2a1408, { rough: 0.7, metal: 0.2, noCache: true });
    for (const [lx, lz] of [[-8, 4], [8, 4], [-4, -10], [4, -10], [-14, -8], [14, -8]]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.10, 1.6, 6), postMat);
      post.position.set(lx * K, 0.8, lz * K);
      root.add(post);
      const lampMat = flatMat(0xffc890, { emissive: 0xffa050, ei: 2.2, noCache: true });
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.30, 10, 8), lampMat);
      lamp.position.set(lx * K, 1.85, lz * K);
      lamp.scale.y = 1.25;
      root.add(lamp);
      dynamicUpdaters.push((dt, t) => {
        lamp.material.emissiveIntensity = 1.8 + Math.sin(t * 5 + lx) * 0.35 + beatNow * 0.6;
      });
    }
  }
  if (variant === 'abyss') {
    // Висячие цепи с крюками — хоррор-ритм, покачиваются
    const chainMat = flatMat(0x3a3f4a, { metal: 0.8, rough: 0.35, noCache: true });
    const hookMat = flatMat(0xff2d55, { emissive: 0xff2d55, ei: 1.4 });
    for (let i = 0; i < 12; i++) {
      const cx = (Math.random() - 0.5) * 44 * K;
      const cz = (Math.random() - 0.5) * 44 * K;
      const top = 9 + Math.random() * 3;
      const links = 5 + Math.floor(Math.random() * 4);
      const chain = new THREE.Group();
      chain.position.set(cx, top, cz);
      for (let li = 0; li < links; li++) {
        const link = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.028, 5, 8), chainMat);
        link.position.y = -li * 0.16;
        link.rotation.y = (li % 2) * Math.PI / 2;
        chain.add(link);
      }
      if (Math.random() < 0.6) {
        const hook = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.34, 6), hookMat);
        hook.position.y = -links * 0.16 - 0.12;
        hook.rotation.x = Math.PI;
        chain.add(hook);
      }
      root.add(chain);
      const seed = i * 1.37;
      dynamicUpdaters.push((dt, t) => {
        chain.rotation.x = Math.sin(t * 0.9 + seed) * 0.06;
        chain.rotation.z = Math.cos(t * 0.7 + seed * 2) * 0.06;
      });
    }
    // Трубы вдоль пола — индустриальная бездна
    const pipeMat = flatMat(0x232630, { metal: 0.7, rough: 0.45, noCache: true });
    for (const [px, pz, pr] of [[-16, 20, 0.4], [18, -18, -0.7], [-24, -14, 1.2], [10, 24, 0.9]]) {
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 14, 8), pipeMat);
      pipe.position.set(px * K, 0.35, pz * K);
      pipe.rotation.z = Math.PI / 2;
      pipe.rotation.y = pr;
      root.add(pipe);
      physics.addStatic(
        new THREE.Vector3(px * K - 2.5, 0, pz * K - 0.4),
        new THREE.Vector3(px * K + 2.5, 0.7, pz * K + 0.4), 'pipe');
    }
  }

  // ---------- Пропсы «РАЯ-7»: стеклянные монолиты, золотые кольца, сады ----------
  if (variant === 'eden') {
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0xbfe8ff, transparent: true, opacity: 0.32,
      metalness: 0.9, roughness: 0.06, emissive: 0x7ac8ff, emissiveIntensity: 0.12,
    });
    for (const [mx, mz, mh] of [[-8, -18, 6], [10, 20, 7.5], [22, -6, 5], [-24, -14, 6.5]]) {
      const mono = new THREE.Mesh(boxGeo(1.6, mh, 1.6), glassMat);
      mono.position.set(mx * K, mh / 2, mz * K);
      root.add(mono);
      physics.addStatic(
        new THREE.Vector3(mx * K - 0.8, 0, mz * K - 0.8),
        new THREE.Vector3(mx * K + 0.8, mh, mz * K + 0.8), 'monolith');
    }
    // Парящие золотые кольца
    const goldMat = flatMat(0xffd77a, { emissive: 0xffd77a, ei: 1.4, metal: 0.9, rough: 0.2, noCache: true });
    for (const [gx, gz, gr] of [[0, -2, 4.5], [-18, 2, 3], [18, -14, 3.5]]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(gr, 0.12, 8, 32), goldMat);
      ring.position.set(gx * K, 6.5 + gr * 0.4, gz * K);
      root.add(ring);
      const seedR = gx * 1.1;
      dynamicUpdaters.push((dt, t) => {
        ring.rotation.y = t * 0.35 + seedR;
        ring.rotation.x = Math.sin(t * 0.5 + seedR) * 0.25;
        ring.position.y = 6.5 + gr * 0.4 + Math.sin(t * 0.7 + seedR) * 0.4;
      });
    }
    // Сады: зелёные шары-кроны на белых колоннах
    const leafMat = flatMat(0x7ac86a, { rough: 0.8, noCache: true });
    const trunkMat = flatMat(0xf0f0f4, { rough: 0.5, noCache: true });
    for (const [tx2, tz2] of [[-10, 18], [12, -20], [-26, 6], [24, 22], [6, 24]]) {
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.2, 2.4, 7), trunkMat);
      trunk.position.set(tx2 * K, 1.2, tz2 * K);
      root.add(trunk);
      const crown = new THREE.Mesh(new THREE.SphereGeometry(1.1 + Math.random() * 0.5, 10, 8), leafMat);
      crown.position.set(tx2 * K, 2.9, tz2 * K);
      crown.scale.y = 0.85;
      root.add(crown);
      physics.addStatic(
        new THREE.Vector3(tx2 * K - 0.25, 0, tz2 * K - 0.25),
        new THREE.Vector3(tx2 * K + 0.25, 2.4, tz2 * K + 0.25), 'tree');
    }
  }

  // ---------- Пропсы «ГЕЕННЫ»: биомасса (пульсирующие цисты, щупальца, рёбра) ----------
  if (variant === 'hell') {
    const cystMat = new THREE.MeshStandardMaterial({
      color: 0x6a1220, roughness: 0.45, metalness: 0.1,
      emissive: 0xa01020, emissiveIntensity: 0.5,
    });
    const cysts = [];
    for (const [bx2, bz2, br] of [[-16, 18, 1.6], [14, 2, 2.2], [-6, -16, 1.9], [20, 20, 1.4], [-22, -18, 2.4], [4, 4, 1.2]]) {
      const cyst = new THREE.Mesh(new THREE.SphereGeometry(br, 12, 9), cystMat.clone());
      cyst.position.set(bx2 * K, br * 0.62, bz2 * K);
      cyst.scale.y = 0.72;
      root.add(cyst);
      cysts.push({ m: cyst, seed: bx2 * 2.3 + bz2, r: br });
      physics.addStatic(
        new THREE.Vector3(bx2 * K - br * 0.8, 0, bz2 * K - br * 0.8),
        new THREE.Vector3(bx2 * K + br * 0.8, br * 1.1, bz2 * K + br * 0.8), 'cyst');
    }
    dynamicUpdaters.push((dt, t) => {
      for (const c of cysts) {
        const p = 1 + Math.sin(t * 1.7 + c.seed) * 0.07 + beatNow * 0.05;
        c.m.scale.set(p, 0.72 * (2 - p), p);
        c.m.material.emissiveIntensity = 0.4 + Math.sin(t * 2.3 + c.seed) * 0.2 + beatNow * 0.5;
      }
    });
    // Щупальца из пола
    const tentMat = new THREE.MeshStandardMaterial({ color: 0x4a0c18, roughness: 0.55, emissive: 0x701018, emissiveIntensity: 0.4 });
    const tents = [];
    for (const [tx3, tz3, th] of [[-10, 6, 5], [8, -8, 6], [-2, 20, 4.5], [16, -20, 5.5], [-18, -8, 4]]) {
      const tent = new THREE.Mesh(new THREE.ConeGeometry(0.5, th, 7), tentMat);
      tent.position.set(tx3 * K, th / 2, tz3 * K);
      tent.rotation.z = (Math.random() - 0.5) * 0.5;
      root.add(tent);
      tents.push({ m: tent, seed: tx3 });
      physics.addStatic(
        new THREE.Vector3(tx3 * K - 0.5, 0, tz3 * K - 0.5),
        new THREE.Vector3(tx3 * K + 0.5, th * 0.8, tz3 * K + 0.5), 'tentacle');
    }
    dynamicUpdaters.push((dt, t) => {
      for (const tn of tents) {
        tn.m.rotation.x = Math.sin(t * 0.8 + tn.seed) * 0.12;
        tn.m.rotation.z = Math.cos(t * 0.6 + tn.seed) * 0.12;
      }
    });
    // Рёберные арки над ареной (мегаструктура-скелет)
    const ribMat = flatMat(0x2a0a12, { rough: 0.5, metal: 0.3, noCache: true });
    for (const [rx, rz, rr, ry] of [[0, -24, 14, 0], [-26, 0, 12, Math.PI / 2], [24, 12, 11, 0.4]]) {
      const rib = new THREE.Mesh(new THREE.TorusGeometry(rr, 0.55, 7, 20, Math.PI), ribMat);
      rib.position.set(rx * K, 0, rz * K);
      rib.rotation.y = ry;
      root.add(rib);
    }
    // Лавовые трещины (светящиеся полосы пола)
    const lavaMat = flatMat(0xff5a1a, { emissive: 0xff4a10, ei: 2.0, noCache: true });
    for (const [lx2, lz2, lr, ll] of [[-12, -4, 0.5, 9], [6, 14, -0.8, 7], [18, -6, 1.2, 8], [-20, 12, 0.2, 6]]) {
      const crack = new THREE.Mesh(boxGeo(ll, 0.03, 0.28), lavaMat);
      crack.position.set(lx2 * K, 0.035, lz2 * K);
      crack.rotation.y = lr;
      root.add(crack);
    }
  }

  // ---------- Пропсы «СЕКТОРА-9»: стеклянный люкс, киоски, кондиционеры ----------
  if (variant === 'sng') {
    // Стеклянная люкс-высотка (статика, синее стекло + светящиеся окна)
    const luxMat = new THREE.MeshStandardMaterial({
      color: 0x3a6a9a, transparent: true, opacity: 0.55,
      metalness: 0.95, roughness: 0.08, emissive: 0x1a3a5c, emissiveIntensity: 0.3,
    });
    const lux = new THREE.Mesh(boxGeo(7, 22, 7), luxMat);
    lux.position.set(26 * K, 11, 20 * K);
    root.add(lux);
    physics.addStatic(new THREE.Vector3(26 * K - 3.5, 0, 20 * K - 3.5), new THREE.Vector3(26 * K + 3.5, 22, 20 * K + 3.5), 'lux');
    const winMat = flatMat(0xcfe8ff, { emissive: 0xbfe0ff, ei: 1.2, noCache: true });
    for (let wy = 2; wy < 21; wy += 2.4) {
      for (const face of [0, 1]) {
        const strip2 = new THREE.Mesh(boxGeo(6.2, 0.5, 0.06), winMat);
        strip2.position.set(26 * K, wy, 20 * K + (face === 0 ? 3.54 : -3.54));
        root.add(strip2);
      }
    }
    // Киоски у панелек
    const kioskMat = flatMat(0x4a5a6a, { rough: 0.7, metal: 0.2, noCache: true });
    const kioskRoof = flatMat(0xffd77a, { emissive: 0xffd77a, ei: 0.7, noCache: true });
    for (const [kx, kz, kr] of [[-8, -18, 0.2], [6, 18, -0.3]]) {
      const kb = new THREE.Mesh(boxGeo(2.6, 2.3, 2.2), kioskMat);
      kb.position.set(kx * K, 1.15, kz * K);
      kb.rotation.y = kr;
      root.add(kb);
      const kr2 = new THREE.Mesh(boxGeo(3.0, 0.18, 2.6), kioskRoof);
      kr2.position.set(kx * K, 2.4, kz * K);
      kr2.rotation.y = kr;
      root.add(kr2);
      physics.addStatic(
        new THREE.Vector3(kx * K - 1.3, 0, kz * K - 1.1),
        new THREE.Vector3(kx * K + 1.3, 2.4, kz * K + 1.1), 'kiosk');
    }
    // Кондиционеры/спутниковые на фасадах панелек (деталь)
    const acMat = flatMat(0x9aa4b0, { rough: 0.6, metal: 0.4, noCache: true });
    for (const [ax, az] of [[-22, 14.4], [-18.4, 22], [14.4, -24], [22.4, -16]]) {
      const ac = new THREE.Mesh(boxGeo(0.9, 0.7, 0.5), acMat);
      ac.position.set(ax * K, 2.2 + Math.random() * 3, az * K);
      root.add(ac);
    }
    // Детская горка во дворе (СНГ-вайб, укрытие)
    const slideMat = flatMat(0xc83a4a, { rough: 0.5, metal: 0.5, noCache: true });
    const slide = new THREE.Mesh(boxGeo(0.8, 0.12, 3.4), slideMat);
    slide.position.set(-2 * K, 0.8, 20 * K);
    slide.rotation.x = -0.45;
    root.add(slide);
    const slideTop = new THREE.Mesh(boxGeo(1.0, 1.6, 1.0), slideMat);
    slideTop.position.set(-2 * K, 0.8, 21.6 * K);
    root.add(slideTop);
    physics.addStatic(new THREE.Vector3(-2 * K - 0.5, 0, 21.2 * K), new THREE.Vector3(-2 * K + 0.5, 1.6, 22 * K), 'slide');
  }

  // ---------- Прожекторы (вертикальные лучи) ----------
  const spotDefs = [
    { x: -28, z: -28, color: V.spotColors[0] }, { x: 28, z: 28, color: V.spotColors[1] }, { x: 28, z: -28, color: V.spotColors[2] },
  ];
  for (const sd of spotDefs) {
    const beam = createSpotlightBeam(sd.color);
    beam.position.set(sd.x * K, 25, sd.z * K);
    root.add(beam);
    dynamicUpdaters.push((dt, t) => {
      beam.rotation.z = Math.sin(t * 0.5 + sd.x) * 0.35;
      beam.rotation.x = Math.cos(t * 0.4 + sd.z) * 0.35;
    });
  }

  // ---------- Динамическое световое шоу ----------
  // 3 летающих point-light (без теней) по Lissajous-орбитам над ареной.
  // Цвет: HSL(baseHue арены + дрейф по времени + фаза трека*0.15); в дроп
  // hue резко сдвигается +60° и орбиты ускоряются ×2. Пульс на бите (spike 3.0
  // с decay) — main.js дёргает lightShowBeat(). На low-тире — 1 свет.
  const showLights = [];
  for (let i = 0; i < 3; i++) {
    const l = new THREE.PointLight(V.spotColors[i % V.spotColors.length], 1.5, 75, 1.8);
    l.position.set(0, 16, 0);
    root.add(l);
    showLights.push({ light: l, seed: i * 2.13 + 0.7 });
  }
  const showState = { spike: 0 };
  function lightShowBeat() { showState.spike = 3.0; }
  const _fogBase = new THREE.Color(V.fog);
  const _hueCol = new THREE.Color();
  dynamicUpdaters.push((dt, t) => {
    showState.spike = Math.max(0, showState.spike - dt * 4.2);
    const orbitK = showNow.drop > 0.5 ? 2 : 1; // дроп: орбиты ×2
    const active = showNow.low ? 1 : showLights.length; // low-качество: 1 свет
    for (let i = 0; i < showLights.length; i++) {
      const s = showLights[i];
      s.light.visible = i < active;
      if (!s.light.visible) continue;
      const tt = t * orbitK + s.seed * 3.1;
      // Lissajous-орбита над ареной
      s.light.position.set(
        Math.sin(tt * 0.53 + s.seed) * half * 0.62,
        13 + Math.sin(tt * 0.83 + s.seed * 2.0) * 5,
        Math.sin(tt * 0.41 + s.seed * 1.7) * half * 0.62,
      );
      // Hue: база арены + медленный дрейф + фаза трека; дроп: +60°
      const hue = V.showHue + t * 0.02 + showNow.phase * 0.15 + (showNow.drop > 0.5 ? 60 / 360 : 0);
      s.light.color.setHSL(((hue % 1) + 1) % 1, 0.85, 0.6);
      // Интенсивность: база 1.5 + спайк на бите (decay) + пульс от fx
      s.light.intensity = 1.5 + showState.spike + Math.min(1.5, beatNow) * 1.2;
    }
    // Туман дышит оттенком шоу (8-12% подмес; в дропе туманом владеет main.js)
    if (scene.fog && showNow.drop < 0.5) {
      const breath = 0.10 + Math.sin(t * 0.7) * 0.02;
      _hueCol.setHSL(((V.showHue + t * 0.02 + showNow.phase * 0.15) % 1 + 1) % 1, 0.55, 0.55);
      scene.fog.color.lerpColors(_fogBase, _hueCol, breath);
      if (scene.background?.isColor) scene.background.copy(scene.fog.color);
    }
    // Слепящий key-light слегка качается по вертикали в такт (subtle)
    sun.position.y = 80 + Math.sin(showNow.beatPhase * Math.PI * 2) * 2.2;
    sun.intensity = V.sunInt * (1 + Math.min(1.5, beatNow) * 0.06);
  });

  // ---------- Летающие частицы ----------
  const particleCount = 300;
  const pGeo = new THREE.BufferGeometry();
  const pPos = new Float32Array(particleCount * 3);
  const pSeed = new Float32Array(particleCount);
  for (let i = 0; i < particleCount; i++) {
    pPos[i * 3] = (Math.random() - 0.5) * SIZE;
    pPos[i * 3 + 1] = Math.random() * 12;
    pPos[i * 3 + 2] = (Math.random() - 0.5) * SIZE;
    pSeed[i] = Math.random() * 100;
  }
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  const particles = new THREE.Points(pGeo, new THREE.PointsMaterial({
    color: V.particles, size: 0.06, transparent: true, opacity: 0.55, sizeAttenuation: true,
  }));
  root.add(particles);
  dynamicUpdaters.push((dt, t) => {
    const arr = pGeo.attributes.position.array;
    for (let i = 0; i < particleCount; i++) {
      arr[i * 3 + 1] += Math.sin(t * 0.6 + pSeed[i]) * dt * 0.35 + dt * 0.12;
      arr[i * 3] += Math.cos(t * 0.3 + pSeed[i]) * dt * 0.2;
      if (arr[i * 3 + 1] > 12) arr[i * 3 + 1] = 0;
    }
    pGeo.attributes.position.needsUpdate = true;
  });

  // ---------- Искры от кристалла ----------
  const sparkCount = 80;
  const sGeo = new THREE.BufferGeometry();
  const sPos = new Float32Array(sparkCount * 3);
  const sSeed = new Float32Array(sparkCount);
  for (let i = 0; i < sparkCount; i++) {
    const r = (0.5 + Math.random() * 5.5) * K;
    const a = Math.random() * Math.PI * 2;
    sPos[i * 3] = Math.cos(a) * r;
    sPos[i * 3 + 1] = 0.4 + Math.random() * 7;
    sPos[i * 3 + 2] = -2 * K + Math.sin(a) * r;
    sSeed[i] = Math.random() * 100;
  }
  sGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
  const sparkMat = new THREE.PointsMaterial({
    color: V.sparks, size: 0.09, transparent: true, opacity: 0.85,
    blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
  });
  const sparks = new THREE.Points(sGeo, sparkMat);
  root.add(sparks);
  dynamicUpdaters.push((dt, t) => {
    const arr = sGeo.attributes.position.array;
    for (let i = 0; i < sparkCount; i++) {
      const a = t * (0.3 + (sSeed[i] % 1) * 0.5) + sSeed[i];
      const r = (0.5 + ((sSeed[i] * 7.13) % 5.5)) * K;
      arr[i * 3] = Math.cos(a) * r;
      arr[i * 3 + 1] += dt * (0.5 + (sSeed[i] % 1)) + beatNow * dt * 3;
      if (arr[i * 3 + 1] > 8.5) arr[i * 3 + 1] = 0.3;
      arr[i * 3 + 2] = -2 * K + Math.sin(a) * r;
    }
    sGeo.attributes.position.needsUpdate = true;
    sparkMat.opacity = 0.7 + beatNow * 0.3;
  });

  // ---------- Пикапы оружия (akimbo): парящий ствол над светящимся пьедесталом ----------
  // Подбор игроком — в main.js (_updateWeaponPickups); здесь только визуал + состояние.
  const weaponPickups = [];
  const addWeaponPickup = (x, y, z, kind) => {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    const ped = new THREE.Mesh(
      new THREE.CylinderGeometry(0.55, 0.68, 0.09, 10),
      flatMat(0x1c1e26, { metal: 0.6, rough: 0.4, noCache: true }));
    ped.position.y = 0.045;
    g.add(ped);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.5, 0.02, 6, 20),
      new THREE.MeshBasicMaterial({ color: 0xffc860, transparent: true, opacity: 0.9 }));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.11;
    g.add(ring);
    const gun = createRealGun(kind);
    gun.position.y = 1.0;
    g.add(gun);
    root.add(g);
    const pk = { pos: new THREE.Vector3(x, y, z), kind, root: g, available: true, respawnT: 0 };
    weaponPickups.push(pk);
    dynamicUpdaters.push((dt, t) => {
      if (!pk.available) return;
      gun.rotation.y = t * 1.4;
      gun.position.y = 1.0 + Math.sin(t * 2 + x) * 0.08;
      ring.rotation.z = t * 0.8;
    });
  };
  if (!V.glb) {
    // Y — лучом вниз по физике: пикап встаёт НА поверхность (пол/блок/платформа),
    // а не внутрь геометрии
    const downRay = new THREE.Vector3(0, -1, 0);
    const fromV = new THREE.Vector3();
    for (const pd of (V.pickups || DEFAULT_PICKUPS)) {
      const px = pd.x * K, pz = pd.z * K;
      const hit = physics.raycast(fromV.set(px, 30, pz), downRay, 60);
      addWeaponPickup(px, hit ? hit.point.y : 0, pz, pd.kind);
    }
  }

  // ---------- Навигационная сетка waypoint'ов (grid 4м) ----------
  const waypoints = buildWaypoints(physics, SIZE);

  // ---------- update ----------
  let t = 0;
  // show: {energy, phase, beatPhase, drop, low} — драйв светового шоу из main.js
  function update(dt, beat = 0, show = null) {
    t += dt;
    beatNow = beat;
    if (show) Object.assign(showNow, show);
    for (const fn of dynamicUpdaters) fn(dt, t);
  }

  return {
    root, variant, size: SIZE,
    colliders, destructibles, centerWalls, spawns, cashoutStations, cashboxSpawn,
    cashbox, objectives, waypoints, update, jumpPads, weaponPickups,
    reflector, glossFloor, setReflector, explosion, bioDecals, setPsy,
    lightShowBeat, // спайк интенсивности прожекторов на бите (main.js → flow.onBeat)
    bounds: SIZE / 2 - 1.5, // предел для ботов/клампов
    env: { fogColor: V.fog, fogDensity: V.fogDensity }, // применяется к engine/scene снаружи
  };
}

// Полная очистка арены: снять группу со сцены и освободить GPU-ресурсы.
// physics/destruction чистит вызывающий (physics.clear + destruction.reset).
export function disposeArena(scene, arena) {
  if (!arena?.root) return;
  scene.remove(arena.root);
  arena.root.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        for (const key of Object.keys(m)) {
          const v = m[key];
          if (v && v.isTexture) v.dispose();
        }
        if (m.uniforms) {
          for (const u of Object.values(m.uniforms)) {
            if (u?.value?.isTexture) u.value.dispose();
            if (u?.value?.isRenderTarget) u.value.dispose();
          }
        }
        m.dispose();
      }
    }
    if (typeof o.getRenderTarget === 'function') {
      try { o.getRenderTarget().dispose(); } catch { /* noop */ }
    }
  });
}

// Waypoint-сетка: узлы 4м, проходимость — проба лучом вниз + проверка свободного объёма
function buildWaypoints(physics, size = ARENA_SIZE) {
  const nodes = [];
  const step = 4;
  const half = size / 2 - 2;
  const from = new THREE.Vector3();
  const down = new THREE.Vector3(0, -1, 0);
  for (let x = -half; x <= half; x += step) {
    for (let z = -half; z <= half; z += step) {
      from.set(x, 8, z);
      const hit = physics.raycast(from, down, 20);
      if (!hit) continue;
      const y = hit.point.y;
      // Над головой должно быть свободно (2м)
      const up = new THREE.Vector3(0, 1, 0);
      const headHit = physics.raycast(new THREE.Vector3(x, y + 0.3, z), up, 1.9);
      if (headHit) continue;
      nodes.push({ x, y, z, walkable: true, neighbors: [] });
    }
  }
  // Связи: 8-соседство в пределах шага и перепад высот < 1.2
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j];
      const dx = Math.abs(a.x - b.x), dz = Math.abs(a.z - b.z);
      if (dx <= step && dz <= step && (dx + dz) > 0 && Math.abs(a.y - b.y) < 1.2) {
        a.neighbors.push(j);
        b.neighbors.push(i);
      }
    }
  }
  return { nodes, step, nearest(pos) {
    let best = -1, bd = Infinity;
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      const d = (n.x - pos.x) ** 2 + (n.z - pos.z) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  } };
}
