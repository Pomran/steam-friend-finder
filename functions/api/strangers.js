export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } });
  }

  const url = new URL(request.url);
  const steamid = url.searchParams.get('steamid');
  if (!steamid) {
    return new Response(JSON.stringify({ error: 'Missing steamid' }), { status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
  }

  const db = env.steam_strangers;
  await db.exec("CREATE TABLE IF NOT EXISTS stranger_users (steamid TEXT PRIMARY KEY, personaname TEXT NOT NULL DEFAULT '', avatar TEXT NOT NULL DEFAULT '', top5_json TEXT NOT NULL DEFAULT '[]', opt_in INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '')");

  try {
    const { results } = await db.prepare(
      `SELECT steamid, personaname, avatar, top5_json FROM stranger_users
       WHERE opt_in = 1 AND steamid != ?
       ORDER BY updated_at DESC`
    ).bind(steamid).all();

    const parsed = (results || []).map(r => ({
      steamid: r.steamid,
      personaname: r.personaname,
      avatar: r.avatar,
      top5: safeJsonParse(r.top5_json),
    }));

    return new Response(JSON.stringify(parsed), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
}

function safeJsonParse(s) {
  try { return JSON.parse(s); } catch { return []; }
}
