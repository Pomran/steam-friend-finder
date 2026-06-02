const ENSURE_TABLE = "CREATE TABLE IF NOT EXISTS recruiting_posts (id INTEGER PRIMARY KEY AUTOINCREMENT, creator_steamid TEXT NOT NULL DEFAULT '', creator_name TEXT NOT NULL DEFAULT '', creator_avatar TEXT NOT NULL DEFAULT '', game_appid TEXT NOT NULL DEFAULT '', game_name TEXT NOT NULL DEFAULT '', game_img_icon_url TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '', min_hours INTEGER NOT NULL DEFAULT 0, max_members INTEGER NOT NULL DEFAULT 4, member_list TEXT NOT NULL DEFAULT '[]', status INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '')";

function safeJsonParse(s) {
  try { return JSON.parse(s); } catch { return []; }
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}

function corsResponse(methods = 'POST, OPTIONS') {
  return new Response(null, {
    headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': methods, 'Access-Control-Allow-Headers': 'Content-Type' },
  });
}

export async function onRequest(context) {
  try {
    const { request, env } = context;
    if (request.method === 'OPTIONS') return corsResponse('GET, POST, OPTIONS');

    const db = env.steam_strangers;
    await db.exec(ENSURE_TABLE);

    const url = new URL(request.url);

    if (request.method === 'GET') {
      const action = url.searchParams.get('action');
      if (action === 'mine') return handleMine(db, url);
      return handleList(db, url);
    }

    let body;
    try { body = await request.json(); } catch {
      return jsonResponse({ error: 'Invalid JSON' }, 400);
    }
    const { action } = body;
    if (!action) return jsonResponse({ error: 'Missing action' }, 400);

    switch (action) {
      case 'create': return handleCreate(db, body);
      case 'join': return handleJoin(db, body);
      case 'leave': return handleLeave(db, body);
      case 'close': return handleClose(db, body);
      case 'kick': return handleKick(db, body);
      default: return jsonResponse({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (err) {
    return jsonResponse({ error: err.message }, 500);
  }
}

async function handleCreate(db, body) {
  const { creator_steamid, creator_name, creator_avatar, game_appid, game_name, game_img_icon_url, max_members, description, goal_type, play_time } = body;
  if (!creator_steamid || !game_appid) return jsonResponse({ error: 'Missing creator_steamid or game_appid' }, 400);
  const now = new Date().toISOString();
  const descJson = JSON.stringify({ d: description || '', g: goal_type || '', t: play_time || '' });
  const memberList = JSON.stringify([{ steamid: creator_steamid, personaname: creator_name || '', avatar: creator_avatar || '' }]);
  try {
    const { meta } = await db.prepare(
      `INSERT INTO recruiting_posts (creator_steamid, creator_name, creator_avatar, game_appid, game_name, game_img_icon_url, max_members, member_list, description, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
    ).bind(creator_steamid, creator_name || '', creator_avatar || '', game_appid, game_name || '', game_img_icon_url || '', max_members || 4, memberList, descJson, now, now).run();
    return jsonResponse({ success: true, id: meta.last_row_id });
  } catch (err) {
    return jsonResponse({ error: err.message }, 500);
  }
}

async function handleList(db, url) {
  try {
    const page = parseInt(url.searchParams.get('page')) || 1;
    const limit = Math.min(parseInt(url.searchParams.get('limit')) || 20, 50);
    const offset = (page - 1) * limit;
    const gameFilter = url.searchParams.get('game_appid');
    let query, countQuery, bindings, countBindings;
    if (gameFilter) {
      query = `SELECT * FROM recruiting_posts WHERE status = 1 AND game_appid = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`;
      countQuery = `SELECT COUNT(*) as total FROM recruiting_posts WHERE status = 1 AND game_appid = ?`;
      bindings = [gameFilter, limit, offset];
      countBindings = [gameFilter];
    } else {
      query = `SELECT * FROM recruiting_posts WHERE status = 1 ORDER BY created_at DESC LIMIT ? OFFSET ?`;
      countQuery = `SELECT COUNT(*) as total FROM recruiting_posts WHERE status = 1`;
      bindings = [limit, offset];
      countBindings = [];
    }
    const { results } = await db.prepare(query).bind(...bindings).all();
    const { results: countResult } = await db.prepare(countQuery).bind(...countBindings).all();
    const total = countResult?.[0]?.total || 0;
    const posts = (results || []).map(r => ({
      ...r, member_list: safeJsonParse(r.member_list), member_count: safeJsonParse(r.member_list).length,
    }));
    return jsonResponse({ posts, total });
  } catch (err) {
    return jsonResponse({ error: err.message }, 500);
  }
}

async function handleMine(db, url) {
  try {
    const steamid = url.searchParams.get('steamid');
    if (!steamid) return jsonResponse({ error: 'Missing steamid' }, 400);
    const { results } = await db.prepare(
      `SELECT * FROM recruiting_posts WHERE creator_steamid = ? OR member_list LIKE ? ORDER BY created_at DESC`
    ).bind(steamid, `%${steamid}%`).all();
    const posts = (results || []).map(r => ({
      ...r, member_list: safeJsonParse(r.member_list), member_count: safeJsonParse(r.member_list).length,
    }));
    return jsonResponse(posts);
  } catch (err) {
    return jsonResponse({ error: err.message }, 500);
  }
}

async function handleJoin(db, body) {
  const { post_id, steamid, personaname, avatar } = body;
  if (!post_id || !steamid) return jsonResponse({ error: 'Missing post_id or steamid' }, 400);
  try {
    const { results } = await db.prepare(`SELECT * FROM recruiting_posts WHERE id = ?`).bind(post_id).all();
    if (!results || !results.length) return jsonResponse({ error: 'Post not found' }, 404);
    const post = results[0];
    if (post.status !== 1) return jsonResponse({ error: 'Post is closed' }, 400);
    const members = safeJsonParse(post.member_list);
    if (members.length >= post.max_members) return jsonResponse({ error: 'Team is full' }, 400);
    if (members.some(m => m.steamid === steamid)) return jsonResponse({ error: 'Already a member' }, 400);
    members.push({ steamid, personaname: personaname || '', avatar: avatar || '' });
    const now = new Date().toISOString();
    await db.prepare(`UPDATE recruiting_posts SET member_list = ?, updated_at = ? WHERE id = ?`).bind(JSON.stringify(members), now, post_id).run();
    return jsonResponse({ success: true });
  } catch (err) {
    return jsonResponse({ error: err.message }, 500);
  }
}

async function handleLeave(db, body) {
  const { post_id, steamid } = body;
  if (!post_id || !steamid) return jsonResponse({ error: 'Missing post_id or steamid' }, 400);
  try {
    const { results } = await db.prepare(`SELECT * FROM recruiting_posts WHERE id = ?`).bind(post_id).all();
    if (!results || !results.length) return jsonResponse({ error: 'Post not found' }, 404);
    const post = results[0];
    if (post.creator_steamid === steamid) return jsonResponse({ error: 'Creator cannot leave, use close instead' }, 400);
    const members = safeJsonParse(post.member_list);
    const idx = members.findIndex(m => m.steamid === steamid);
    if (idx === -1) return jsonResponse({ error: 'Not a member' }, 400);
    members.splice(idx, 1);
    const now = new Date().toISOString();
    await db.prepare(`UPDATE recruiting_posts SET member_list = ?, updated_at = ? WHERE id = ?`).bind(JSON.stringify(members), now, post_id).run();
    return jsonResponse({ success: true });
  } catch (err) {
    return jsonResponse({ error: err.message }, 500);
  }
}

async function handleClose(db, body) {
  const { post_id, steamid } = body;
  if (!post_id || !steamid) return jsonResponse({ error: 'Missing post_id or steamid' }, 400);
  try {
    const { results } = await db.prepare(`SELECT * FROM recruiting_posts WHERE id = ?`).bind(post_id).all();
    if (!results || !results.length) return jsonResponse({ error: 'Post not found' }, 404);
    const post = results[0];
    if (post.creator_steamid !== steamid) return jsonResponse({ error: 'Only creator can close the post' }, 403);
    if (post.status === 0) return jsonResponse({ error: 'Post already closed' }, 400);
    const now = new Date().toISOString();
    await db.prepare(`UPDATE recruiting_posts SET status = 0, updated_at = ? WHERE id = ?`).bind(now, post_id).run();
    return jsonResponse({ success: true });
  } catch (err) {
    return jsonResponse({ error: err.message }, 500);
  }
}

async function handleKick(db, body) {
  const { post_id, steamid, target_steamid } = body;
  if (!post_id || !steamid || !target_steamid) return jsonResponse({ error: 'Missing fields' }, 400);
  try {
    const { results } = await db.prepare("SELECT * FROM recruiting_posts WHERE id = ? AND status = 1").bind(post_id).all();
    if (!results.length) return jsonResponse({ error: 'Post not found or closed' }, 404);
    const post = results[0];
    if (post.creator_steamid !== steamid) return jsonResponse({ error: 'Only the creator can remove members' }, 403);
    if (target_steamid === steamid) return jsonResponse({ error: 'Cannot remove yourself' }, 400);
    let members = safeJsonParse(post.member_list);
    const before = members.length;
    members = members.filter(m => m.steamid !== target_steamid);
    if (members.length === before) return jsonResponse({ error: 'Member not found' }, 404);
    const now = new Date().toISOString();
    await db.prepare("UPDATE recruiting_posts SET member_list = ?, updated_at = ? WHERE id = ?").bind(JSON.stringify(members), now, post_id).run();
    return jsonResponse({ success: true });
  } catch (err) {
    return jsonResponse({ error: err.message }, 500);
  }
}
