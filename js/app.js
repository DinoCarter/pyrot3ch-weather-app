// PYROT3CH Weather — DOM wiring, orchestration, and rendering.
// Data fetching lives in api.js, thresholds in config.js, pass/fail logic
// in verdict.js. This file glues them to the page.

const els = {};

document.addEventListener('DOMContentLoaded', init);

function init() {
  els.latInput = document.getElementById('lat-input');
  els.lonInput = document.getElementById('lon-input');
  els.datetimeInput = document.getElementById('datetime-input');
  els.geolocateBtn = document.getElementById('geolocate-btn');
  els.checkBtn = document.getElementById('check-btn');
  els.statusMessage = document.getElementById('status-message');

  els.headerSiteInfo = document.getElementById('header-site-info');

  els.verdictBanner = document.getElementById('verdict-banner');
  els.verdictHeadline = document.getElementById('verdict-headline');
  els.verdictSentence = document.getElementById('verdict-sentence');
  els.verdictReason = document.getElementById('verdict-reason');
  els.verdictNote = document.getElementById('verdict-note');

  els.alertsRow = document.getElementById('alerts-row');
  els.alertsChips = document.getElementById('alerts-chips');

  els.metricSection = document.getElementById('metric-section');
  els.metricGrid = document.getElementById('metric-grid');

  els.advisoriesSection = document.getElementById('advisories-section');
  els.advisoriesList = document.getElementById('advisories-list');

  els.hourlySection = document.getElementById('hourly-section');
  els.hourlyStrip = document.getElementById('hourly-strip');

  els.nwsSection = document.getElementById('nws-supplement-section');
  els.nwsLabel = document.getElementById('nws-supplement-label');
  els.nwsSupplement = document.getElementById('nws-supplement');

  els.footerCoords = document.getElementById('footer-coords');
  els.footerElevation = document.getElementById('footer-elevation');
  els.footerUpdated = document.getElementById('footer-updated');

  els.geolocateBtn.addEventListener('click', useMyLocation);
  els.checkBtn.addEventListener('click', runCheck);

  setDefaultDatetime();
}

// Just a convenient starting value in the browser's own local time — the
// user can change it, and the real math below uses the site's time zone
// (from Open-Meteo), not this default.
function setDefaultDatetime() {
  const now = new Date();
  const localMs = now.getTime() - now.getTimezoneOffset() * 60000;
  els.datetimeInput.value = new Date(localMs).toISOString().slice(0, 16);
}

function useMyLocation() {
  if (!('geolocation' in navigator)) {
    showStatus('Geolocation is not supported by this browser. Enter coordinates manually.', 'error');
    return;
  }
  showStatus('Locating…', 'info');
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      els.latInput.value = pos.coords.latitude.toFixed(5);
      els.lonInput.value = pos.coords.longitude.toFixed(5);
      showStatus('Location filled in.', 'info');
    },
    (err) => {
      const messages = {
        1: 'Location permission denied. Enter coordinates manually.',
        2: 'Location unavailable right now. Enter coordinates manually.',
        3: 'Location request timed out. Enter coordinates manually.',
      };
      showStatus(messages[err.code] || 'Could not get your location. Enter coordinates manually.', 'error');
    },
    { timeout: 10000 }
  );
}

async function runCheck() {
  clearStatus();
  const lat = parseFloat(els.latInput.value);
  const lon = parseFloat(els.lonInput.value);

  const validation = API.validateCoords(lat, lon);
  if (!validation.valid) {
    showStatus(validation.message, 'error');
    return;
  }
  if (!els.datetimeInput.value) {
    showStatus('Pick a date and time for the show.', 'error');
    return;
  }

  setLoading(true);
  try {
    await performCheck(lat, lon, els.datetimeInput.value);
  } catch (err) {
    resetResultSections();
    showStatus('Could not load weather data, and no cached data was available for this location. Check your connection and try again.', 'error');
  } finally {
    setLoading(false);
  }
}

