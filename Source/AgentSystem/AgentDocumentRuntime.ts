import { z } from "zod";
import { parse as parseToml } from "smol-toml";
import { resolveUploadsConfig } from "./AgentDefaults.js";
import { throwIfAborted } from "./AgentCancellation.js";
import {
  extractAgentDocument,
  selectAgentDocumentExtractor,
  type AgentDocumentExtractorConfig,
} from "./Documents/AgentDocumentExtract.js";
import { probeAgentDocument } from "./Documents/AgentDocumentProbe.js";
import type { AgentDocumentProbeResult } from "./Documents/AgentDocumentProbeTypes.js";
import type { AgentHostToolHandler } from "./ToolRuntime/AgentToolHostCapabilityRegistry.js";
import type { AgentToolProcessRunResult } from "./ToolRuntime/AgentToolProcessRunner.js";
import {
  toolProcessFailureResult,
  toolProcessSuccessResult,
} from "./ToolRuntime/AgentToolProcessEnvelope.js";
import {
  AgentExecutionErrorCodes,
  AgentToolProcessErrorPhases,
} from "./Xml/AgentXmlStatus.js";
import { AgentUploadStore } from "./Uploads/AgentUploadStore.js";
import { normalizeAgentUploadUri } from "./Uploads/AgentUploadLocator.js";

const DocumentArgumentsSchema = z
  .object({
    uploadUri: z.string().trim().min(1),
    mode: z.string().trim().min(1).optional(),
  })
  .strict();

const ExtractorSchema: z.ZodType<AgentDocumentExtractorConfig> = z
  .object({
    type: z.string().trim().min(1),
    enabled: z.boolean(),
    priority: z.number().finite(),
  })
  .catchall(z.unknown());

