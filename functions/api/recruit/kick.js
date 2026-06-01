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
  const { post_id, steamid, target_steamid } = body;
  if (!post_id || !steamid || !target_steamid) {
    return new Response(JSON.stringify({ error: 'Missing fields' }), { status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
  }
  try {
    const { results } = await db.prepare("SELECT * FROM recruiting_posts WHERE id = ? AND status = 1").bind(post_id).all();
    if (!results.length) return new Response(JSON.stringify({ error: 'Post not found or closed' }), { status: 404, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
    const post = results[0];
    if (post.creator_steamid !== steamid) {
      return new Response(JSON.stringify({ error: 'Only the creator can remove members' }), { status: 403, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
    }
    if (target_steamid === steamid) {
      return new Response(JSON.stringify({ error: 'Cannot remove yourself' }), { status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
    }
    let members = JSON.parse(post.member_list || '[]');
    const before = members.length;
    members = members.filter(m => m.steamid !== target_steamid);
    if (members.length === before) {
      return new Response(JSON.stringify({ error: 'Member not found' }), { status: 404, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
    }
    const now = new Date().toISOString();
    await db.prepare("UPDATE recruiting_posts SET member_list = ?, updated_at = ? WHERE id = ?").bind(JSON.stringify(members), now, post_id).run();
    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
  }
}
