import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { fileTypeFromBuffer } from "file-type";
import { lookup as lookupMime } from "mime-types";
import { AgentDefaults } from "../AgentDefaults.js";
import { sha256Hex } from "../Core/AgentHash.js";
import type { ConfigFormDocument } from "../Config/AgentConfigFormDocument.js";
import type { AgentExtensionLocalizedText } from "../Extensions/AgentExtensionLocalization.js";
import { AgentLocalizedError } from "../I18n/AgentLocalizedError.js";
import { AgentImageVisionModelClient } from "../Vision/AgentImageVisionModelClient.js";
import { resolveAgentVisionProvider } from "../Vision/AgentVisionProviderResolver.js";
import { defineSystemTool } from "./AgentSystemToolDefinition.js";
import { StandardAgentToolObservationProjection } from "../ToolRuntime/AgentToolObservationProjectionPlan.js";
import { resolveAgentSystemResource } from "./AgentSystemResource.js";
import { AgentResourceUriSchema } from "../Resources/AgentResourceSchema.js";
import { fetchWebResource } from "../Web/AgentWebHttpClient.js";
import type { AgentHostToolContext } from "../ToolRuntime/AgentToolHostCapabilityRegistry.js";

const AgentImageSourceKinds = ["resource", "url"] as const;
const AgentImageSourceKind = z.enum(AgentImageSourceKinds);
const AgentImageAnalyzeTasks = ["describe", "ocr", "question"] as const;
const AgentImageAnalyzeTask = z.enum(AgentImageAnalyzeTasks);
const AgentImageAnalyzeMaximumImageCount = 32;

const HttpImageUrlSchema = z
  .string()
  .trim()
  .url()
  .regex(/^https?:\/\/\S+$/u, "Expected a public HTTP(S) URL.");

const ImageAnalyzeInput = z
  .object({
    images: z
      .array(
        z.union([
          z
            .object({
              resourceUri: AgentResourceUriSchema.describe(
                "Canonical Senera resource URI to analyze. When a Markdown image uses a local path, use the host-provided resource mapping and never invent a URI from its filename.",
              ),
            })
            .strict(),
          z
            .object({
              url: HttpImageUrlSchema.describe(
                "Public HTTP(S) image URL. Preserve the URL exactly; Senera downloads it and sends the image as base64.",
              ),
            })
            .strict(),
        ]),
      )
      .min(1)
      .max(AgentImageAnalyzeMaximumImageCount)
      .describe("Images to analyze together, in the supplied order."),
    task: AgentImageAnalyzeTask.default("describe"),
    question: z.string().trim().min(1).optional(),
    timeoutMs: z
      .number()
      .int()
      .min(1_000)
      .max(15 * 60 * 1_000)
      .optional()
      .describe("Optional per-call image download timeout in milliseconds."),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.task === "question" && !value.question) {
      context.addIssue({
        code: "custom",
        path: ["question"],
        message: "question is required when task is question.",
      });
    }
  });

const ImageAnalyzeOutput = z
  .object({
    images: z
      .array(
        z
          .object({
            source: z
              .object({
                kind: AgentImageSourceKind,
                uri: z.string().min(1),
              })
              .strict(),
            name: z.string(),
            mime: z.string(),
            size: z.number().int().nonnegative(),
            sha256: z.string().regex(/^[a-f0-9]{64}$/u),
          })
          .strict(),
      )
      .min(1),
    task: AgentImageAnalyzeTask,
    question: z.string().optional(),
    answer: z.string(),
    model: z.string(),
  })
  .strict();

export const DefaultAgentImageAnalyzeExtensionConfiguration = {
  model: {
    modelProviderId: "",
  },
  input: {
    maxImageCount: AgentDefaults.Uploads.MaxFilesPerRequest,
    maxImageBytes: AgentDefaults.Uploads.MaxFileBytes,
    maxTotalImageBytes: AgentDefaults.Uploads.MaxRequestBytes,
  },
  remote: {
    maxRedirects: 5,
    maxUrlLength: 4_096,
    requestTimeoutMs: 180_000,
    maxOperationTimeoutMs: 900_000,
    allowPrivateNetworks: false,
    allowSyntheticProxyAddresses: true,
    userAgent: "Senera-ImageAnalyze/1.0",
  },
  prompt: {
    systemPrompt:
      "Analyze only visible evidence in the supplied image. State uncertainty and do not infer hidden content.",
  },
} as const;

