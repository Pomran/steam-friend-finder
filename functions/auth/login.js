import { buildLoginUrl } from '../lib/openid';

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const returnTo = `${url.origin}/auth/return`;
  const realm = url.origin;
  return Response.redirect(buildLoginUrl(returnTo, realm), 302);
}
