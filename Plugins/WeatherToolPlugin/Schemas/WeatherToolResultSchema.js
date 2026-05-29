"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var WeatherToolResultSchema_exports = {};
__export(WeatherToolResultSchema_exports, {
  Schema: () => Schema
});
module.exports = __toCommonJS(WeatherToolResultSchema_exports);
var import_zod = require("@senera/tool-plugin-sdk");
const Schema = import_zod.z.object({
  location: import_zod.z.string(),
  latitude: import_zod.z.number(),
  longitude: import_zod.z.number(),
  timezone: import_zod.z.string(),
  temperature: import_zod.z.number(),
  temperatureUnit: import_zod.z.string(),
  windSpeed: import_zod.z.number(),
  windSpeedUnit: import_zod.z.string(),
  windDirection: import_zod.z.number(),
  weatherCode: import_zod.z.number().int(),
  weatherText: import_zod.z.string(),
  observationTime: import_zod.z.string(),
  source: import_zod.z.string()
}).strict();
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  Schema
});
