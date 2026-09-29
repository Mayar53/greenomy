// services/weather.service.js — where a member is, what season it is there, and
// what the weather is doing. Two providers, chosen by WEATHER_PROVIDER:
//
//   offline     a built-in climate table, no network at all (default)
//   open-meteo  keyless live forecast + geocoding (opt-in)
//
// Either way this never throws for an unknown city or a dead network: growing
// advice falls back to a general climate rather than failing the request. That
// mirrors how the AI features degrade without a key.
//
// Offline is the default, so the app needs no weather account and makes no
// external call. Open-Meteo is opt-in (WEATHER_PROVIDER=open-meteo) and its
// free tier is NON-COMMERCIAL only (CC BY 4.0, attribution required); commercial
// use needs their paid plan via WEATHER_API_KEY. See docs/DEPLOYMENT.md.

const DEFAULT_BASE = "https://api.open-meteo.com/v1/forecast";
const DEFAULT_GEOCODE = "https://geocoding-api.open-meteo.com/v1/search";
const CACHE_TTL_MS = Number(process.env.WEATHER_CACHE_TTL_MS || 60 * 60 * 1000);
const TIMEOUT_MS = Number(process.env.WEATHER_TIMEOUT_MS || 8000);

// Coarse climate by city, for the offline provider and as the fallback when
// geocoding finds nothing. Latitude drives hemisphere and season.
const KNOWN_CITIES = {
  erbil: { climate: "subtropical", lat: 36.19, country: "Iraq" },
  hawler: { climate: "subtropical", lat: 36.19, country: "Iraq" },
  sulaymaniyah: { climate: "subtropical", lat: 35.56, country: "Iraq" },
  sulaimani: { climate: "subtropical", lat: 35.56, country: "Iraq" },
  duhok: { climate: "subtropical", lat: 36.87, country: "Iraq" },
  mosul: { climate: "subtropical", lat: 36.34, country: "Iraq" },
  kirkuk: { climate: "subtropical", lat: 35.47, country: "Iraq" },
  baghdad: { climate: "arid", lat: 33.31, country: "Iraq" },
  basra: { climate: "arid", lat: 30.51, country: "Iraq" },
  najaf: { climate: "arid", lat: 32.03, country: "Iraq" },
  istanbul: { climate: "mediterranean", lat: 41.01, country: "Turkey" },
  ankara: { climate: "continental", lat: 39.93, country: "Turkey" },
  tehran: { climate: "arid", lat: 35.69, country: "Iran" },
  dubai: { climate: "arid", lat: 25.2, country: "United Arab Emirates" },
  doha: { climate: "arid", lat: 25.29, country: "Qatar" },
  riyadh: { climate: "arid", lat: 24.71, country: "Saudi Arabia" },
  cairo: { climate: "arid", lat: 30.04, country: "Egypt" },
  amman: { climate: "arid", lat: 31.95, country: "Jordan" },
  beirut: { climate: "mediterranean", lat: 33.89, country: "Lebanon" },
  damascus: { climate: "arid", lat: 33.51, country: "Syria" },
  london: { climate: "temperate", lat: 51.51, country: "United Kingdom" },
  paris: { climate: "temperate", lat: 48.86, country: "France" },
  berlin: { climate: "continental", lat: 52.52, country: "Germany" },
  madrid: { climate: "mediterranean", lat: 40.42, country: "Spain" },
  rome: { climate: "mediterranean", lat: 41.9, country: "Italy" },
  athens: { climate: "mediterranean", lat: 37.98, country: "Greece" },
  newyork: { climate: "continental", lat: 40.71, country: "United States" },
  losangeles: { climate: "mediterranean", lat: 34.05, country: "United States" },
  toronto: { climate: "continental", lat: 43.65, country: "Canada" },
  sydney: { climate: "subtropical", lat: -33.87, country: "Australia" },
  melbourne: { climate: "temperate", lat: -37.81, country: "Australia" },
  auckland: { climate: "temperate", lat: -36.85, country: "New Zealand" },
  nairobi: { climate: "tropical", lat: -1.29, country: "Kenya" },
  capetown: { climate: "mediterranean", lat: -33.92, country: "South Africa" },
  buenosaires: { climate: "temperate", lat: -34.6, country: "Argentina" },
  saopaulo: { climate: "subtropical", lat: -23.55, country: "Brazil" },
  mumbai: { climate: "tropical", lat: 19.08, country: "India" },
  singapore: { climate: "tropical", lat: 1.35, country: "Singapore" },
};

