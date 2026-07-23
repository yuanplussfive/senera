"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { readPluginTomlConfig, runMcpTool } = require("@senera/tool-plugin-sdk");
const { Schema: ArgumentSchema } = require("./Schemas/WeatherToolArgumentsSchema.js");
const { Schema: ResultSchema } = require("./Schemas/WeatherToolResultSchema.js");
const { configuration } = require("./PluginConfig.definition.cjs");

const ConfigFileName = "PluginConfig.toml";

async function fetchQWeather(options) {
  const location = await lookupQWeatherLocation(options);
  const nowUrl = new URL("/v7/weather/now", options.config.baseUrl);
  nowUrl.searchParams.set("location", location.id);
  nowUrl.searchParams.set("lang", options.language);
  nowUrl.searchParams.set("unit", options.config.unit === "imperial" ? "i" : "m");
  const now = await fetchQWeatherJson(nowUrl, options.timeoutMs, options.apiKey, options.signal);
  const forecast = options.args.days > 1 ? await fetchQWeatherForecast(options, location.id) : undefined;
  return normalizeQWeather(now, forecast, location, options.args.location, options.config.unit);
}

void runMcpTool({
  toolName: "WeatherTool",
  argumentSchema: ArgumentSchema,
  resultSchema: ResultSchema,
  resultText: (result) => formatWeatherOutput(result).trim(),
  async execute(args, context) {
    await context.reportProgress({ completed: 0, total: 1, message: "正在请求天气服务" });
    const config = resolveQWeatherConfig(readConfig());
    const apiKey = await claimNextApiKey(config);
    const result = await fetchQWeather({
      args,
      apiKey,
      config,
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
    api_keys: appendDefined(config.api_keys, process.env.QWEATHER_API_KEY),
    api_host: process.env.QWEATHER_API_HOST ?? config.api_host,
    language: process.env.WEATHER_LANG ?? config.language,
  };
}

function resolveQWeatherConfig(config) {
  const baseUrl = new URL(config.api_host);
  if (baseUrl.protocol !== "https:") {
    throw new Error("Weather 插件的 weather.api_host 必须使用 HTTPS URL。");
  }
  return {
    ...config,
    baseUrl: baseUrl.toString(),
  };
}

function appendDefined(values, ...candidates) {
  return [...values, ...candidates.filter((value) => typeof value === "string" && value.trim().length > 0)];
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
  const url = new URL("/v7/weather/3d", options.config.baseUrl);
  url.searchParams.set("location", locationId);
  url.searchParams.set("lang", options.language);
  url.searchParams.set("unit", options.config.unit === "imperial" ? "i" : "m");
  return fetchQWeatherJson(url, options.timeoutMs, options.apiKey, options.signal);
}

async function lookupQWeatherLocation(options) {
  const url = new URL("/geo/v2/city/lookup", options.config.baseUrl);
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isNodeErrorCode(error, code) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === code);
}
