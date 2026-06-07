const CHARSET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const CODE_LEN = 5;
const MAX_ATTEMPTS = 5;

function generateCode() {
  let code = '';
  for (let i = 0; i < CODE_LEN; i++) {
    code += CHARSET[Math.floor(Math.random() * CHARSET.length)];
  }
  return code;
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } });
  }
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
  }

  const db = env.steam_strangers;
  await db.exec("CREATE TABLE IF NOT EXISTS share_codes (code TEXT PRIMARY KEY, steamid TEXT NOT NULL, personaname TEXT NOT NULL DEFAULT '', avatar TEXT NOT NULL DEFAULT '', top5_json TEXT NOT NULL DEFAULT '[]', recent_top5_json TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL DEFAULT '')");

  let body;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
  }

  const { steamid, personaname, avatar, top5, recentTop5 } = body;
  if (!steamid) {
    return new Response(JSON.stringify({ error: 'Missing steamid' }), { status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
  }

  const now = new Date().toISOString();
  const top5Json = JSON.stringify(top5 || []);
  const recentTop5Json = JSON.stringify(recentTop5 || []);

  let code;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    code = generateCode();
    const existing = await db.prepare('SELECT 1 FROM share_codes WHERE code = ?').bind(code).first();
    if (!existing) break;
    if (attempt === MAX_ATTEMPTS - 1) {
      return new Response(JSON.stringify({ error: 'Failed to generate unique code' }), { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
    }
  }

  try {
    await db.prepare(
      `INSERT INTO share_codes (code, steamid, personaname, avatar, top5_json, recent_top5_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(code, steamid, personaname || '', avatar || '', top5Json, recentTop5Json, now).run();
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
  }

  return new Response(JSON.stringify({ code }), {
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}
