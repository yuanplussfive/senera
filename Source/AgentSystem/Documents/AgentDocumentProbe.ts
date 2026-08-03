import fs from "node:fs/promises";
import path from "node:path";
import { detect as detectCharset } from "chardet";
import { isBinary, isText } from "istextorbinary";
import { lookup } from "mime-types";
import { UnknownBinaryMimeType } from "../Uploads/AgentUploadMime.js";
import type {
  AgentDocumentProbeInput,
  AgentDocumentProbeResult,
  AgentDocumentProbeSignal,
} from "./AgentDocumentProbeTypes.js";
import { probeDocumentContainer, type AgentDocumentContainerProbeOptions } from "./AgentDocumentContainerProbe.js";

export interface AgentDocumentProbeOptions {
  sampleBytes: number;
  container: AgentDocumentContainerProbeOptions;
}

export async function probeAgentDocument(
  input: AgentDocumentProbeInput,
  options: AgentDocumentProbeOptions,
): Promise<AgentDocumentProbeResult> {
  const detected = await detectMimeFromBytes(input.filePath);
  const sample = await readFileSample(input.filePath, input.size, options.sampleBytes);
  const namedExtension = path.extname(input.name).toLowerCase() || undefined;
  const namedMime = normalizeMime(lookup(input.name) || undefined);
  const declaredMime = normalizeMime(input.declaredMime);
  const effectiveMime = detected.mime ?? declaredMime ?? namedMime ?? UnknownBinaryMimeType;
  const text = isText(input.name, sample);
  const binary = isBinary(input.name, sample);
  const charset = detectCharset(sample) ?? undefined;
  const container = await probeDocumentContainer(input.filePath, options.container);

  return {
    status: "probed",
    effectiveMime,
    detectedMime: detected.mime,
    detectedExtension: detected.extension,
    declaredMime,
    namedMime,
    namedExtension,
    mediaType: readMediaType(effectiveMime),
    charset,
    isText: typeof text === "boolean" ? text : undefined,
    isBinary: typeof binary === "boolean" ? binary : undefined,
    container,
    signals: compactSignals([
      {
        source: "file-type",
        fields: {
          mime: detected.mime,
          extension: detected.extension,
        },
      },
      {
        source: "mime-types",
        fields: {
          mime: namedMime,
          extension: namedExtension,
        },
      },
      {
        source: "upload-client",
        fields: {
          mime: declaredMime,
        },
      },
      {
        source: "istextorbinary",
        fields: {
          isText: text,
          isBinary: binary,
        },
      },
      {
        source: "chardet",
        fields: {
          charset,
        },
      },
      {
        source: "zip-container",
        fields: {
          format: container?.format,
          entryCount: container?.entryCount,
          sampledEntryCount: container?.sampledEntries.length,
          contentTypeDefaults: container?.contentTypes?.defaults.length,
          contentTypeOverrides: container?.contentTypes?.overrides.length,
        },
      },
    ]),
    file: {
      name: input.name,
      size: input.size,
      sha256: input.sha256,
      uploadUri: input.uploadUri,
    },
  };
}

async function detectMimeFromBytes(filePath: string): Promise<{
  mime?: string;
  extension?: string;
}> {
  const { fileTypeFromFile } = await import("file-type");
  const detected = await fileTypeFromFile(filePath);
  return {
    mime: normalizeMime(detected?.mime),
    extension: detected?.ext ? `.${detected.ext.toLowerCase()}` : undefined,
  };
}

async function readFileSample(filePath: string, fileSize: number, sampleBytes: number): Promise<Buffer> {
  const length = Math.min(fileSize, sampleBytes);
  if (length <= 0) {
    return Buffer.alloc(0);
  }

  const handle = await fs.open(filePath, "r");
  try {
    const buffer = Buffer.alloc(length);
    const result = await handle.read(buffer, 0, length, 0);
    return result.bytesRead === buffer.byteLength ? buffer : buffer.subarray(0, result.bytesRead);
  } finally {
    await handle.close();
  }
}

function readMediaType(mime: string): string | undefined {
  const [type] = mime.split("/");
  return type || undefined;
}

function normalizeMime(value: string | false | undefined): string | undefined {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return normalized ? normalized : undefined;
}

function compactSignals(signals: AgentDocumentProbeSignal[]): AgentDocumentProbeSignal[] {
  return signals
    .map((signal) => ({
      source: signal.source,
      fields: Object.fromEntries(
        Object.entries(signal.fields).filter((entry) => entry[1] !== undefined && entry[1] !== null),
      ),
    }))
    .filter((signal) => Object.keys(signal.fields).length > 0);
}