export const AgentImageAnalyzeExtensionConfigurationSchema = z
  .object({
    model: z
      .object({
        modelProviderId: z.string().trim().max(256).default(""),
      })
      .strict()
      .default(DefaultAgentImageAnalyzeExtensionConfiguration.model),
    input: z
      .object({
        maxImageCount: z
          .number()
          .int()
          .min(1)
          .max(AgentImageAnalyzeMaximumImageCount)
          .default(DefaultAgentImageAnalyzeExtensionConfiguration.input.maxImageCount),
        maxImageBytes: z
          .number()
          .int()
          .min(1_024)
          .max(AgentDefaults.Uploads.MaxRequestBytes)
          .default(DefaultAgentImageAnalyzeExtensionConfiguration.input.maxImageBytes),
        maxTotalImageBytes: z
          .number()
          .int()
          .min(1_024)
          .max(AgentDefaults.Uploads.MaxRequestBytes)
          .default(DefaultAgentImageAnalyzeExtensionConfiguration.input.maxTotalImageBytes),
      })
      .strict()
      .default(DefaultAgentImageAnalyzeExtensionConfiguration.input),
    remote: z
      .object({
        maxRedirects: z
          .number()
          .int()
          .min(0)
          .max(20)
          .default(DefaultAgentImageAnalyzeExtensionConfiguration.remote.maxRedirects),
        maxUrlLength: z
          .number()
          .int()
          .min(256)
          .max(16_384)
          .default(DefaultAgentImageAnalyzeExtensionConfiguration.remote.maxUrlLength),
        requestTimeoutMs: z
          .number()
          .int()
          .min(1_000)
          .max(15 * 60 * 1_000)
          .default(DefaultAgentImageAnalyzeExtensionConfiguration.remote.requestTimeoutMs),
        maxOperationTimeoutMs: z
          .number()
          .int()
          .min(1_000)
          .max(15 * 60 * 1_000)
          .default(DefaultAgentImageAnalyzeExtensionConfiguration.remote.maxOperationTimeoutMs),
        allowPrivateNetworks: z
          .boolean()
          .default(DefaultAgentImageAnalyzeExtensionConfiguration.remote.allowPrivateNetworks),
        allowSyntheticProxyAddresses: z
          .boolean()
          .default(DefaultAgentImageAnalyzeExtensionConfiguration.remote.allowSyntheticProxyAddresses),
        userAgent: z
          .string()
          .trim()
          .min(1)
          .max(512)
          .default(DefaultAgentImageAnalyzeExtensionConfiguration.remote.userAgent),
      })
      .strict()
      .superRefine((value, context) => {
        if (value.requestTimeoutMs > value.maxOperationTimeoutMs) {
          context.addIssue({
            code: "custom",
            path: ["requestTimeoutMs"],
            message: "requestTimeoutMs must not exceed maxOperationTimeoutMs.",
          });
        }
      })
      .default(DefaultAgentImageAnalyzeExtensionConfiguration.remote),
    prompt: z
      .object({
        systemPrompt: z
          .string()
          .trim()
          .min(1)
          .max(8_000)
          .default(DefaultAgentImageAnalyzeExtensionConfiguration.prompt.systemPrompt),
      })
      .strict()
      .default(DefaultAgentImageAnalyzeExtensionConfiguration.prompt),
  })
  .strict();

