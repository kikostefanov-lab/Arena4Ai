const ALLOWED_ORIGINS = [
  'https://arena4.ai',
  'https://www.arena4.ai',
  'https://arena4ai.com',
  'https://www.arena4ai.com',
  // localhost entries for local dev — safe to leave in production Worker
  'http://localhost:8080',
  'http://localhost:3000',
  'http://localhost:3001',
];

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function isValidEmail(email) {
  return typeof email === 'string' &&
    email.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(origin),
    },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    // POST /api/register
    if (request.method === 'POST' && url.pathname === '/api/register') {
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ ok: false, error: 'Invalid JSON' }, 400, origin);
      }

      const { email } = body;
      if (!isValidEmail(email)) {
        return json({ ok: false, error: 'Invalid email' }, 400, origin);
      }

      try {
        await env.DB.prepare(
          'INSERT INTO registrants (email) VALUES (?)'
        ).bind(email.toLowerCase()).run();
        return json({ ok: true }, 200, origin);
      } catch (err) {
        // SQLite UNIQUE constraint error code 2067
        if (err.message && err.message.includes('UNIQUE constraint failed')) {
          return json({ ok: true, duplicate: true }, 200, origin);
        }
        console.error('DB insert error:', err);
        return json({ ok: false, error: 'Server error' }, 500, origin);
      }
    }

    // GET /api/registrants?key=ADMIN_KEY
    if (request.method === 'GET' && url.pathname === '/api/registrants') {
      const key = url.searchParams.get('key');
      if (!key || key !== env.ADMIN_KEY) {
        return json({ ok: false, error: 'Unauthorized' }, 401, origin);
      }

      const { results } = await env.DB.prepare(
        'SELECT email, created_at, source FROM registrants ORDER BY created_at DESC'
      ).all();

      return json({ ok: true, count: results.length, registrants: results }, 200, origin);
    }

    return json({ ok: false, error: 'Not found' }, 404, origin);
  },
};
