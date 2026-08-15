import { getSession } from '../lib/openid';
import { jsonResponse, corsResponse } from '../lib/http';

const LOBBY_TABLE = "CREATE TABLE IF NOT EXISTS lobbies (id TEXT PRIMARY KEY, host_steamid TEXT NOT NULL DEFAULT '', host_name TEXT NOT NULL DEFAULT '', host_avatar TEXT NOT NULL DEFAULT '', game_name TEXT NOT NULL DEFAULT '', appid TEXT NOT NULL DEFAULT '', max_players INTEGER NOT NULL DEFAULT 4, play_time TEXT NOT NULL DEFAULT '', room_code TEXT NOT NULL DEFAULT '', voice_url TEXT NOT NULL DEFAULT '', tags_json TEXT NOT NULL DEFAULT '[]', players_json TEXT NOT NULL DEFAULT '[]', require_approval INTEGER NOT NULL DEFAULT 0, pending_json TEXT NOT NULL DEFAULT '[]', status INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '')";
const PRESENCE_TABLE = "CREATE TABLE IF NOT EXISTS presence (steamid TEXT PRIMARY KEY, personaname TEXT NOT NULL DEFAULT '', avatar TEXT NOT NULL DEFAULT '', online INTEGER NOT NULL DEFAULT 0, gameid TEXT NOT NULL DEFAULT '', game_name TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '')";
const PRESENCE_TTL_MS = 5 * 60 * 1000;

function safeJsonParse(s) {
  try { return JSON.parse(s); } catch { return []; }
}

function mapLobbyRow(r) {
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

function mapPresenceRow(r) {
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

async function ensureSchema(db) {
  await db.exec(LOBBY_TABLE);
  await db.exec(PRESENCE_TABLE);
  const alters = [
    "ALTER TABLE lobbies ADD COLUMN appid TEXT NOT NULL DEFAULT ''",
    'ALTER TABLE lobbies ADD COLUMN require_approval INTEGER NOT NULL DEFAULT 0',
    "ALTER TABLE lobbies ADD COLUMN pending_json TEXT NOT NULL DEFAULT '[]'",
  ];
  for (const sql of alters) {
    try { await db.exec(sql); } catch (e) {
      const msg = String(e && e.message || '');
      if (!/duplicate|already exists/i.test(msg)) console.error('bootstrap alter failed:', msg);
    }
  }
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return corsResponse('GET, OPTIONS');

  const db = env.steam_strangers;
  await ensureSchema(db);

  const session = await getSession(request, env.SESSION_SECRET);
  const cutoff = new Date(Date.now() - PRESENCE_TTL_MS).toISOString();

  const [lobbyRes, presenceRes] = await Promise.all([
    db.prepare('SELECT * FROM lobbies WHERE status = 1 ORDER BY created_at DESC LIMIT 50').all(),
    db.prepare('SELECT * FROM presence WHERE updated_at >= ? ORDER BY online DESC, game_name ASC, personaname ASC').bind(cutoff).all(),
  ]);

  return jsonResponse({
    me: session ? { loggedIn: true, user: session } : { loggedIn: false },
    lobby: (lobbyRes.results || []).map(mapLobbyRow),
    presence: (presenceRes.results || []).map(mapPresenceRow),
    serverTime: Date.now(),
  });
}
