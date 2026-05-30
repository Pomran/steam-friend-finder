export async function onRequest(context) {
  const url = new URL(context.request.url);
  const target = url.searchParams.get('url');
  if (!target) return new Response('Missing ?url= parameter', { status: 400 });

  const res = await fetch(target, {
    method: context.request.method,
    headers: context.request.headers,
    redirect: 'follow',
  });

  const newHeaders = new Headers(res.headers);
  newHeaders.set('Access-Control-Allow-Origin', '*');
  newHeaders.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  newHeaders.set('Access-Control-Allow-Headers', '*');

  return new Response(res.body, { status: res.status, headers: newHeaders });
}
