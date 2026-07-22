"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { readPluginTomlConfig, runMcpTool } = require("@senera/tool-plugin-sdk");
const { Schema: ArgumentSchema } = require("./Schemas/WeatherToolArgumentsSchema.js");
const { Schema: ResultSchema } = require("./Schemas/WeatherToolResultSchema.js");
const { configuration } = require("./PluginConfig.definition.cjs");

const ConfigFileName = "PluginConfig.toml";
const ProviderNames = {
  WeatherApi: "weatherapi",
  QWeather: "qweather",
  VisualCrossing: "visual_crossing",
};

const Providers = {
  [ProviderNames.WeatherApi]: {
    title: "WeatherAPI.com",
    defaultBaseUrl: "https://api.weatherapi.com/v1",
    async fetch(options) {
      const endpoint = options.args.days > 1 ? "/forecast.json" : "/current.json";
      const url = new URL(endpoint, options.config.base_url);
      url.searchParams.set("key", options.apiKey);
      url.searchParams.set("q", options.args.location);
      url.searchParams.set("lang", options.language);
      url.searchParams.set("aqi", "yes");
      if (options.args.days > 1) {
        url.searchParams.set("days", String(options.args.days));
        url.searchParams.set("alerts", "no");
      }
      return normalizeWeatherApi(
        await fetchJson(url, options.timeoutMs, undefined, options.signal),
        options.args.location,
        options.config.unit,
      );
    },
  },
  [ProviderNames.QWeather]: {
    title: "QWeather",
    defaultBaseUrl: "https://devapi.qweather.com",
    async fetch(options) {
      const location = await lookupQWeatherLocation(options);
      const nowUrl = new URL("/v7/weather/now", options.config.base_url);
      nowUrl.searchParams.set("location", location.id);
      nowUrl.searchParams.set("lang", options.language);
      nowUrl.searchParams.set("unit", options.config.unit === "imperial" ? "i" : "m");
      const now = await fetchQWeatherJson(nowUrl, options.timeoutMs, options.apiKey, options.signal);
      const forecast = options.args.days > 1 ? await fetchQWeatherForecast(options, location.id) : undefined;
      return normalizeQWeather(now, forecast, location, options.args.location, options.config.unit);
    },
  },
  [ProviderNames.VisualCrossing]: {
    title: "Visual Crossing",
    defaultBaseUrl: "https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline",
    async fetch(options) {
      const encodedLocation = encodeURIComponent(options.args.location);
      const url = new URL(`${trimTrailingSlash(options.config.base_url)}/${encodedLocation}`);
      url.searchParams.set("key", options.apiKey);
      url.searchParams.set("unitGroup", options.config.unit === "imperial" ? "us" : "metric");
      url.searchParams.set("lang", options.language);
      url.searchParams.set("include", options.args.days > 1 ? "current,days" : "current");
      url.searchParams.set("contentType", "json");
      return normalizeVisualCrossing(
        await fetchJson(url, options.timeoutMs, undefined, options.signal),
        options.args.location,
        options.args.days,
      );
    },
  },
};

void runMcpTool({
  toolName: "WeatherTool",
  argumentSchema: ArgumentSchema,
  resultSchema: ResultSchema,
  resultText: (result) => formatWeatherOutput(result).trim(),
  async execute(args, context) {
    await context.reportProgress({ completed: 0, total: 1, message: "正在请求天气服务" });
    const config = readConfig();
    const provider = Providers[config.provider];
    const apiKey = await claimNextApiKey(config);
    const result = await provider.fetch({
      args,
      apiKey,
      config: resolveProviderConfig(config, provider),
      language: args.language ?? config.language,
      timeoutMs: args.timeoutMs ?? config.timeoutMs,
      signal: context.signal,
    });
    await context.reportOutput({ stream: "stdout", text: formatWeatherOutput(result) });
    await context.reportProgress({ completed: 1, total: 1, message: "天气数据已返回" });
    return result;
  },
});

function formatWeatherOutput(result) {
  const location = result.resolvedLocation ?? result.location;
  const temperature = result.temperature === undefined ? "" : ` ${result.temperature} ${result.temperatureUnit ?? ""}`;
  return `${location}: ${result.condition}${temperature}\n`;
}

