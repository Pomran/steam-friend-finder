export async function onRequest(context) {
  try {
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
  const url = new URL(request.url);
  const steamid = url.searchParams.get('steamid');
  if (!steamid) {
    return new Response(JSON.stringify({ error: 'Missing steamid' }), { status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
  }
  try {
    const { results } = await db.prepare(
      `SELECT * FROM recruiting_posts WHERE creator_steamid = ? OR member_list LIKE ? ORDER BY created_at DESC`
    ).bind(steamid, `%${steamid}%`).all();
    const posts = (results || []).map(r => ({
      ...r,
      member_list: safeJsonParse(r.member_list),
      member_count: safeJsonParse(r.member_list).length,
    }));
    return new Response(JSON.stringify(posts), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
  }
  } catch (err) {
    return new Response(JSON.stringify({ outer: err.message }), { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
  }
}
function safeJsonParse(s) {
  try { return JSON.parse(s); } catch { return []; }
}
