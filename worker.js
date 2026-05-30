export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': '*' } });
    }
    const url = new URL(request.url);
    const target = url.searchParams.get('url');
    if (!target) return new Response('Missing ?url= parameter', { status: 400 });

    const res = await fetch(target, {
      method: request.method,
      headers: request.headers,
      redirect: "follow",
    });

    const newHeaders = new Headers(res.headers);
    newHeaders.set('Access-Control-Allow-Origin', '*');
    newHeaders.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    newHeaders.set('Access-Control-Allow-Headers', '*');
    newHeaders.set('Cache-Control', 'public, max-age=86400');

    return new Response(res.body, { status: res.status, headers: newHeaders });
  },
};