const DEFAULT_CLIMATE = "temperate";
const DEFAULT_LAT = 40; // northern temperate, used when nothing is known

const geocodeCache = new Map();
const conditionsCache = new Map();

function config() {
  const provider = (process.env.WEATHER_PROVIDER || "offline").trim().toLowerCase();
  const apiKey = (process.env.WEATHER_API_KEY || "").trim();
  return {
    provider,
    apiKey,
    // Commercial Open-Meteo requires the customer- host plus &apikey.
    baseUrl: (process.env.WEATHER_BASE_URL || (apiKey ? DEFAULT_BASE.replace("//api.", "//customer-api.") : DEFAULT_BASE)).trim(),
    geocodeUrl: (process.env.WEATHER_GEOCODE_URL || DEFAULT_GEOCODE).trim(),
  };
}

const isConfigured = () => config().provider === "offline" || config().provider === "open-meteo";

function normaliseCity(city) {
  return String(city || "").trim().toLowerCase().replace(/\s+/g, "");
}

const hemisphereFor = (latitude) => (latitude < 0 ? "southern" : "northern");

/** A finite number, or null for a field the provider has no value for. */
const numberOf = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);

/** Coarse climate zone from latitude, current temperature and weekly rainfall.
 * A documented heuristic — not a Köppen classification — which is all the
 * ranking needs. */
function climateZone({ latitude, temperature, weeklyRain }) {
  const abs = Math.abs(latitude);
  if (abs < 23.5) return "tropical";
  if (typeof weeklyRain === "number" && weeklyRain < 3 && abs < 35) return "arid";
  if (abs < 35) return "subtropical";
  if (abs < 45) return typeof temperature === "number" && temperature >= 20 ? "mediterranean" : "temperate";
  if (abs < 60) return typeof temperature === "number" && temperature < 8 ? "continental" : "temperate";
  return "cold";
}

/** Season for a month (1-12) in a hemisphere. */
function seasonFor(month, hemisphere) {
  const m = hemisphere === "southern" ? ((month + 5) % 12) + 1 : month;
  if (m >= 3 && m <= 5) return "spring";
  if (m >= 6 && m <= 8) return "summer";
  if (m >= 9 && m <= 11) return "autumn";
  return "winter";
}

/** The catalog lists planting months in northern-hemisphere terms, so a
 * southern-hemisphere member's month is mapped north before comparing. */
function northernMonthFor(month, hemisphere) {
  return hemisphere === "southern" ? ((month + 5) % 12) + 1 : month;
}

function cacheGet(store, key) {
  const hit = store.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expires) {
    store.delete(key);
    return null;
  }
  return hit.value;
}

