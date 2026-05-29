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
var WeatherToolArgumentsSchema_exports = {};
__export(WeatherToolArgumentsSchema_exports, {
  Schema: () => Schema
});
module.exports = __toCommonJS(WeatherToolArgumentsSchema_exports);
var import_zod = require("@senera/tool-plugin-sdk");
const Schema = import_zod.z.object({
  location: import_zod.z.string().min(1).optional(),
  latitude: import_zod.z.coerce.number().min(-90).max(90).optional(),
  longitude: import_zod.z.coerce.number().min(-180).max(180).optional(),
  timezone: import_zod.z.string().min(1).default("auto"),
  temperatureUnit: import_zod.z.enum(["celsius", "fahrenheit"]).default("celsius"),
  timeoutMs: import_zod.z.coerce.number().int().min(1e3).max(9e3).default(8e3)
}).strict().refine(
  (value) => Boolean(value.location) || value.latitude !== void 0 && value.longitude !== void 0,
  {
    message: "\u5FC5\u987B\u63D0\u4F9B location\uFF0C\u6216\u8005\u540C\u65F6\u63D0\u4F9B latitude \u548C longitude\u3002",
    path: ["location"]
  }
);
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  Schema
});
