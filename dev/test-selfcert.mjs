// Тест генерации сертификата + HTTPS-запроса
import { ensureSelfSignedCert } from '../server/selfcert.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import https from 'node:https';

const dir = path.join(os.tmpdir(), 'genswags-cert-test');
const certPath = path.join(dir, 'cert.pem');
const keyPath = path.join(dir, 'key.pem');

console.log('[1] Генерация сертификата...');
const ok = ensureSelfSignedCert(certPath, keyPath, ['127.0.0.1', '192.168.0.42']);
console.log('[1] Результат:', ok);
if (!ok) process.exit(1);
console.log('[1] cert.pem:', fs.existsSync(certPath) ? `${fs.statSync(certPath).size} байт` : 'ОТСУТСТВУЕТ');
console.log('[1] key.pem:', fs.existsSync(keyPath) ? `${fs.statSync(keyPath).size} байт` : 'ОТСУТСТВУЕТ');

console.log('[2] Поднимаем HTTPS-сервер на :18343...');
const srv = https.createServer({
  cert: fs.readFileSync(certPath),
  key: fs.readFileSync(keyPath),
}, (req, res) => { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('OK'); });

await new Promise((r) => srv.listen(18343, '127.0.0.1', r));
console.log('[2] Сервер слушает');

console.log('[3] HTTPS-запрос (rejectUnauthorized: false)...');
const res = await new Promise((resolve, reject) => {
  const req = https.get('https://127.0.0.1:18343/', { rejectUnauthorized: false, timeout: 3000 }, resolve);
  req.on('error', reject);
  req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
});
let body = '';
for await (const chunk of res) body += chunk;
console.log('[3] Ответ:', res.statusCode, JSON.stringify(body));

srv.close();
console.log('[OK] Сертификат работает, HTTPS живой.');
process.exit(0);
