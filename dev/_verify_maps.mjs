// Проверка GLB-карт: масштаб, спавны на полу, скриншоты
import puppeteer from 'puppeteer-core';

const shots = '/tmp/shots';
const browser = await puppeteer.launch({
  executablePath: '/usr/local/bin/google-chrome',
  headless: 'new',
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader',
    '--window-size=1280,720', '--disable-dev-shm-usage'],
  defaultViewport: { width: 1280, height: 720 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE-ERR:', m.text().slice(0, 200)); });

await page.goto('http://localhost:8080/?autostart=1', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__game && window.__game.state === 'GAME', { timeout: 40000 });
await new Promise((r) => setTimeout(r, 1200));

for (const variant of ['dust2', 'ruins', 'goldencity']) {
  const info = await page.evaluate(async (v) => {
    const g = window.__game;
    g.player.damage = () => {};
    g.rebuildArena(v);
    await g.arena.glbReady; // ждём загрузку и привязку
    // Респавн игрока на точке команды
    const sp = g.arena.spawns[0];
    g.player.spawn(sp.pos, sp.yaw);
    for (let i = 0; i < 30; i++) for (const cb of g.engine._updateCbs) cb(1 / 60);
    const p = g.player.body.pos;
    return {
      variant: v,
      size: g.arena.size,
      spawns: g.arena.spawns.map((s) => s.pos.toArray().map((n) => +n.toFixed(1))),
      playerY: +p.y.toFixed(2),
      onGround: g.player.onGround,
      colliders: g.physics.statics.length,
      stations: g.mode.stations.map((s) => s.pos.toArray().map((n) => +n.toFixed(1))),
      cashbox: g.mode.boxPos.toArray().map((n) => +n.toFixed(1)),
      pickups: g.arena.weaponPickups.map((x) => x.pos.toArray().map((n) => +n.toFixed(1))),
    };
  }, variant);
  console.log('MAP:', JSON.stringify(info));
  // Скриншот от первого лица на спавне
  await page.evaluate(() => {
    const g = window.__game;
    g.player.look.pitch = 0.05;
    for (const cb of g.engine._renderCbs) cb(1 / 60);
  });
  await page.screenshot({ path: `${shots}/map_${variant}.png` });
  // Вид сверху для масштаба
  await page.evaluate(() => {
    const g = window.__game;
    const s = g.arena.size;
    g.engine.camera.position.set(0, s * 0.7, s * 0.5);
    g.engine.camera.lookAt(0, 0, 0);
    g._debugCam = { pos: [0, s * 0.7, s * 0.5], look: [0, 0, 0] };
    for (const cb of g.engine._renderCbs) cb(1 / 60);
  });
  await page.screenshot({ path: `${shots}/map_${variant}_top.png` });
  await page.evaluate(() => { window.__game._debugCam = null; });
}
console.log('DONE');
await browser.close();
