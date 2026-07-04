// Tiny localStorage wrapper so every data source can fall back to its last
// good response when a live fetch fails (bad signal in the field, etc).

const Cache = {
  set(key, data) {
    try {
      localStorage.setItem(key, JSON.stringify({ data, timestamp: Date.now() }));
    } catch (err) {
      // Storage full or unavailable (private browsing) — degrade silently,
      // caching is a nice-to-have, not required for the app to function.
    }
  },

  get(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (err) {
      return null;
    }
  },
};

// Fetches JSON from `url`, caching the result under `cacheKey` on success.
// On failure, falls back to the last cached value (if any) and marks it
// stale so the UI can say "may be stale" instead of just breaking.
async function fetchJsonCached(cacheKey, url, options = {}) {
  try {
    const res = await fetchWithTimeout(url, options);
    if (!res.ok) throw new Error(`${url} responded ${res.status}`);
    const data = await res.json();
    Cache.set(cacheKey, data);
    return { data, stale: false, timestamp: Date.now() };
  } catch (err) {
    const cached = Cache.get(cacheKey);
    if (cached) {
      return { data: cached.data, stale: true, timestamp: cached.timestamp };
    }
    throw err;
  }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function minutesAgo(timestamp) {
  return Math.round((Date.now() - timestamp) / 60000);
}

function formatAge(timestamp) {
  const mins = minutesAgo(timestamp);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  return `${hours} hr ${mins % 60} min ago`;
}
