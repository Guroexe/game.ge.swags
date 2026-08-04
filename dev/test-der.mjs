// Дамп DER-структуры сертификата для отладки
import { ensureSelfSignedCert } from '../server/selfcert.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

const dir = path.join(os.tmpdir(), 'genswags-cert-test2');
const certPath = path.join(dir, 'cert.pem');
const keyPath = path.join(dir, 'key.pem');
ensureSelfSignedCert(certPath, keyPath, ['127.0.0.1', '192.168.0.42']);

const pem = fs.readFileSync(certPath, 'utf8');
const der = Buffer.from(pem.replace(/-----[^-]+-----/g, '').replace(/\s/g, ''), 'base64');
console.log('DER длина:', der.length);

// Рекурсивный дамп TLV
function dump(buf, depth = 0, offset = 0) {
  const pad = '  '.repeat(depth);
  let i = offset;
  while (i < buf.length) {
    const tag = buf[i];
    let lenByte = buf[i + 1];
    let len = lenByte;
    let hdrLen = 2;
    if (lenByte & 0x80) {
      const numBytes = lenByte & 0x7f;
      len = 0;
      for (let j = 0; j < numBytes; j++) len = (len << 8) | buf[i + 2 + j];
      hdrLen = 2 + numBytes;
    }
    const tagName = {
      0x30: 'SEQUENCE', 0x31: 'SET', 0x02: 'INTEGER', 0x06: 'OID',
      0x05: 'NULL', 0x0c: 'UTF8String', 0x17: 'UTCTime', 0x03: 'BIT STRING',
      0x04: 'OCTET STRING', 0xa0: '[0]', 0xa1: '[1]', 0xa2: '[2]', 0xa3: '[3]',
      0x87: '[7] IPAddr', 0x82: '[2] DNSName',
    }[tag] || `tag 0x${tag.toString(16)}`;
    const content = buf.slice(i + hdrLen, i + hdrLen + len);
    let extra = '';
    if (tag === 0x06) extra = ` ${content.toString('hex')}`;
    if (tag === 0x0c || tag === 0x82 || tag === 0x17) extra = ` "${content.toString('ascii')}"`;
    if (tag === 0x87) extra = ` ${[...content].join('.')}`;
    if (tag === 0x02) extra = ` ${content.toString('hex')}`;
    console.log(`${pad}${tagName} len=${len}${extra}`);
    if ((tag & 0x20) || tag === 0x30 || tag === 0x31 || (tag >= 0xa0 && tag <= 0xa3)) {
      dump(content, depth + 1, 0);
    }
    i += hdrLen + len;
  }
}
dump(der);
