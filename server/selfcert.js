// ===== GEN.SWAGS — самоподписанный X.509 сертификат на чистом node:crypto =====
// Без openssl: генерирует RSA-2048 пару и собирает DER-сертификат вручную.
// Экспорт: ensureSelfSignedCert(certPath, keyPath, ips) → boolean
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// --- Минимальный DER-кодер ---
const len = (n) => {
  if (n < 0x80) return Buffer.from([n]);
  const b = [];
  while (n > 0) { b.unshift(n & 0xff); n >>= 8; }
  return Buffer.from([0x80 | b.length, ...b]);
};
const tlv = (tag, content) => Buffer.concat([Buffer.from([tag]), len(content.length), content]);
const SEQ = (...c) => tlv(0x30, Buffer.concat(c));
const SET = (...c) => tlv(0x31, Buffer.concat(c));
const INT = (bytes) => tlv(0x02, bytes[0] & 0x80 ? Buffer.concat([Buffer.from([0]), bytes]) : bytes);
const OID = (hex) => tlv(0x06, Buffer.from(hex, 'hex'));
const NULL = () => Buffer.from([0x05, 0x00]);
const UTF8 = (s) => tlv(0x0c, Buffer.from(s, 'utf8'));
const BIT = (b) => tlv(0x03, Buffer.concat([Buffer.from([0]), b]));
const OCT = (b) => tlv(0x04, b);
const EXPL = (n, c) => tlv(0xa0 + n, c);
// UTCTime: YYMMDDhhmmssZ (13 байт). Берём из ISO: 2026-08-03T16:37:00.000Z → 260803163700Z
const UTCTIME = (d) => {
  const iso = d.toISOString(); // "2026-08-03T16:37:00.000Z"
  const yy = iso.slice(2, 4), mm = iso.slice(5, 7), dd = iso.slice(8, 10);
  const hh = iso.slice(11, 13), mi = iso.slice(14, 16), ss = iso.slice(17, 19);
  return tlv(0x17, Buffer.from(`${yy}${mm}${dd}${hh}${mi}${ss}Z`, 'ascii'));
};

// iPAddress в SAN: context-specific [7] primitive, 4 байта IPv4
const IPADDR = (ip) => tlv(0x87, Buffer.from(ip.split('.').map(Number)));
// dNSName в SAN: context-specific [2] primitive, IA5String байты
const DNSNAME = (s) => tlv(0x82, Buffer.from(s, 'ascii'));

// OID-ы
const OID_CN = OID('550403');                       // commonName
const OID_RSA = OID('2a864886f70d010101');          // rsaEncryption
const OID_SHA256RSA = OID('2a864886f70d01010b');    // sha256WithRSAEncryption
const OID_SAN = OID('551d11');                      // subjectAltName (2.5.29.17)
const OID_BC = OID('551d13');                       // basicConstraints (2.5.29.19)

// AttributeTypeAndValue ::= SEQUENCE { type OID, value ANY }
// RDN ::= SET OF AttributeTypeAndValue; Name ::= SEQUENCE OF RDN
const attr = (oid, val) => SEQ(oid, val);
const name = (cn) => SEQ(SET(attr(OID_CN, UTF8(cn))));


// Extension ::= SEQUENCE { extnID OID, critical BOOLEAN OPTIONAL, extnValue OCTET STRING }
const ext = (oid, value) => SEQ(oid, OCT(value));

export function ensureSelfSignedCert(certPath, keyPath, ips = ['127.0.0.1']) {
  if (fs.existsSync(certPath) && fs.existsSync(keyPath)) return true;
  fs.mkdirSync(path.dirname(certPath), { recursive: true });

  // RSA-3072: Node 24 / OpenSSL 3.x при security level 2 отвергает RSA-2048 как "ee key too small"
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 3072 });

  const privPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const spki = publicKey.export({ type: 'spki', format: 'der' });

  const now = new Date();
  const until = new Date(now.getTime() + 3650 * 864e5);
  const serial = INT(crypto.randomBytes(8));

  // SAN: IP-адреса + DNS:localhost — без этого Safari ругается даже после «доверять»
  const sanValue = SEQ(...ips.map(IPADDR), DNSNAME('localhost'));
  // BasicConstraints: CA:FALSE (пустая SEQUENCE)
  const bcValue = SEQ();

  // Extensions ::= [3] EXPLICIT SEQUENCE OF Extension
  const extensions = EXPL(3, SEQ(
    ext(OID_SAN, sanValue),
    ext(OID_BC, bcValue),
  ));

  // spki уже содержит полный SubjectPublicKeyInfo (SEQUENCE { algorithm, publicKey })
  // — используем напрямую, не оборачивая повторно
  const tbs = SEQ(
    EXPL(0, INT(Buffer.from([2]))), // version v3
    serial,
    SEQ(OID_SHA256RSA, NULL()),
    name('gen.swags'),
    SEQ(UTCTIME(now), UTCTIME(until)),
    name('gen.swags'),
    spki,
    extensions,
  );


  const sign = crypto.createSign('RSA-SHA256');
  sign.update(tbs);
  const sig = sign.sign(privateKey);

  const cert = SEQ(tbs, SEQ(OID_SHA256RSA, NULL()), BIT(sig));
  const b64 = cert.toString('base64').replace(/.{64}/g, '$&\n');
  fs.writeFileSync(certPath, `-----BEGIN CERTIFICATE-----\n${b64}\n-----END CERTIFICATE-----\n`);
  fs.writeFileSync(keyPath, privPem);
  return true;
}
