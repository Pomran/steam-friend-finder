import { getSession } from '../../lib/openid';
import { jsonResponse, corsResponse } from '../../lib/http';
import { notifyHost } from '../../lib/push';

const ENSURE_TABLE = "CREATE TABLE IF NOT EXISTS lobbies (id TEXT PRIMARY KEY, host_steamid TEXT NOT NULL DEFAULT '', host_name TEXT NOT NULL DEFAULT '', host_avatar TEXT NOT NULL DEFAULT '', game_name TEXT NOT NULL DEFAULT '', appid TEXT NOT NULL DEFAULT '', max_players INTEGER NOT NULL DEFAULT 4, play_time TEXT NOT NULL DEFAULT '', room_code TEXT NOT NULL DEFAULT '', voice_url TEXT NOT NULL DEFAULT '', tags_json TEXT NOT NULL DEFAULT '[]', players_json TEXT NOT NULL DEFAULT '[]', require_approval INTEGER NOT NULL DEFAULT 0, pending_json TEXT NOT NULL DEFAULT '[]', status INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '')";

async function ensureSchema(db) {
  await db.exec(ENSURE_TABLE);
  // 老表可能缺列，做兼容迁移；已存在的列会报 duplicate，忽略即可
  const alters = [
    "ALTER TABLE lobbies ADD COLUMN appid TEXT NOT NULL DEFAULT ''",
    'ALTER TABLE lobbies ADD COLUMN require_approval INTEGER NOT NULL DEFAULT 0',
    "ALTER TABLE lobbies ADD COLUMN pending_json TEXT NOT NULL DEFAULT '[]'",
  ];
  for (const sql of alters) {
    try { await db.exec(sql); } catch (e) {
      const msg = String(e && e.message || '');
      if (!/duplicate|already exists/i.test(msg)) console.error('lobby alter failed:', msg);
    }
  }
}

function safeJsonParse(s) {
  try { return JSON.parse(s); } catch { return []; }
}

function genId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const arr = new Uint8Array(6);
  crypto.getRandomValues(arr);
  let s = '';
  for (let i = 0; i < 6; i++) s += chars[arr[i] % chars.length];
  return s;
}

function mapRow(r) {
  return {
    id: r.id,
    gameName: r.game_name,
    appid: r.appid || '',
    maxPlayers: r.max_players,
    playTime: r.play_time,
    roomCode: r.room_code,
    voiceUrl: r.voice_url,
    tags: safeJsonParse(r.tags_json),
    host: { steamId: r.host_steamid, nickname: r.host_name, avatar: r.host_avatar },
    players: safeJsonParse(r.players_json).map(p => ({ steamId: p.steamid, nickname: p.nickname, avatar: p.avatar })),
    pending: safeJsonParse(r.pending_json).map(p => ({ steamId: p.steamid, nickname: p.nickname, avatar: p.avatar })),
    requireApproval: !!r.require_approval,
    status: r.status,
    createdAt: r.created_at,
  };
}

async function getRawLobby(db, id) {
  const { results } = await db.prepare('SELECT * FROM lobbies WHERE id = ?').bind(id).all();
  return results && results[0] ? results[0] : null;
}

async function getLobby(db, id) {
  const row = await getRawLobby(db, id);
  return row ? mapRow(row) : null;
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return corsResponse('GET, POST, OPTIONS');

  const db = env.steam_strangers;
  await ensureSchema(db);

  const url = new URL(request.url);

  if (request.method === 'GET') {
    const id = url.searchParams.get('id');
    if (id) return handleGet(db, id);
    return handleList(db, url);
  }

  let body;
  try { body = await request.json(); } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400);
  }
  const { action } = body;
  if (!action) return jsonResponse({ error: 'Missing action' }, 400);

  const session = await getSession(request, env.SESSION_SECRET);
  if (!session) return jsonResponse({ error: '请先登录 Steam' }, 401);

  switch (action) {
    case 'create': return handleCreate(db, body, session);
    case 'join': return handleJoin(context, db, body, session);
    case 'leave': return handleLeave(db, body, session);
    case 'close': return handleClose(db, body, session);
    case 'kick': return handleKick(db, body, session);
    case 'approve': return handleApprove(context, db, body, session);
    case 'reject': return handleReject(context, db, body, session);
    case 'cancel_join': return handleCancelJoin(db, body, session);
    default: return jsonResponse({ error: `Unknown action: ${action}` }, 400);
  }
}

async function handleList(db, url) {
  const appid = (url.searchParams.get('appid') || '').trim();
  let results;
  if (appid) {
    ({ results } = await db.prepare('SELECT * FROM lobbies WHERE status = 1 AND appid = ? ORDER BY created_at DESC LIMIT 50').bind(appid).all());
  } else {
    ({ results } = await db.prepare('SELECT * FROM lobbies WHERE status = 1 ORDER BY created_at DESC LIMIT 50').all());
  }
  return jsonResponse((results || []).map(mapRow));
}

async function handleGet(db, id) {
  const lobby = await getLobby(db, id);
  if (!lobby) return jsonResponse({ error: '房间不存在' }, 404);
  return jsonResponse(lobby);
}

