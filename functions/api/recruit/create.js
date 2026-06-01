export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } });
  }
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
  }
  const db = env.steam_strangers;
  await db.exec(`CREATE TABLE IF NOT EXISTS recruiting_posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    creator_steamid TEXT NOT NULL DEFAULT '',
    creator_name TEXT NOT NULL DEFAULT '',
    creator_avatar TEXT NOT NULL DEFAULT '',
    game_appid TEXT NOT NULL DEFAULT '',
    game_name TEXT NOT NULL DEFAULT '',
    game_img_icon_url TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    min_hours INTEGER NOT NULL DEFAULT 0,
    max_members INTEGER NOT NULL DEFAULT 4,
    member_list TEXT NOT NULL DEFAULT '[]',
    status INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT ''
  )`);
  const { results: cols } = await db.prepare("PRAGMA table_info('recruiting_posts')").all();
  if (!cols.some(c => c.name === 'team_type')) {
    await db.exec("ALTER TABLE recruiting_posts ADD COLUMN team_type TEXT NOT NULL DEFAULT ''");
  }
  let body;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
  }
  const { creator_steamid, creator_name, creator_avatar, game_appid, game_name, game_img_icon_url, max_members, team_type } = body;
  if (!creator_steamid || !game_appid) {
    return new Response(JSON.stringify({ error: 'Missing creator_steamid or game_appid' }), { status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
  }
  const now = new Date().toISOString();
  const memberList = JSON.stringify([{ steamid: creator_steamid, personaname: creator_name || '', avatar: creator_avatar || '' }]);
  try {
    const { meta } = await db.prepare(
      `INSERT INTO recruiting_posts (creator_steamid, creator_name, creator_avatar, game_appid, game_name, game_img_icon_url, max_members, member_list, team_type, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
    ).bind(creator_steamid, creator_name || '', creator_avatar || '', game_appid, game_name || '', game_img_icon_url || '', max_members || 4, memberList, team_type || '', now, now).run();
    return new Response(JSON.stringify({ success: true, id: meta.last_row_id }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
  }
}
