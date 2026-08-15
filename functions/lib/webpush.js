import { b64urlEncode, b64urlDecode } from './b64';

const enc = new TextEncoder();

function concatBytes(...arrays) {
  const total = arrays.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) { out.set(a, off); off += a.length; }
  return out;
}

async function hmac(keyBytes, dataBytes) {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, dataBytes);
  return new Uint8Array(sig);
}

async function hkdf(salt, ikm, info, length) {
  const prk = await hmac(salt, ikm);
  const data = new Uint8Array(info.length + 1);
  data.set(info, 0);
  data[info.length] = 1;
  const okm = await hmac(prk, data);
  return okm.slice(0, length);
}

function rawPrivateToPkcs8(raw) {
  if (raw.length !== 32) throw new Error('Invalid VAPID private key length');
  const prefix = new Uint8Array([
    0x30, 0x41, 0x02, 0x01, 0x00,
    0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01,
    0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07,
    0x04, 0x27, 0x30, 0x25, 0x02, 0x01, 0x01, 0x04, 0x20,
  ]);
  const der = new Uint8Array(prefix.length + 32);
  der.set(prefix, 0);
  der.set(raw, prefix.length);
  return der;
}

async function generateVapidJwt(privateKeyB64, audience) {
  const keyBytes = rawPrivateToPkcs8(b64urlDecode(privateKeyB64));
  const key = await crypto.subtle.importKey('pkcs8', keyBytes, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const header = { typ: 'JWT', alg: 'ES256' };
  const payload = { aud: audience, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: 'mailto:admin@example.com' };
  const h = b64urlEncode(enc.encode(JSON.stringify(header)));
  const p = b64urlEncode(enc.encode(JSON.stringify(payload)));
  const input = `${h}.${p}`;
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(input));
  return `${input}.${b64urlEncode(new Uint8Array(sig))}`;
}

export async function sendWebPush(env, subscription, payload) {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return false;
  const endpoint = subscription.endpoint;
  const audience = new URL(endpoint).origin;
  const jwt = await generateVapidJwt(env.VAPID_PRIVATE_KEY, audience);

  const clientPub = b64urlDecode(subscription.keys.p256dh);
  const authSecret = b64urlDecode(subscription.keys.auth);

  const ourKeys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const ourPub = new Uint8Array(await crypto.subtle.exportKey('raw', ourKeys.publicKey));

  const clientKeyObj = await crypto.subtle.importKey('raw', clientPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const sharedBits = await crypto.subtle.deriveBits({ name: 'ECDH', public: clientKeyObj }, ourKeys.privateKey, 256);
  const shared = new Uint8Array(sharedBits);

  const salt = crypto.getRandomValues(new Uint8Array(16));

  const info = concatBytes(enc.encode('WebPush: info\0'), clientPub, ourPub);
  const prk = await hkdf(authSecret, shared, info, 32);

  const cek = await hkdf(salt, prk, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, prk, enc.encode('Content-Encoding: nonce\0'), 12);

  const header = concatBytes(salt, new Uint8Array([0, 0, 16, 0, 65]), ourPub);

  const aesKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  // aes128gcm 要求明文末尾追加 1 字节 padding delimiter（末条记录为 0x02），否则浏览器解密后去 padding 会失败
  const plaintext = concatBytes(enc.encode(JSON.stringify(payload)), new Uint8Array([2]));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce, additionalData: new Uint8Array(0), tagLength: 128 },
    aesKey,
    plaintext
  ));

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `vapid t=${jwt}, k=${env.VAPID_PUBLIC_KEY}`,
      'Content-Type': 'application/octet-stream',
      'Content-Encoding': 'aes128gcm',
      TTL: '60',
    },
    body: concatBytes(header, ciphertext),
  });
  return res.ok;
}