function readConfig() {
  const parsed = readConfigFile();
  const result = configuration.schema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Weather 插件配置无效：${path.resolve(process.cwd(), ConfigFileName)}：${result.error.message}`);
  }
  return withEnvironmentConfig(normalizeConfigUnits(result.data.weather));
}

function normalizeConfigUnits(config) {
  return {
    ...config,
    timeoutMs: readSecondsAsMilliseconds(config.timeout_seconds),
  };
}

function readSecondsAsMilliseconds(valueSeconds) {
  return Math.round(valueSeconds * 1000);
}

function readConfigFile() {
  return readPluginTomlConfig(ConfigFileName);
}

function withEnvironmentConfig(config) {
  return {
    ...config,
    api_keys: appendDefined(config.api_keys, process.env.WEATHER_API_KEY, process.env.QWEATHER_API_KEY),
    api_host: process.env.WEATHER_API_HOST ?? config.api_host ?? config.weather_api_host,
    language: process.env.WEATHER_LANG ?? config.language,
  };
}

function resolveProviderConfig(config, provider) {
  const qWeatherHost = config.provider === ProviderNames.QWeather ? normalizeBaseUrl(config.api_host) : undefined;
  const baseUrl = normalizeBaseUrl(config.base_url) ?? qWeatherHost ?? provider.defaultBaseUrl;
  return {
    ...config,
    base_url: baseUrl,
    geo_base_url: normalizeBaseUrl(config.geo_base_url) ?? qWeatherHost ?? provider.defaultGeoBaseUrl ?? baseUrl,
  };
}

function appendDefined(values, ...candidates) {
  return [...values, ...candidates.filter((value) => typeof value === "string" && value.trim().length > 0)];
}

function normalizeBaseUrl(value) {
  if (typeof value !== "string" || value.trim().length === 0) {
    return undefined;
  }
  const trimmed = value.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

async function claimNextApiKey(config) {
  if (config.api_keys.length < 1) {
    throw new Error(
      "Weather 插件缺少 API key：请在 PluginConfig.toml 的 weather.api_keys 中填写，或设置 WEATHER_API_KEY。",
    );
  }
  if (config.api_keys.length === 1) {
    return config.api_keys[0];
  }

  const stateFilePath = resolveStateFilePath(config);
  fs.mkdirSync(path.dirname(stateFilePath), { recursive: true });
  const releaseLock = await acquireStateLock(`${stateFilePath}.lock`);
  try {
    const current = readKeyCursor(stateFilePath);
    const nextIndex = current % config.api_keys.length;
    writeJsonFileAtomic(stateFilePath, {
      cursor: (nextIndex + 1) % config.api_keys.length,
      updatedAt: new Date().toISOString(),
    });
    return config.api_keys[nextIndex];
  } finally {
    releaseLock();
  }
}

function resolveStateFilePath(config) {
  const stateDir = path.isAbsolute(config.state_dir) ? config.state_dir : path.resolve(process.cwd(), config.state_dir);
  return path.join(stateDir, "weather-key-cursor.json");
}

function readKeyCursor(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return Number.isInteger(parsed.cursor) && parsed.cursor >= 0 ? parsed.cursor : 0;
  } catch {
    return 0;
  }
}

async function acquireStateLock(lockFilePath) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 3000) {
    try {
      const handle = await fs.promises.open(lockFilePath, "wx");
      await handle.writeFile(
        JSON.stringify({
          pid: process.pid,
          createdAt: new Date().toISOString(),
        }),
      );
      await handle.close();
      return () => fs.rmSync(lockFilePath, { force: true });
    } catch (error) {
      if (!isNodeErrorCode(error, "EEXIST")) {
        throw error;
      }
      removeStaleLock(lockFilePath);
      await sleep(50);
    }
  }
  throw new Error(`Weather key 轮询状态锁等待超时：${lockFilePath}`);
}

function removeStaleLock(lockFilePath) {
  try {
    const stat = fs.statSync(lockFilePath);
    if (Date.now() - stat.mtimeMs > 10000) {
      fs.rmSync(lockFilePath, { force: true });
    }
  } catch (error) {
    if (!isNodeErrorCode(error, "ENOENT")) {
      throw error;
    }
  }
}

function writeJsonFileAtomic(filePath, value) {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(value, null, 2));
  fs.renameSync(tempPath, filePath);
}

async function fetchQWeatherForecast(options, locationId) {
  const url = new URL("/v7/weather/3d", options.config.base_url);
  url.searchParams.set("location", locationId);
  url.searchParams.set("lang", options.language);
  url.searchParams.set("unit", options.config.unit === "imperial" ? "i" : "m");
  return fetchQWeatherJson(url, options.timeoutMs, options.apiKey, options.signal);
}

async function lookupQWeatherLocation(options) {
  const url = new URL(qWeatherGeoLookupPath(options.config), options.config.geo_base_url);
  url.searchParams.set("location", options.args.location);
  url.searchParams.set("lang", options.language);
  url.searchParams.set("number", "1");
  const response = await fetchQWeatherJson(url, options.timeoutMs, options.apiKey, options.signal);
  const [location] = Array.isArray(response.location) ? response.location : [];
  if (!location) {
    throw new Error(`QWeather 没有找到天气位置：${options.args.location}`);
  }
  return location;
}

function qWeatherGeoLookupPath(config) {
  return isLegacyQWeatherGeoHost(config.geo_base_url) ? "/v2/city/lookup" : "/geo/v2/city/lookup";
}

function isLegacyQWeatherGeoHost(value) {
  try {
    return new URL(value).hostname === "geoapi.qweather.com";
  } catch {
    return false;
  }
}

async function fetchQWeatherJson(url, timeoutMs, apiKey, signal) {
  const response = await fetchJson(
    url,
    timeoutMs,
    {
      "X-QW-Api-Key": apiKey,
    },
    signal,
  );
  const code = stringOrUndefined(asRecord(response).code);
  if (code && code !== "200") {
    throw new Error(`QWeather 请求失败：code=${code} path=${url.pathname}`);
  }
  return response;
}

async function fetchJson(url, timeoutMs, headers = undefined, signal = undefined) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const requestSignal = signal ? AbortSignal.any([controller.signal, signal]) : controller.signal;
    const response = await fetch(url, { signal: requestSignal, headers });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`天气接口请求失败：${response.status} ${response.statusText} ${text}`);
    }
    return text.length > 0 ? JSON.parse(text) : {};
  } catch (error) {
    if (controller.signal.aborted && error instanceof Error && error.name === "AbortError") {
      throw new Error(`天气接口请求超时，超过 ${formatMillisecondsAsSeconds(timeoutMs)} 秒：${url.hostname}`, {
        cause: error,
      });
    }
    if (signal?.aborted) throw signal.reason ?? error;
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function formatMillisecondsAsSeconds(valueMs) {
  return Number((valueMs / 1000).toFixed(3));
}

function normalizeWeatherApi(value, originalLocation, unit) {
  const location = asRecord(value.location);
  const current = asRecord(value.current);
  const condition = asRecord(current.condition);
  const metric = unit === "metric";
  return {
    location: originalLocation,
    resolvedLocation: joinLocation([location.name, location.region, location.country]),
    country: stringOrUndefined(location.country),
    region: stringOrUndefined(location.region),
    latitude: numberOrUndefined(location.lat),
    longitude: numberOrUndefined(location.lon),
    timezone: stringOrUndefined(location.tz_id),
    localTime: stringOrUndefined(location.localtime),
    observationTime: stringOrUndefined(current.last_updated),
    temperature: numberOrUndefined(metric ? current.temp_c : current.temp_f),
    feelsLike: numberOrUndefined(metric ? current.feelslike_c : current.feelslike_f),
    temperatureUnit: metric ? "celsius" : "fahrenheit",
    condition: stringOrUndefined(condition.text) ?? "",
    humidity: numberOrUndefined(current.humidity),
    windSpeed: numberOrUndefined(metric ? current.wind_kph : current.wind_mph),
    windSpeedUnit: metric ? "kph" : "mph",
    windDirection: stringOrUndefined(current.wind_dir),
    airQualityIndex: numberOrUndefined(asRecord(current.air_quality)["us-epa-index"]),
    forecast: normalizeWeatherApiForecast(value.forecast, unit),
    source: "WeatherAPI.com",
  };
}

function normalizeWeatherApiForecast(forecast, unit) {
  const metric = unit === "metric";
  const days = asArray(asRecord(forecast).forecastday).map((entry) => {
    const record = asRecord(entry);
    const day = asRecord(record.day);
    const astro = asRecord(record.astro);
    const condition = asRecord(day.condition);
    return {
      date: stringValue(record.date),
      condition: stringOrUndefined(condition.text) ?? "",
      maxTemperature: numberOrUndefined(metric ? day.maxtemp_c : day.maxtemp_f),
      minTemperature: numberOrUndefined(metric ? day.mintemp_c : day.mintemp_f),
      avgTemperature: numberOrUndefined(metric ? day.avgtemp_c : day.avgtemp_f),
      temperatureUnit: metric ? "celsius" : "fahrenheit",
      chanceOfRain: numberOrUndefined(day.daily_chance_of_rain),
      precipitation: numberOrUndefined(metric ? day.totalprecip_mm : day.totalprecip_in),
      precipitationUnit: metric ? "mm" : "in",
      sunrise: stringOrUndefined(astro.sunrise),
      sunset: stringOrUndefined(astro.sunset),
    };
  });
  return days.length > 0 ? { item: days } : undefined;
}

function normalizeQWeather(nowResponse, forecastResponse, location, originalLocation, unit) {
  const now = asRecord(nowResponse.now);
  const metric = unit === "metric";
  return {
    location: originalLocation,
    resolvedLocation: joinLocation([location.name, location.adm1, location.country]),
    country: stringOrUndefined(location.country),
    region: stringOrUndefined(location.adm1),
    latitude: numberOrUndefined(location.lat),
    longitude: numberOrUndefined(location.lon),
    timezone: stringOrUndefined(location.tz),
    observationTime: stringOrUndefined(now.obsTime),
    temperature: numberOrUndefined(now.temp),
    feelsLike: numberOrUndefined(now.feelsLike),
    temperatureUnit: metric ? "celsius" : "fahrenheit",
    condition: stringOrUndefined(now.text) ?? "",
    humidity: numberOrUndefined(now.humidity),
    windSpeed: numberOrUndefined(now.windSpeed),
    windSpeedUnit: metric ? "kph" : "mph",
    windDirection: stringOrUndefined(now.windDir),
    forecast: normalizeQWeatherForecast(forecastResponse, unit),
    source: "QWeather",
  };
}

function normalizeQWeatherForecast(response, unit) {
  const metric = unit === "metric";
  const days = asArray(asRecord(response).daily).map((entry) => {
    const record = asRecord(entry);
    return {
      date: stringValue(record.fxDate),
      condition: joinLocation([record.textDay, record.textNight]),
      maxTemperature: numberOrUndefined(record.tempMax),
      minTemperature: numberOrUndefined(record.tempMin),
      temperatureUnit: metric ? "celsius" : "fahrenheit",
      precipitation: numberOrUndefined(record.precip),
      precipitationUnit: "mm",
      sunrise: stringOrUndefined(record.sunrise),
      sunset: stringOrUndefined(record.sunset),
    };
  });
  return days.length > 0 ? { item: days } : undefined;
}

function normalizeVisualCrossing(value, originalLocation, days) {
  const current = asRecord(value.currentConditions);
  return {
    location: originalLocation,
    resolvedLocation: stringOrUndefined(value.resolvedAddress) ?? originalLocation,
    latitude: numberOrUndefined(value.latitude),
    longitude: numberOrUndefined(value.longitude),
    timezone: stringOrUndefined(value.timezone),
    observationTime: stringOrUndefined(current.datetime),
    temperature: numberOrUndefined(current.temp),
    feelsLike: numberOrUndefined(current.feelslike),
    temperatureUnit: "celsius",
    condition: stringOrUndefined(current.conditions) ?? "",
    humidity: numberOrUndefined(current.humidity),
    windSpeed: numberOrUndefined(current.windspeed),
    windSpeedUnit: "kph",
    windDirection: stringOrUndefined(current.winddir),
    forecast: normalizeVisualCrossingForecast(value.days, days),
    source: "Visual Crossing",
  };
}

function normalizeVisualCrossingForecast(value, maxDays) {
  const days = asArray(value)
    .slice(0, maxDays)
    .map((entry) => {
      const record = asRecord(entry);
      return {
        date: stringValue(record.datetime),
        condition: stringOrUndefined(record.conditions) ?? "",
        maxTemperature: numberOrUndefined(record.tempmax),
        minTemperature: numberOrUndefined(record.tempmin),
        avgTemperature: numberOrUndefined(record.temp),
        temperatureUnit: "celsius",
        precipitation: numberOrUndefined(record.precip),
        precipitationUnit: "mm",
        sunrise: stringOrUndefined(record.sunrise),
        sunset: stringOrUndefined(record.sunset),
      };
    });
  return days.length > 0 ? { item: days } : undefined;
}

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function numberOrUndefined(value) {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(number) ? number : undefined;
}

function stringOrUndefined(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function stringValue(value) {
  return stringOrUndefined(value) ?? "";
}

function joinLocation(values) {
  return values.map(stringOrUndefined).filter(Boolean).join(", ");
}

function trimTrailingSlash(value) {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isNodeErrorCode(error, code) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === code);
}
