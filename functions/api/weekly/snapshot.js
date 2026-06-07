function getISOWeek(date) {
  const d = new Date(date);
  const dayNum = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dayNum + 3);
  const firstThursday = d.getTime();
  d.setUTCMonth(0, 1);
  if (d.getUTCDay() !== 4) {
    d.setUTCMonth(0, 1 + ((4 - d.getUTCDay()) + 7) % 7);
  }
  const weekNum = 1 + Math.ceil((firstThursday - d.getTime()) / 604800000);
  const y = d.getUTCFullYear();
  return `${y}-W${String(weekNum).padStart(2, '0')}`;
}

function computeDiff(currentGames, prevSnapshot) {
  const prev = JSON.parse(prevSnapshot);
  const prevMap = {};
  (prev.games || []).forEach(g => { prevMap[g.appid] = g.playtime_forever; });
  const games = (currentGames || []).map(g => {
    const prevPt = prevMap[g.appid] || 0;
    const thisWeek = Math.max((g.playtime_forever || 0) - prevPt, 0) / 60;
    const lastWeek = Math.max(prevPt - (prev.prevTotal || 0), 0) / 60;
    return {
      appid: g.appid,
      name: g.name,
      img_icon_url: g.img_icon_url || '',
      thisWeek: Math.round(thisWeek * 10) / 10,
      lastWeek: Math.round(lastWeek * 10) / 10,
      trend: thisWeek > lastWeek + 0.5 ? 'up' : (thisWeek < lastWeek - 0.5 ? 'down' : 'flat'),
    };
  }).filter(g => g.thisWeek > 0 || g.lastWeek > 0);
  const weekTotal = games.reduce((s, g) => s + g.thisWeek, 0);
  const prevTotal = games.reduce((s, g) => s + g.lastWeek, 0);
  return { games, weekTotal: Math.round(weekTotal * 10) / 10, prevTotal: Math.round(prevTotal * 10) / 10 };
}

function setDiffToZero(currentGames) {
  const games = (currentGames || []).map(g => ({
    appid: g.appid, name: g.name, img_icon_url: g.img_icon_url || '',
    thisWeek: 0, lastWeek: 0, trend: 'flat',
  }));
  return { games, weekTotal: 0, prevTotal: 0 };
}

function isConsecutiveWeek(prevWeek, currentWeek) {
  if (!prevWeek) return false;
  const prevNum = parseInt(prevWeek.split('-W')[1]);
  const curNum = parseInt(currentWeek.split('-W')[1]);
  const prevYear = parseInt(prevWeek.split('-W')[0]);
  const curYear = parseInt(currentWeek.split('-W')[0]);
  if (curYear === prevYear) return curNum - prevNum === 1;
  if (curYear === prevYear + 1 && prevNum >= 51) return curNum === 1;
  return false;
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
  await db.exec("CREATE TABLE IF NOT EXISTS weekly_snapshots (steamid TEXT NOT NULL, week TEXT NOT NULL, snapshot TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT '', PRIMARY KEY (steamid, week))");

  let body;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
  }

  const { steamid, games } = body;
  if (!steamid) {
    return new Response(JSON.stringify({ error: 'Missing steamid' }), { status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
  }

  const currentWeek = getISOWeek(new Date());
  const now = new Date().toISOString();
  const total = (games || []).reduce((s, g) => s + (g.playtime_forever || 0), 0);
  const snapshotJson = JSON.stringify({ games: games || [], total });

  let diff = { games: [], weekTotal: 0, prevTotal: 0 };

  try {
    const lastRow = await db.prepare(
      "SELECT week, snapshot FROM weekly_snapshots WHERE steamid = ? ORDER BY week DESC LIMIT 1"
    ).bind(steamid).first();

    if (lastRow) {
      if (lastRow.week === currentWeek) {
        const prevRow = await db.prepare(
          "SELECT snapshot FROM weekly_snapshots WHERE steamid = ? AND week < ? ORDER BY week DESC LIMIT 1"
        ).bind(steamid, currentWeek).first();
        diff = computeDiff(games, prevRow?.snapshot || lastRow.snapshot);
        await db.prepare(
          "UPDATE weekly_snapshots SET snapshot = ?, created_at = ? WHERE steamid = ? AND week = ?"
        ).bind(snapshotJson, now, steamid, currentWeek).run();
      } else {
        if (isConsecutiveWeek(lastRow.week, currentWeek)) {
          diff = computeDiff(games, lastRow.snapshot);
        } else {
          diff = setDiffToZero(games);
        }
        await db.prepare(
          "INSERT INTO weekly_snapshots (steamid, week, snapshot, created_at) VALUES (?, ?, ?, ?)"
        ).bind(steamid, currentWeek, snapshotJson, now).run();
      }
    } else {
      diff = setDiffToZero(games);
      await db.prepare(
        "INSERT INTO weekly_snapshots (steamid, week, snapshot, created_at) VALUES (?, ?, ?, ?)"
      ).bind(steamid, currentWeek, snapshotJson, now).run();
    }
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
  }

  return new Response(JSON.stringify({ week: currentWeek, ...diff }), {
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}
