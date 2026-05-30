"use strict";

const { z } = require("@senera/tool-plugin-sdk");

const ForecastDaySchema = z.object({
  date: z.string(),
  condition: z.string(),
  maxTemperature: z.number().optional(),
  minTemperature: z.number().optional(),
  avgTemperature: z.number().optional(),
  temperatureUnit: z.string(),
  chanceOfRain: z.number().optional(),
  precipitation: z.number().optional(),
  precipitationUnit: z.string().optional(),
  sunrise: z.string().optional(),
  sunset: z.string().optional()
}).strict();

const Schema = z.object({
  location: z.string(),
  resolvedLocation: z.string(),
  country: z.string().optional(),
  region: z.string().optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  timezone: z.string().optional(),
  localTime: z.string().optional(),
  observationTime: z.string().optional(),
  temperature: z.number().optional(),
  feelsLike: z.number().optional(),
  temperatureUnit: z.string(),
  condition: z.string(),
  humidity: z.number().optional(),
  windSpeed: z.number().optional(),
  windSpeedUnit: z.string().optional(),
  windDirection: z.string().optional(),
  airQualityIndex: z.number().optional(),
  forecast: z.object({
    item: z.array(ForecastDaySchema)
  }).optional(),
  source: z.string()
}).strict();

module.exports = {
  Schema
};
