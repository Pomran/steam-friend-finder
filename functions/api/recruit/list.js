export async function onRequest(context) {
  const { request, env } = context;
  try {
    const db = env.steam_strangers;
    await db.exec("DROP TABLE IF EXISTS recruiting_posts");
    await db.exec("CREATE TABLE IF NOT EXISTS recruiting_posts (id INTEGER PRIMARY KEY AUTOINCREMENT, creator_steamid TEXT NOT NULL DEFAULT '', creator_name TEXT NOT NULL DEFAULT '', creator_avatar TEXT NOT NULL DEFAULT '', game_appid TEXT NOT NULL DEFAULT '', game_name TEXT NOT NULL DEFAULT '', game_img_icon_url TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '', min_hours INTEGER NOT NULL DEFAULT 0, max_members INTEGER NOT NULL DEFAULT 4, member_list TEXT NOT NULL DEFAULT '[]', status INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '')");
    const { results } = await db.prepare("SELECT COUNT(*) as cnt FROM recruiting_posts").all();
    return new Response(JSON.stringify({ ok: true, count: results[0].cnt }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
  }
}
