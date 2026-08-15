import { getSession } from '../../lib/openid';
import { jsonResponse, corsResponse } from '../../lib/http';

// pushplus_token 列保留仅为兼容旧表结构，代码中已不再使用
const ENSURE_TABLE = "CREATE TABLE IF NOT EXISTS push_configs (steamid TEXT PRIMARY KEY, pushplus_token TEXT NOT NULL DEFAULT '', webpush_sub_json TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '')";

function safeJsonParse(s, fallback) {
  try { return JSON.parse(s); } catch { return fallback; }
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return corsResponse('GET, POST, OPTIONS');

  const db = env.steam_strangers;
  await db.exec(ENSURE_TABLE);

  const session = await getSession(request, env.SESSION_SECRET);
  if (!session) return jsonResponse({ error: '未登录' }, 401);

  if (request.method === 'GET') {
    const { results } = await db.prepare('SELECT webpush_sub_json FROM push_configs WHERE steamid = ?').bind(session.steamId).all();
    const r = results && results[0];
    return jsonResponse({
      webPushSub: r && r.webpush_sub_json ? safeJsonParse(r.webpush_sub_json, null) : null,
    });
  }

  let body;
  try { body = await request.json(); } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400);
  }

  const { results } = await db.prepare('SELECT * FROM push_configs WHERE steamid = ?').bind(session.steamId).all();
  const existing = results && results[0];

  const webPushSub = body.webPushSub !== undefined
    ? (body.webPushSub ? JSON.stringify(body.webPushSub) : '')
    : (existing ? existing.webpush_sub_json : '');

  const now = new Date().toISOString();
  await db.prepare(
    `INSERT INTO push_configs (steamid, pushplus_token, webpush_sub_json, created_at, updated_at)
     VALUES (?, '', ?, ?, ?)
     ON CONFLICT(steamid) DO UPDATE SET pushplus_token = '', webpush_sub_json = excluded.webpush_sub_json, updated_at = excluded.updated_at`
  ).bind(session.steamId, webPushSub, now, now).run();

  return jsonResponse({ success: true });
}
