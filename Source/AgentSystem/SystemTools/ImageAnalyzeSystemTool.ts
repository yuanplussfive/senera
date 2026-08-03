import fs from "node:fs/promises";
import { z } from "zod";
import { AgentDefaults } from "../AgentDefaults.js";
import type { ConfigFormDocument } from "../Config/AgentConfigFormDocument.js";
import type { AgentExtensionLocalizedText } from "../Extensions/AgentExtensionLocalization.js";
import { AgentLocalizedError } from "../I18n/AgentLocalizedError.js";
import { AgentImageVisionModelClient } from "../Vision/AgentImageVisionModelClient.js";
import { resolveAgentVisionProvider } from "../Vision/AgentVisionProviderResolver.js";
import { defineSystemTool } from "./AgentSystemToolDefinition.js";
import { StandardAgentToolObservationProjection } from "../ToolRuntime/AgentToolObservationProjectionPlan.js";
import { resolveAgentSystemUpload } from "./AgentSystemUpload.js";

const ImageAnalyzeInput = z
  .object({
    uploadUri: z.string().trim().min(1).describe("Exact senera-upload URI supplied by the runtime."),
    task: z.enum(["describe", "ocr", "question"]).default("describe"),
    question: z.string().trim().min(1).optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.task === "question" && !input.question) {
      context.addIssue({ code: "custom", path: ["question"], message: "Required when task is question." });
    }
  });

const ImageAnalyzeOutput = z
  .object({
    uploadUri: z.string(),
    name: z.string(),
    mime: z.string(),
    size: z.number().int().nonnegative(),
    task: z.enum(["describe", "ocr", "question"]),
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
    maxImageBytes: AgentDefaults.Uploads.MaxFileBytes,
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
        maxImageBytes: z
          .number()
          .int()
          .min(1_024)
          .max(AgentDefaults.Uploads.MaxRequestBytes)
          .default(DefaultAgentImageAnalyzeExtensionConfiguration.input.maxImageBytes),
      })
      .strict()
      .default(DefaultAgentImageAnalyzeExtensionConfiguration.input),
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
            path: ["input", "maxImageBytes"],
            label: localized("最大图像字节", "Maximum image bytes"),
            description: localized(
              "超过此上限的上传图像不会发送给视觉模型。",
              "Uploaded images above this limit are not sent to the vision model.",
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
        "zh-CN": "使用宿主选择的视觉模型分析用户上传的图像。",
        "en-US": "Analyzes user-uploaded images with a host-selected vision model.",
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
      description: "Analyze an uploaded image or screenshot for visible evidence, OCR, or a specific question.",
      permissions: ["uploads:read", "model:vision"],
      execution: { Targets: ["Local"], Network: "Allow", Workspace: "ReadOnly" },
    },
    name: "ImageAnalyze",
    input: ImageAnalyzeInput,
    output: ImageAnalyzeOutput,
    async execute(input, context) {
      const upload = await resolveAgentSystemUpload(context, input.uploadUri);
      if (!upload.manifest.mime.toLowerCase().startsWith("image/")) {
        throw new AgentLocalizedError("vision.imageMimeRequired", { mime: upload.manifest.mime });
      }
      if (upload.manifest.size > configuration.input.maxImageBytes) {
        throw new AgentLocalizedError("vision.imageTooLarge", {
          size: upload.manifest.size,
          maxImageBytes: configuration.input.maxImageBytes,
        });
      }
      const response = await new AgentImageVisionModelClient().complete({
        provider: resolveAgentVisionProvider(context.config, {
          conversationModelProviderId,
          configuredModelProviderId: configuration.model.modelProviderId,
        }),
        systemPrompt: configuration.prompt.systemPrompt,
        prompt: createImagePrompt(
          input.task,
          input.question,
          upload.manifest.name,
          upload.manifest.mime,
          upload.manifest.size,
        ),
        mime: upload.manifest.mime,
        base64: await fs.readFile(upload.filePath, { encoding: "base64", signal: context.signal }),
        signal: context.signal,
      });
      return {
        uploadUri: upload.manifest.uploadUri,
        name: upload.manifest.name,
        mime: upload.manifest.mime,
        size: upload.manifest.size,
        task: input.task,
        ...(input.question ? { question: input.question } : {}),
        answer: response.text,
        model: response.provider.model,
      };
    },
  });
}

function localized(zhCn: string, enUs: string) {
  return { "zh-CN": zhCn, "en-US": enUs } as const;
}

function createImagePrompt(
  task: z.output<typeof ImageAnalyzeInput>["task"],
  question: string | undefined,
  name: string,
  mime: string,
  size: number,
): string {
  const request = question ? `Question: ${question}` : "Describe the visible image evidence concisely.";
  return `Task: ${task}\n${request}\nImage: ${name} (${mime}, ${size} bytes)`;
}