async function performCheck(lat, lon, targetLocalStr) {
  const forecastResult = await API.getOpenMeteoForecast(lat, lon);
  const forecast = forecastResult.data;
  const utcOffsetSeconds = forecast.utc_offset_seconds;
  const timezoneName = forecast.timezone;

  const siteNowParts = resolveSiteNowParts(utcOffsetSeconds);
  const targetParts = parseDatetimeLocalParts(targetLocalStr);
  const hoursFromNow = hoursBetweenParts(siteNowParts, targetParts);
  const mode = Verdict.determineMode(hoursFromNow);

  const staleSources = [];
  let latestTimestamp = forecastResult.timestamp;
  if (forecastResult.stale) staleSources.push('Open-Meteo forecast');

  let alerts = [];
  let nwsHourlyPeriods = null;
  let nwsObs = null;
  let seasonal = null;

  if (mode === 'current' || mode === 'short') {
    try {
      const alertsResult = await API.getNwsAlerts(lat, lon);
      alerts = alertsResult.data;
      if (alertsResult.stale) staleSources.push('NWS alerts');
      latestTimestamp = Math.max(latestTimestamp, alertsResult.timestamp);
    } catch (err) {
      // Proceed without alert-based overrides rather than failing the whole lookup.
    }

    try {
      const pointResult = await API.getNwsPoint(lat, lon);
      if (mode === 'current') {
        nwsObs = await API.getNwsLatestObservation(pointResult.data.properties.observationStations, lat, lon);
      } else {
        const hourlyResult = await API.getNwsHourlyForecast(pointResult.data.properties.forecastHourly, lat, lon);
        nwsHourlyPeriods = hourlyResult.data.properties.periods;
        if (hourlyResult.stale) staleSources.push('NWS hourly forecast');
        latestTimestamp = Math.max(latestTimestamp, hourlyResult.timestamp);
      }
    } catch (err) {
      // NWS point/hourly/observation unavailable — Open-Meteo still carries the reading.
    }
  }

  if (mode === 'long') {
    try {
      const seasonalResult = await API.getSeasonalOutlook(lat, lon);
      seasonal = seasonalResult.data;
      if (seasonalResult.stale) staleSources.push('Seasonal outlook');
      latestTimestamp = Math.max(latestTimestamp, seasonalResult.timestamp);
    } catch (err) {
      // seasonal stays null; rendered as "unavailable"
    }
  }

  let reading = null;
  let verdictResult = null;
  let hourlyWindow = null;

  if (mode !== 'long') {
    const idx = nearestHourlyIndex(forecast.hourly.time, targetParts);
    reading = buildReading(forecast, idx, mode);
    verdictResult = Verdict.evaluate(reading, alerts);
    hourlyWindow = buildHourlyWindow(forecast.hourly, idx);
  }

  const elevationData = await API.getElevation(lat, lon).catch(() => null);
  const elevationFt = elevationData && elevationData.data.elevation ? elevationData.data.elevation[0] * 3.28084 : null;
  const advisories = mode !== 'long' ? Verdict.getAdvisories(reading, elevationFt) : [];

  render({
    lat, lon, targetParts, timezoneName, mode,
    verdictResult, reading, hourlyWindow, advisories,
    alerts,
    fireDanger: deriveFireDanger(alerts, mode),
    stormProximity: deriveStormProximity(alerts, mode),
    nwsHourlyPeriods, nwsObs, seasonal,
    elevationFt, staleSources, latestTimestamp, utcOffsetSeconds,
  });
}

// --- Time helpers -----------------------------------------------------
// The show's date/time is entered as a plain wall-clock string with no
// zone attached, and it means "that time at the site" — not the crew
// member's own browser time zone. So instead of letting JS's Date parser
// guess a zone, every comparison here works in "site wall-clock parts"
// and converts to a comparable instant with Date.UTC, which cancels the
// zone out as long as both sides of a comparison use the same trick.

