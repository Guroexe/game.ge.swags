// Проверка сертификата через crypto.X509Certificate
import { ensureSelfSignedCert } from '../server/selfcert.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

const dir = path.join(os.tmpdir(), 'genswags-cert-test3');
const certPath = path.join(dir, 'cert.pem');
const keyPath = path.join(dir, 'key.pem');
ensureSelfSignedCert(certPath, keyPath, ['127.0.0.1', '192.168.0.42']);

const certPem = fs.readFileSync(certPath, 'utf8');
const keyPem = fs.readFileSync(keyPath, 'utf8');

console.log('=== Проверка X509Certificate ===');
try {
  const cert = new crypto.X509Certificate(certPem);
  console.log('✓ X509Certificate распарсил сертификат');
  console.log('  subject:', cert.subject);
  console.log('  issuer:', cert.issuer);
  console.log('  validFrom:', cert.validFrom);
  console.log('  validTo:', cert.validTo);
  console.log('  subjectAltName:', cert.subjectAltName);
  console.log('  serialNumber:', cert.serialNumber);
} catch (e) {
  console.log('✗ X509Certificate ошибка:', e.message);
}

console.log('\n=== Проверка createPrivateKey ===');
try {
  const key = crypto.createPrivateKey(keyPem);
  console.log('✓ Ключ OK, type:', key.asymmetricKeyType, 'size:', key.asymmetricKeySize);
} catch (e) {
  console.log('✗ createPrivateKey ошибка:', e.message);
}

console.log('\n=== Проверка cert.publicKey ===');
try {
  const cert = new crypto.X509Certificate(certPem);
  const pubKey = cert.publicKey;
  console.log('✓ cert.publicKey OK, type:', pubKey.asymmetricKeyType);
  // Проверка верификации подписи
  const tbsCert = cert.raw; // весь сертификат
  console.log('  raw cert size:', tbsCert.length);
} catch (e) {
  console.log('✗ cert.publicKey ошибка:', e.message);
}

console.log('\n=== Проверка TLS с security level 1 ===');
try {
  const https = await import('node:https');
  const srv = https.createServer({
    cert: certPem,
    key: keyPem,
    secureOptions: crypto.constants.SSL_OP_NO_SECURITY_LEVEL_2 || 0,
    ciphers: 'DEFAULT@SECLEVEL=1',
  }, (req, res) => { res.writeHead(200); res.end('OK'); });
  await new Promise((r) => srv.listen(18344, '127.0.0.1', r));
  console.log('✓ HTTPS с SECLEVEL=1 запустился');
  srv.close();
} catch (e) {
  console.log('✗ HTTPS SECLEVEL=1 ошибка:', e.message);
}


