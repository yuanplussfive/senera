"use strict";

const { definePluginConfiguration, z } = require("@senera/tool-plugin-sdk");

const configuration = definePluginConfiguration({
  schema: z
    .object({
      senera: z.object({ enabled: z.boolean() }).passthrough(),
      weather: z
        .object({
          api_keys: z.array(z.string().trim().min(1)),
          api_host: z.string().trim().url(),
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
      api_keys: [],
      api_host: "https://your-id.re.qweatherapi.com",
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
        fields: [{ path: ["senera", "enabled"], label: "启用插件", type: "boolean", required: true, essential: true }],
      },
      {
        id: "weather",
        label: "和风天气",
        fields: [
          {
            path: ["weather", "api_keys"],
            label: "接口密钥",
            type: "array",
            itemType: "string",
            secret: true,
            required: true,
            essential: true,
          },
          {
            path: ["weather", "api_host"],
            label: "API URL",
            description: "和风天气控制台分配的专属 API Host，必须包含 https://。",
            type: "string",
            required: true,
            essential: true,
          },
          { path: ["weather", "language"], label: "语言", type: "string", required: false, essential: false },
          {
            path: ["weather", "unit"],
            label: "单位",
            type: "string",
            options: ["metric", "imperial"],
            optionLabels: { metric: "公制", imperial: "英制" },
            required: false,
            essential: false,
          },
          {
            path: ["weather", "timeout_seconds"],
            label: "请求超时",
            type: "number",
            min: 1,
            max: 300,
            step: 1,
            required: false,
            essential: false,
          },
          { path: ["weather", "state_dir"], label: "状态目录", type: "string", required: false, essential: false },
        ],
      },
    ],
  },
});

module.exports = { configuration };
