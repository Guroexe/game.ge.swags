// Smoke-тест railway-входа: статика + WS на одном порту (env PORT).
// Запуск: node dev/smoke-railway.mjs
import { spawn } from 'node:child_process';
import { setTimeout as wait } from 'node:timers/promises';
import WebSocket from '../server/node_modules/ws/wrapper.mjs';

const PORT = 17777;
const child = spawn(process.execPath, ['server/start.railway.js'], {
  env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
child.stdout.on('d', (d) => (serverLog += d));
child.stdout.on('data', (d) => (serverLog += d));
child.stderr.on('data', (d) => (serverLog += d));

let failed = false;
const fail = (msg) => { failed = true; console.log('FAIL', msg); };
try {
  await wait(1800);
  const h = await fetch(`http://localhost:${PORT}/healthz`);
  console.log('HEALTHZ', h.status, (await h.text()).slice(0, 120));
  if (h.status !== 200) fail('healthz status');

  const i = await fetch(`http://localhost:${PORT}/index.html`);
  const html = await i.text();
  console.log('INDEX', i.status, html.includes('<canvas') || html.includes('main.js') ? 'ok' : 'suspicious');
  if (i.status !== 200) fail('index status');

  await new Promise((resolve) => {
    const ws = new WebSocket(`ws://localhost:${PORT}`);
    const to = setTimeout(() => { fail('ws timeout'); ws.terminate(); resolve(); }, 4000);
    ws.on('open', () => { console.log('WS OPEN'); clearTimeout(to); ws.close(); resolve(); });
    ws.on('error', (e) => { fail('ws error: ' + e.message); clearTimeout(to); resolve(); });
  });
} catch (e) {
  fail(e.message);
} finally {
  child.kill();
}
if (failed) { console.log('--- server log ---\n' + serverLog); process.exit(1); }
console.log('SMOKE OK');
process.exit(0);
