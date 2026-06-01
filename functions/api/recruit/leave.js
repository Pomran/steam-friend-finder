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
  await db.exec(`ALTER TABLE recruiting_posts ADD COLUMN IF NOT EXISTS team_type TEXT NOT NULL DEFAULT ''`);
  let body;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
  }
  const { post_id, steamid } = body;
  if (!post_id || !steamid) {
    return new Response(JSON.stringify({ error: 'Missing post_id or steamid' }), { status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
  }
  try {
    const { results } = await db.prepare(`SELECT * FROM recruiting_posts WHERE id = ?`).bind(post_id).all();
    if (!results || !results.length) {
      return new Response(JSON.stringify({ error: 'Post not found' }), { status: 404, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
    }
    const post = results[0];
    if (post.creator_steamid === steamid) {
      return new Response(JSON.stringify({ error: 'Creator cannot leave, use close instead' }), { status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
    }
    const members = safeJsonParse(post.member_list);
    const idx = members.findIndex(m => m.steamid === steamid);
    if (idx === -1) {
      return new Response(JSON.stringify({ error: 'Not a member' }), { status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
    }
    members.splice(idx, 1);
    const now = new Date().toISOString();
    if (members.length <= 1) {
      await db.prepare(`UPDATE recruiting_posts SET member_list = ?, status = 0, updated_at = ? WHERE id = ?`).bind(JSON.stringify(members), now, post_id).run();
    } else {
      await db.prepare(`UPDATE recruiting_posts SET member_list = ?, updated_at = ? WHERE id = ?`).bind(JSON.stringify(members), now, post_id).run();
    }
    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
  }
}
function safeJsonParse(s) {
  try { return JSON.parse(s); } catch { return []; }
}
