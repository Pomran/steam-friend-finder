export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } });
  }
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
  }

  const db = env.steam_strangers;

  let body;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
  }

  const { steamids, mySteamId } = body;
  if (!steamids || !Array.isArray(steamids) || steamids.length === 0) {
    return new Response(JSON.stringify({ error: 'Missing steamids' }), { status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
  }

  try {
    const placeholders = steamids.map(() => '?').join(',');
    const rows = await db.prepare(
      `SELECT s1.steamid, s1.week, s1.snapshot, s1.created_at
       FROM weekly_snapshots s1
       INNER JOIN (
         SELECT steamid, MAX(week) AS max_week
         FROM weekly_snapshots
         WHERE steamid IN (${placeholders})
         GROUP BY steamid
       ) s2 ON s1.steamid = s2.steamid AND s1.week = s2.max_week`
    ).bind(...steamids).all();

    return new Response(JSON.stringify({ friends: rows.results || [] }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
  }
}