function resolveSiteNowParts(utcOffsetSeconds) {
  const shifted = new Date(Date.now() + utcOffsetSeconds * 1000);
  return {
    y: shifted.getUTCFullYear(),
    mo: shifted.getUTCMonth(),
    d: shifted.getUTCDate(),
    h: shifted.getUTCHours(),
    mi: shifted.getUTCMinutes(),
  };
}

function parseDatetimeLocalParts(str) {
  const [datePart, timePart] = str.split('T');
  const [y, mo, d] = datePart.split('-').map(Number);
  const [h, mi] = timePart.split(':').map(Number);
  return { y, mo: mo - 1, d, h, mi };
}

function partsToUtcMs(p) {
  return Date.UTC(p.y, p.mo, p.d, p.h, p.mi);
}

function hoursBetweenParts(fromParts, toParts) {
  return (partsToUtcMs(toParts) - partsToUtcMs(fromParts)) / 3600000;
}

// Open-Meteo's hourly.time strings are wall-clock, zone-less, and already
// in the site's local time (we requested timezone=auto) — same trick applies.
function nearestHourlyIndex(times, targetParts) {
  const targetMs = partsToUtcMs(targetParts);
  let bestIdx = 0;
  let bestDiff = Infinity;
  times.forEach((t, i) => {
    const diff = Math.abs(partsToUtcMs(parseDatetimeLocalParts(t)) - targetMs);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestIdx = i;
    }
  });
  return bestIdx;
}

// NWS period times DO carry a real UTC offset, so these compare as true
// instants rather than wall-clock parts.
function nearestNwsPeriodIndex(periods, targetParts, utcOffsetSeconds) {
  const targetTrueUtcMs = partsToUtcMs(targetParts) - utcOffsetSeconds * 1000;
  let bestIdx = 0;
  let bestDiff = Infinity;
  periods.forEach((p, i) => {
    const diff = Math.abs(new Date(p.startTime).getTime() - targetTrueUtcMs);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestIdx = i;
    }
  });
  return bestIdx;
}

// --- Reading construction ----------------------------------------------

function buildReading(forecast, idx, mode) {
  const hourly = forecast.hourly;
  const windAloftKey = `wind_speed_${THRESHOLDS.WIND_ALOFT_HEIGHT_M}m`;

  let surfaceWindMph, surfaceWindGustMph, surfaceWindDir, humidityPct, tempF, precipRateIn;

  // Current-conditions mode prefers Open-Meteo's live "current" block over
  // the nearest-hour forecast value, per spec — it's a truer "right now".
  if (mode === 'current' && forecast.current) {
    surfaceWindMph = forecast.current.wind_speed_10m;
    surfaceWindGustMph = forecast.current.wind_gusts_10m;
    surfaceWindDir = forecast.current.wind_direction_10m;
    humidityPct = forecast.current.relative_humidity_2m;
    tempF = forecast.current.temperature_2m;
    precipRateIn = forecast.current.precipitation;
  } else {
    surfaceWindMph = hourly.wind_speed_10m[idx];
    surfaceWindGustMph = hourly.wind_gusts_10m[idx];
    surfaceWindDir = hourly.wind_direction_10m[idx];
    humidityPct = hourly.relative_humidity_2m[idx];
    tempF = hourly.temperature_2m[idx];
    precipRateIn = hourly.precipitation[idx];
  }

  const windAloftMph = hourly[windAloftKey] ? hourly[windAloftKey][idx] : null;
  const precipChancePct = hourly.precipitation_probability ? hourly.precipitation_probability[idx] : null;
  const visibilityMeters = hourly.visibility ? hourly.visibility[idx] : null;
  const visibilityMiles = visibilityMeters != null ? visibilityMeters / 1609.34 : null;
  const precipRateMmHr = precipRateIn != null ? precipRateIn * 25.4 : null; // inch/hr -> mm/hr

  return {
    surfaceWindMph, surfaceWindGustMph, surfaceWindDir,
    windAloftMph, humidityPct, tempF,
    precipChancePct, precipRateMmHr, visibilityMiles,
  };
}

