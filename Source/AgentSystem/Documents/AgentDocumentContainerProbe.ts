import { DOMParser } from "@xmldom/xmldom";
import { openPromise, type Entry } from "yauzl";
import type {
  AgentDocumentContainerProbeResult,
  AgentDocumentContentTypeDefault,
  AgentDocumentContentTypeOverride,
  AgentDocumentContentTypesProbeResult,
} from "./AgentDocumentProbeTypes.js";

export interface AgentDocumentContainerProbeOptions {
  maxEntries: number;
  maxEntryBytes: number;
  contentTypesEntryName: string;
}

export async function probeDocumentContainer(
  filePath: string,
  options: AgentDocumentContainerProbeOptions,
): Promise<AgentDocumentContainerProbeResult | undefined> {
  const zip = await openPromise(filePath, {
    lazyEntries: true,
    decodeStrings: true,
    validateEntrySizes: true,
  }).catch(() => undefined);
  if (!zip) {
    return undefined;
  }

  try {
    const sampledEntries: string[] = [];
    let entryCount = 0;
    let contentTypes: AgentDocumentContentTypesProbeResult | undefined;

    for await (const entry of zip.eachEntry()) {
      entryCount += 1;
      if (sampledEntries.length < options.maxEntries) {
        sampledEntries.push(entry.fileName);
      }

      if (entry.fileName === options.contentTypesEntryName) {
        contentTypes = parseContentTypesXml(
          options.contentTypesEntryName,
          await readZipEntryText(zip, entry, options.maxEntryBytes),
        );
      }
    }

    return {
      format: "zip",
      entryCount,
      sampledEntries,
      contentTypes,
    };
  } finally {
    zip.close();
  }
}

async function readZipEntryText(
  zip: Awaited<ReturnType<typeof openPromise>>,
  entry: Entry,
  maxBytes: number,
): Promise<string> {
  if (entry.uncompressedSize > maxBytes) {
    throw new Error(`ZIP entry exceeds configured probe read limit: ${entry.fileName}`);
  }

  const stream = await zip.openReadStreamPromise(entry);
  const chunks: Buffer[] = [];
  let bytes = 0;

  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes > maxBytes) {
      throw new Error(`ZIP entry exceeds configured probe read limit: ${entry.fileName}`);
    }
    chunks.push(buffer);
  }

  return Buffer.concat(chunks).toString("utf8");
}

function parseContentTypesXml(entryName: string, xml: string): AgentDocumentContentTypesProbeResult {
  const document = new DOMParser().parseFromString(xml, "application/xml");
  return {
    entryName,
    defaults: Array.from(document.getElementsByTagName("Default"), readDefaultContentType),
    overrides: Array.from(document.getElementsByTagName("Override"), readOverrideContentType),
  };
}

function readDefaultContentType(
  element: ReturnType<ReturnType<typeof DOMParser.prototype.parseFromString>["getElementsByTagName"]>[number],
): AgentDocumentContentTypeDefault {
  return {
    extension: element.getAttribute("Extension") ?? "",
    contentType: element.getAttribute("ContentType") ?? "",
  };
}

function readOverrideContentType(
  element: ReturnType<ReturnType<typeof DOMParser.prototype.parseFromString>["getElementsByTagName"]>[number],
): AgentDocumentContentTypeOverride {
  return {
    partName: element.getAttribute("PartName") ?? "",
    contentType: element.getAttribute("ContentType") ?? "",
  };
}
