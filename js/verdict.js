// Verdict engine: takes a normalized "reading" for the target hour plus
// active alerts, and returns the worst-case go / caution / no-go call.
// All the numbers it checks against live in THRESHOLDS (js/config.js).

const Verdict = {};

// reading shape: { surfaceWindMph, surfaceWindGustMph, surfaceWindDir,
//   windAloftMph, humidityPct, tempF, precipChancePct, precipRateMmHr,
//   visibilityMiles }

Verdict.evaluate = function (reading, alerts) {
  const checks = [
    checkSurfaceWind(reading.surfaceWindMph),
    checkWindAloft(reading.windAloftMph),
    checkPrecip(reading.precipChancePct, reading.precipRateMmHr),
    checkHumidity(reading.humidityPct),
    checkTemp(reading.tempF),
    checkVisibility(reading.visibilityMiles),
  ].filter(Boolean);

  const alertOverride = checkAlerts(alerts);
  if (alertOverride) checks.push(alertOverride);

  const worst = worstCheck(checks);
  return {
    level: worst ? worst.level : 'go',
    reason: worst ? worst.reason : 'All checks within normal range.',
    checks,
  };
};

const LEVEL_RANK = { go: 0, caution: 1, nogo: 2 };

function worstCheck(checks) {
  return checks.reduce((worst, c) => {
    if (!worst) return c;
    return LEVEL_RANK[c.level] > LEVEL_RANK[worst.level] ? c : worst;
  }, null);
}

function checkSurfaceWind(mph) {
  if (mph == null) return null;
  if (mph >= THRESHOLDS.SURFACE_WIND_NOGO_MPH) {
    return { signal: 'Surface wind', level: 'nogo', reason: `Surface wind ${mph.toFixed(0)} mph — at or above the ${THRESHOLDS.SURFACE_WIND_NOGO_MPH} mph no-go line.` };
  }
  if (mph >= THRESHOLDS.SURFACE_WIND_CAUTION_MPH) {
    return { signal: 'Surface wind', level: 'caution', reason: `Surface wind ${mph.toFixed(0)} mph — in the ${THRESHOLDS.SURFACE_WIND_CAUTION_MPH}-${THRESHOLDS.SURFACE_WIND_NOGO_MPH} mph caution band.` };
  }
  return { signal: 'Surface wind', level: 'go', reason: null };
}

function checkWindAloft(mph) {
  if (mph == null) return null;
  if (mph >= THRESHOLDS.WIND_ALOFT_NOGO_MPH) {
    return { signal: 'Wind aloft', level: 'nogo', reason: `Wind aloft ${mph.toFixed(0)} mph — at or above the ${THRESHOLDS.WIND_ALOFT_NOGO_MPH} mph no-go line.` };
  }
  if (mph >= THRESHOLDS.WIND_ALOFT_CAUTION_MPH) {
    return { signal: 'Wind aloft', level: 'caution', reason: `Wind aloft ${mph.toFixed(0)} mph — in the ${THRESHOLDS.WIND_ALOFT_CAUTION_MPH}-${THRESHOLDS.WIND_ALOFT_NOGO_MPH} mph caution band.` };
  }
  return { signal: 'Wind aloft', level: 'go', reason: null };
}

function checkPrecip(chancePct, rateMmHr) {
  if (rateMmHr != null && rateMmHr >= THRESHOLDS.ACTIVE_RAIN_NOGO_MM_PER_HR) {
    return { signal: 'Precipitation', level: 'nogo', reason: `Active moderate/heavy rain (${rateMmHr.toFixed(1)} mm/hr).` };
  }
  if (chancePct != null && chancePct >= THRESHOLDS.PRECIP_CHANCE_CAUTION_PCT) {
    return { signal: 'Precipitation', level: 'caution', reason: `${chancePct}% chance of precipitation.` };
  }
  return { signal: 'Precipitation', level: 'go', reason: null };
}

function checkHumidity(pct) {
  if (pct == null) return null;
  if (pct < THRESHOLDS.HUMIDITY_CAUTION_LOW_PCT || pct > THRESHOLDS.HUMIDITY_CAUTION_HIGH_PCT) {
    return { signal: 'Humidity', level: 'caution', reason: `Relative humidity ${pct}% — outside the ${THRESHOLDS.HUMIDITY_CAUTION_LOW_PCT}-${THRESHOLDS.HUMIDITY_CAUTION_HIGH_PCT}% normal band.` };
  }
  return { signal: 'Humidity', level: 'go', reason: null };
}

