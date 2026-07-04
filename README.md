# PYROT3CH Weather

A one-page go/caution/no-go check for whether weather conditions are safe for a fireworks show at a given place and time. Enter coordinates (or hit "use my location") and a show date/time, and it pulls current or forecast weather, runs it against fireworks-specific thresholds (wind, wind aloft, precipitation, humidity, temperature, visibility, active NWS alerts), and shows the verdict plus the numbers behind it. Built for one team's internal use before a show — not a public product, no accounts, no saved sites, read-only.

## Verdict thresholds

All the numbers the verdict engine checks against (wind speed cutoffs, humidity band, temperature range, etc.) live in one place: `THRESHOLDS` at the top of [js/config.js](js/config.js). Tune them there; nothing else in the code hardcodes these numbers. `ALERT_EVENTS` right below it lists which NWS alert types force a no-go vs. a caution.

## How the pieces fit together

- `js/config.js` — thresholds and alert types, the only file you should need to touch to retune the verdict.
- `js/cache.js` — localStorage wrapper; every fetch falls back to the last good cached response if the network fails.
- `js/api.js` — all calls to NWS (`api.weather.gov`) and Open-Meteo (`api.open-meteo.com`).
- `js/verdict.js` — takes a weather reading and active alerts, returns go/caution/no-go and picks which lookup mode (current conditions / short-range / extended / long-range outlook) applies based on how far out the show is.
- `js/app.js` — DOM wiring and rendering; the only file that touches the page directly.

## Data sources

Weather data comes from the [National Weather Service](https://www.weather.gov/) (`api.weather.gov`) and [Open-Meteo](https://open-meteo.com/) — both free and keyless. Open-Meteo's free tier is for non-commercial use, which covers this internal tool; revisit if that ever changes. Credit for both is in the footer, as required by Open-Meteo's license.

One quirk worth knowing if you touch `js/api.js`: don't set a custom `User-Agent` header on NWS requests. The browser's default one works fine, and setting your own triggers a CORS preflight that NWS rejects for browser-based clients.