function cacheSet(store, key, value) {
  store.set(key, { value, expires: Date.now() + CACHE_TTL_MS });
  return value;
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

/** City name -> coordinates. Cached; null when it cannot be resolved. */
async function geocode(city) {
  const key = normaliseCity(city);
  if (!key) return null;

  const cached = cacheGet(geocodeCache, key);
  if (cached) return cached;

  const { geocodeUrl } = config();
  const data = await fetchJson(`${geocodeUrl}?name=${encodeURIComponent(city)}&count=1&language=en&format=json`);
  const hit = data?.results?.[0];
  if (!hit) return null;

  return cacheSet(geocodeCache, key, {
    latitude: hit.latitude,
    longitude: hit.longitude,
    country: hit.country || null,
    name: hit.name || city,
    timezone: hit.timezone || null,
  });
}

/** The built-in table. Always returns something, flagged approximate if the
 * city was not recognised. */
function offlineConditions(city, reason) {
  const known = KNOWN_CITIES[normaliseCity(city)];
  const latitude = known ? known.lat : DEFAULT_LAT;
  const hemisphere = hemisphereFor(latitude);
  const month = new Date().getMonth() + 1;

  return {
    city: city || null,
    coordinates: known ? { latitude, longitude: null } : null,
    country: known ? known.country : null,
    climate: known ? known.climate : DEFAULT_CLIMATE,
    hemisphere,
    season: seasonFor(month, hemisphere),
    month,
    northernMonth: northernMonthFor(month, hemisphere),
    current: {
      temperature: null,
      apparentTemperature: null,
      humidity: null,
      windSpeed: null,
      precipitation: null,
      weatherCode: null,
      soilTemperature: null,
      soilMoisture: null,
    },
    forecast: [],
    source: "climate-table",
    approximate: true,
    fallbackReason: reason,
  };
}

/**
 * Conditions for a city. Never throws: an unresolvable city, a timeout or a
 * provider error all fall back to the climate table.
 */
async function getConditions(city) {
  const { provider } = config();

  if (provider === "offline") {
    return offlineConditions(city, "provider is offline");
  }

  const cacheKey = normaliseCity(city) || "__none__";
  const cached = cacheGet(conditionsCache, cacheKey);
  if (cached) return cached;

  try {
    const place = await geocode(city);
    if (!place) return offlineConditions(city, "city not found");

    const { baseUrl, apiKey } = config();
    const params = new URLSearchParams({
      latitude: String(place.latitude),
      longitude: String(place.longitude),
      current: [
        "temperature_2m",
        "apparent_temperature",
        "relative_humidity_2m",
        "wind_speed_10m",
        "precipitation",
        "weather_code",
        "soil_temperature_6cm",
        "soil_moisture_0_to_1cm",
      ].join(","),
      daily: "temperature_2m_max,temperature_2m_min,precipitation_sum",
      timezone: "auto",
      forecast_days: "7",
    });
    if (apiKey) params.set("apikey", apiKey);

    const data = await fetchJson(`${baseUrl}?${params.toString()}`);
    const daily = data?.daily || {};
    const days = Array.isArray(daily.time) ? daily.time : [];
    const forecast = days.map((date, i) => ({
      date,
      max: daily.temperature_2m_max?.[i] ?? null,
      min: daily.temperature_2m_min?.[i] ?? null,
      precipitation: daily.precipitation_sum?.[i] ?? null,
    }));

    const weeklyRain = forecast.reduce((sum, day) => sum + (typeof day.precipitation === "number" ? day.precipitation : 0), 0);
    const temperature = typeof data?.current?.temperature_2m === "number" ? data.current.temperature_2m : null;
    const hemisphere = hemisphereFor(place.latitude);
    const month = data?.current?.time
      ? new Date(data.current.time).getMonth() + 1
      : new Date().getMonth() + 1;

    // Prefer the curated table over the latitude heuristic when we have the
    // city: otherwise the same city would be scored "mediterranean" online and
    // "subtropical" offline, and the ranking would change with the network.
    const curated =
      KNOWN_CITIES[normaliseCity(city)]?.climate || KNOWN_CITIES[normaliseCity(place.name)]?.climate;

    return cacheSet(conditionsCache, cacheKey, {
      city: place.name || city,
      coordinates: { latitude: place.latitude, longitude: place.longitude },
      country: place.country,
      climate: curated || climateZone({ latitude: place.latitude, temperature, weeklyRain }),
      hemisphere,
      season: seasonFor(month, hemisphere),
      month,
      northernMonth: northernMonthFor(month, hemisphere),
      current: {
        temperature,
        apparentTemperature: numberOf(data?.current?.apparent_temperature),
        humidity: numberOf(data?.current?.relative_humidity_2m),
        windSpeed: numberOf(data?.current?.wind_speed_10m),
        precipitation: numberOf(data?.current?.precipitation),
        weatherCode: data?.current?.weather_code ?? null,
        // Soil figures come from the same call; not every location has them.
        soilTemperature: numberOf(data?.current?.soil_temperature_6cm),
        soilMoisture: numberOf(data?.current?.soil_moisture_0_to_1cm),
      },
      forecast,
      source: "open-meteo",
      approximate: false,
      fallbackReason: null,
    });
  } catch (err) {
    console.warn(`Weather lookup failed for "${city}" (${err.message}) — using the climate table.`);
    return offlineConditions(city, err.message);
  }
}

module.exports = {
  getConditions,
  isConfigured,
  // exported for tests
  climateZone,
  seasonFor,
  hemisphereFor,
  northernMonthFor,
  normaliseCity,
  KNOWN_CITIES,
};
