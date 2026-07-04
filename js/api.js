// All network calls to NWS and Open-Meteo. Every function here returns
// { data, stale, timestamp } (see fetchJsonCached in cache.js) so the caller
// can decide how to label the result in the UI.

const API = {};

// Round coordinates for cache keys / NWS requests — NWS's own docs note
// excess precision can cause point lookups to miss, and it also keeps
// cache keys stable for "the same spot" instead of churning on float noise.
function roundCoord(n) {
  return Math.round(n * 10000) / 10000;
}

function cacheKey(name, lat, lon) {
  return `pyrot3ch:${name}:${roundCoord(lat)},${roundCoord(lon)}`;
}

API.validateCoords = function (lat, lon) {
  if (Number.isNaN(lat) || Number.isNaN(lon)) {
    return { valid: false, message: 'Enter numbers for both latitude and longitude.' };
  }
  if (lat < -90 || lat > 90) {
    return { valid: false, message: 'Latitude must be between -90 and 90.' };
  }
  if (lon < -180 || lon > 180) {
    return { valid: false, message: 'Longitude must be between -180 and 180.' };
  }
  return { valid: true };
};

// --- Open-Meteo ---------------------------------------------------------

API.getOpenMeteoForecast = async function (lat, lon) {
  const params = new URLSearchParams({
    latitude: lat,
    longitude: lon,
    current: [
      'temperature_2m',
      'relative_humidity_2m',
      'precipitation',
      'wind_speed_10m',
      'wind_direction_10m',
      'wind_gusts_10m',
    ].join(','),
    hourly: [
      'temperature_2m',
      'relative_humidity_2m',
      'precipitation_probability',
      'precipitation',
      'wind_speed_10m',
      'wind_direction_10m',
      'wind_gusts_10m',
      `wind_speed_${THRESHOLDS.WIND_ALOFT_HEIGHT_M}m`,
      'visibility',
    ].join(','),
    forecast_days: 16,
    wind_speed_unit: 'mph',
    temperature_unit: 'fahrenheit',
    precipitation_unit: 'inch',
    timezone: 'auto',
  });
  const url = `https://api.open-meteo.com/v1/forecast?${params}`;
  return fetchJsonCached(cacheKey('openmeteo-forecast', lat, lon), url);
};

API.getElevation = async function (lat, lon) {
  const params = new URLSearchParams({ latitude: lat, longitude: lon });
  const url = `https://api.open-meteo.com/v1/elevation?${params}`;
  return fetchJsonCached(cacheKey('elevation', lat, lon), url);
};

// Coarse monthly outlook for shows more than 16 days out. SEAS5 anomaly
// data, not a real forecast — the UI must label it as such.
API.getSeasonalOutlook = async function (lat, lon) {
  const params = new URLSearchParams({
    latitude: lat,
    longitude: lon,
    monthly: ['temperature_2m_mean', 'temperature_2m_anomaly', 'precipitation_sum', 'precipitation_anomaly'].join(','),
  });
  const url = `https://seasonal-api.open-meteo.com/v1/seasonal?${params}`;
  return fetchJsonCached(cacheKey('seasonal', lat, lon), url);
};

// --- NWS -----------------------------------------------------------------
// No custom User-Agent here on purpose — the browser's default header is
// fine, and setting a custom one triggers a CORS preflight that NWS
// rejects for browser-based clients.

API.getNwsPoint = async function (lat, lon) {
  const url = `https://api.weather.gov/points/${roundCoord(lat)},${roundCoord(lon)}`;
  return fetchJsonCached(cacheKey('nws-point', lat, lon), url);
};

API.getNwsHourlyForecast = async function (forecastHourlyUrl, lat, lon) {
  return fetchJsonCached(cacheKey('nws-hourly', lat, lon), forecastHourlyUrl);
};

API.getNwsAlerts = async function (lat, lon) {
  const url = `https://api.weather.gov/alerts/active?point=${roundCoord(lat)},${roundCoord(lon)}`;
  const result = await fetchJsonCached(cacheKey('nws-alerts', lat, lon), url);
  const relevantEvents = new Set([...ALERT_EVENTS.NOGO, ...ALERT_EVENTS.CAUTION]);
  const features = (result.data.features || []).filter((f) => relevantEvents.has(f.properties.event));
  return { ...result, data: features };
};

API.getNwsLatestObservation = async function (observationStationsUrl, lat, lon) {
  const stationsResult = await fetchJsonCached(cacheKey('nws-stations', lat, lon), observationStationsUrl);
  const stations = stationsResult.data.features || [];
  if (stations.length === 0) return null;

  // NWS returns stations ordered nearest-first; walk until one has a
  // recent-enough observation instead of assuming the very first works.
  for (const station of stations.slice(0, 5)) {
    const stationId = station.properties.stationIdentifier;
    try {
      const obsUrl = `https://api.weather.gov/stations/${stationId}/observations/latest`;
      const result = await fetchJsonCached(cacheKey(`nws-obs-${stationId}`, lat, lon), obsUrl);
      const ageMinutes = (Date.now() - new Date(result.data.properties.timestamp).getTime()) / 60000;
      if (ageMinutes <= THRESHOLDS.STALE_OBSERVATION_MINUTES) {
        return { ...result, data: result.data.properties, stationId, ageMinutes };
      }
    } catch (err) {
      // try the next station
    }
  }
  return null;
};
