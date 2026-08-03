import { z } from "zod";
import type { ConfigFormDocument } from "../Config/AgentConfigFormDocument.js";
import type { AgentExtensionLocalizedText } from "../Extensions/AgentExtensionLocalization.js";
import { extractAgentDocument } from "../Documents/AgentDocumentExtract.js";
import { probeAgentDocument } from "../Documents/AgentDocumentProbe.js";
import {
  AgentDocumentToolConfigurationSchema,
  DefaultAgentDocumentToolConfiguration,
} from "../Documents/AgentDocumentToolConfiguration.js";
import { defineSystemTool } from "./AgentSystemToolDefinition.js";
import { StandardAgentToolObservationProjection } from "../ToolRuntime/AgentToolObservationProjectionPlan.js";
import { resolveAgentSystemUpload } from "./AgentSystemUpload.js";

const DocumentExtractInput = z
  .object({
    uploadUri: z.string().trim().min(1).describe("Exact senera-upload URI supplied by the runtime."),
    mode: z.enum(["auto", "probe", "extract"]).default("auto"),
  })
  .strict();

const DocumentProbe = z.object({}).passthrough();
const DocumentExtraction = z
  .object({
    status: z.literal("extracted"),
    parser: z.string(),
    fileType: z.string(),
    textPreview: z.string(),
    markdownPreview: z.string(),
    textLength: z.number().int().nonnegative(),
    markdownLength: z.number().int().nonnegative(),
    metadata: z.record(z.string(), z.unknown()),
    structure: z
      .object({
        topLevelNodeCount: z.number().int().nonnegative(),
        attachmentCount: z.number().int().nonnegative(),
        warningCount: z.number().int().nonnegative(),
      })
      .strict(),
    chunks: z.array(
      z
        .object({
          index: z.number().int().nonnegative(),
          text: z.string(),
          length: z.number().int().nonnegative(),
          metadata: z.record(z.string(), z.unknown()).optional(),
        })
        .strict(),
    ),
    warnings: z.array(
      z.object({ type: z.enum(["warning", "info", "error"]), code: z.string(), message: z.string() }).strict(),
    ),
  })
  .strict();

const DocumentExtractOutput = z
  .object({
    document: z
      .object({
        uploadUri: z.string(),
        name: z.string(),
        mime: z.string(),
        size: z.number().int().nonnegative(),
        sha256: z.string(),
        status: z.enum(["probed", "extracted"]),
        probe: DocumentProbe,
        extraction: DocumentExtraction.optional(),
      })
      .strict(),
  })
  .strict();

const DefaultDocumentExtensionConfiguration = {
  probe: DefaultAgentDocumentToolConfiguration.probe,
  parse: DefaultAgentDocumentToolConfiguration.parse,
  output: DefaultAgentDocumentToolConfiguration.output,
};

