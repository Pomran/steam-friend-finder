import { getSession } from '../../lib/openid';
import { jsonResponse, corsResponse } from '../../lib/http';
import { sendWebPush } from '../../lib/webpush';

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return corsResponse('POST, OPTIONS');
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  const session = await getSession(request, env.SESSION_SECRET);
  if (!session) return jsonResponse({ error: '未登录' }, 401);

  const db = env.steam_strangers;
  const { results } = await db.prepare('SELECT webpush_sub_json FROM push_configs WHERE steamid = ?').bind(session.steamId).all();
  const cfg = results && results[0];
  if (!cfg || !cfg.webpush_sub_json) {
    return jsonResponse({ error: '尚未绑定桌面通知，请先授权桌面弹窗' }, 400);
  }

  const payload = {
    title: '测试通知',
    body: '发车雷达通知链路正常！有队友上车时就会这样提醒你。',
    url: '/play',
  };

  try {
    const sub = JSON.parse(cfg.webpush_sub_json);
    const webpushOk = await sendWebPush(env, sub, payload);
    return jsonResponse({ success: true, webpushOk });
  } catch (e) {
    return jsonResponse({ error: 'Web Push 发送失败：' + e.message }, 500);
  }
}
