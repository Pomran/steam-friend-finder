export default {
  async fetch(request) {
    const url = new URL(request.url);
    const target = url.searchParams.get('url');
    if (!target) return new Response('Missing ?url= parameter', { status: 400 });

    const accept = request.headers.get('Accept') || '';
    const isImg = accept.startsWith('image/');
    const res = await fetch(target, {
      method: request.method,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': isImg ? 'image/webp,image/apng,image/*,*/*;q=0.8' : accept,
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Referer': 'https://steamcommunity.com/',
      },
    });

    const newHeaders = new Headers(res.headers);
    newHeaders.set('Access-Control-Allow-Origin', '*');
    newHeaders.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    newHeaders.set('Access-Control-Allow-Headers', '*');
    newHeaders.set('Cache-Control', 'public, max-age=86400');

    return new Response(res.body, { status: res.status, headers: newHeaders });
  },
};