export const AgentDocumentExtensionConfigurationSchema = z
  .object({
    probe: z
      .object({
        sampleBytes: z
          .number()
          .int()
          .min(4_096)
          .max(4_194_304)
          .default(DefaultDocumentExtensionConfiguration.probe.sampleBytes),
        containerMaxEntries: z
          .number()
          .int()
          .min(1)
          .max(10_000)
          .default(DefaultDocumentExtensionConfiguration.probe.containerMaxEntries),
        containerMaxEntryBytes: z
          .number()
          .int()
          .min(1_024)
          .max(16_777_216)
          .default(DefaultDocumentExtensionConfiguration.probe.containerMaxEntryBytes),
        contentTypesEntryName: z
          .string()
          .trim()
          .min(1)
          .default(DefaultDocumentExtensionConfiguration.probe.contentTypesEntryName),
      })
      .strict()
      .default(DefaultDocumentExtensionConfiguration.probe),
    parse: z
      .object({
        ocr: z.boolean().default(DefaultDocumentExtensionConfiguration.parse.ocr),
        extractAttachments: z.boolean().default(DefaultDocumentExtensionConfiguration.parse.extractAttachments),
        includeRawContent: z.boolean().default(DefaultDocumentExtensionConfiguration.parse.includeRawContent),
        ignoreNotes: z.boolean().default(DefaultDocumentExtensionConfiguration.parse.ignoreNotes),
        ignoreComments: z.boolean().default(DefaultDocumentExtensionConfiguration.parse.ignoreComments),
        ignoreHeadersAndFooters: z
          .boolean()
          .default(DefaultDocumentExtensionConfiguration.parse.ignoreHeadersAndFooters),
        ignoreSlideMasters: z.boolean().default(DefaultDocumentExtensionConfiguration.parse.ignoreSlideMasters),
        ignoreInternalLinks: z.boolean().default(DefaultDocumentExtensionConfiguration.parse.ignoreInternalLinks),
        newlineDelimiter: z.string().max(8).default(DefaultDocumentExtensionConfiguration.parse.newlineDelimiter),
      })
      .strict()
      .default(DefaultDocumentExtensionConfiguration.parse),
    output: z
      .object({
        maxFileBytes: z
          .number()
          .int()
          .min(1_024)
          .max(1_073_741_824)
          .default(DefaultDocumentExtensionConfiguration.output.maxFileBytes),
        maxTextChars: z
          .number()
          .int()
          .min(0)
          .max(10_000_000)
          .default(DefaultDocumentExtensionConfiguration.output.maxTextChars),
        maxMarkdownChars: z
          .number()
          .int()
          .min(0)
          .max(10_000_000)
          .default(DefaultDocumentExtensionConfiguration.output.maxMarkdownChars),
        maxChunks: z.number().int().min(0).max(10_000).default(DefaultDocumentExtensionConfiguration.output.maxChunks),
        maxChunkChars: z
          .number()
          .int()
          .min(0)
          .max(1_000_000)
          .default(DefaultDocumentExtensionConfiguration.output.maxChunkChars),
      })
      .strict()
      .default(DefaultDocumentExtensionConfiguration.output),
  })
  .strict();

const AgentDocumentExtensionConfigurationUi = {
  form: {
    version: 1 as const,
    sections: [
      {
        id: "probe",
        label: localized("文档探测", "Document probing"),
        description: localized(
          "控制容器探测的读取预算和安全边界。",
          "Control read budgets and safety boundaries for container probing.",
        ),
        fields: [
          numberField(["probe", "sampleBytes"], "探测采样字节", "Probe sample bytes", 4_096, 4_194_304),
          numberField(["probe", "containerMaxEntries"], "容器最大条目数", "Maximum container entries", 1, 10_000),
          numberField(
            ["probe", "containerMaxEntryBytes"],
            "单条目最大字节",
            "Maximum bytes per container entry",
            1_024,
            16_777_216,
          ),
          textField(["probe", "contentTypesEntryName"], "内容类型清单文件", "Content types manifest file"),
        ],
      },
      {
        id: "parse",
        label: localized("解析策略", "Parsing policy"),
        description: localized(
          "控制正文、批注、附件和版式内容的解析方式。",
          "Control how body text, comments, attachments, and layout content are parsed.",
        ),
        fields: [
          booleanField(["parse", "ocr"], "启用 OCR", "Enable OCR"),
          booleanField(["parse", "extractAttachments"], "提取附件", "Extract attachments"),
          booleanField(["parse", "includeRawContent"], "保留原始内容", "Include raw content"),
          booleanField(["parse", "ignoreNotes"], "忽略备注", "Ignore notes"),
          booleanField(["parse", "ignoreComments"], "忽略批注", "Ignore comments"),
          booleanField(["parse", "ignoreHeadersAndFooters"], "忽略页眉页脚", "Ignore headers and footers"),
          booleanField(["parse", "ignoreSlideMasters"], "忽略幻灯片母版", "Ignore slide masters"),
          booleanField(["parse", "ignoreInternalLinks"], "忽略内部链接", "Ignore internal links"),
          textField(["parse", "newlineDelimiter"], "换行分隔符", "Newline delimiter"),
        ],
      },
      {
        id: "output",
        label: localized("输出预算", "Output budgets"),
        description: localized(
          "限制单次提取的文件大小、文本长度和分块数量。",
          "Limit file size, text length, and chunk counts for one extraction.",
        ),
        fields: [
          numberField(["output", "maxFileBytes"], "最大文件字节", "Maximum file bytes", 1_024, 1_073_741_824),
          numberField(["output", "maxTextChars"], "纯文本最大字符", "Maximum plain-text characters", 0, 10_000_000),
          numberField(
            ["output", "maxMarkdownChars"],
            "Markdown 最大字符",
            "Maximum Markdown characters",
            0,
            10_000_000,
          ),
          numberField(["output", "maxChunks"], "最大分块数", "Maximum chunks", 0, 10_000),
          numberField(["output", "maxChunkChars"], "单分块最大字符", "Maximum characters per chunk", 0, 1_000_000),
        ],
      },
    ],
  },
} satisfies ConfigFormDocument<AgentExtensionLocalizedText>;

