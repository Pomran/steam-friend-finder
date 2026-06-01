export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } });
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
  await db.exec(`ALTER TABLE recruiting_posts ADD COLUMN IF NOT EXISTS team_type TEXT NOT NULL DEFAULT ''`);
  const url = new URL(request.url);
  const page = parseInt(url.searchParams.get('page')) || 1;
  const limit = Math.min(parseInt(url.searchParams.get('limit')) || 20, 50);
  const offset = (page - 1) * limit;
  const gameFilter = url.searchParams.get('game_appid');
  try {
    let query, countQuery, bindings;
    if (gameFilter) {
      query = `SELECT * FROM recruiting_posts WHERE status = 1 AND game_appid = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`;
      countQuery = `SELECT COUNT(*) as total FROM recruiting_posts WHERE status = 1 AND game_appid = ?`;
      bindings = [gameFilter, limit, offset];
    } else {
      query = `SELECT * FROM recruiting_posts WHERE status = 1 ORDER BY created_at DESC LIMIT ? OFFSET ?`;
      countQuery = `SELECT COUNT(*) as total FROM recruiting_posts WHERE status = 1`;
      bindings = [limit, offset];
    }
    const { results } = await db.prepare(query).bind(...bindings).all();
    const { results: countResult } = await db.prepare(countQuery).bind(...(gameFilter ? [gameFilter] : [])).all();
    const total = countResult?.[0]?.total || 0;
    const posts = (results || []).map(r => ({
      ...r,
      member_list: safeJsonParse(r.member_list),
      member_count: safeJsonParse(r.member_list).length,
    }));
    return new Response(JSON.stringify({ posts, total }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, s-maxage=60' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
  }
}
function safeJsonParse(s) {
  try { return JSON.parse(s); } catch { return []; }
}
