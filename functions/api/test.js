export async function onRequest(context) {
  return new Response(JSON.stringify({ ok: true, method: context.request.method, url: context.request.url }), {
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}
