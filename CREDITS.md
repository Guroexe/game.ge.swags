# CREDITS — скачанные 3D-модели (assets/models/)

Все модели загружены локально и идут в составе сборки (относительные пути,
внешних URL в рантайме нет). Лицензии проверены на страницах источников;
тексты лицензий — в `assets/models/src/`.

## Персонажи (скелетные, ~75 анимаций: Idle/Walking_A/Running_A/Jump_*/
## 2H_Ranged_Shooting/Death_A/Death_B/Hit_A и др., ~5.8–7k tris, текстуры встроены)

| Файл | Модель | Автор | Лицензия | Источник |
|---|---|---|---|---|
| Knight.glb | KayKit Adventurers — Knight | Kay Lousberg | **CC0** | https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0 |
| Barbarian.glb | KayKit Adventurers — Barbarian | Kay Lousberg | **CC0** | (тот же пак) |
| Mage.glb | KayKit Adventurers — Mage | Kay Lousberg | **CC0** | (тот же пак) |
| Rogue.glb | KayKit Adventurers — Rogue | Kay Lousberg | **CC0** | (тот же пак) |
| Rogue_Hooded.glb | KayKit Adventurers — Rogue Hooded | Kay Lousberg | **CC0** | (тот же пак) |

Страница пака: https://kaylousberg.itch.io/kaykit-adventurers (CC0).
Текст лицензии: `assets/models/src/KayKit-Adventurers-LICENSE.txt`.
Использование (v5): **запасной пак** — файлы остаются в сборке, тест
`test/assets.test.mjs` проверяет их целостность и покрытие клипов, но в
рантайме боты/MP-игроки заменены процедурными аниме-девушками (см. ниже).
Скелетный загрузчик `createRiggedCharacter` (js/engine/assetlib.js) сохранён.

## Персонажи v6 — процедурные КИБЕР-ХОРРОР АНИМЕ-ДЕВУШКИ (свои, без внешних ассетов)

С v6 боты и MP-игроки — взрослые кибер-хоррор аниме-девушки (~1.74 м) по
референсам (Nyave): глянцевый чёрный боди со светящимися швами, мех-позвоночник,
лезвия-наручи, шипастая плечевая броня, рваная юбка, высокие бронеботинки,
светящиеся «трещины» на бедре, твинтейлы до колен, неко-ушки, ахоге, автомат,
хвост-кабель, anime-лицо (PNG-декаль). Три командных варианта
(волосы/свечение/цвет глаз): ALPHA — блонд/малиновый/тёмные,
BRAVO — серебро/фиолет/фиолетовые, CHARLIE — пепельно-голубой/ледяной/голубые.
Реализация: `createCyberGirl` (js/engine/models.js), процедурная анимация
(бег/стрельба/прыжок/idle/рассыпание при смерти) — тот же API, что был у
неко-мех fallback. Хитбоксы подросли под взрослые пропорции: голова +1.58
(r=0.22), тело до +1.32.

| Файл | Назначение | Происхождение | Лицензия |
|---|---|---|---|
| assets/textures/face_alpha.png | anime-лицо ALPHA (тёмные глаза) | сгенерировано AI-плагином под задачу проекта | свой ассет |
| assets/textures/face_bravo.png | anime-лицо BRAVO (фиолетовые глаза) | (то же) | свой ассет |
| assets/textures/face_charlie.png | anime-лицо CHARLIE (голубые глаза) | (то же) | свой ассет |

При недоступности PNG используется процедурное canvas-лицо (fallback внутри
createCyberGirl). Старый chibi-вариант v5 (`createAnimeGirl`) сохранён в коде.

## Оружие (статика, ~1.2k tris, текстура Textures/colormap.png — в комплекте)