const DocumentPluginConfigSchema = z
  .object({
    document: z
      .object({
        defaultMode: z.string().trim().min(1),
        modes: z.array(z.string().trim().min(1)).min(1),
      })
      .strict(),
    extractors: z.record(z.string().trim().min(1), ExtractorSchema)
      .refine((value) => Object.keys(value).length > 0, {
        message: "DocumentTool 至少需要配置一个 extractor。",
      }),
    probe: z
      .object({
        sampleBytes: z.number().int().positive(),
        containerMaxEntries: z.number().int().positive(),
        containerMaxEntryBytes: z.number().int().positive(),
        contentTypesEntryName: z.string().trim().min(1),
      })
      .strict(),
    parse: z
      .object({
        ocr: z.boolean(),
        extractAttachments: z.boolean(),
        includeRawContent: z.boolean(),
        ignoreNotes: z.boolean(),
        ignoreComments: z.boolean(),
        ignoreHeadersAndFooters: z.boolean(),
        ignoreSlideMasters: z.boolean(),
        ignoreInternalLinks: z.boolean(),
        newlineDelimiter: z.string(),
      })
      .strict(),
    output: z
      .object({
        maxFileBytes: z.number().int().positive(),
        maxTextChars: z.number().int().nonnegative(),
        maxMarkdownChars: z.number().int().nonnegative(),
        maxChunks: z.number().int().nonnegative(),
        maxChunkChars: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .passthrough();

type DocumentArguments = z.infer<typeof DocumentArgumentsSchema>;
type DocumentPluginConfig = z.infer<typeof DocumentPluginConfigSchema>;
type ResolvedUpload = NonNullable<Awaited<ReturnType<AgentUploadStore["resolve"]>>>;

export const documentHostTool: AgentHostToolHandler = async (args, context) => {
  const parsed = DocumentArgumentsSchema.safeParse(args);
  if (!parsed.success) {
    return documentFailure({
      code: AgentExecutionErrorCodes.InvalidToolArguments,
      message: "DocumentTool 参数无效。",
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
    const result = await handleUploadedDocument(parsed.data, context);
    return toolProcessSuccessResult(result);
  } catch (error) {
    return documentFailure({
      code: AgentExecutionErrorCodes.PluginExecutionError,
      message: error instanceof Error ? error.message : String(error),
      details: {
        phase: AgentToolProcessErrorPhases.RuntimeExecution,
        toolName: context.tool.name,
      },
    });
  }
};

async function handleUploadedDocument(
  args: DocumentArguments,
  context: Parameters<AgentHostToolHandler>[1],
) {
  const pluginConfig = readDocumentPluginConfig(context.tool.plugin.config.toml);
  const mode = resolveDocumentMode(args.mode, pluginConfig);
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
      documents: {
        item: [
          {
            uploadUri,
            mode,
            status: "not_found",
            textAvailable: false,
            contentAvailable: false,
            message: "Upload handle was not found in the configured upload store.",
          },
        ],
      },
    };
  }

  const probe = await probeResolvedDocument({
    uploadUri,
    resolved,
    config: pluginConfig,
  });
  const base = toProbeRecord({
    uploadUri,
    mode,
    resolved,
    probe,
  });

  if (mode === "probe") {
    return {
      documents: {
        item: [base],
      },
    };
  }

  const canExtract = canExtractDocument(probe, pluginConfig);
  if (mode === "auto" && !canExtract) {
    return {
      documents: {
        item: [
          {
            ...base,
            status: "probed",
            message: "Document was probed. No configured content extractor matched this file.",
          },
        ],
      },
    };
  }

  const extracted = await extractAgentDocument({
    filePath: resolved.filePath,
    uploadUri,
    name: resolved.manifest.name,
    declaredMime: resolved.manifest.declaredMime,
    size: resolved.manifest.size,
    sha256: resolved.manifest.sha256,
    extractors: pluginConfig.extractors,
    probe: toProbeOptions(pluginConfig),
    signal: context.signal,
  }, {
    parse: pluginConfig.parse,
    output: pluginConfig.output,
  });

  return {
    documents: {
      item: [
        {
          ...base,
          status: "extracted",
          contentAvailable: true,
          textAvailable: extracted.textLength > 0,
          fileType: extracted.fileType,
          parser: extracted.parser,
          textLength: extracted.textLength,
          markdownLength: extracted.markdownLength,
          chunkCount: extracted.chunks.length,
          warningCount: extracted.structure.warningCount,
          textPreview: extracted.textPreview,
          markdownPreview: extracted.markdownPreview,
          metadata: extracted.metadata,
          chunks: {
            item: extracted.chunks,
          },
          warnings: {
            item: extracted.warnings,
          },
          message: "Document was probed and text was extracted by the configured extractor.",
        },
      ],
    },
  };
}

async function probeResolvedDocument(input: {
  uploadUri: string;
  resolved: ResolvedUpload;
  config: DocumentPluginConfig;
}): Promise<AgentDocumentProbeResult> {
  return probeAgentDocument({
    filePath: input.resolved.filePath,
    uploadUri: input.uploadUri,
    name: input.resolved.manifest.name,
    declaredMime: input.resolved.manifest.declaredMime,
    size: input.resolved.manifest.size,
    sha256: input.resolved.manifest.sha256,
  }, toProbeOptions(input.config));
}

function toProbeRecord(input: {
  uploadUri: string;
  mode: string;
  resolved: ResolvedUpload;
  probe: AgentDocumentProbeResult;
}) {
  return {
    uploadUri: input.uploadUri,
    mode: input.mode,
    status: "probed",
    name: input.resolved.manifest.name,
    mime: input.resolved.manifest.mime,
    size: input.resolved.manifest.size,
    sha256: input.resolved.manifest.sha256,
    effectiveMime: input.probe.effectiveMime,
    detectedMime: input.probe.detectedMime,
    declaredMime: input.probe.declaredMime,
    namedMime: input.probe.namedMime,
    detectedExtension: input.probe.detectedExtension,
    namedExtension: input.probe.namedExtension,
    mediaType: input.probe.mediaType,
    charset: input.probe.charset,
    isText: input.probe.isText,
    isBinary: input.probe.isBinary,
    containerFormat: input.probe.container?.format,
    containerEntryCount: input.probe.container?.entryCount,
    contentTypeDefaultCount: input.probe.container?.contentTypes?.defaults.length,
    contentTypeOverrideCount: input.probe.container?.contentTypes?.overrides.length,
    probe: input.probe,
    contentAvailable: false,
    textAvailable: false,
    message: "Document was probed. Content extraction was not executed.",
  };
}

function canExtractDocument(
  probe: AgentDocumentProbeResult,
  config: DocumentPluginConfig,
): boolean {
  return Boolean(selectAgentDocumentExtractor(probe, config.extractors));
}

function resolveDocumentMode(value: string | undefined, config: DocumentPluginConfig): string {
  const mode = value?.trim() || config.document.defaultMode;
  if (!config.document.modes.includes(mode)) {
    throw new Error(`DocumentTool mode is not configured: ${mode}`);
  }
  return mode;
}

function toProbeOptions(config: DocumentPluginConfig): Parameters<typeof probeAgentDocument>[1] {
  return {
    sampleBytes: config.probe.sampleBytes,
    container: {
      maxEntries: config.probe.containerMaxEntries,
      maxEntryBytes: config.probe.containerMaxEntryBytes,
      contentTypesEntryName: config.probe.contentTypesEntryName,
    },
  };
}

function readDocumentPluginConfig(toml: string): DocumentPluginConfig {
  return DocumentPluginConfigSchema.parse(parseToml(toml));
}

function documentFailure(
  error: NonNullable<AgentToolProcessRunResult["response"]["error"]>,
): AgentToolProcessRunResult {
  return toolProcessFailureResult(error);
}
