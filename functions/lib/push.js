import { sendWebPush } from './webpush';

export async function notifyHost(env, hostSteamid, { title, body, url }) {
  const db = env.steam_strangers;
  let cfg = null;
  try {
    const { results } = await db.prepare('SELECT webpush_sub_json FROM push_configs WHERE steamid = ?').bind(hostSteamid).all();
    cfg = results && results[0];
  } catch (e) {
    console.error('notifyHost: query failed', e.message);
  }
  if (!cfg || !cfg.webpush_sub_json) return;

  try {
    const sub = JSON.parse(cfg.webpush_sub_json);
    await sendWebPush(env, sub, { title, body, url });
  } catch (e) {
    console.error('notifyHost: webpush failed', e.message);
  }
}
