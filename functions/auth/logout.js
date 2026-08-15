import { clearSessionRedirect } from '../lib/openid';

export async function onRequest(context) {
  const url = new URL(context.request.url);
  return clearSessionRedirect(`${url.origin}/play`);
}