function buildHourlyWindow(hourly, idx) {
  const start = Math.max(0, idx - 1);
  const end = Math.min(hourly.time.length - 1, idx + 2);
  const points = [];
  for (let i = start; i <= end; i++) {
    points.push({ time: hourly.time[i], windMph: hourly.wind_speed_10m[i], isTarget: i === idx });
  }
  return points;
}

function deriveFireDanger(alerts, mode) {
  if (mode === 'extended' || mode === 'long') return 'Not available outside NWS alert range';
  const events = alerts.map((a) => a.properties.event);
  if (events.includes('Red Flag Warning')) return 'Red Flag Warning active';
  if (events.includes('Fire Weather Watch')) return 'Fire Weather Watch active';
  return 'None reported';
}

function deriveStormProximity(alerts, mode) {
  if (mode === 'extended' || mode === 'long') return 'Not available outside NWS alert range';
  const events = alerts.map((a) => a.properties.event);
  if (events.includes('Tornado Warning')) return 'Tornado Warning active';
  if (events.includes('Severe Thunderstorm Warning')) return 'Severe Thunderstorm Warning active';
  return 'None reported';
}

// --- Rendering -----------------------------------------------------------

function render(ctx) {
  renderHeader(ctx);
  renderVerdict(ctx);
  renderAlerts(ctx);
  renderMetricGrid(ctx);
  renderAdvisories(ctx);
  renderHourlyStrip(ctx);
  renderNwsSupplement(ctx);
  renderFooter(ctx);
}

function renderHeader(ctx) {
  const pad = (n) => String(n).padStart(2, '0');
  const p = ctx.targetParts;
  const dateLabel = `${p.y}-${pad(p.mo + 1)}-${pad(p.d)} ${pad(p.h)}:${pad(p.mi)}`;
  els.headerSiteInfo.textContent = `${ctx.lat.toFixed(4)}, ${ctx.lon.toFixed(4)} — ${dateLabel} (${ctx.timezoneName})`;
}

const VERDICT_LABELS = { go: 'GO', caution: 'CAUTION', nogo: 'NO-GO' };
const VERDICT_SENTENCES = {
  go: 'Show is cleared to go.',
  caution: 'Show needs caution — review the numbers below.',
  nogo: 'Show is a no-go right now.',
};

function renderVerdict(ctx) {
  els.verdictBanner.classList.remove('verdict-hidden', 'verdict-go', 'verdict-caution', 'verdict-nogo', 'verdict-outlook');

  if (ctx.mode === 'long') {
    els.verdictBanner.classList.add('verdict-outlook');
    els.verdictHeadline.textContent = 'OUTLOOK ONLY';
    els.verdictSentence.textContent = 'Too far out for a verdict.';
    els.verdictReason.textContent = 'This date is beyond the 16-day forecast range — no go/caution/no-go verdict is possible this far out.';
    els.verdictNote.textContent = 'Check back as the date gets closer for a real forecast-based verdict.';
    return;
  }

  const level = ctx.verdictResult.level;
  els.verdictBanner.classList.add(`verdict-${level}`);
  els.verdictHeadline.textContent = VERDICT_LABELS[level];
  els.verdictSentence.textContent = VERDICT_SENTENCES[level];
  els.verdictReason.textContent = ctx.verdictResult.reason;

  const notes = [];
  if (ctx.mode === 'extended') notes.push('7-16 days out: extended forecast, lower confidence.');
  if (ctx.staleSources.length > 0) notes.push(`Using cached data for: ${ctx.staleSources.join(', ')}.`);
  els.verdictNote.textContent = notes.join(' ');
}

function renderAlerts(ctx) {
  if (!ctx.alerts || ctx.alerts.length === 0) {
    els.alertsRow.hidden = true;
    els.alertsChips.innerHTML = '';
    return;
  }
  els.alertsRow.hidden = false;
  els.alertsChips.innerHTML = '';
  ctx.alerts.forEach((a) => {
    const chip = document.createElement('span');
    const severity = ALERT_EVENTS.NOGO.includes(a.properties.event) ? 'chip-nogo' : 'chip-caution';
    chip.className = `alert-chip ${severity}`;
    chip.textContent = a.properties.event;
    chip.title = a.properties.headline || '';
    els.alertsChips.appendChild(chip);
  });
}

