// PYROT3CH Weather — verdict thresholds
//
// Every number the verdict engine checks against lives here, in one place,
// so whoever tunes these after real-world use doesn't have to go hunting
// through verdict.js. Units are noted per constant since the app pulls
// values in mixed units (mph, %, °F, miles) from two different APIs.

const THRESHOLDS = {
  // Surface wind speed, mph
  SURFACE_WIND_CAUTION_MPH: 15,
  SURFACE_WIND_NOGO_MPH: 20,

  // Wind aloft (~180m / ~600ft, proxy for shell burst height), mph
  WIND_ALOFT_CAUTION_MPH: 20,
  WIND_ALOFT_NOGO_MPH: 30,

  // Precipitation chance, percent
  PRECIP_CHANCE_CAUTION_PCT: 40,

  // Relative humidity, percent — both a low-end and high-end caution band
  HUMIDITY_CAUTION_LOW_PCT: 20,
  HUMIDITY_CAUTION_HIGH_PCT: 90,

  // Temperature, °F
  TEMP_CAUTION_HIGH_F: 100,
  TEMP_CAUTION_LOW_F: 20,

  // Visibility, miles
  VISIBILITY_CAUTION_MILES: 3,

  // Rain intensity, mm/hr — Open-Meteo's precipitation field is a rate.
  // "Moderate" rain starts around 2.5 mm/hr by the usual meteorological
  // scale; used as the no-go active-rain trigger regardless of forecast %.
  ACTIVE_RAIN_NOGO_MM_PER_HR: 2.5,

  // How far apart a requested time and "now" can be and still count as
  // current-conditions mode, in minutes.
  CURRENT_CONDITIONS_WINDOW_MIN: 60,

  // Lookup mode boundaries, in hours from now
  SHORT_RANGE_MAX_HOURS: 24 * 7,
  EXTENDED_RANGE_MAX_HOURS: 24 * 16,

  // NWS station observation older than this is not used for current mode, in minutes
  STALE_OBSERVATION_MINUTES: 60,

  // Wind aloft sample height used from Open-Meteo, meters — see README for
  // why 180m stands in for actual shell burst altitude
  WIND_ALOFT_HEIGHT_M: 180,
};

// Informational advisory notes — these never change the go/caution/no-go
// verdict, they just flag pyro-specific operational concerns (fuse
// reliability, static, burst height) that can matter even when the
// underlying number isn't severe enough to move the verdict itself.
// Deliberately separate from THRESHOLDS above rather than reusing those
// bands, since the concern here (e.g. "fuses get unreliable") kicks in at
// a different point than the go/caution/no-go cutoffs.
const ADVISORY_THRESHOLDS = {
  // Relative humidity, percent
  HUMIDITY_ADVISORY_HIGH_PCT: 80, // fuse hangfire/dud risk from damp black match
  HUMIDITY_ADVISORY_LOW_PCT: 25, // static discharge risk while handling product

  // Temperature, °F — fuses burn slower and less predictably in the cold
  TEMP_ADVISORY_COLD_F: 32,

  // Site elevation, feet — thinner air changes shell trajectory/burst height
  ELEVATION_ADVISORY_FT: 5000,
};

// NWS alert event types that force or push the verdict, matched against
// the `event` field of each active alert feature
const ALERT_EVENTS = {
  NOGO: ['Red Flag Warning', 'Severe Thunderstorm Warning', 'Tornado Warning'],
  CAUTION: ['Fire Weather Watch'],
};
