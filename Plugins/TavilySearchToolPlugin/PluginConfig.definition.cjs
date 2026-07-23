"use strict";

const { definePluginConfiguration, z } = require("@senera/tool-plugin-sdk");

const configuration = definePluginConfiguration({
  schema: z
    .object({
      senera: z.object({ enabled: z.boolean() }).passthrough(),
      tavily: z
        .object({
          api_keys: z.array(z.string().trim().min(1)),
          base_url: z.string().trim().url(),
          timeout_seconds: z.number().positive().max(300),
          state_dir: z.string().trim().min(1),
        })
        .strict(),
    })
    .strict(),
  defaults: {
    senera: { enabled: false },
    tavily: {
      api_keys: [],
      base_url: "https://api.tavily.com",
      timeout_seconds: 300,
      state_dir: ".state",
    },
  },
  form: {
    sections: [
      {
        id: "senera",
        label: "启用状态",
        fields: [{ path: ["senera", "enabled"], label: "启用插件", type: "boolean", required: true }],
      },
      {
        id: "tavily",
        label: "网页搜索参数",
        fields: [
          {
            path: ["tavily", "api_keys"],
            label: "接口密钥",
            type: "array",
            itemType: "string",
            secret: true,
            required: true,
          },
          { path: ["tavily", "base_url"], label: "服务地址", type: "string" },
          { path: ["tavily", "timeout_seconds"], label: "请求超时", type: "number", min: 1, max: 300, step: 1 },
          { path: ["tavily", "state_dir"], label: "状态目录", type: "string" },
        ],
      },
    ],
  },
});

module.exports = { configuration };