function renderMetricGrid(ctx) {
  els.metricSection.hidden = false;
  els.metricGrid.innerHTML = '';

  if (ctx.mode === 'long') {
    if (ctx.seasonal && ctx.seasonal.monthly) {
      const m = ctx.seasonal.monthly;
      els.metricGrid.appendChild(metricCard('Avg temperature (monthly outlook)', fmtDeg(m.temperature_2m_mean)));
      els.metricGrid.appendChild(metricCard('Temperature anomaly', fmtAnomaly(m.temperature_2m_anomaly, '°F')));
      els.metricGrid.appendChild(metricCard('Precipitation (monthly outlook)', fmtUnit(m.precipitation_sum, 'in')));
      els.metricGrid.appendChild(metricCard('Precipitation anomaly', fmtAnomaly(m.precipitation_anomaly, 'in')));
    } else {
      els.metricGrid.appendChild(metricCard('Outlook data', 'Unavailable right now'));
    }
    return;
  }

  const r = ctx.reading;
  els.metricGrid.appendChild(metricCard('Surface wind', `${fmt(r.surfaceWindMph, 0)} mph`, `${degToCompass(r.surfaceWindDir)} · gust ${fmt(r.surfaceWindGustMph, 0)} mph`));
  els.metricGrid.appendChild(metricCard('Wind aloft', `${fmt(r.windAloftMph, 0)} mph`, `~600 ft proxy, ${THRESHOLDS.WIND_ALOFT_HEIGHT_M}m sample`));
  els.metricGrid.appendChild(metricCard('Humidity', `${fmt(r.humidityPct, 0)}%`));
  els.metricGrid.appendChild(metricCard('Temperature', `${fmt(r.tempF, 0)}°F`));
  els.metricGrid.appendChild(metricCard('Precipitation chance', `${fmt(r.precipChancePct, 0)}%`));
  els.metricGrid.appendChild(metricCard('Visibility', `${fmt(r.visibilityMiles, 1)} mi`));
  els.metricGrid.appendChild(metricCard('Fire danger', ctx.fireDanger));
  els.metricGrid.appendChild(metricCard('Storm proximity', ctx.stormProximity));
}

function metricCard(label, value, sub) {
  const card = document.createElement('div');
  card.className = 'metric-card';
  card.innerHTML = `<div class="metric-label">${label}</div><div class="metric-value">${value}</div>${sub ? `<div class="metric-sub">${sub}</div>` : ''}`;
  return card;
}

function fmt(n, digits) {
  return n == null ? '—' : n.toFixed(digits);
}

function fmtDeg(arr) {
  return arr && arr[0] != null ? `${arr[0].toFixed(0)}°F` : '—';
}

function fmtUnit(arr, unit) {
  return arr && arr[0] != null ? `${arr[0].toFixed(1)} ${unit}` : '—';
}

function fmtAnomaly(arr, unit) {
  if (!arr || arr[0] == null) return '—';
  const v = arr[0];
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)} ${unit}`;
}

function degToCompass(deg) {
  if (deg == null) return '—';
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return dirs[Math.round(deg / 22.5) % 16];
}

function renderAdvisories(ctx) {
  if (!ctx.advisories || ctx.advisories.length === 0) {
    els.advisoriesSection.hidden = true;
    els.advisoriesList.innerHTML = '';
    return;
  }
  els.advisoriesSection.hidden = false;
  els.advisoriesList.innerHTML = '';
  ctx.advisories.forEach((text) => {
    const li = document.createElement('li');
    li.textContent = text;
    els.advisoriesList.appendChild(li);
  });
}

function renderHourlyStrip(ctx) {
  if (ctx.mode === 'long' || !ctx.hourlyWindow) {
    els.hourlySection.hidden = true;
    return;
  }
  els.hourlySection.hidden = false;
  els.hourlyStrip.innerHTML = '';
  ctx.hourlyWindow.forEach((point) => {
    const col = document.createElement('div');
    col.className = 'hourly-point' + (point.isTarget ? ' hourly-point-target' : '');
    col.innerHTML = `<div class="hourly-time">${formatHourLabel(point.time)}</div><div class="hourly-wind">${fmt(point.windMph, 0)}</div><div class="hourly-unit">mph</div>`;
    els.hourlyStrip.appendChild(col);
  });
}

function formatHourLabel(isoLikeStr) {
  const [h] = isoLikeStr.split('T')[1].split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12} ${period}`;
}