export function createDocumentExtractSystemTool(extensionConfiguration?: Record<string, unknown>) {
  const settings = AgentDocumentExtensionConfigurationSchema.parse(extensionConfiguration ?? {});
  const configuration = AgentDocumentToolConfigurationSchema.parse({
    ...DefaultAgentDocumentToolConfiguration,
    probe: settings.probe,
    parse: settings.parse,
    output: settings.output,
  });
  return defineSystemTool({
    extension: {
      name: "agent-document-tools",
      displayName: {
        "zh-CN": "文档理解",
        "en-US": "Document Understanding",
      },
      description: {
        "zh-CN": "探测并提取用户上传文档的文本、结构和元数据。",
        "en-US": "Probes and extracts text, structure, and metadata from user-uploaded documents.",
      },
      priority: 8,
      skills: ["document-understanding"],
      configuration: {
        schema: AgentDocumentExtensionConfigurationSchema,
        ui: AgentDocumentExtensionConfigurationUi,
      },
    },
    metadata: {
      observation: StandardAgentToolObservationProjection,
      description: "Probe or extract text, structure, metadata, and warnings from a user-uploaded document.",
      permissions: ["uploads:read"],
      execution: { Targets: ["Local"], Network: "Deny", Workspace: "ReadOnly" },
    },
    name: "DocumentExtract",
    input: DocumentExtractInput,
    output: DocumentExtractOutput,
    async execute(input, context) {
      const upload = await resolveAgentSystemUpload(context, input.uploadUri);
      const document = {
        filePath: upload.filePath,
        name: upload.manifest.name,
        declaredMime: upload.manifest.declaredMime,
        size: upload.manifest.size,
        sha256: upload.manifest.sha256,
        uploadUri: upload.manifest.uploadUri,
      };
      const probe = await probeAgentDocument(document, {
        sampleBytes: configuration.probe.sampleBytes,
        container: {
          maxEntries: configuration.probe.containerMaxEntries,
          maxEntryBytes: configuration.probe.containerMaxEntryBytes,
          contentTypesEntryName: configuration.probe.contentTypesEntryName,
        },
      });
      if (input.mode === "probe") {
        return DocumentExtractOutput.parse({
          document: {
            ...publicDocument(upload),
            status: "probed" as const,
            probe,
          },
        });
      }
      const extraction = await extractAgentDocument(
        {
          ...document,
          extractors: configuration.extractors,
          probe: {
            sampleBytes: configuration.probe.sampleBytes,
            container: {
              maxEntries: configuration.probe.containerMaxEntries,
              maxEntryBytes: configuration.probe.containerMaxEntryBytes,
              contentTypesEntryName: configuration.probe.contentTypesEntryName,
            },
          },
          signal: context.signal,
        },
        { parse: configuration.parse, output: configuration.output },
      );
      return DocumentExtractOutput.parse({
        document: {
          ...publicDocument(upload),
          status: "extracted" as const,
          probe,
          extraction,
        },
      });
    },
  });
}

export const DocumentExtractSystemTool = createDocumentExtractSystemTool();

function publicDocument(upload: Awaited<ReturnType<typeof resolveAgentSystemUpload>>) {
  return {
    uploadUri: upload.manifest.uploadUri,
    name: upload.manifest.name,
    mime: upload.manifest.mime,
    size: upload.manifest.size,
    sha256: upload.manifest.sha256,
  };
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
    essential: true,
  };
}

function textField(path: string[], label: string, enUsLabel: string) {
  return {
    path,
    label: localized(label, enUsLabel),
    type: "string" as const,
    required: false,
    essential: true,
  };
}

function localized(zhCn: string, enUs: string) {
  return { "zh-CN": zhCn, "en-US": enUs } as const;
}
