import { b64urlEncode, b64urlDecode } from './b64';

const COOKIE_NAME = 'lfg_session';
const enc = new TextEncoder();
const dec = new TextDecoder();

function cookieFlags(url) {
  const secure = String(url).startsWith('https://') ? '; Secure' : '';
  return `HttpOnly; Path=/; SameSite=Lax${secure}`;
}

async function hmacBase64(secret, dataStr) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(dataStr));
  return b64urlEncode(new Uint8Array(sig));
}

export function buildLoginUrl(returnTo, realm) {
  const params = new URLSearchParams({
    'openid.ns': 'http://specs.openid.net/auth/2.0',
    'openid.mode': 'checkid_setup',
    'openid.return_to': returnTo,
    'openid.realm': realm,
    'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
    'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select',
  });
  return `https://steamcommunity.com/openid/login?${params.toString()}`;
}

export function extractSteamId(claimedId) {
  if (!claimedId) return null;
  const m = claimedId.match(/\/id\/(\d+)/);
  return m ? m[1] : null;
}

export async function verifySteamLogin(url) {
  if (url.searchParams.get('openid.mode') !== 'id_res') return null;

  // check_authentication 必须回传回调里的全部 openid.* 字段
  // （含 openid.sig / openid.ns），仅把 openid.mode 换成 check_authentication。
  const body = new URLSearchParams();
  for (const [key, value] of url.searchParams) {
    if (key.startsWith('openid.')) body.set(key, value);
  }
  body.set('openid.mode', 'check_authentication');

  let res;
  try {
    res = await fetch('https://steamcommunity.com/openid/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
  } catch {
    return null;
  }
  const text = await res.text();
  if (!/is_valid\s*:\s*true/i.test(text)) return null;
  return extractSteamId(url.searchParams.get('openid.claimed_id'));
}

export async function signSession(user, secret) {
  const payload = b64urlEncode(enc.encode(JSON.stringify(user)));
  const sig = await hmacBase64(secret, payload);
  return `${payload}.${sig}`;
}

export async function verifySession(token, secret) {
  if (!token) return null;
  const idx = token.lastIndexOf('.');
  if (idx <= 0) return null;
  const payload = token.slice(0, idx);
  const sig = token.slice(idx + 1);
  const expected = await hmacBase64(secret, payload);
  if (sig.length !== expected.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff !== 0) return null;
  try {
    return JSON.parse(dec.decode(b64urlDecode(payload)));
  } catch {
    return null;
  }
}

export async function getSession(request, secret) {
  const cookie = request.headers.get('Cookie') || '';
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`));
  if (!m) return null;
  return verifySession(decodeURIComponent(m[1]), secret);
}

export async function sessionRedirect(url, user, secret) {
  const token = await signSession(user, secret);
  return new Response(null, {
    status: 302,
    headers: {
      Location: url,
      'Set-Cookie': `${COOKIE_NAME}=${encodeURIComponent(token)}; ${cookieFlags(url)}; Max-Age=2592000`,
    },
  });
}

export function clearSessionRedirect(url) {
  return new Response(null, {
    status: 302,
    headers: {
      Location: url,
      'Set-Cookie': `${COOKIE_NAME}=; ${cookieFlags(url)}; Max-Age=0`,
    },
  });
}
