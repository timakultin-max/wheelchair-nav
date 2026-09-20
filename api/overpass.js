export default async function handler(req, res) {
  // Разрешаем только POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // CORS для нашего же домена
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // Тело запроса — это Overpass-запрос (строка)
    const body = typeof req.body === 'string' ? req.body : req.body.data || '';
    const query = decodeURIComponent(body.replace(/^data=/, ''));

    if (!query) {
      return res.status(400).json({ error: 'Empty query' });
    }

    // Обращаемся к Overpass с сервера — CORS не действует
    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'data=' + encodeURIComponent(query),
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: 'Overpass error: ' + response.status });
    }

    const data = await response.json();
    res.setHeader('Cache-Control', 's-maxage=300'); // кэш на 5 минут
    return res.status(200).json(data);
  } catch (e) {
    return res.status(500).json({ error: 'Proxy error: ' + e.message });
  }
}
