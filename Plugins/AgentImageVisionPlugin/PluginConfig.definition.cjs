"use strict";

const { definePluginConfiguration, z } = require("@senera/tool-plugin-sdk");

const EndpointNames = ["Responses", "ChatCompletions", "ClaudeMessages", "GoogleGenerateContent"];

const configuration = definePluginConfiguration({
  schema: z
    .object({
      senera: z.object({ enabled: z.boolean() }).passthrough(),
      vision: z
        .object({
          maxImageMb: z.number().positive(),
          allowedMimes: z.array(z.string().trim().min(1)).min(1),
          systemTemplate: z.string().min(1),
          promptTemplate: z.string().min(1),
          provider: z
            .object({
              id: z.string().trim(),
              title: z.string().trim(),
              kind: z.literal("OpenAICompatible"),
              endpoint: z.enum(EndpointNames),
              baseUrl: z.string().trim(),
              apiKey: z.string(),
              apiVersion: z.string().trim(),
              model: z.string().trim(),
              temperature: z.number().min(0).max(2),
              maxOutputTokens: z
                .number()
                .int()
                .refine((value) => value === -1 || value >= 1),
              timeoutSeconds: z.number().positive(),
              firstTokenTimeoutSeconds: z.number().refine((value) => value === -1 || value > 0),
              maxRequestSeconds: z.number().refine((value) => value === -1 || value > 0),
              maxNetworkRetries: z.number().int().min(0),
              retryBaseDelaySeconds: z.number().positive(),
              retryMaxDelaySeconds: z.number().positive(),
              retryAfterMaxDelaySeconds: z.number().positive(),
              headers: z.record(z.string(), z.string()),
            })
            .strict(),
        })
        .strict(),
    })
    .strict(),
  defaults: {
    senera: { enabled: false },
    vision: {
      maxImageMb: 10,
      allowedMimes: ["image/png", "image/jpeg", "image/webp", "image/gif"],
      systemTemplate:
        "You analyze user-provided images from Senera uploads. Answer only from visible evidence in the image. If information is unclear, say it is unclear.",
      promptTemplate:
        "Task: {{ task }}\\nQuestion: {{ question }}\\nImage: {{ name }} ({{ mime }}, {{ size }} bytes)\\nReturn concise observations and directly answer the question when possible.",
      provider: {
        id: "",
        title: "",
        kind: "OpenAICompatible",
        endpoint: "Responses",
        baseUrl: "",
        apiKey: "",
        apiVersion: "",
        model: "",
        temperature: 0.2,
        maxOutputTokens: -1,
        timeoutSeconds: 120,
        firstTokenTimeoutSeconds: -1,
        maxRequestSeconds: -1,
        maxNetworkRetries: 2,
        retryBaseDelaySeconds: 1,
        retryMaxDelaySeconds: 30,
        retryAfterMaxDelaySeconds: 60,
        headers: {},
      },
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
        id: "vision",
        label: "图片识别参数",
        fields: [
          { path: ["vision", "maxImageMb"], label: "图片大小上限", type: "number", min: 0.1, step: 0.5 },
          { path: ["vision", "allowedMimes"], label: "允许图片类型", type: "array", itemType: "string" },
          { path: ["vision", "systemTemplate"], label: "系统提示词", type: "string", multiline: true },
          { path: ["vision", "promptTemplate"], label: "用户提示词", type: "string", multiline: true },
        ],
      },
      {
        id: "vision.provider",
        label: "识图供应商",
        fields: [
          { path: ["vision", "provider", "id"], label: "供应商 ID", type: "string" },
          { path: ["vision", "provider", "title"], label: "供应商名称", type: "string" },
          { path: ["vision", "provider", "kind"], label: "供应商类型", type: "string", options: ["OpenAICompatible"] },
          { path: ["vision", "provider", "endpoint"], label: "接口协议", type: "string", options: EndpointNames },
          {
            path: ["vision", "provider", "baseUrl"],
            label: "服务地址",
            type: "string",
            required: true,
          },
          { path: ["vision", "provider", "apiKey"], label: "接口密钥", type: "string", secret: true },
          { path: ["vision", "provider", "apiVersion"], label: "接口版本", type: "string" },
          { path: ["vision", "provider", "model"], label: "模型", type: "string", required: true },
          { path: ["vision", "provider", "temperature"], label: "温度", type: "number", min: 0, max: 2, step: 0.1 },
          {
            path: ["vision", "provider", "maxOutputTokens"],
            label: "最大输出 tokens",
            type: "number",
            min: -1,
            step: 1,
          },
          { path: ["vision", "provider", "timeoutSeconds"], label: "请求超时", type: "number", min: 0.1, step: 1 },
          {
            path: ["vision", "provider", "firstTokenTimeoutSeconds"],
            label: "首 token 超时",
            type: "number",
            min: -1,
            step: 1,
          },
          { path: ["vision", "provider", "maxRequestSeconds"], label: "总请求时限", type: "number", min: -1, step: 1 },
          { path: ["vision", "provider", "maxNetworkRetries"], label: "网络重试次数", type: "number", min: 0, step: 1 },
          {
            path: ["vision", "provider", "retryBaseDelaySeconds"],
            label: "重试基础等待",
            type: "number",
            min: 0.001,
            step: 0.1,
          },
          {
            path: ["vision", "provider", "retryMaxDelaySeconds"],
            label: "重试最大等待",
            type: "number",
            min: 0.001,
            step: 1,
          },
          {
            path: ["vision", "provider", "retryAfterMaxDelaySeconds"],
            label: "Retry-After 最大等待",
            type: "number",
            min: 0.001,
            step: 1,
          },
          { path: ["vision", "provider", "headers"], label: "附加请求头", type: "table" },
        ],
      },
    ],
  },
});

module.exports = { configuration };
