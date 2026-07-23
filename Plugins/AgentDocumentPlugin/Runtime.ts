import { createRequire } from "node:module";
import path from "node:path";
import { readPluginTomlConfig, runMcpTool, z } from "@senera/tool-plugin-sdk";
import {
  extractAgentDocument,
  selectAgentDocumentExtractor,
} from "../../Source/AgentSystem/Documents/AgentDocumentExtract.js";
import { probeAgentDocument } from "../../Source/AgentSystem/Documents/AgentDocumentProbe.js";
import type { AgentDocumentProbeResult } from "../../Source/AgentSystem/Documents/AgentDocumentProbeTypes.js";
import type { AgentDocumentExtractorConfig } from "../../Source/AgentSystem/Documents/AgentDocumentExtractorTypes.js";
import { DefaultDocumentToolMode, DocumentToolModes, type DocumentToolMode } from "./DocumentModeContract.js";

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
const DocumentResourcesSchema = z.object({ document: UploadResourceSchema.optional() }).strict();
const DocumentArgumentsSchema = z
  .object({
    uploadUri: z.string().trim().min(1),
    mode: z.enum(DocumentToolModes).optional(),
    resources: DocumentResourcesSchema.optional(),
  })
  .strict();
const DocumentResultSchema = z
  .object({
    documents: z
      .object({
        item: z.array(
          z
            .object({
              uploadUri: z.string(),
              mode: z.string(),
              status: z.enum(["probed", "extracted"]),
              contentAvailable: z.boolean(),
              textAvailable: z.boolean(),
              message: z.string(),
            })
            .passthrough(),
        ),
      })
      .strict(),
  })
  .strict();

interface DocumentPluginConfig {
  extractors: Record<string, AgentDocumentExtractorConfig>;
  probe: {
    sampleBytes: number;
    containerMaxEntries: number;
    containerMaxEntryBytes: number;
    contentTypesEntryName: string;
  };
  parse: {
    ocr: boolean;
    extractAttachments: boolean;
    includeRawContent: boolean;
    ignoreNotes: boolean;
    ignoreComments: boolean;
    ignoreHeadersAndFooters: boolean;
    ignoreSlideMasters: boolean;
    ignoreInternalLinks: boolean;
    newlineDelimiter: string;
  };
  output: {
    maxFileBytes: number;
    maxTextChars: number;
    maxMarkdownChars: number;
    maxChunks: number;
    maxChunkChars: number;
  };
}

void runMcpTool({
  toolName: "DocumentTool",
  argumentSchema: DocumentArgumentsSchema,
  resultSchema: DocumentResultSchema,
  resultText: (result) => result.documents.item.map((item) => item.message).join("\n"),
  async execute(args, context) {
    const upload = UploadResourceSchema.parse(args.resources?.document);
    if (upload.uploadUri !== args.uploadUri) {
      throw new Error("DocumentTool received an upload resource that does not match uploadUri.");
    }
    const config = readDocumentPluginConfig();
    const mode = args.mode ?? DefaultDocumentToolMode;
    const probe = await probeAgentDocument(
      {
        filePath: upload.filePath,
        uploadUri: upload.uploadUri,
        name: upload.name,
        declaredMime: upload.declaredMime,
        size: upload.size,
        sha256: upload.sha256,
      },
      toProbeOptions(config),
    );
    const base = toProbeRecord({ upload, mode, probe });
    if (mode === "probe") return { documents: { item: [base] } };

    if (mode === "auto" && !selectAgentDocumentExtractor(probe, config.extractors)) {
      return {
        documents: {
          item: [
            {
              ...base,
              status: "probed" as const,
              message: "Document was probed. No configured content extractor matched this file.",
            },
          ],
        },
      };
    }

    const extracted = await extractAgentDocument(
      {
        filePath: upload.filePath,
        uploadUri: upload.uploadUri,
        name: upload.name,
        declaredMime: upload.declaredMime,
        size: upload.size,
        sha256: upload.sha256,
        extractors: config.extractors,
        probe: toProbeOptions(config),
        signal: context.signal,
      },
      { parse: config.parse, output: config.output },
    );
    return {
      documents: {
        item: [
          {
            ...base,
            status: "extracted" as const,
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
            chunks: { item: extracted.chunks },
            warnings: { item: extracted.warnings },
            message: "Document was probed and text was extracted by the configured extractor.",
          },
        ],
      },
    };
  },
});

function readDocumentPluginConfig(): DocumentPluginConfig {
  return configuration.schema.parse(readPluginTomlConfig("PluginConfig.toml")) as DocumentPluginConfig;
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

function toProbeRecord(input: {
  upload: z.infer<typeof UploadResourceSchema>;
  mode: DocumentToolMode;
  probe: AgentDocumentProbeResult;
}) {
  return {
    uploadUri: input.upload.uploadUri,
    mode: input.mode,
    status: "probed" as const,
    name: input.upload.name,
    mime: input.upload.mime,
    size: input.upload.size,
    sha256: input.upload.sha256,
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
