import { getSession } from '../../lib/openid';
import { jsonResponse, corsResponse } from '../../lib/http';

const ENSURE_TABLE = "CREATE TABLE IF NOT EXISTS presence (steamid TEXT PRIMARY KEY, personaname TEXT NOT NULL DEFAULT '', avatar TEXT NOT NULL DEFAULT '', online INTEGER NOT NULL DEFAULT 0, gameid TEXT NOT NULL DEFAULT '', game_name TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '')";

const ACTIVE_WINDOW_MS = 5 * 60 * 1000; // 5 分钟内有过心跳视为在线
const REFRESH_MIN_MS = 45 * 1000; // 无本地数据时，至少间隔 45 秒才重查 Steam，避免刷爆 key

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return corsResponse('GET, POST, OPTIONS');

  const db = env.steam_strangers;
  await db.exec(ENSURE_TABLE);

  if (request.method === 'GET') return handleList(db, new URL(request.url));

  const session = await getSession(request, env.SESSION_SECRET);
  if (!session) return jsonResponse({ error: '未登录' }, 401);

  let body;
  try { body = await request.json(); } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400);
  }
  return handleHeartbeat(env, db, session, body);
}

async function handleList(db, url) {
  const cutoff = new Date(Date.now() - ACTIVE_WINDOW_MS).toISOString();
  const appid = (url.searchParams.get('appid') || '').trim();

  let results;
  if (appid) {
    ({ results } = await db.prepare('SELECT * FROM presence WHERE updated_at >= ? AND gameid = ? ORDER BY online DESC, game_name ASC, personaname ASC').bind(cutoff, appid).all());
  } else {
    ({ results } = await db.prepare('SELECT * FROM presence WHERE updated_at >= ? ORDER BY online DESC, game_name ASC, personaname ASC').bind(cutoff).all());
  }
  return jsonResponse((results || []).map(mapRow));
}

async function handleHeartbeat(env, db, session, body) {
  const steamId = session.steamId;

  // 用户关闭共享：立即移除自己的在线状态
  if (body.active === false) {
    await db.prepare('DELETE FROM presence WHERE steamid = ?').bind(steamId).run();
    return jsonResponse({ ok: true });
  }

  const { results } = await db.prepare('SELECT * FROM presence WHERE steamid = ?').bind(steamId).all();
  const existing = results && results[0];
  const now = new Date();
  const nowIso = now.toISOString();

  // 带本地游戏数据的心跳：直接用本地数据更新（本地 Steam 是当前游戏的最准确来源）
  const hasLocalGame = body && body.appid !== undefined && body.appid !== null && String(body.appid).trim() !== '';
  if (hasLocalGame) {
    const gameid = String(body.appid).trim().slice(0, 10);
    if (!/^\d{1,10}$/.test(gameid)) return jsonResponse({ error: 'appid 需为纯数字' }, 400);
    const gameName = String(body.gameName || '').trim().slice(0, 80);
    const row = {
      steamid: steamId,
      personaname: session.nickname || (existing && existing.personaname) || '',
      avatar: session.avatar || (existing && existing.avatar) || '',
      online: 1,
      gameid: gameid,
      game_name: gameName,
      updated_at: nowIso,
    };
    await db.prepare(
      `INSERT INTO presence (steamid, personaname, avatar, online, gameid, game_name, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(steamid) DO UPDATE SET personaname = excluded.personaname, avatar = excluded.avatar, online = excluded.online, gameid = excluded.gameid, game_name = excluded.game_name, updated_at = excluded.updated_at`
    ).bind(steamId, row.personaname, row.avatar, row.online, row.gameid, row.game_name, nowIso).run();
    return jsonResponse(mapRow(row));
  }

  // 刚查过不久，直接续活跃时间并返回缓存，不重复打 Steam 接口
  if (existing && now.getTime() - new Date(existing.updated_at).getTime() < REFRESH_MIN_MS) {
    await db.prepare('UPDATE presence SET updated_at = ? WHERE steamid = ?').bind(nowIso, steamId).run();
    return jsonResponse(mapRow({ ...existing, updated_at: nowIso }));
  }

  let p = null;
  if (env.STEAM_API_KEY) {
    try {
      const res = await fetch(`https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${env.STEAM_API_KEY}&steamids=${steamId}`);
      const data = await res.json();
      p = data.response && data.response.players && data.response.players[0];
    } catch (e) {
      console.error('presence: GetPlayerSummaries failed', e.message);
    }
  }

  const row = {
    steamid: steamId,
    personaname: (p && p.personaname) || session.nickname || '',
    avatar: (p && p.avatarfull) || (p && p.avatarmedium) || (p && p.avatar) || session.avatar || '',
    online: p && p.personastate !== 0 ? 1 : 0,
    gameid: p && p.gameid ? String(p.gameid) : '',
    game_name: p && p.gameextrainfo ? p.gameextrainfo : '',
    updated_at: nowIso,
  };

  await db.prepare(
    `INSERT INTO presence (steamid, personaname, avatar, online, gameid, game_name, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(steamid) DO UPDATE SET personaname = excluded.personaname, avatar = excluded.avatar, online = excluded.online, gameid = excluded.gameid, game_name = excluded.game_name, updated_at = excluded.updated_at`
  ).bind(steamId, row.personaname, row.avatar, row.online, row.gameid, row.game_name, nowIso).run();

  return jsonResponse(mapRow(row));
}

function mapRow(r) {
  return {
    steamId: r.steamid,
    nickname: r.personaname,
    avatar: r.avatar,
    online: !!r.online,
    gameId: r.gameid,
    gameName: r.game_name,
    updatedAt: r.updated_at,
  };
}
