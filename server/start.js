// ===== GEN.SWAGS — единый лаунчер (static :8080 + HTTPS :8343 + WS :7777) =====
// Один процесс Node: раздаёт игру по HTTP, по HTTPS (для гироскопа iPhone,
// если есть dev/certs/cert.pem+key.pem) и поднимает MP-сервер.
// Запуск: node server/start.js   (или start.bat / start.command в корне)
// Зависимости: ws (server/node_modules — идёт в сборке).
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { ensureSelfSignedCert } from './selfcert.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const STATIC_PORT = Number(process.env.STATIC_PORT) || 8080;
const HTTPS_PORT = Number(process.env.HTTPS_PORT) || 8343;

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
};

const serveFile = (req, res) => {
  try {
    let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    if (urlPath === '/') urlPath = '/index.html';
    // защита от выхода за корень
    const filePath = path.normalize(path.join(ROOT, urlPath));
    if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end('403'); return; }
    fs.stat(filePath, (err, st) => {
      if (err || !st.isFile()) { res.writeHead(404); res.end('404: ' + urlPath); return; }
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Content-Length': st.size,
        'Cache-Control': 'no-cache',
        'Access-Control-Allow-Origin': '*',
      });
      fs.createReadStream(filePath).pipe(res);
    });
  } catch (e) {
    res.writeHead(500); res.end('500');
  }
};

const server = http.createServer(serveFile);

const lanIps = [];
for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
  for (const a of addrs || []) {
    if (a.family === 'IPv4' && !a.internal) lanIps.push(a.address);
  }
}
// Приоритет реальной Wi-Fi сети: 192.168.* → 10.* → 172.16-31 → прочее
const rank = (ip) =>
  ip.startsWith('192.168.') ? 0 :
  ip.startsWith('10.') ? 1 :
  /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ? 2 : 3;
lanIps.sort((a, b) => rank(a) - rank(b));
const lanIp = lanIps[0] || '<IP-ПК>';

server.listen(STATIC_PORT, '0.0.0.0', () => {
  console.log('');
  console.log('  ╔══════════════════════════════════════════════════════╗');
  console.log('  ║              GEN.SWAGS — сервер запущен              ║');
  console.log('  ╚══════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`  На этом ПК:      http://localhost:${STATIC_PORT}/`);
  console.log(`  iPhone (Wi-Fi):  http://${lanIp}:${STATIC_PORT}/`);
  console.log(`  MP авто-подключ: http://${lanIp}:${STATIC_PORT}/index.html?server=ws://${lanIp}:7777`);
});
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.log('');
    console.log(`  [HTTP] порт :${STATIC_PORT} занят — похоже, игра УЖЕ запущена.`);
    console.log(`  Открывай http://localhost:${STATIC_PORT}/ (это окно можно закрыть).`);
    console.log('');
  } else {
    console.error('  [HTTP] ошибка сервера:', e.message);
  }
});

// HTTPS :8343 — нужен iPhone для гироскопа (iOS требует secure context).
// Сертификат создаётся АВТОМАТИЧЕСКИ (pure node:crypto, без openssl) при первом
// запуске в dev/certs/{cert.pem,key.pem} — SAN включает все текущие LAN IP.
// Если IP ПК сменился — удали dev/certs и перезапусти, сертификат пересоздастся.
const CERT = path.join(ROOT, 'dev', 'certs', 'cert.pem');
const KEY = path.join(ROOT, 'dev', 'certs', 'key.pem');
let httpsOk = false;
try {
  httpsOk = ensureSelfSignedCert(CERT, KEY, ['127.0.0.1', ...lanIps]);
} catch (e) {
  console.log(`  [HTTPS] не удалось создать сертификат: ${e.message}`);
}
if (httpsOk) {
  const httpsServer = https.createServer({
    cert: fs.readFileSync(CERT), key: fs.readFileSync(KEY),
  }, serveFile);
  httpsServer.listen(HTTPS_PORT, '0.0.0.0', () => {
    console.log('');
    console.log(`  HTTPS (гироскоп iPhone): https://${lanIp}:${HTTPS_PORT}/`);
    console.log('  (на айфоне: примите сертификат — Подробности → Перейти на сайт)');
    console.log('');
  });
  httpsServer.on('error', (e) => {
    console.log(`  [HTTPS] не удалось поднять :${HTTPS_PORT} — ${e.message}`);
  });
} else {
  console.log('');
  console.log('  [HTTPS] сертификат недоступен — гироскоп по HTTPS выключен.');
  console.log('');
}

// WS MP-сервер (порт 7777 по умолчанию, env PORT) — импорт запускает его
await import('./server.js');
