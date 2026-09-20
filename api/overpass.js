export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Vercel сам парсит JSON-тело, если Content-Type: application/json
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (e) { /* ignore */ }
    }

    const encoded = body && body.data ? body.data : '';
    const query = decodeURIComponent(encoded);

    if (!query) {
      return res.status(400).json({ error: 'Empty query' });
    }

    // Отправляем в Overpass как form-urlencoded — как он любит
    const params = new URLSearchParams();
    params.append('data', query);

    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
        'User-Agent': 'wheelchair-nav/1.0'
      },
      body: params.toString()
    });

    const text = await response.text();

    if (!response.ok) {
      return res.status(response.status).json({ 
        error: 'Overpass error ' + response.status,
        details: text.slice(0, 500)
      });
    }

    // Overpass возвращает JSON, парсим
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      return res.status(500).json({ error: 'Invalid JSON from Overpass', details: text.slice(0, 500) });
    }

    res.setHeader('Cache-Control', 's-maxage=300');
    return res.status(200).json(data);
  } catch (e) {
    return res.status(500).json({ error: 'Proxy error: ' + e.message });
  }
}