async function handleCreate(db, body, session) {
  const gameName = String(body.gameName || '').trim().slice(0, 60);
  if (!gameName) return jsonResponse({ error: '请填写游戏名称' }, 400);

  const maxPlayers = Math.min(50, Math.max(2, parseInt(body.maxPlayers) || 4));
  const voiceUrl = String(body.voiceUrl || '').trim().slice(0, 200);
  if (voiceUrl && !/^https?:\/\//i.test(voiceUrl)) {
    return jsonResponse({ error: '语音链接需以 http(s):// 开头' }, 400);
  }

  const roomCode = String(body.roomCode || '').trim().slice(0, 100);
  const playTime = String(body.playTime || '').trim().slice(0, 50);
  const tags = Array.isArray(body.tags) ? body.tags.slice(0, 8).map(t => String(t).slice(0, 20)) : [];
  const appid = String(body.appid || '').trim().slice(0, 10);
  if (appid && !/^\d{1,10}$/.test(appid)) {
    return jsonResponse({ error: 'appid 需为纯数字' }, 400);
  }

  const requireApproval = body.requireApproval === true || body.requireApproval === 'true' || body.requireApproval === 1 ? 1 : 0;

  const id = genId();
  const now = new Date().toISOString();
  const host = { steamid: session.steamId, nickname: session.nickname || '', avatar: session.avatar || '' };
  const players = [host];

  await db.prepare(
    `INSERT INTO lobbies (id, host_steamid, host_name, host_avatar, game_name, appid, max_players, play_time, room_code, voice_url, tags_json, players_json, require_approval, pending_json, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', 1, ?, ?)`
  ).bind(
    id, session.steamId, session.nickname || '', session.avatar || '',
    gameName, appid, maxPlayers, playTime, roomCode, voiceUrl,
    JSON.stringify(tags), JSON.stringify(players), requireApproval, now, now
  ).run();

  return jsonResponse(await getLobby(db, id));
}

async function handleJoin(context, db, body, session) {
  const { id } = body;
  if (!id) return jsonResponse({ error: '缺少房间 ID' }, 400);

  const row = await getRawLobby(db, id);
  if (!row) return jsonResponse({ error: '房间不存在' }, 404);
  if (row.status !== 1) return jsonResponse({ error: '车队已解散' }, 400);

  const players = safeJsonParse(row.players_json);
  const pending = safeJsonParse(row.pending_json);
  if (players.some(p => p.steamid === session.steamId)) return jsonResponse({ error: '你已在车队中' }, 400);

  // 需要房主同意：先进入申请列表
  if (row.require_approval) {
    if (pending.some(p => p.steamid === session.steamId)) {
      return jsonResponse({ error: '你已申请加入，请等待房主同意' }, 400);
    }
    pending.push({ steamid: session.steamId, nickname: session.nickname || '', avatar: session.avatar || '' });
    const now = new Date().toISOString();
    await db.prepare('UPDATE lobbies SET pending_json = ?, updated_at = ? WHERE id = ?').bind(JSON.stringify(pending), now, id).run();

    const title = `你的【${row.game_name}】车队收到新的入队申请`;
    const content = `玩家 [${session.nickname || session.steamId}] 申请加入车队，请及时处理。`;
    context.waitUntil(notifyHost(context.env, row.host_steamid, { title, body: content, url: `/play?room=${id}` }));

    return jsonResponse({ ok: true, requested: true, lobby: await getLobby(db, id) });
  }

  if (players.length >= row.max_players) return jsonResponse({ error: '车队已满员' }, 400);

  players.push({ steamid: session.steamId, nickname: session.nickname || '', avatar: session.avatar || '' });
  const now = new Date().toISOString();
  await db.prepare('UPDATE lobbies SET players_json = ?, updated_at = ? WHERE id = ?').bind(JSON.stringify(players), now, id).run();

  const title = `你的【${row.game_name}】车队有新玩家加入！`;
  const content = `玩家 [${session.nickname || session.steamId}] 已上车！当前进度 (${players.length}/${row.max_players})。`;
  context.waitUntil(notifyHost(context.env, row.host_steamid, { title, body: content, url: `/play?room=${id}` }));

  return jsonResponse(await getLobby(db, id));
}

async function handleLeave(db, body, session) {
  const { id } = body;
  if (!id) return jsonResponse({ error: '缺少房间 ID' }, 400);

  const row = await getRawLobby(db, id);
  if (!row) return jsonResponse({ error: '房间不存在' }, 404);
  if (row.host_steamid === session.steamId) return jsonResponse({ error: '房主不能退出，请解散车队' }, 400);

  const players = safeJsonParse(row.players_json);
  const idx = players.findIndex(p => p.steamid === session.steamId);
  if (idx === -1) return jsonResponse({ error: '你不在车队中' }, 400);
  players.splice(idx, 1);

  await db.prepare('UPDATE lobbies SET players_json = ?, updated_at = ? WHERE id = ?').bind(JSON.stringify(players), new Date().toISOString(), id).run();
  return jsonResponse(await getLobby(db, id));
}