function renderNwsSupplement(ctx) {
  if (ctx.mode === 'current' && ctx.nwsObs) {
    els.nwsSection.hidden = false;
    els.nwsLabel.textContent = 'Nearest NWS station observation';
    const obs = ctx.nwsObs.data;
    const tempF = obs.temperature && obs.temperature.value != null ? celsiusToF(obs.temperature.value) : null;
    const windMph = obs.windSpeed && obs.windSpeed.value != null ? kmhToMph(obs.windSpeed.value) : null;
    const humidity = obs.relativeHumidity ? obs.relativeHumidity.value : null;
    els.nwsSupplement.innerHTML = `
      <p>Station ${ctx.nwsObs.stationId} · ${Math.round(ctx.nwsObs.ageMinutes)} min old</p>
      <p>Temp ${fmt(tempF, 0)}°F · Wind ${fmt(windMph, 0)} mph · Humidity ${fmt(humidity, 0)}%</p>
    `;
    return;
  }

  if (ctx.mode === 'short' && ctx.nwsHourlyPeriods) {
    const idx = nearestNwsPeriodIndex(ctx.nwsHourlyPeriods, ctx.targetParts, ctx.utcOffsetSeconds);
    const period = ctx.nwsHourlyPeriods[idx];
    els.nwsSection.hidden = false;
    els.nwsLabel.textContent = 'NWS hourly forecast (nearest reading)';
    const precip = period.probabilityOfPrecipitation && period.probabilityOfPrecipitation.value != null
      ? `${period.probabilityOfPrecipitation.value}%`
      : '—';
    els.nwsSupplement.innerHTML = `
      <p>${period.shortForecast}</p>
      <p>Temp ${period.temperature}°F · Wind ${period.windSpeed} ${period.windDirection} · Precip chance ${precip}</p>
    `;
    return;
  }

  els.nwsSection.hidden = true;
}

function celsiusToF(c) {
  return (c * 9) / 5 + 32;
}

function kmhToMph(kmh) {
  return kmh * 0.621371;
}

function renderFooter(ctx) {
  els.footerCoords.textContent = `Coordinates: ${ctx.lat.toFixed(5)}, ${ctx.lon.toFixed(5)}`;

  els.footerElevation.textContent = ctx.elevationFt != null ? `Elevation: ${ctx.elevationFt.toFixed(0)} ft` : 'Elevation: unavailable';

  const staleNote = ctx.staleSources.length > 0 ? ' — some data may be stale' : '';
  els.footerUpdated.textContent = `Last updated: ${formatAge(ctx.latestTimestamp)}${staleNote}`;
}

// --- UI state helpers ------------------------------------------------------

function showStatus(message, kind) {
  els.statusMessage.textContent = message;
  els.statusMessage.className = `status-message status-${kind}`;
}

function clearStatus() {
  els.statusMessage.textContent = '';
  els.statusMessage.className = 'status-message';
}

function setLoading(isLoading) {
  els.checkBtn.disabled = isLoading;
  els.checkBtn.textContent = isLoading ? 'Checking…' : 'Check conditions';
}

function resetResultSections() {
  els.verdictBanner.classList.add('verdict-hidden');
  els.alertsRow.hidden = true;
  els.metricSection.hidden = true;
  els.advisoriesSection.hidden = true;
  els.hourlySection.hidden = true;
  els.nwsSection.hidden = true;
}
