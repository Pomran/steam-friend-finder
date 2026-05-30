export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } });
  }
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
  }

  const db = env.steam_strangers;
  await db.exec("CREATE TABLE IF NOT EXISTS stranger_users (steamid TEXT PRIMARY KEY, personaname TEXT NOT NULL DEFAULT '', avatar TEXT NOT NULL DEFAULT '', top5_json TEXT NOT NULL DEFAULT '[]', opt_in INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '')");

  let body;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
  }

  const { steamid, personaname, avatar, top5, opt_in } = body;
  if (!steamid) {
    return new Response(JSON.stringify({ error: 'Missing steamid' }), { status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
  }

  const now = new Date().toISOString();
  const top5Json = JSON.stringify(top5 || []);

  try {
    if (opt_in) {
      await db.prepare(
        `INSERT INTO stranger_users (steamid, personaname, avatar, top5_json, opt_in, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)
         ON CONFLICT(steamid) DO UPDATE SET
           personaname = excluded.personaname,
           avatar = excluded.avatar,
           top5_json = excluded.top5_json,
           opt_in = 1,
           updated_at = excluded.updated_at`
      ).bind(steamid, personaname || '', avatar || '', top5Json, now, now).run();
    } else {
      await db.prepare(`DELETE FROM stranger_users WHERE steamid = ?`).bind(steamid).run();
    }
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
  }

  return new Response(JSON.stringify({ success: true }), {
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}
