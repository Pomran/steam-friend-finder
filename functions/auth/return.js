import { verifySteamLogin, sessionRedirect } from '../lib/openid';

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const base = url.origin;
  const steamId = await verifySteamLogin(url);
  if (!steamId) return Response.redirect(`${base}/play?login=failed`, 302);

  let nickname = '';
  let avatar = '';
  if (env.STEAM_API_KEY) {
    try {
      const res = await fetch(
        `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${env.STEAM_API_KEY}&steamids=${steamId}`
      );
      const data = await res.json();
      const p = data.response && data.response.players && data.response.players[0];
      if (p) {
        nickname = p.personaname || '';
        avatar = p.avatarfull || p.avatarmedium || p.avatar || '';
      }
    } catch (e) {
      console.error('GetPlayerSummaries failed', e.message);
    }
  }

  const user = { steamId, nickname, avatar };
  return sessionRedirect(`${base}/play?login=success`, user, env.SESSION_SECRET);
}
