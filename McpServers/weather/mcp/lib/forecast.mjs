const forecastPeriods = [3, 7, 10, 15, 30];
const errorResponsePreviewCharacters = 1_000;
let credentialCursor = 0;

export default async function execute(input, context) {
  const config = configuration(context.environment);
  const credential = nextCredential(config.credentials);
  const language = input.language ?? config.language;
  const locationResponse = await qweather(
    config,
    credential,
    "/geo/v2/city/lookup",
    { location: input.location, lang: language, number: "1" },
    context.signal,
  );
  const location = record(array(locationResponse.location)[0]);
  const locationId = text(location.id);
  if (!locationId) throw new Error(`QWeather did not resolve location: ${input.location}`);
  const current = await qweather(
    config,
    credential,
    "/v7/weather/now",
    { location: locationId, lang: language, unit: config.unit === "imperial" ? "i" : "m" },
    context.signal,
  );
  const days = input.days ?? 1;
  const forecast =
    days > 1 ? await forecastRequest(config, credential, locationId, days, language, context.signal) : [];
  const data = projectWeather(input.location, location, record(current.now), forecast, config.unit);
  return { data, summary: `${data.resolvedLocation}: ${data.condition}` };
}

function configuration(environment) {
  const credentials = environmentList(environment.QWEATHER_API_KEYS, environment.QWEATHER_API_KEY);
  if (credentials.length === 0) throw new Error("Weather requires QWEATHER_API_KEY or QWEATHER_API_KEYS.");
  return {
    credentials,
    endpoint: httpsEndpoint(environment.QWEATHER_API_HOST ?? "https://devapi.qweather.com"),
    language: text(environment.WEATHER_LANG) ?? "zh",
    unit: environment.WEATHER_UNIT === "imperial" ? "imperial" : "metric",
    timeoutMs: positiveInteger(environment.QWEATHER_TIMEOUT_MS),
  };
}

async function forecastRequest(config, credential, location, days, language, signal) {
  const period = forecastPeriods.find((candidate) => candidate >= days) ?? forecastPeriods.at(-1);
  const response = await qweather(
    config,
    credential,
    `/v7/weather/${period}d`,
    { location, lang: language, unit: config.unit === "imperial" ? "i" : "m" },
    signal,
  );
  return array(response.daily).slice(0, days);
}

async function qweather(config, credential, pathname, query, externalSignal) {
  const url = new URL(pathname, config.endpoint);
  Object.entries(query).forEach(([name, value]) => url.searchParams.set(name, value));
  const signal = upstreamSignal(externalSignal, config.timeoutMs);
  const response = await fetch(url, { headers: { "X-QW-Api-Key": credential }, signal });
  const body = await response.text();
  if (!response.ok)
    throw new Error(
      `QWeather request failed with HTTP ${response.status}: ${body.slice(0, errorResponsePreviewCharacters)}`,
    );
  const result = record(body ? JSON.parse(body) : {});
  const providerCode = text(result.code);
  if (providerCode && providerCode !== "200")
    throw new Error(`QWeather request failed with provider code ${providerCode}.`);
  return result;
}

function upstreamSignal(externalSignal, timeoutMs) {
  if (timeoutMs === undefined) return externalSignal;
  const timeout = AbortSignal.timeout(timeoutMs);
  return externalSignal ? AbortSignal.any([externalSignal, timeout]) : timeout;
}

function projectWeather(requestedLocation, location, current, forecastSource, unit) {
  const metric = unit === "metric";
  const temperatureUnit = metric ? "celsius" : "fahrenheit";
  return compact({
    location: requestedLocation,
    resolvedLocation: [text(location.name), text(location.adm1), text(location.country)].filter(Boolean).join(", "),
    country: text(location.country),
    region: text(location.adm1),
    latitude: number(location.lat),
    longitude: number(location.lon),
    timezone: text(location.tz),
    observationTime: text(current.obsTime),
    temperature: number(current.temp),
    feelsLike: number(current.feelsLike),
    temperatureUnit,
    condition: text(current.text) ?? "Unknown",
    humidity: number(current.humidity),
    windSpeed: number(current.windSpeed),
    windSpeedUnit: metric ? "kph" : "mph",
    windDirection: text(current.windDir),
    forecast: forecastSource.map((entry) => {
      const day = record(entry);
      return compact({
        date: text(day.fxDate) ?? "",
        condition: [text(day.textDay), text(day.textNight)].filter(Boolean).join(" / "),
        maxTemperature: number(day.tempMax),
        minTemperature: number(day.tempMin),
        temperatureUnit,
        chanceOfRain: number(day.precipProbability ?? day.pop),
        precipitation: number(day.precip),
        precipitationUnit: "mm",
        sunrise: text(day.sunrise),
        sunset: text(day.sunset),
      });
    }),
    source: "QWeather",
  });
}

function nextCredential(credentials) {
  const credential = credentials[credentialCursor % credentials.length];
  credentialCursor = (credentialCursor + 1) % credentials.length;
  return credential;
}

function environmentList(...values) {
  return [
    ...new Set(
      values
        .flatMap((value) => (typeof value === "string" ? value.split(",") : []))
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ];
}

function httpsEndpoint(value) {
  const endpoint = new URL(value);
  if (endpoint.protocol !== "https:") throw new Error("QWeather endpoint must use HTTPS.");
  return endpoint;
}

function positiveInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function compact(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function text(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function number(value) {
  if (typeof value !== "number" && (typeof value !== "string" || !value.trim())) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