const AgentImageAnalyzeExtensionConfigurationUi = {
  form: {
    version: 1,
    sections: [
      {
        id: "model",
        label: localized("模型选择", "Model selection"),
        description: localized(
          "选择图像分析使用的视觉模型；留空时优先使用当前会话模型。",
          "Choose the vision model used for image analysis. When empty, the current conversation model is preferred.",
        ),
        fields: [
          {
            path: ["model", "modelProviderId"],
            label: localized("视觉模型", "Vision model"),
            description: localized(
              "只显示已启用且声明 Vision 能力的模型。",
              "Only enabled models that declare the Vision capability are listed.",
            ),
            placeholder: localized("自动（会话模型优先）", "Automatic (prefer conversation model)"),
            type: "string",
            required: false,
            essential: true,
            modelSelection: {
              id: "agent-image-tools.vision-model",
              capability: "Vision",
              valueKind: "model-id",
              mutation: "config",
              required: false,
            },
          },
        ],
      },
      {
        id: "input",
        label: localized("输入边界", "Input limits"),
        description: localized(
          "限制单次图像分析读取到内存的文件大小。",
          "Limit the image size read into memory for one analysis.",
        ),
        fields: [
          {
            path: ["input", "maxImageCount"],
            label: localized("单次最大图片数", "Maximum image count"),
            description: localized(
              "限制一次图像分析可同时提交的图片数量。",
              "Limit how many images one analysis can submit together.",
            ),
            type: "number",
            min: 1,
            max: AgentImageAnalyzeMaximumImageCount,
            step: 1,
            required: false,
            essential: true,
          },
          {
            path: ["input", "maxImageBytes"],
            label: localized("最大图像字节", "Maximum image bytes"),
            description: localized(
              "超过此上限的图像资源不会发送给视觉模型。",
              "Image resources above this limit are not sent to the vision model.",
            ),
            type: "number",
            min: 1_024,
            max: AgentDefaults.Uploads.MaxRequestBytes,
            step: 1,
            required: false,
            essential: true,
          },
          {
            path: ["input", "maxTotalImageBytes"],
            label: localized("单次图片总字节", "Maximum total image bytes"),
            description: localized(
              "超过此总量的图片集合不会发送给视觉模型。",
              "Image sets above this total are not sent to the vision model.",
            ),
            type: "number",
            min: 1_024,
            max: AgentDefaults.Uploads.MaxRequestBytes,
            step: 1,
            required: false,
            essential: true,
          },
        ],
      },
      {
        id: "remote",
        label: localized("远程图像", "Remote images"),
        description: localized(
          "控制直接 URL 图像的下载时限、跳转和网络边界。",
          "Control download limits, redirects, and network boundaries for direct image URLs.",
        ),
        fields: [
          numberField(["remote", "maxRedirects"], "最大跳转次数", "Maximum redirects", 0, 20),
          numberField(["remote", "maxUrlLength"], "最大 URL 长度", "Maximum URL length", 256, 16_384),
          numberField(
            ["remote", "requestTimeoutMs"],
            "默认下载超时（毫秒）",
            "Default download timeout (ms)",
            1_000,
            900_000,
          ),
          numberField(
            ["remote", "maxOperationTimeoutMs"],
            "最大下载超时（毫秒）",
            "Maximum download timeout (ms)",
            1_000,
            900_000,
          ),
          booleanField(["remote", "allowPrivateNetworks"], "允许私有网络", "Allow private networks"),
          booleanField(
            ["remote", "allowSyntheticProxyAddresses"],
            "允许代理映射地址",
            "Allow synthetic proxy addresses",
          ),
          textField(["remote", "userAgent"], "下载 User-Agent", "Download User-Agent"),
        ],
      },
      {
        id: "prompt",
        label: localized("分析策略", "Analysis policy"),
        description: localized(
          "定义视觉模型分析图像时遵循的系统级约束。",
          "Define the system-level instructions followed while analyzing images.",
        ),
        fields: [
          {
            path: ["prompt", "systemPrompt"],
            label: localized("视觉系统提示词", "Vision system prompt"),
            description: localized(
              "用于约束可见证据、推断边界和不确定性表达。",
              "Controls visible-evidence grounding, inference boundaries, and uncertainty reporting.",
            ),
            type: "string",
            minLength: 1,
            maxLength: 8_000,
            multiline: true,
            required: false,
            essential: false,
          },
        ],
      },
    ],
  },
} as const satisfies ConfigFormDocument<AgentExtensionLocalizedText>;

