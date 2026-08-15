import { getSession } from '../lib/openid';
import { jsonResponse } from '../lib/http';

export async function onRequest(context) {
  const { request, env } = context;
  const user = await getSession(request, env.SESSION_SECRET);
  if (!user) return jsonResponse({ loggedIn: false });
  return jsonResponse({ loggedIn: true, user });
}
