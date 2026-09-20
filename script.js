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

// Слои доступности
const layerGroups = {};
let layersVisible = false;

const statusEl = document.getElementById('status');

function setStatus(text, type = '') {
  statusEl.textContent = text;
  statusEl.className = type;
}

// ====== Поиск адресов с подсказками ======
async function searchAddresses(query) {
  // viewbox — ограничение по Москве и окрестностям (юго-запад, северо-восток)
  const viewbox = '36.5,56.0,38.5,55.4';
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=6&accept-language=ru&bounded=0&viewbox=${viewbox}&q=${encodeURIComponent(query)}`;
  const res = await fetch(url);
  return await res.json();
}

function showSuggestions(containerId, items, onPick) {
  const el = document.getElementById(containerId);
  el.innerHTML = '';
  if (!items.length) return;

  items.forEach(item => {
    const div = document.createElement('div');
    div.className = 'suggest-item';
    div.textContent = item.display_name;
    div.onclick = () => {
      el.innerHTML = '';
      onPick(item);
    };
    el.appendChild(div);
  });
}

// Обработка ввода "Откуда"
let fromDebounce = null;
document.getElementById('from').addEventListener('input', (e) => {
  clearTimeout(fromDebounce);
  const q = e.target.value.trim();
  if (q.length < 3) {
    document.getElementById('fromSuggest').innerHTML = '';
    return;
  }
  fromDebounce = setTimeout(async () => {
    const results = await searchAddresses(q);
    showSuggestions('fromSuggest', results, (item) => {
      document.getElementById('from').value = item.display_name;
      document.getElementById('from').dataset.lat = item.lat;
      document.getElementById('from').dataset.lon = item.lon;
    });
  }, 500);
});

// Обработка ввода "Куда"
let toDebounce = null;
document.getElementById('to').addEventListener('input', (e) => {
  clearTimeout(toDebounce);
  const q = e.target.value.trim();
  if (q.length < 3) {
    document.getElementById('toSuggest').innerHTML = '';
    return;
  }
  toDebounce = setTimeout(async () => {
    const results = await searchAddresses(q);
    showSuggestions('toSuggest', results, (item) => {
      document.getElementById('to').value = item.display_name;
      document.getElementById('to').dataset.lat = item.lat;
      document.getElementById('to').dataset.lon = item.lon;
    });
  }, 500);
});

// ====== Моё местоположение ======
function useMyLocation() {
  if (!navigator.geolocation) {
    setStatus('Геолокация не поддерживается', 'error');
    return;
  }
  setStatus('Определяю местоположение...');
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude, longitude } = pos.coords;
      const inp = document.getElementById('from');
      inp.value = 'Моё местоположение';
      inp.dataset.lat = latitude;
      inp.dataset.lon = longitude;
      setStatus('Местоположение определено', 'success');
    },
    (err) => setStatus('Ошибка геолокации: ' + err.message, 'error'),
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

// ====== Построение маршрута ======
async function buildRoute() {
  const fromEl = document.getElementById('from');
  const toEl = document.getElementById('to');

  let from = fromEl.dataset.lat
    ? { lat: parseFloat(fromEl.dataset.lat), lon: parseFloat(fromEl.dataset.lon) }
    : null;
  let to = toEl.dataset.lat
    ? { lat: parseFloat(toEl.dataset.lat), lon: parseFloat(toEl.dataset.lon) }
    : null;

  // Если координат нет — ищем по введённому тексту
  if (!from && fromEl.value.trim()) {
    setStatus('Ищу адрес "Откуда"...');
    const r = await searchAddresses(fromEl.value.trim());
    if (r.length) from = { lat: parseFloat(r[0].lat), lon: parseFloat(r[0].lon) };
  }
  if (!to && toEl.value.trim()) {
    setStatus('Ищу адрес "Куда"...');
    const r = await searchAddresses(toEl.value.trim());
    if (r.length) to = { lat: parseFloat(r[0].lat), lon: parseFloat(r[0].lon) };
  }

  if (!from || !to) {
    setStatus('Не удалось определить адреса. Выберите из подсказок.', 'error');
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
  setStatus(`Готово: ${km} км, ~${min} мин.`, 'success');
}

// ====== Озвучка ======
let isSpeaking = false;
let currentUtterance = null;

function toggleVoice() {
  if (isSpeaking) {
    stopVoice();
  } else {
    speakRoute();
  }
}

function stopVoice() {
  speechSynthesis.cancel();
  isSpeaking = false;
  currentUtterance = null;
  const btn = document.getElementById('voiceBtn');
  btn.textContent = '🔊';
  btn.classList.remove('speaking');
  setStatus('Озвучка остановлена');
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
  isSpeaking = true;
  const vbtn = document.getElementById('voiceBtn');
  vbtn.textContent = '⏹';
  vbtn.classList.add('speaking');
  
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

  // Произносим по очереди, с отслеживанием
  let index = 0;

  function speakNext() {
    if (!isSpeaking || index >= texts.length) {
  if (index >= texts.length) {
        isSpeaking = false;
        const b = document.getElementById('voiceBtn');
        b.textContent = '🔊';
        b.classList.remove('speaking');
        setStatus('Озвучка завершена', 'success');
      }
      return;
    }

    const u = new SpeechSynthesisUtterance(texts[index]);
    u.lang = 'ru-RU';
    u.rate = 0.95;
    u.onend = () => {
      index++;
      speakNext();
    };
    u.onerror = () => {
      isSpeaking = false;
      document.getElementById('voiceBtn').textContent = '🔊';
    };
    currentUtterance = u;
    speechSynthesis.speak(u);
  }

  speakNext();
  setStatus('Озвучиваю маршрут... (нажми ⏹ для стоп)', 'success');
}

// ====== Слои доступности (Overpass API) ======
function toggleLayers() {
  const panel = document.getElementById('layers');
  panel.classList.toggle('hidden');

  if (!layersVisible && panel.classList.contains('hidden') === false) {
    loadAccessibilityLayers();
    layersVisible = true;
  }
}

async function loadAccessibilityLayers() {
  setStatus('Загружаю данные о доступности...');

  // Ограничим область видимой частью карты
  const b = map.getBounds();
  const bbox = `${b.getSouth()},${b.getWest()},${b.getNorth()},${b.getEast()}`;

  const query = `
    [out:json][timeout:25];
    (
      node["ramp"="yes"](${bbox});
      node["wheelchair"="yes"](${bbox});
      node["highway"="elevator"](${bbox});
      node["amenity"="toilets"]["wheelchair"="yes"](${bbox});
      node["amenity"="parking"]["parking:disabled"="yes"](${bbox});
      node["wheelchair"="no"](${bbox});
    );
    out body;
  `;

  const url = 'https://overpass-api.de/api/interpreter';
  try {
    const res = await fetch(url, {
      method: 'POST',
      body: 'data=' + encodeURIComponent(query)
    });
    const data = await res.json();

    // Инициализируем группы
    ['ramps', 'entrances', 'elevators', 'toilets', 'parking', 'noAccess'].forEach(k => {
      if (!layerGroups[k]) {
        layerGroups[k] = L.layerGroup().addTo(map);
      } else {
        layerGroups[k].clearLayers();
      }
    });

    data.elements.forEach(el => {
      if (!el.lat || !el.lon) return;
      const tags = el.tags || {};
      let group = null, emoji = '', label = '';

      if (tags.wheelchair === 'no') {
        group = 'noAccess'; emoji = '🔴'; label = 'Недоступно';
      } else if (tags.highway === 'elevator') {
        group = 'elevators'; emoji = '🟣'; label = 'Лифт';
      } else if (tags.amenity === 'toilets') {
        group = 'toilets'; emoji = '🟠'; label = 'Доступный туалет';
      } else if (tags.amenity === 'parking') {
        group = 'parking'; emoji = '🟡'; label = 'Парковка для инвалидов';
      } else if (tags.ramp === 'yes') {
        group = 'ramps'; emoji = '🔵'; label = 'Пандус';
      } else if (tags.wheelchair === 'yes') {
        group = 'entrances'; emoji = '🟢'; label = 'Доступный вход';
      }

      if (!group) return;

      const marker = L.circleMarker([el.lat, el.lon], {
        radius: 8,
        color: '#fff',
        weight: 2,
        fillOpacity: 1,
        fillColor: getColorForGroup(group)
      }).bindPopup(`<b>${emoji} ${label}</b>${tags.name ? '<br>' + tags.name : ''}`);

      layerGroups[group].addLayer(marker);
    });

    // Применяем текущие чекбоксы
    ['ramps', 'entrances', 'elevators', 'toilets', 'parking', 'noAccess'].forEach(k => {
      toggleLayer(k);
    });

    setStatus(`Загружено объектов: ${data.elements.length}`, 'success');
  } catch (e) {
    setStatus('Ошибка загрузки данных: ' + e.message, 'error');
  }
}

function getColorForGroup(group) {
  switch (group) {
    case 'ramps': return '#2b7de9';
    case 'entrances': return '#34a853';
    case 'elevators': return '#6a1b9a';
    case 'toilets': return '#ff9800';
    case 'parking': return '#fbc02d';
    case 'noAccess': return '#d32f2f';
    default: return '#999';
  }
}

function toggleLayer(name) {
  const checkbox = document.getElementById('layer' + name.charAt(0).toUpperCase() + name.slice(1));
  if (!checkbox || !layerGroups[name]) return;

  if (checkbox.checked) {
    if (!map.hasLayer(layerGroups[name])) layerGroups[name].addTo(map);
  } else {
    if (map.hasLayer(layerGroups[name])) map.removeLayer(layerGroups[name]);
  }
}
