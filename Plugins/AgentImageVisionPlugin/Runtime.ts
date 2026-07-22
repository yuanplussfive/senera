import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { readPluginTomlConfig, runMcpTool, z } from "@senera/tool-plugin-sdk";
import { AgentPromptRenderer } from "../../Source/AgentSystem/Prompt/AgentPromptRenderer.js";
import type { ResolvedAgentModelProviderConfig } from "../../Source/AgentSystem/Types/AgentConfigTypes.js";
import { AgentImageVisionModelClient } from "../../Source/AgentSystem/Vision/AgentImageVisionModelClient.js";

const nodeRequire = createRequire(path.join(process.cwd(), "PluginConfig.definition.cjs"));
const { configuration } = nodeRequire("./PluginConfig.definition.cjs") as {
  configuration: { schema: { parse(value: unknown): unknown } };
};

const UploadResourceSchema = z
  .object({
    uploadUri: z.string().min(1),
    filePath: z.string().min(1),
    name: z.string().min(1),
    mime: z.string().min(1),
    declaredMime: z.string().min(1).optional(),
    size: z.number().int().nonnegative(),
    sha256: z.string().min(1),
  })
  .strict();
const ImageVisionResourcesSchema = z.object({ image: UploadResourceSchema.optional() }).strict();
const ImageVisionArgumentsSchema = z
  .object({
    uploadUri: z.string().trim().min(1),
    task: z.string().trim().min(1),
    question: z.string().trim().min(1).optional(),
    resources: ImageVisionResourcesSchema.optional(),
  })
  .strict();

const ImageVisionResultSchema = z
  .object({
    images: z
      .object({
        item: z.array(
          z
            .object({
              uploadUri: z.string(),
              status: z.literal("analyzed"),
              task: z.string(),
              question: z.string().optional(),
              name: z.string(),
              mime: z.string(),
              size: z.number().int().nonnegative(),
              answer: z.string(),
              providerId: z.string(),
              providerEndpoint: z.string(),
              providerModel: z.string(),
              message: z.string(),
            })
            .strict(),
        ),
      })
      .strict(),
  })
  .strict();

type RawImageVisionPluginConfig = {
  vision: {
    maxImageMb: number;
    allowedMimes: string[];
    systemTemplate: string;
    promptTemplate: string;
    provider: {
      id: string;
      title: string;
      kind: "OpenAICompatible";
      endpoint: ResolvedAgentModelProviderConfig["Endpoint"];
      baseUrl: string;
      apiKey: string;
      apiVersion: string;
      model: string;
      temperature: number;
      maxOutputTokens: number;
      timeoutSeconds: number;
      firstTokenTimeoutSeconds: number;
      maxRequestSeconds: number;
      maxNetworkRetries: number;
      retryBaseDelaySeconds: number;
      retryMaxDelaySeconds: number;
      retryAfterMaxDelaySeconds: number;
      headers: Record<string, string>;
    };
  };
};

void runMcpTool({
  toolName: "ImageVisionTool",
  argumentSchema: ImageVisionArgumentsSchema,
  resultSchema: ImageVisionResultSchema,
  resultText: (result) => result.images.item.map((item) => `${item.name}: ${item.answer}`).join("\n"),
  async execute(args, context) {
    const upload = UploadResourceSchema.parse(args.resources?.image);
    if (upload.uploadUri !== args.uploadUri) {
      throw new Error("ImageVisionTool received an upload resource that does not match uploadUri.");
    }
    const pluginConfig = readImageVisionPluginConfig();
    ensureImageAllowed(upload.mime, upload.size, pluginConfig);
    const base64 = await fs.readFile(upload.filePath, { encoding: "base64", signal: context.signal });
    const renderer = new AgentPromptRenderer();
    const promptScope = {
      uploadUri: upload.uploadUri,
      task: args.task,
      question: args.question ?? "",
      name: upload.name,
      mime: upload.mime,
      size: upload.size,
    };
    const response = await new AgentImageVisionModelClient().complete({
      provider: resolveImageVisionProvider(pluginConfig),
      systemPrompt: renderer.renderTextSync(pluginConfig.vision.systemTemplate, promptScope),
      prompt: renderer.renderTextSync(pluginConfig.vision.promptTemplate, promptScope),
      mime: upload.mime,
      base64,
      signal: context.signal,
    });
    return {
      images: {
        item: [
          {
            uploadUri: upload.uploadUri,
            status: "analyzed" as const,
            task: args.task,
            ...(args.question ? { question: args.question } : {}),
            name: upload.name,
            mime: upload.mime,
            size: upload.size,
            answer: response.text,
            providerId: response.provider.id,
            providerEndpoint: response.provider.endpoint,
            providerModel: response.provider.model,
            message: "Image was analyzed by the configured vision model.",
          },
        ],
      },
    };
  },
});

