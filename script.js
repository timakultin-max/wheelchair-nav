// ====== Карта ======
const map = L.map('map').setView([55.751244, 37.618423], 13);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '© OpenStreetMap'
}).addTo(map);

let fromMarker = null;
let toMarker = null;
let routeLine = null;
let routeSteps = [];

const statusEl = document.getElementById('status');

function setStatus(text, type = '') {
  statusEl.textContent = text;
  statusEl.className = type;
}

async function geocode(query) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { 'Accept-Language': 'ru' } });
  const data = await res.json();
  if (!data.length) return null;
  return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
}

function useMyLocation() {
  if (!navigator.geolocation) {
    setStatus('Геолокация не поддерживается', 'error');
    return;
  }
  setStatus('Определяю местоположение...');
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude, longitude } = pos.coords;
      document.getElementById('from').value = `${latitude},${longitude}`;
      setStatus('Местоположение определено', 'success');
    },
    (err) => setStatus('Ошибка геолокации: ' + err.message, 'error'),
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

async function buildRoute() {
  const fromText = document.getElementById('from').value.trim();
  const toText = document.getElementById('to').value.trim();

  if (!fromText || !toText) {
    setStatus('Введите адреса "Откуда" и "Куда"', 'error');
    return;
  }

  setStatus('Ищу адреса...');

  const parseCoords = (s) => {
    const m = s.match(/^(-?\d+\.?\d*),\s*(-?\d+\.?\d*)$/);
    return m ? { lat: parseFloat(m[1]), lon: parseFloat(m[2]) } : null;
  };

  let from = parseCoords(fromText) || await geocode(fromText);
  let to = parseCoords(toText) || await geocode(toText);

  if (!from || !to) {
    setStatus('Не удалось найти один из адресов', 'error');
    return;
  }

  setStatus('Строю маршрут...');

  const url = `https://router.project-osrm.org/route/v1/foot/${from.lon},${from.lat};${to.lon},${to.lat}?overview=full&geometries=geojson&steps=true`;
  const res = await fetch(url);
  const data = await res.json();

  if (!data.routes || !data.routes.length) {
    setStatus('Маршрут не найден', 'error');
    return;
  }

  const route = data.routes[0];
  const coords = route.geometry.coordinates.map(c => [c[1], c[0]]);

  if (fromMarker) map.removeLayer(fromMarker);
  if (toMarker) map.removeLayer(toMarker);
  if (routeLine) map.removeLayer(routeLine);

  fromMarker = L.marker([from.lat, from.lon]).addTo(map).bindPopup('Откуда');
  toMarker = L.marker([to.lat, to.lon]).addTo(map).bindPopup('Куда');
  routeLine = L.polyline(coords, { color: '#2b7de9', weight: 6 }).addTo(map);

  map.fitBounds(routeLine.getBounds(), { padding: [60, 60] });

  routeSteps = [];
  route.legs.forEach(leg => {
    leg.steps.forEach(step => {
      const dist = Math.round(step.distance);
      if (dist < 3) return;
      routeSteps.push({
        dist,
        type: step.maneuver.type,
        modifier: step.maneuver.modifier || '',
        name: step.name || ''
      });
    });
  });

  const km = (route.distance / 1000).toFixed(2);
  const min = Math.round(route.duration / 60);
  setStatus(`Готово: ${km} км, ~${min} мин. Нажми 🔊 для озвучки.`, 'success');
}

function speakRoute() {
  if (!routeSteps.length) {
    setStatus('Сначала постройте маршрут', 'error');
    return;
  }
  if (!('speechSynthesis' in window)) {
    setStatus('Озвучка не поддерживается', 'error');
    return;
  }

  speechSynthesis.cancel();

  const texts = routeSteps.map(s => {
    let action = '';
    switch (s.type) {
      case 'depart': action = 'Начните движение'; break;
      case 'arrive': action = 'Вы прибыли'; break;
      case 'turn':
        action = s.modifier.includes('left') ? 'Поверните налево'
               : s.modifier.includes('right') ? 'Поверните направо'
               : 'Продолжайте движение';
        break;
      case 'continue': action = 'Продолжайте движение'; break;
      case 'roundabout': action = 'Войдите на круг'; break;
      default: action = 'Двигайтесь';
    }
    const street = s.name ? ` по ${s.name}` : '';
    return `${action}${street}. Через ${s.dist} метров.`;
  });

  texts.forEach((t) => {
    const u = new SpeechSynthesisUtterance(t);
    u.lang = 'ru-RU';
    u.rate = 0.95;
    speechSynthesis.speak(u);
  });

  setStatus('Озвучиваю маршрут...', 'success');
}