| Файл | Модель | Автор | Лицензия | Источник |
|---|---|---|---|---|
| weapons/blaster-rifle.glb | Blaster Kit — blaster-f | Kenney | **CC0** | https://kenney.nl/assets/blaster-kit |
| weapons/blaster-shotgun.glb | Blaster Kit — blaster-p | Kenney | **CC0** | (тот же набор) |
| weapons/clip-small.glb | Blaster Kit — clip-small | Kenney | **CC0** | (тот же набор) |
| weapons/Textures/colormap.png | общая палитра бластеров | Kenney | **CC0** | (тот же набор) |

Текст лицензии: `assets/models/src/Kenney-BlasterKit-LICENSE.txt`.
Использование: world-модели в руках персонажей (кость `handslot.r`) и
viewmodel игрока (процедурные sway/bob/recoil/reload сохранены, магазин —
нода `magazine` из самой модели).

## Оружие v7 — полный набор viewmodel (assets/models/weapons/kit/)

| Файл | Модель | Автор | Лицензия | Источник |
|---|---|---|---|---|
| kit/blaster-{a,b,c,d,e,g,h,i,j,o,q,r}.glb | Blaster Kit (12 стволов) | Kenney | **CC0** | https://kenney.nl/assets/blaster-kit |
| kit/clip-large.glb | увеличенный магазин | Kenney | **CC0** | (тот же набор) |
| kit/Textures/colormap.png | общая палитра | Kenney | **CC0** | (тот же набор) |

Скачано из публичного зеркала набора: github.com/subtiliorars-sys/game-3d-assets
(ветка main, `vendor/kenney/blaster-kit/Models/GLB format/`). Маппинг:
smg=h, dmr=d, lmg=e, revolver=b, awp=o, flamer=g, rocket=j, gl=i
(js/engine/assetlib.js `WEAPON_MODELS`); безтекстурным экземплярам назначается
gunmetal-материал в `upgradeViewmodel`.

## Оружие v8 — РЕАЛЬНЫЕ процедурные стволы (js/engine/realguns.js)

Свои low-poly модели, генерируются кодом (без внешних ассетов): АК-47, УЗИ,
SPAS-12, СВД, ПКМ, Магнум .44, AWP, РПГ-7, ГМ-94, огнемёт. Тёмные материалы
(оружейная сталь/полимер/дерево/латунь). Используются и во viewmodel от первого
лица (`upgradeViewmodelReal`), и в руках скелетных персонажей (кость RightHand,
js/engine/charlib.js). Именованные узлы `muzzle`/`magazine` участвуют в
анимациях перезарядки. Kenney-бластеры оставлены только как запасной слой.

## Звуковые эффекты (assets/audio/sfx/, OGG)

| Файл | Назначение | Автор | Лицензия | Источник |
|---|---|---|---|---|
| blaster.ogg | выстрел винтовки | Kenney | **CC0** | https://github.com/KenneyNL/Starter-Kit-FPS |
| blaster_repeater.ogg | выстрел дробовика | Kenney | **CC0** | (тот же набор, Starter-Kit-FPS/sounds/) |
| enemy_hurt.ogg | попадание по врагу | Kenney | **CC0** | (тот же набор) |
| enemy_destroy.ogg | убийство / разбитый череп | Kenney | **CC0** | (тот же набор) |
| jump_a.ogg | прыжок | Kenney | **CC0** | (тот же набор) |
| weapon_change.ogg | смена оружия | Kenney | **CC0** | (тот же набор) |
| land.ogg, enemy_attack.ogg | (в запасе, не задействованы) | Kenney | **CC0** | (тот же набор) |

## Реальные выстрелы (assets/audio/guns/)
| Файл | Назначение | Автор | Лицензия | Источник |
|---|---|---|---|---|
| shot_9mm.wav | сэмпл реального выстрела 9мм (основа звука АК/УЗИ/ПКМ/СВД/Магнум/SPAS/AWP — тон и громкость меняются под ствол) | Mike Koenig | **CC BY-SA 4.0** | Wikimedia Commons: File:9 mm gunshot-mike-koenig-123.wav |
| gunshots8.ogg | очереди/залпы (запасной слой) | не указан (Wikimedia Commons) | **Public domain** | Wikimedia Commons: File:Gunshots 8.ogg |