export function createImageAnalyzeSystemTool(
  extensionConfiguration?: Record<string, unknown>,
  conversationModelProviderId?: string,
) {
  const configuration = AgentImageAnalyzeExtensionConfigurationSchema.parse(extensionConfiguration ?? {});
  return defineSystemTool({
    extension: {
      name: "agent-image-tools",
      displayName: {
        "zh-CN": "图像理解",
        "en-US": "Image Understanding",
      },
      description: {
        "zh-CN": "使用宿主选择的视觉模型分析统一资源中的图像。",
        "en-US": "Analyzes images from canonical Senera resources with a host-selected vision model.",
      },
      priority: 8,
      skills: ["image-understanding"],
      configuration: {
        schema: AgentImageAnalyzeExtensionConfigurationSchema,
        ui: AgentImageAnalyzeExtensionConfigurationUi,
      },
    },
    metadata: {
      observation: StandardAgentToolObservationProjection,
      description:
        "Analyze one or more canonical Senera image resources, screenshots, or unchanged public HTTP(S) image URLs together for visible evidence, OCR, or a specific question. Resolve local Markdown paths to a host-provided Senera resource before calling.",
      permissions: ["resources:read", "model:vision"],
      execution: { Targets: ["Local"], Network: "Allow", Workspace: "ReadOnly" },
      search: {
        Summary: "一起分析一张或多张图片，读取画面、文字和与当前问题有关的可见证据。",
        Tags: ["image", "vision", "ocr", "screenshot"],
        Capabilities: [
          {
            Id: "vision.image-analysis",
            Title: "Image analysis",
            Description: "分析图片内容、提取图片文字，或针对图片回答具体问题。",
            Facets: {
              Actions: ["describe", "ocr", "answer"],
              Targets: ["image-resource", "public-image-url"],
              Inputs: ["images", "task", "question"],
              Outputs: ["description", "ocr-text", "answer", "image-metadata"],
              Effects: ["none"],
            },
            Aliases: ["看图", "识别图片", "分析截图", "图片文字", "image analysis"],
            Risk: { SideEffect: "read-only", Permission: "resources-read-vision" },
          },
        ],
        UseCases: ["用户提供截图、图片或公开图片链接，并希望了解画面、文字或具体细节。"],
        Avoid: ["没有图片证据时不要猜测画面内容；需要修改或生成图片时使用对应的图像工具。"],
      },
    },
    name: "ImageAnalyze",
    input: ImageAnalyzeInput,
    output: ImageAnalyzeOutput,
    async execute(input, context) {
      const images = await resolveImageInputs(input, context, configuration);
      const response = await new AgentImageVisionModelClient().complete({
        provider: resolveAgentVisionProvider(context.config, {
          conversationModelProviderId,
          configuredModelProviderId: configuration.model.modelProviderId,
        }),
        systemPrompt: configuration.prompt.systemPrompt,
        prompt: createImagePrompt(input.task, input.question, images),
        images: images.map((image) => ({ mime: image.mime, base64: image.base64 })),
        signal: context.signal,
      });
      return {
        images: images.map(({ base64: _base64, ...image }) => image),
        task: input.task,
        ...(input.question ? { question: input.question } : {}),
        answer: response.text,
        model: response.provider.model,
      };
    },
  });
}

interface ResolvedImageInput {
  readonly source: { readonly kind: z.output<typeof AgentImageSourceKind>; readonly uri: string };
  readonly name: string;
  readonly mime: string;
  readonly size: number;
  readonly sha256: string;
  readonly base64: string;
}

async function resolveImageInputs(
  input: z.output<typeof ImageAnalyzeInput>,
  context: AgentHostToolContext,
  configuration: z.output<typeof AgentImageAnalyzeExtensionConfigurationSchema>,
): Promise<ResolvedImageInput[]> {
  if (input.images.length > configuration.input.maxImageCount) {
    throw new AgentLocalizedError("vision.imageCountExceeded", {
      count: input.images.length,
      maxImageCount: configuration.input.maxImageCount,
    });
  }

  const images: ResolvedImageInput[] = [];
  let totalImageBytes = 0;
  for (const source of input.images) {
    const image = await resolveImageInput(source, input.timeoutMs, context, configuration);
    totalImageBytes += image.size;
    assertTotalImageSize(totalImageBytes, configuration.input.maxTotalImageBytes);
    images.push(image);
  }
  return images;
}

