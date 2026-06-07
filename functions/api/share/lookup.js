function safeJsonParse(s) {
  try { return JSON.parse(s); } catch { return []; }
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } });
  }

  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  if (!code || !/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{5}$/.test(code)) {
    return new Response(JSON.stringify({ error: 'Invalid code format' }), { status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
  }

  const db = env.steam_strangers;
  await db.exec("CREATE TABLE IF NOT EXISTS share_codes (code TEXT PRIMARY KEY, steamid TEXT NOT NULL, personaname TEXT NOT NULL DEFAULT '', avatar TEXT NOT NULL DEFAULT '', top5_json TEXT NOT NULL DEFAULT '[]', recent_top5_json TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL DEFAULT '')");

  try {
    const row = await db.prepare(
      'SELECT steamid, personaname, avatar, top5_json, recent_top5_json, created_at FROM share_codes WHERE code = ?'
    ).bind(code).first();

    if (!row) {
      return new Response(JSON.stringify({ error: 'Code not found' }), { status: 404, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
    }

    const data = {
      steamid: row.steamid,
      personaname: row.personaname,
      avatar: row.avatar,
      top5: safeJsonParse(row.top5_json),
      recentTop5: safeJsonParse(row.recent_top5_json),
      createdAt: row.created_at,
    };

    return new Response(JSON.stringify(data), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, s-maxage=60' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
}
