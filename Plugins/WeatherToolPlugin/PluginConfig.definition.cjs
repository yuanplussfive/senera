"use strict";

const { definePluginConfiguration, z } = require("@senera/tool-plugin-sdk");

const configuration = definePluginConfiguration({
  schema: z
    .object({
      senera: z.object({ enabled: z.boolean() }).passthrough(),
      weather: z
        .object({
          provider: z.enum(["qweather", "weatherapi", "visual_crossing"]),
          api_keys: z.array(z.string().trim().min(1)),
          api_host: z.string().trim().min(1),
          weather_api_host: z.string().trim().min(1).optional(),
          base_url: z.string().trim().min(1).optional(),
          geo_base_url: z.string().trim().min(1).optional(),
          language: z.string().trim().min(1),
          unit: z.enum(["metric", "imperial"]),
          timeout_seconds: z.number().positive().max(300),
          state_dir: z.string().trim().min(1),
        })
        .strict(),
    })
    .strict(),
  defaults: {
    senera: { enabled: false },
    weather: {
      provider: "qweather",
      api_keys: [],
      api_host: "your-id.re.qweatherapi.com",
      language: "zh",
      unit: "metric",
      timeout_seconds: 15,
      state_dir: ".state",
    },
  },
  form: {
    sections: [
      {
        id: "senera",
        label: "启用状态",
        fields: [{ path: ["senera", "enabled"], label: "启用插件", type: "boolean" }],
      },
      {
        id: "weather",
        label: "天气参数",
        fields: [
          {
            path: ["weather", "provider"],
            label: "天气服务",
            type: "string",
            options: ["qweather", "weatherapi", "visual_crossing"],
            optionLabels: { qweather: "和风天气", weatherapi: "国际天气服务", visual_crossing: "全球天气服务" },
          },
          { path: ["weather", "api_keys"], label: "接口密钥", type: "array", itemType: "string", secret: true },
          { path: ["weather", "api_host"], label: "接口域名", type: "string" },
          { path: ["weather", "weather_api_host"], label: "WeatherAPI 域名", type: "string", required: false },
          { path: ["weather", "base_url"], label: "服务基础地址", type: "string", required: false },
          { path: ["weather", "geo_base_url"], label: "地理编码地址", type: "string", required: false },
          { path: ["weather", "language"], label: "语言", type: "string" },
          {
            path: ["weather", "unit"],
            label: "单位",
            type: "string",
            options: ["metric", "imperial"],
            optionLabels: { metric: "公制", imperial: "英制" },
          },
          { path: ["weather", "timeout_seconds"], label: "请求超时", type: "number", min: 1, max: 300, step: 1 },
          { path: ["weather", "state_dir"], label: "状态目录", type: "string" },
        ],
      },
    ],
  },
});

module.exports = { configuration };