Поверх сэмпла реального выстрела кладётся процедурный синтез WebAudio
(механика затвора, помпа SPAS, болт AWP/СВД, хвост-отражение от зданий).
Если сэмпл не декодирован — звучит полный синтез (fallback на iOS для OGG).

# CREDITS — скачанные PBR-текстуры (assets/textures/)

Все текстуры — с ambientCG.com, лицензия **CC0** (https://ambientcg.com/license),
наборы 1K-JPG (Albedo/NormalGL/Roughness[/Metalness], 1024×1024). Загружаются
локально из `assets/textures/` (относительные пути, внешних URL в рантайме нет);
при недоступности файла действует процедурный canvas-fallback (js/engine/models.js).

| Файлы | Материал (ID) | Лицензия | Источник | Использование |
|---|---|---|---|---|
| marble_white_{color,roughness,normal}.jpg | Marble005 | **CC0** | https://ambientcg.com/view?id=Marble005 | белый мрамор — пол «СОБОРА» (gloss-пол + вуаль поверх Reflector) |
| concrete_{color,roughness,normal}.jpg | Concrete034 | **CC0** | https://ambientcg.com/view?id=Concrete034 | светлый бетон — стены/блоки/опоры всех арен |
| metalplates_{color,roughness,normal,metalness}.jpg | MetalPlates006 | **CC0** | https://ambientcg.com/view?id=MetalPlates006 | sci-fi металл-панели — пол/стены/блоки «НЕКРО-ЗАВОДА» |
| ground_{color,roughness,normal}.jpg | Ground054 | **CC0** | https://ambientcg.com/view?id=Ground054 | камень/песок — пол «ПУСТЫНИ ДАННЫХ» |
| panel_{color,roughness,normal,metalness}.jpg | Metal038 | **CC0** | https://ambientcg.com/view?id=Metal038 | тёмная металл-панель — акценты: пьедесталы кешаут-станций, рамки зон A/B/C |

Прямые ссылки наборов: `https://ambientcg.com/get?file=<ID>_1K-JPG.zip`.
Применение: js/engine/models.js (`ENV_TEXTURE_SETS`, `loadTextureSet`,
`applyTextureSet` — sRGB для albedo, RepeatWrapping, anisotropy 4),
js/game/arena.js (маппинг наборов на варианты арен).

## Не использовано / заменено
- ~~Аниме-неко девочка-мех под CC0 не нашлась~~ → персонажи — **свои
  процедурные аниме-девушки** (`createCyberGirl`) с AI-сгенерированными
  лицами (см. раздел выше); KayKit-бойцы переведены в запасной пак.
- Animated FPS-руки+оружие под CC0 не найдены → viewmodel = скачанный
  бластер + процедурные руки и анимации из текущего кода.

# CREDITS — вендорный рантайм и шрифты (офлайн-сборка)

## Череп-змея (assets/models/skull/)
| Файл | Модель | Автор | Лицензия | Источник |
|---|---|---|---|---|
| skull.gltf + skull.bin + halloweenbits_texture.png | KayKit Halloween Bits — Skull | Kay Lousberg / Sketchpunk Labs | **MIT** | github.com/sketchpunklabs/kaykit_halloween |

Текст лицензии: `assets/models/skull/KAYKIT_LICENSE.txt`.
Использование: low-poly череп-сегменты летающей змеи-охотника
(js/game/skulls.js `loadSkullTemplate`/`cloneRealSkull`, нормировка к высоте 1,
светящиеся глаза — отдельные сферы с `userData.isEye`). Процедурный череп
сохранён как fallback.

## Анонсер убийств (assets/audio/announcer/)
| Файлы | Назначение | Происхождение | Лицензия |
|---|---|---|---|
| firstblood/doublekill/triplekill/ultrakill/monsterkill/rampage/humiliation/headshot .mp3 | низкий голос анонсера в стиле Quake/Dota: первая кровь, серии убийств, хедшот, смерть от падения | сгенерированы AI-плагином (Kimi audio_generation, sound-effects flow) под задачу проекта | свой ассет |

Подключение: js/game/audio.js `announcer(name)` (one-shot + саб-румбл 58→34 Hz),
js/game/main.js (firstblood → chain по стрику → headshot), humiliation — при
смерти от падения за арену.

## three.js (vendor/three/, r160)
- `vendor/three/three.module.js`, `vendor/three/addons/**` — Three.js r160,
  лицензия **MIT** (© three.js authors, https://threejs.org). Скачано с
  cdn.jsdelivr.net (пакет `three@0.160.0`) и разложено локально — внешних
  CDN в рантайме нет, игра грузится офлайн/по LAN.

## Шрифты (assets/fonts/, все SIL Open Font License 1.1)
| Файл | Шрифт | Авторы | Лицензия | Источник |
|---|---|---|---|---|
| RubikMonoOne-Regular.ttf | Rubik Mono One | Hubert & Fischer | **OFL-1.1** | github.com/google/fonts (OFL текст: fonts.google.com) |
| RubikGlitch-Regular.ttf | Rubik Glitch | NaN / Lubomir Kavicky | **OFL-1.1** | github.com/google/fonts (cdn.jsdelivr.net gh/google/fonts) |
| ShareTechMono-Regular.ttf | Share Tech Mono | Carrois Apostrophe | **OFL-1.1** | github.com/google/fonts |
| DotGothic16-Regular.ttf | DotGothic16 | Font DASUKE / Dharma Type | **OFL-1.1** | github.com/google/fonts |
| unbounded-cyr/lat-{400,800}.woff2 | Unbounded | NaN / Jake Lunde | **OFL-1.1** | fontsource (cdn.jsdelivr.net, пакет @fontsource/unbounded) |
| ysabeau-cyr-{400,700}.woff2 | Ysabeau | Christian Thalmann | **OFL-1.1** | fontsource (@fontsource/ysabeau) |
| jost-cyr-500.woff2 | Jost | Indestructible Type / Owen Earl | **OFL-1.1** | fontsource (@fontsource/jost) |
| zendots-lat-400.woff2 | Zen Dots | Yoshimichi Ohira | **OFL-1.1** | fontsource (@fontsource/zen-dots) |
| michroma-lat-400.woff2 | Michroma | Vernon Adams | **OFL-1.1** | fontsource (@fontsource/michroma) |

Использование: `css/fonts.css` (@font-face с unicode-range + стеки
`--font-display/-arch/-mono/-tech/-logo/-latin/-jp/-glitch`): заголовки и
крупные цифры — Unbounded (растянутый дисплейный), архитектурные подписи —
Ysabeau, HUD-моно — Jost/ShareTech, лого-акценты — Zen Dots/Michroma,
глитч — Rubik Glitch, кана/кандзи — DotGothic16. CSS-искажения
(scaleX 1.14–1.22 + letter-spacing) — в `css/fonts.css`.

## UI-орнамент (assets/ui/)
| Файл | Назначение | Происхождение | Лицензия |
|---|---|---|---|
| tribal-skull.svg | металл-трибал полоса с черепом (меню/смерть/конец матча) | нарисован вручную под задачу проекта | свой ассет |
| menu_header.png, menu_btn.png, menu_bar.png, menu_divider.png | меню: заголовок с черепом, кнопки, плашки разделов | PNG-элементы интерфейса от владельца проекта (исходники в dev/ui_src/), нарезка dev/slice_ui.py | ассет владельца |
| hud_hp.png, hud_ammo.png, hud_skills.png, hud_topbar.png, hud_diamonds.png, hud_radar.png, hud_teams.png, hud_feed.png, hud_side.png | HUD: HP-сфера, пилюля патронов, гнёзда скилов, панель счёта, ромбы, радар, тиммейты, NOW PLAYING, FLOW-бар | (те же исходники владельца) | ассет владельца |