async function handleClose(db, body, session) {
  const { id } = body;
  if (!id) return jsonResponse({ error: '缺少房间 ID' }, 400);

  const row = await getRawLobby(db, id);
  if (!row) return jsonResponse({ error: '房间不存在' }, 404);
  if (row.host_steamid !== session.steamId) return jsonResponse({ error: '只有房主能解散车队' }, 403);
  if (row.status === 0) return jsonResponse({ error: '车队已解散' }, 400);

  await db.prepare('UPDATE lobbies SET status = 0, updated_at = ? WHERE id = ?').bind(new Date().toISOString(), id).run();
  return jsonResponse({ success: true });
}

async function handleKick(db, body, session) {
  const { id, targetSteamId } = body;
  if (!id || !targetSteamId) return jsonResponse({ error: '缺少参数' }, 400);

  const row = await getRawLobby(db, id);
  if (!row) return jsonResponse({ error: '房间不存在' }, 404);
  if (row.host_steamid !== session.steamId) return jsonResponse({ error: '只有房主能踢人' }, 403);
  if (targetSteamId === session.steamId) return jsonResponse({ error: '不能踢自己' }, 400);

  const players = safeJsonParse(row.players_json);
  const before = players.length;
  const next = players.filter(p => p.steamid !== targetSteamId);
  if (next.length === before) return jsonResponse({ error: '成员不存在' }, 404);

  await db.prepare('UPDATE lobbies SET players_json = ?, updated_at = ? WHERE id = ?').bind(JSON.stringify(next), new Date().toISOString(), id).run();
  return jsonResponse(await getLobby(db, id));
}

async function handleApprove(context, db, body, session) {
  const { id, targetSteamId } = body;
  if (!id || !targetSteamId) return jsonResponse({ error: '缺少参数' }, 400);

  const row = await getRawLobby(db, id);
  if (!row) return jsonResponse({ error: '房间不存在' }, 404);
  if (row.host_steamid !== session.steamId) return jsonResponse({ error: '只有房主能处理入队申请' }, 403);
  if (row.status !== 1) return jsonResponse({ error: '车队已解散' }, 400);

  const players = safeJsonParse(row.players_json);
  const pending = safeJsonParse(row.pending_json);
  const idx = pending.findIndex(p => p.steamid === targetSteamId);
  if (idx === -1) return jsonResponse({ error: '申请不存在或已处理' }, 404);
  if (players.length >= row.max_players) return jsonResponse({ error: '车队已满员，无法通过申请' }, 400);

  const [applicant] = pending.splice(idx, 1);
  players.push(applicant);
  const now = new Date().toISOString();
  await db.prepare('UPDATE lobbies SET players_json = ?, pending_json = ?, updated_at = ? WHERE id = ?')
    .bind(JSON.stringify(players), JSON.stringify(pending), now, id).run();

  const title = `你已加入【${row.game_name}】车队`;
  const content = `房主已通过你的入队申请，当前进度 (${players.length}/${row.max_players})。`;
  context.waitUntil(notifyHost(context.env, targetSteamId, { title, body: content, url: `/play?room=${id}` }));

  return jsonResponse(await getLobby(db, id));
}

async function handleReject(context, db, body, session) {
  const { id, targetSteamId } = body;
  if (!id || !targetSteamId) return jsonResponse({ error: '缺少参数' }, 400);

  const row = await getRawLobby(db, id);
  if (!row) return jsonResponse({ error: '房间不存在' }, 404);
  if (row.host_steamid !== session.steamId) return jsonResponse({ error: '只有房主能处理入队申请' }, 403);

  const pending = safeJsonParse(row.pending_json);
  const before = pending.length;
  const next = pending.filter(p => p.steamid !== targetSteamId);
  if (next.length === before) return jsonResponse({ error: '申请不存在或已处理' }, 404);

  await db.prepare('UPDATE lobbies SET pending_json = ?, updated_at = ? WHERE id = ?')
    .bind(JSON.stringify(next), new Date().toISOString(), id).run();

  const title = `你的入队申请被拒绝`;
  const content = `很遗憾，【${row.game_name}】车队的房主没有通过你的入队申请。`;
  context.waitUntil(notifyHost(context.env, targetSteamId, { title, body: content, url: `/play?room=${id}` }));

  return jsonResponse(await getLobby(db, id));
}

async function handleCancelJoin(db, body, session) {
  const { id } = body;
  if (!id) return jsonResponse({ error: '缺少房间 ID' }, 400);

  const row = await getRawLobby(db, id);
  if (!row) return jsonResponse({ error: '房间不存在' }, 404);

  const pending = safeJsonParse(row.pending_json);
  const before = pending.length;
  const next = pending.filter(p => p.steamid !== session.steamId);
  if (next.length === before) return jsonResponse({ error: '你没有待处理的申请' }, 400);

  await db.prepare('UPDATE lobbies SET pending_json = ?, updated_at = ? WHERE id = ?')
    .bind(JSON.stringify(next), new Date().toISOString(), id).run();
  return jsonResponse(await getLobby(db, id));
}
