// ===== GEN.SWAGS — Railway entry (единый процесс: WS + статика) =====
// Railway выдаёт ОДИН порт (env PORT) и свой HTTPS-терминатор:
//   https://<app>.up.railway.app        → статика игры
//   wss://<app>.up.railway.app          → MP WebSocket (тот же порт!)
// Гироскоп iOS работает из коробки: Railway-HTTPS = secure context,
// самоподписанный сертификат и :8343 на проде НЕ нужны.
//
// Локально этот файл тоже работает:  node server/start.railway.js
// (порт 7777, http://localhost:7777/). Для LAN-разработки с HTTPS-гироскопом
// по-прежнему используй server/start.js (start.bat).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

// Отключаем автозапуск standalone-WS в server.js ДО его импорта —
// здесь мы поднимаем WS сами через attachServer на общем http-порту.
process.env.GENSWAGS_NO_AUTOSTART = '1';
const { attachServer } = await import('./server.js');

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 7777;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
  '.ttf': 'font/ttf', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json',
  '.md': 'text/markdown; charset=utf-8',
  '.zip': 'application/zip',
  '.ico': 'image/x-icon',
};

// Кэш: статика меняется только при деплое — отдаём с immutable-кэшем,
// кроме index.html (всегда свежий, чтобы обновления доезжали сразу).
function serveFile(req, res) {
  try {
    let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    if (urlPath === '/') urlPath = '/index.html';
    if (urlPath === '/healthz') {          // healthcheck для Railway
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
      return;
    }
    const filePath = path.normalize(path.join(ROOT, urlPath));
    if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end('403'); return; }
    fs.stat(filePath, (err, st) => {
      if (err || !st.isFile()) { res.writeHead(404); res.end('404: ' + urlPath); return; }
      const ext = path.extname(filePath).toLowerCase();
      const isHtml = ext === '.html';
      res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Content-Length': st.size,
        'Cache-Control': isHtml ? 'no-cache' : 'public, max-age=86400, immutable',
        'Access-Control-Allow-Origin': '*',
      });
      fs.createReadStream(filePath).pipe(res);
    });
  } catch {
    res.writeHead(500); res.end('500');
  }
}

const server = http.createServer(serveFile);

// MP WebSocket — на ТОМ ЖЕ порту (upgrade-запросы). attachServer вешает
// обработчик 'upgrade' и возвращает WebSocketServer; HTTP-часть — выше.
const wss = new WebSocketServer({ noServer: true });
attachServer(wss, server);

server.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('  GEN.SWAGS (Railway mode) — один порт: HTTP + WS');
  console.log(`  → http://localhost:${PORT}/`);
  if (process.env.RAILWAY_PUBLIC_DOMAIN) {
    console.log(`  → https://${process.env.RAILWAY_PUBLIC_DOMAIN}/`);
    console.log(`  → wss://${process.env.RAILWAY_PUBLIC_DOMAIN}/  (MP авто-подключится)`);
  }
  console.log('');
});
server.on('error', (e) => {
  console.error('  [server] ошибка:', e.message);
  if (e.code === 'EADDRINUSE') process.exit(1);
});
