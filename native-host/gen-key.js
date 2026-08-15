// 生成固定的 Chrome/Edge 扩展 ID 所需 key，并写回 manifest.json。
// 用法：node native-host/gen-key.js
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const manifestPath = path.join(__dirname, '..', 'extension', 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

if (!manifest.key) {
  const { publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const der = publicKey.export({ type: 'spki', format: 'der' });
  manifest.key = der.toString('base64');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.error('generated new extension key');
}

const der = Buffer.from(manifest.key, 'base64');
const hex = crypto.createHash('sha256').update(der).digest('hex').slice(0, 32);
// Chrome 扩展 ID：前 16 字节 SHA256 的每个 hex 数字映射为 a-p
const extId = hex
  .split('')
  .map((h) => String.fromCharCode(97 + parseInt(h, 16)))
  .join('');

console.log(extId);
