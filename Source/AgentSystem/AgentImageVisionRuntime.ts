import fs from "node:fs/promises";
import { z } from "zod";
import { parse as parseToml } from "smol-toml";
import { resolveUploadsConfig } from "./AgentDefaults.js";
import { throwIfAborted } from "./AgentCancellation.js";
import { AgentPromptRenderer } from "./AgentPromptRenderer.js";
import type { ResolvedAgentModelProviderConfig } from "./Types/AgentConfigTypes.js";
import type { AgentHostToolHandler } from "./AgentToolHostCapabilityRegistry.js";
import type { AgentToolProcessRunResult } from "./AgentToolProcessRunner.js";
import {
  toolProcessFailureResult,
  toolProcessSuccessResult,
} from "./AgentToolProcessEnvelope.js";
import {
  AgentExecutionErrorCodes,
  AgentToolProcessErrorPhases,
} from "./AgentXmlStatus.js";
import { AgentUploadStore } from "./Uploads/AgentUploadStore.js";
import { normalizeAgentUploadUri } from "./Uploads/AgentUploadLocator.js";
import { AgentImageVisionModelClient } from "./Vision/AgentImageVisionModelClient.js";

const ImageVisionArgumentsSchema = z
  .object({
    uploadUri: z.string().trim().min(1),
    task: z.string().trim().min(1),
    question: z.string().trim().min(1).optional(),
  })
  .strict();

const ImageVisionPluginConfigSchema = z
  .object({
    vision: z
      .object({
        maxImageMb: z.number().positive(),
        allowedMimes: z.array(z.string().trim().min(1)).min(1),
        systemTemplate: z.string().min(1),
        promptTemplate: z.string().min(1),
        provider: z
          .object({
            id: z.string().trim(),
            kind: z.literal("OpenAICompatible"),
            endpoint: z.enum([
              "Responses",
              "ChatCompletions",
              "ClaudeMessages",
              "GoogleGenerateContent",
            ]),
            baseUrl: z.string().trim(),
            apiKey: z.string(),
            apiVersion: z.string().trim(),
            model: z.string().trim(),
            temperature: z.number().min(0).max(2),
            maxOutputTokens: z.number().int().refine((value) => value === -1 || value >= 1, {
              message: "maxOutputTokens 必须为 -1，或大于等于 1。",
            }),
            timeoutSeconds: z.number().positive(),
            firstTokenTimeoutSeconds: z.number().refine((value) => value === -1 || value > 0, {
              message: "firstTokenTimeoutSeconds 必须为 -1，或大于 0。",
            }),
            maxRequestSeconds: z.number().refine((value) => value === -1 || value > 0, {
              message: "maxRequestSeconds 必须为 -1，或大于 0。",
            }).optional(),
            maxNetworkRetries: z.number().int().min(0),
            headers: z.record(z.string(), z.string()),
          })
          .strict(),
      })
      .strict(),
  })
  .passthrough();

type ImageVisionArguments = z.infer<typeof ImageVisionArgumentsSchema>;
type RawImageVisionPluginConfig = z.infer<typeof ImageVisionPluginConfigSchema>;

interface ImageVisionPluginConfig {
  vision: Omit<RawImageVisionPluginConfig["vision"], "maxImageMb" | "provider"> & {
    maxImageBytes: number;
    provider: Omit<
      RawImageVisionPluginConfig["vision"]["provider"],
      | "timeoutSeconds"
      | "firstTokenTimeoutSeconds"
      | "maxRequestSeconds"
    > & {
      timeoutMs: number;
      firstTokenTimeoutMs: number;
      maxRequestMs: number;
    };
  };
}

export const imageVisionHostTool: AgentHostToolHandler = async (args, context) => {
  const parsed = ImageVisionArgumentsSchema.safeParse(args);
  if (!parsed.success) {
    return imageVisionFailure({
      code: AgentExecutionErrorCodes.InvalidToolArguments,
      message: "ImageVisionTool 参数无效。",
      details: {
        phase: AgentToolProcessErrorPhases.RuntimeExecution,
        issues: parsed.error.issues,
        toolName: context.tool.name,
      },
      diagnostics: parsed.error.issues.map((issue) => ({
        message: issue.message,
        pointer: `/${issue.path.join("/")}`,
        path: issue.path.map((entry) => typeof entry === "number" ? entry : String(entry)),
      })),
    });
  }

  try {
    throwIfAborted(context.signal);
    const result = await inspectImage(parsed.data, context);
    return toolProcessSuccessResult(result);
  } catch (error) {
    return imageVisionFailure({
      code: AgentExecutionErrorCodes.PluginExecutionError,
      message: error instanceof Error ? error.message : String(error),
      details: {
        phase: AgentToolProcessErrorPhases.RuntimeExecution,
        toolName: context.tool.name,
      },
    });
  }
};

