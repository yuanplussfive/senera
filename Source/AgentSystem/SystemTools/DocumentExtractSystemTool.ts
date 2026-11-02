import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { extension as mimeExtension, lookup as lookupMime } from "mime-types";
import { fileTypeFromBuffer } from "file-type";
import { extractAgentDocument } from "../Documents/AgentDocumentExtract.js";
import { probeAgentDocument } from "../Documents/AgentDocumentProbe.js";
import {
  AgentDocumentToolConfigurationSchema,
  DefaultAgentDocumentToolConfiguration,
} from "../Documents/AgentDocumentToolConfiguration.js";
import { defineSystemTool, systemToolArguments } from "./AgentSystemToolDefinition.js";
import { resolveAgentSystemLocalResource } from "./AgentSystemResource.js";
import type { AgentResourceSource } from "../Resources/AgentResourceSource.js";
import { AgentWebToolsConfigurationSchema } from "../Web/AgentWebConfiguration.js";
import { fetchWebResource } from "../Web/AgentWebHttpClient.js";
import { sha256Hex } from "../Core/AgentHash.js";
import { removeAgentPathWithRetry } from "../Core/AgentFs.js";
import type { AgentHostToolContext } from "../ToolRuntime/AgentToolHostCapabilityRegistry.js";
import type { AgentDocumentExtractResult } from "../Documents/AgentDocumentExtractTypes.js";

interface DocumentExtractArguments extends Record<string, unknown> {
  readonly source: AgentResourceSource;
  readonly mode: "auto" | "probe" | "extract";
  readonly format?: "markdown" | "text";
}

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

export function createDocumentExtractSystemTool(extensionConfiguration?: Record<string, unknown>) {
  const settings = AgentDocumentExtensionConfigurationSchema.parse(extensionConfiguration ?? {});
  const configuration = AgentDocumentToolConfigurationSchema.parse({
    ...DefaultAgentDocumentToolConfiguration,
    probe: settings.probe,
    parse: settings.parse,
    output: settings.output,
  });
  return defineSystemTool({
    capability: "system.tool.agent-document-tools.DocumentExtract",
    async execute(input, context) {
      const args = systemToolArguments<DocumentExtractArguments>(input);
      const resource = await resolveDocumentSource(args.source, context, configuration.output.maxFileBytes);
      try {
        const document = {
          filePath: resource.filePath,
          name: resource.name,
          declaredMime: resource.declaredMime,
          size: resource.size,
          sha256: resource.sha256,
          ...(resource.resourceUri ? { resourceUri: resource.resourceUri } : {}),
        };
        const probe = await probeAgentDocument(document, {
          sampleBytes: configuration.probe.sampleBytes,
          container: {
            maxEntries: configuration.probe.containerMaxEntries,
            maxEntryBytes: configuration.probe.containerMaxEntryBytes,
            contentTypesEntryName: configuration.probe.contentTypesEntryName,
          },
        });
        if (args.mode === "probe") {
          return {
            document: {
              ...publicDocument(resource),
              status: "probed" as const,
              probe,
            },
          };
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
        return {
          document: {
            ...publicDocument(resource),
            status: "extracted" as const,
            probe,
            content: documentContent(extraction, args.format),
            extraction,
          },
        };
      } finally {
        await resource.cleanup?.();
      }
    },
  });
}

export const DocumentExtractSystemTool = createDocumentExtractSystemTool();

interface ResolvedDocumentSource {
  readonly source: AgentResourceSource;
  readonly resourceUri?: string;
  readonly filePath: string;
  readonly name: string;
  readonly mime: string;
  readonly declaredMime?: string;
  readonly size: number;
  readonly sha256: string;
  readonly cleanup?: () => Promise<void>;
}

async function resolveDocumentSource(
  source: AgentResourceSource,
  context: AgentHostToolContext,
  maxFileBytes: number,
): Promise<ResolvedDocumentSource> {
  if (source.kind !== "http_url") return resolveAgentSystemLocalResource(context, source);

  const web = AgentWebToolsConfigurationSchema.parse(context.config.Extensions?.["web-tools"]?.Configuration ?? {});
  const response = await fetchWebResource(
    source.url,
    {
      maxRedirects: web.fetch.maxRedirects,
      responseMaxBytes: Math.min(maxFileBytes, web.fetch.responseMaxBytes),
      timeoutMs: web.fetch.requestTimeoutMs,
      userAgent: web.fetch.userAgent,
      maxUrlLength: web.fetch.maxUrlLength,
      allowPrivateNetworks: web.fetch.allowPrivateNetworks,
      allowSyntheticProxyAddresses: web.fetch.allowSyntheticProxyAddresses,
    },
    context.signal,
  );
  if (response.transfer.truncated) {
    throw new Error(
      `Document download exceeds its byte limit of ${Math.min(maxFileBytes, web.fetch.responseMaxBytes)}.`,
    );
  }

  const detectedMime = (await fileTypeFromBuffer(response.body))?.mime;
  const declaredMime = response.contentType.split(";", 1)[0]?.trim().toLowerCase() || undefined;
  const mime =
    detectedMime ?? declaredMime ?? (lookupMime(new URL(response.url).pathname) || "application/octet-stream");
  const extension = mimeExtension(mime);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "senera-document-"));
  const name = path.basename(new URL(response.url).pathname) || "document";
  const fileName = `${randomUUID()}${extension ? `.${extension}` : ""}`;
  const filePath = path.join(directory, fileName);
  try {
    await fs.writeFile(filePath, response.body, { flag: "wx" });
  } catch (error) {
    await removeAgentPathWithRetry(directory, { recursive: true });
    throw error;
  }
  const bytes = Buffer.from(response.body);
  return {
    source: { kind: "http_url", url: response.url },
    filePath,
    name,
    mime,
    ...(declaredMime ? { declaredMime } : {}),
    size: bytes.byteLength,
    sha256: sha256Hex(bytes),
    cleanup: async () => {
      await removeAgentPathWithRetry(directory, { recursive: true });
    },
  };
}

function publicDocument(resource: ResolvedDocumentSource) {
  return {
    source: resource.source,
    name: resource.name,
    mime: resource.mime,
    size: resource.size,
    sha256: resource.sha256,
  };
}

function documentContent(extraction: AgentDocumentExtractResult, format: DocumentExtractArguments["format"]) {
  const representation = format === "text" ? "text" : "markdown";
  const text = representation === "text" ? extraction.textPreview : extraction.markdownPreview;
  const length = representation === "text" ? extraction.textLength : extraction.markdownLength;
  return { format: representation, text, truncated: text.length < length };
}