function checkTemp(f) {
  if (f == null) return null;
  if (f > THRESHOLDS.TEMP_CAUTION_HIGH_F || f < THRESHOLDS.TEMP_CAUTION_LOW_F) {
    return { signal: 'Temperature', level: 'caution', reason: `Temperature ${f.toFixed(0)}°F — outside the ${THRESHOLDS.TEMP_CAUTION_LOW_F}-${THRESHOLDS.TEMP_CAUTION_HIGH_F}°F normal band.` };
  }
  return { signal: 'Temperature', level: 'go', reason: null };
}

// Spec's threshold table also mentions ceiling height, but neither data
// source exposes a usable cloud-base/ceiling figure, so this only checks
// visibility.
function checkVisibility(miles) {
  if (miles == null) return null;
  if (miles < THRESHOLDS.VISIBILITY_CAUTION_MILES) {
    return { signal: 'Visibility', level: 'caution', reason: `Visibility ${miles.toFixed(1)} mi — below the ${THRESHOLDS.VISIBILITY_CAUTION_MILES} mi caution line.` };
  }
  return { signal: 'Visibility', level: 'go', reason: null };
}

function checkAlerts(alerts) {
  if (!alerts || alerts.length === 0) return null;
  const events = alerts.map((a) => a.properties.event);
  const nogoHit = events.find((e) => ALERT_EVENTS.NOGO.includes(e));
  if (nogoHit) {
    return { signal: 'Active alert', level: 'nogo', reason: `Active ${nogoHit} for this location.` };
  }
  const cautionHit = events.find((e) => ALERT_EVENTS.CAUTION.includes(e));
  if (cautionHit) {
    return { signal: 'Active alert', level: 'caution', reason: `Active ${cautionHit} for this location.` };
  }
  return null;
}

// --- Advisory notes ---------------------------------------------------
// Informational only — these never affect the go/caution/no-go level.

Verdict.getAdvisories = function (reading, elevationFt) {
  const notes = [];

  if (reading && reading.humidityPct != null) {
    if (reading.humidityPct >= ADVISORY_THRESHOLDS.HUMIDITY_ADVISORY_HIGH_PCT) {
      notes.push(`High humidity (${reading.humidityPct.toFixed(0)}%) — increased risk of fuse hangfires or duds. Treat any unlit shell with extra caution and wait time.`);
    } else if (reading.humidityPct <= ADVISORY_THRESHOLDS.HUMIDITY_ADVISORY_LOW_PCT) {
      notes.push(`Low humidity (${reading.humidityPct.toFixed(0)}%) — higher static discharge risk. Ground yourself and equipment before handling product.`);
    }
  }

  if (reading && reading.tempF != null && reading.tempF <= ADVISORY_THRESHOLDS.TEMP_ADVISORY_COLD_F) {
    notes.push(`Cold temperature (${reading.tempF.toFixed(0)}°F) — fuses can burn slower and less predictably. Extend hangfire wait times before approaching a dud shell.`);
  }

  if (elevationFt != null && elevationFt >= ADVISORY_THRESHOLDS.ELEVATION_ADVISORY_FT) {
    notes.push(`High elevation site (${elevationFt.toFixed(0)} ft) — thinner air means shells can fly higher and perform differently than sea-level-rated product suggests.`);
  }

  return notes;
};

// --- Mode / time helpers ---------------------------------------------------

// Determines which lookup mode applies given hours between "now" and the
// requested show time (both already expressed in the site's local time —
// see resolveSiteNow in app.js for why we compute it this way).
Verdict.determineMode = function (hoursFromNow) {
  const abs = Math.abs(hoursFromNow);
  if (abs <= THRESHOLDS.CURRENT_CONDITIONS_WINDOW_MIN / 60) return 'current';
  if (hoursFromNow > 0 && hoursFromNow <= THRESHOLDS.SHORT_RANGE_MAX_HOURS) return 'short';
  if (hoursFromNow > THRESHOLDS.SHORT_RANGE_MAX_HOURS && hoursFromNow <= THRESHOLDS.EXTENDED_RANGE_MAX_HOURS) return 'extended';
  if (hoursFromNow > THRESHOLDS.EXTENDED_RANGE_MAX_HOURS) return 'long';
  return 'current'; // requested time is in the past by more than the window
};