async function inspectImage(
  args: ImageVisionArguments,
  context: Parameters<AgentHostToolHandler>[1],
) {
  const pluginConfig = readImageVisionPluginConfig(context.tool.plugin.config.toml);
  const uploads = resolveUploadsConfig(context.config);
  const store = new AgentUploadStore({
    workspaceRoot: context.workspaceRoot,
    rootDir: uploads.RootDir,
    maxFileBytes: uploads.MaxFileBytes,
  });
  const uploadUri = normalizeAgentUploadUri(args.uploadUri) ?? args.uploadUri;
  const resolved = await store.resolve(uploadUri).catch(() => undefined);
  if (!resolved) {
    return {
      images: {
        item: [
          {
            uploadUri,
            status: "not_found",
            task: args.task,
            answer: "",
            message: "Upload handle was not found in the configured upload store.",
          },
        ],
      },
    };
  }

  ensureImageAllowed(resolved.manifest.mime, resolved.manifest.size, pluginConfig);
  const provider = resolveImageVisionProvider(pluginConfig);
  const base64 = await fs.readFile(resolved.filePath, { encoding: "base64" });
  const renderer = new AgentPromptRenderer();
  const promptScope = {
    uploadUri,
    task: args.task,
    question: args.question ?? "",
    name: resolved.manifest.name,
    mime: resolved.manifest.mime,
    size: resolved.manifest.size,
  };
  const response = await new AgentImageVisionModelClient().complete({
    provider,
    systemPrompt: renderer.renderTextSync(pluginConfig.vision.systemTemplate, promptScope),
    prompt: renderer.renderTextSync(pluginConfig.vision.promptTemplate, promptScope),
    mime: resolved.manifest.mime,
    base64,
    signal: context.signal,
  });

  return {
    images: {
      item: [
        {
          uploadUri,
          status: "analyzed",
          task: args.task,
          question: args.question,
          name: resolved.manifest.name,
          mime: resolved.manifest.mime,
          size: resolved.manifest.size,
          answer: response.text,
          providerId: response.provider.id,
          providerEndpoint: response.provider.endpoint,
          providerModel: response.provider.model,
          message: "Image was analyzed by the configured vision model.",
        },
      ],
    },
  };
}

function ensureImageAllowed(
  mime: string,
  size: number,
  config: ImageVisionPluginConfig,
): void {
  if (!config.vision.allowedMimes.includes(mime)) {
    throw new Error(`当前图片 MIME 未被 ImageVisionTool 配置允许：${mime}`);
  }
  if (size > config.vision.maxImageBytes) {
    throw new Error(`图片超过 ImageVisionTool 配置大小限制：${size} > ${config.vision.maxImageBytes}`);
  }
}

function readImageVisionPluginConfig(toml: string): ImageVisionPluginConfig {
  const parsed = ImageVisionPluginConfigSchema.parse(parseToml(toml));
  return normalizeImageVisionPluginConfig(parsed);
}

function normalizeImageVisionPluginConfig(config: RawImageVisionPluginConfig): ImageVisionPluginConfig {
  const provider = config.vision.provider;
  return {
    ...config,
    vision: {
      ...config.vision,
      maxImageBytes: readMegabytesAsBytes(config.vision.maxImageMb, "vision.maxImageMb"),
      provider: {
        ...provider,
        timeoutMs: readSecondsAsMilliseconds(provider.timeoutSeconds, "vision.provider.timeoutSeconds"),
        firstTokenTimeoutMs: readOptionalSecondsAsMilliseconds(
          provider.firstTokenTimeoutSeconds,
          "vision.provider.firstTokenTimeoutSeconds",
        ),
        maxRequestMs: readOptionalSecondsAsMilliseconds(
          provider.maxRequestSeconds,
          "vision.provider.maxRequestSeconds",
        ),
      },
    },
  };
}

function readMegabytesAsBytes(valueMb: number, fieldName: string): number {
  const value = Math.round(valueMb * 1024 * 1024);
  if (value < 1) {
    throw new Error(`ImageVisionTool 配置缺失或无效：${fieldName}`);
  }
  return value;
}

function readSecondsAsMilliseconds(
  valueSeconds: number,
  fieldName: string,
): number {
  const value = Math.round(valueSeconds * 1000);
  if (value < 1) {
    throw new Error(`ImageVisionTool 配置缺失或无效：${fieldName}`);
  }
  return value;
}

function readOptionalSecondsAsMilliseconds(
  valueSeconds: number | undefined,
  fieldName: string,
): number {
  const value = valueSeconds === undefined || valueSeconds === -1
    ? -1
    : Math.round(valueSeconds * 1000);
  if (value === undefined || (value !== -1 && value < 1)) {
    throw new Error(`ImageVisionTool 配置缺失或无效：${fieldName}`);
  }
  return value;
}

function resolveImageVisionProvider(
  config: ImageVisionPluginConfig,
): ResolvedAgentModelProviderConfig {
  const provider = config.vision.provider;
  assertConfiguredProvider(provider);
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
    TimeoutMs: provider.timeoutMs,
    FirstTokenTimeoutMs: provider.firstTokenTimeoutMs,
    MaxRequestMs: provider.maxRequestMs,
    MaxNetworkRetries: provider.maxNetworkRetries,
    Headers: provider.headers,
  };
}

function assertConfiguredProvider(
  provider: ImageVisionPluginConfig["vision"]["provider"],
): void {
  const missing = [
    provider.id ? undefined : "vision.provider.id",
    provider.baseUrl ? undefined : "vision.provider.baseUrl",
    provider.apiKey ? undefined : "vision.provider.apiKey",
    provider.apiVersion ? undefined : "vision.provider.apiVersion",
    provider.model ? undefined : "vision.provider.model",
  ].filter((item): item is string => Boolean(item));

  if (missing.length > 0) {
    throw new Error(`ImageVisionTool 供应商配置缺失：${missing.join(", ")}`);
  }

  new URL(provider.baseUrl);
}

function imageVisionFailure(
  error: NonNullable<AgentToolProcessRunResult["response"]["error"]>,
): AgentToolProcessRunResult {
  return toolProcessFailureResult(error);
}