async function resolveImageInput(
  source: z.output<typeof ImageAnalyzeInput>["images"][number],
  timeoutMs: number | undefined,
  context: AgentHostToolContext,
  configuration: z.output<typeof AgentImageAnalyzeExtensionConfigurationSchema>,
): Promise<ResolvedImageInput> {
  if ("resourceUri" in source) {
    const resource = await resolveAgentSystemResource(context, source.resourceUri);
    assertImageMime(resource.mime);
    assertImageSize(resource.size, configuration.input.maxImageBytes);
    const content = await fs.readFile(resource.filePath, { signal: context.signal });
    return {
      source: { kind: "resource", uri: resource.resourceUri },
      name: resource.name,
      mime: resource.mime,
      size: resource.size,
      sha256: resource.sha256,
      base64: content.toString("base64"),
    };
  }

  const requestTimeoutMs = resolveImageRequestTimeout(timeoutMs, configuration.remote);
  const response = await fetchWebResource(
    source.url,
    {
      maxRedirects: configuration.remote.maxRedirects,
      responseMaxBytes: configuration.input.maxImageBytes,
      timeoutMs: requestTimeoutMs,
      userAgent: configuration.remote.userAgent,
      maxUrlLength: configuration.remote.maxUrlLength,
      allowPrivateNetworks: configuration.remote.allowPrivateNetworks,
      allowSyntheticProxyAddresses: configuration.remote.allowSyntheticProxyAddresses,
    },
    context.signal,
  );
  if (response.transfer.truncated) {
    throw new AgentLocalizedError("vision.imageTooLarge", {
      size: response.transfer.declaredContentLength ?? response.transfer.receivedBytes + 1,
      maxImageBytes: configuration.input.maxImageBytes,
    });
  }
  const mime = await resolveRemoteImageMime(response.body, response.contentType, response.url);
  assertImageMime(mime);
  const content = Buffer.from(response.body);
  return {
    source: { kind: "url", uri: response.url },
    name: readImageName(response.url),
    mime,
    size: content.byteLength,
    sha256: sha256Hex(content),
    base64: content.toString("base64"),
  };
}

function resolveImageRequestTimeout(
  requested: number | undefined,
  configuration: z.output<typeof AgentImageAnalyzeExtensionConfigurationSchema>["remote"],
): number {
  if (requested === undefined) return configuration.requestTimeoutMs;
  if (requested > configuration.maxOperationTimeoutMs) {
    throw new Error(
      `Image download timeoutMs must be an integer between 1000 and ${configuration.maxOperationTimeoutMs}.`,
    );
  }
  return requested;
}

async function resolveRemoteImageMime(content: Uint8Array, contentType: string, url: string): Promise<string> {
  const detected = normalizeMime((await fileTypeFromBuffer(content))?.mime);
  const declared = normalizeMime(contentType.split(";", 1)[0]);
  const named = normalizeMime(lookupMime(new URL(url).pathname) || undefined);
  return detected ?? declared ?? named ?? "application/octet-stream";
}

function assertImageMime(mime: string): void {
  if (!mime.toLowerCase().startsWith("image/")) {
    throw new AgentLocalizedError("vision.imageMimeRequired", { mime });
  }
}

function assertImageSize(size: number, maxImageBytes: number): void {
  if (size > maxImageBytes) {
    throw new AgentLocalizedError("vision.imageTooLarge", { size, maxImageBytes });
  }
}

function assertTotalImageSize(totalImageBytes: number, maxTotalImageBytes: number): void {
  if (totalImageBytes > maxTotalImageBytes) {
    throw new AgentLocalizedError("vision.imageTotalTooLarge", { totalImageBytes, maxTotalImageBytes });
  }
}

function readImageName(url: string): string {
  const name = path.basename(new URL(url).pathname);
  return name || "remote-image";
}

function normalizeMime(value: string | false | undefined): string | undefined {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return normalized || undefined;
}

function localized(zhCn: string, enUs: string) {
  return { "zh-CN": zhCn, "en-US": enUs } as const;
}

function numberField(path: string[], label: string, enUsLabel: string, min: number, max: number) {
  return {
    path,
    label: localized(label, enUsLabel),
    type: "number" as const,
    min,
    max,
    step: 1,
    required: false,
    essential: true,
  };
}

function booleanField(path: string[], label: string, enUsLabel: string) {
  return {
    path,
    label: localized(label, enUsLabel),
    type: "boolean" as const,
    required: false,
    essential: false,
  };
}

function textField(path: string[], label: string, enUsLabel: string) {
  return {
    path,
    label: localized(label, enUsLabel),
    type: "string" as const,
    required: false,
    essential: false,
  };
}

function createImagePrompt(
  task: z.output<typeof ImageAnalyzeInput>["task"],
  question: string | undefined,
  images: readonly Omit<ResolvedImageInput, "base64">[],
): string {
  const request = question ? `Question: ${question}` : "Describe the visible image evidence concisely.";
  const imageList = images
    .map((image, index) => `Image ${index + 1}: ${image.name} (${image.mime}, ${image.size} bytes)`)
    .join("\n");
  return `Task: ${task}\n${request}\nAnalyze images in this exact order and identify each image by its number when relevant.\n${imageList}`;
}