function readImageVisionPluginConfig(): RawImageVisionPluginConfig {
  return configuration.schema.parse(readPluginTomlConfig("PluginConfig.toml")) as RawImageVisionPluginConfig;
}

function ensureImageAllowed(mime: string, size: number, config: RawImageVisionPluginConfig): void {
  if (!config.vision.allowedMimes.includes(mime)) {
    throw new Error(`当前图片 MIME 未被 ImageVisionTool 配置允许：${mime}`);
  }
  const maxBytes = Math.round(config.vision.maxImageMb * 1024 * 1024);
  if (size > maxBytes) {
    throw new Error(`图片超过 ImageVisionTool 配置大小限制：${size} > ${maxBytes}`);
  }
}

function resolveImageVisionProvider(config: RawImageVisionPluginConfig): ResolvedAgentModelProviderConfig {
  const provider = config.vision.provider;
  const missing = [
    provider.id ? undefined : "vision.provider.id",
    provider.baseUrl ? undefined : "vision.provider.baseUrl",
    provider.apiKey ? undefined : "vision.provider.apiKey",
    provider.apiVersion ? undefined : "vision.provider.apiVersion",
    provider.model ? undefined : "vision.provider.model",
  ].filter((value): value is string => Boolean(value));
  if (missing.length > 0) throw new Error(`ImageVisionTool 供应商配置缺失：${missing.join(", ")}`);
  if (provider.retryBaseDelaySeconds > provider.retryMaxDelaySeconds) {
    throw new Error("ImageVisionTool 配置无效：retryBaseDelaySeconds 不能大于 retryMaxDelaySeconds");
  }
  new URL(provider.baseUrl);
  return {
    Id: provider.id,
    ProviderId: provider.id,
    Kind: provider.kind,
    Endpoint: provider.endpoint,
    BaseUrl: provider.baseUrl,
    ApiKey: provider.apiKey,
    ApiVersion: provider.apiVersion,
    Model: provider.model,
    Temperature: provider.temperature,
    MaxOutputTokens: provider.maxOutputTokens,
    Stream: false,
    TimeoutMs: toMilliseconds(provider.timeoutSeconds, "vision.provider.timeoutSeconds"),
    FirstTokenTimeoutMs: toOptionalMilliseconds(
      provider.firstTokenTimeoutSeconds,
      "vision.provider.firstTokenTimeoutSeconds",
    ),
    MaxRequestMs: toOptionalMilliseconds(provider.maxRequestSeconds, "vision.provider.maxRequestSeconds"),
    MaxNetworkRetries: provider.maxNetworkRetries,
    RetryBaseDelayMs: toMilliseconds(provider.retryBaseDelaySeconds, "vision.provider.retryBaseDelaySeconds"),
    RetryMaxDelayMs: toMilliseconds(provider.retryMaxDelaySeconds, "vision.provider.retryMaxDelaySeconds"),
    RetryAfterMaxDelayMs: toMilliseconds(
      provider.retryAfterMaxDelaySeconds,
      "vision.provider.retryAfterMaxDelaySeconds",
    ),
    Headers: provider.headers,
  };
}

function toMilliseconds(seconds: number, field: string): number {
  const milliseconds = Math.round(seconds * 1000);
  if (milliseconds < 1) throw new Error(`ImageVisionTool 配置无效：${field}`);
  return milliseconds;
}

function toOptionalMilliseconds(seconds: number, field: string): number {
  if (seconds === -1) return -1;
  return toMilliseconds(seconds, field);
}
