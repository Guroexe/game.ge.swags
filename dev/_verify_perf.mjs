// Перф-проба: время сим-шага на больших картах (спatial hash)
import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({
  executablePath: '/usr/local/bin/google-chrome',
  headless: 'new',
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader',
    '--window-size=1280,720', '--disable-dev-shm-usage'],
  defaultViewport: { width: 1280, height: 720 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

await page.goto('http://localhost:8080/?autostart=1', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__game && window.__game.state === 'GAME', { timeout: 40000 });
await new Promise((r) => setTimeout(r, 1000));

for (const variant of ['eden', 'dust2', 'goldencity']) {
  const perf = await page.evaluate(async (v) => {
    const g = window.__game;
    g.player.damage = () => {};
    if (g.arena?.variant !== v) g.rebuildArena(v);
    if (g.arena.glbReady) await g.arena.glbReady;
    const sp = g.arena.spawns[0];
    g.player.spawn(sp.pos, sp.yaw);
    // прогрев
    for (let i = 0; i < 10; i++) for (const cb of g.engine._updateCbs) cb(1 / 60);
    const t0 = performance.now();
    for (let i = 0; i < 120; i++) for (const cb of g.engine._updateCbs) cb(1 / 60);
    const ms = (performance.now() - t0) / 120;
    return { variant: v, size: g.arena.size, colliders: g.physics.statics.length, simMsPerStep: +ms.toFixed(2) };
  }, variant);
  console.log('PERF:', JSON.stringify(perf));
}
await browser.close();
