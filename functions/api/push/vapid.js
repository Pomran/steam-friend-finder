import { jsonResponse } from '../../lib/http';

export async function onRequest(context) {
  return jsonResponse({ publicKey: context.env.VAPID_PUBLIC_KEY || '' });
}
