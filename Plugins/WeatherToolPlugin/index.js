"use strict";
var import_plugin_sdk = require("@senera/tool-plugin-sdk");
var import_WeatherToolArgumentsSchema = require("./Schemas/WeatherToolArgumentsSchema.js");
var import_WeatherToolResultSchema = require("./Schemas/WeatherToolResultSchema.js");
void (0, import_plugin_sdk.runToolPlugin)({
  toolName: "WeatherTool",
  argumentSchema: import_WeatherToolArgumentsSchema.Schema,
  resultSchema: import_WeatherToolResultSchema.Schema,
  async execute(args) {
    const coordinates = args.latitude !== void 0 && args.longitude !== void 0 ? {
      location: args.location ?? `${args.latitude},${args.longitude}`,
      latitude: args.latitude,
      longitude: args.longitude,
      timezone: args.timezone
    } : await geocodeLocation(args.location ?? "", args.timeoutMs);
    const forecast = await fetchCurrentWeather({
      latitude: coordinates.latitude,
      longitude: coordinates.longitude,
      timezone: args.timezone === "auto" ? coordinates.timezone : args.timezone,
      temperatureUnit: args.temperatureUnit,
      timeoutMs: args.timeoutMs
    });
    return {
      location: coordinates.location,
      latitude: forecast.latitude,
      longitude: forecast.longitude,
      timezone: forecast.timezone,
      temperature: forecast.current.temperature_2m,
      temperatureUnit: forecast.current_units.temperature_2m,
      windSpeed: forecast.current.wind_speed_10m,
      windSpeedUnit: forecast.current_units.wind_speed_10m,
      windDirection: forecast.current.wind_direction_10m,
      weatherCode: forecast.current.weather_code,
      weatherText: describeWeatherCode(forecast.current.weather_code),
      observationTime: forecast.current.time,
      source: "Open-Meteo"
    };
  }
});
async function geocodeLocation(location, timeoutMs) {
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.searchParams.set("name", location);
  url.searchParams.set("count", "1");
  url.searchParams.set("language", "zh");
  url.searchParams.set("format", "json");
  const response = await fetchJson(url, timeoutMs);
  const first = response.results?.[0];
  if (!first) {
    throw new Error(`\u6CA1\u6709\u627E\u5230\u5929\u6C14\u4F4D\u7F6E\uFF1A${location}`);
  }
  return {
    location: [first.name, first.admin1, first.country].filter(Boolean).join(", "),
    latitude: first.latitude,
    longitude: first.longitude,
    timezone: first.timezone ?? "auto"
  };
}
async function fetchCurrentWeather(options) {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(options.latitude));
  url.searchParams.set("longitude", String(options.longitude));
  url.searchParams.set("current", [
    "temperature_2m",
    "weather_code",
    "wind_speed_10m",
    "wind_direction_10m"
  ].join(","));
  url.searchParams.set("timezone", options.timezone);
  if (options.temperatureUnit === "fahrenheit") {
    url.searchParams.set("temperature_unit", "fahrenheit");
  }
  return fetchJson(url, options.timeoutMs);
}
async function fetchJson(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`\u5929\u6C14\u63A5\u53E3\u8BF7\u6C42\u5931\u8D25\uFF1A${response.status} ${response.statusText}`);
    }
    return response.json();
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`\u5929\u6C14\u63A5\u53E3\u8BF7\u6C42\u8D85\u65F6\uFF0C\u8D85\u8FC7 ${timeoutMs}ms\uFF1A${url.hostname}`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
function describeWeatherCode(code) {
  const descriptions = {
    0: "\u6674\u6717",
    1: "\u5927\u90E8\u6674\u6717",
    2: "\u5C40\u90E8\u591A\u4E91",
    3: "\u9634\u5929",
    45: "\u96FE",
    48: "\u96FE\u51C7",
    51: "\u5C0F\u6BDB\u6BDB\u96E8",
    53: "\u4E2D\u7B49\u6BDB\u6BDB\u96E8",
    55: "\u5F3A\u6BDB\u6BDB\u96E8",
    61: "\u5C0F\u96E8",
    63: "\u4E2D\u96E8",
    65: "\u5927\u96E8",
    71: "\u5C0F\u96EA",
    73: "\u4E2D\u96EA",
    75: "\u5927\u96EA",
    80: "\u5C0F\u9635\u96E8",
    81: "\u4E2D\u7B49\u9635\u96E8",
    82: "\u5F3A\u9635\u96E8",
    95: "\u96F7\u66B4",
    96: "\u96F7\u66B4\u4F34\u5C0F\u51B0\u96F9",
    99: "\u96F7\u66B4\u4F34\u5927\u51B0\u96F9"
  };
  return descriptions[code] ?? `\u672A\u77E5\u5929\u6C14\u4EE3\u7801 ${code}`;
}
