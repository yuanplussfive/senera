import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {
  extractAgentDocument,
  selectAgentDocumentExtractor,
  type AgentDocumentExtractorConfig,
} from "../Source/AgentSystem/Documents/AgentDocumentExtract.js";
import { probeAgentDocument } from "../Source/AgentSystem/Documents/AgentDocumentProbe.js";

const workspaceRoot = process.cwd();
const tempRoot = path.join(workspaceRoot, ".senera", "tmp", "document-text-extractor");
const filePath = path.join(tempRoot, "server.output");
const content = [
  "service started",
  "request accepted",
  "request completed",
].join("\n");

const probeOptions = {
  sampleBytes: 65536,
  container: {
    maxEntries: 8,
    maxEntryBytes: 65536,
    contentTypesEntryName: "[Content_Types].xml",
  },
};

const extractors: Record<string, AgentDocumentExtractorConfig> = {
  officeparser: {
    type: "officeparser",
    enabled: true,
    priority: 100,
    fileTypes: {
      pdf: {
        mimes: ["application/pdf"],
        extensions: [".pdf"],
      },
    },
  },
  text: {
    type: "text",
    enabled: true,
    priority: 10,
    match: {
      mediaTypes: ["text"],
      isText: true,
    },
    decode: {
      defaultEncoding: "utf8",
    },
  },
};

void main();

async function main(): Promise<void> {
  await fs.mkdir(tempRoot, { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
  const stat = await fs.stat(filePath);

  const probe = await probeAgentDocument({
    filePath,
    name: "server.output",
    declaredMime: "text/plain",
    size: stat.size,
    uploadUri: "senera://upload/upl_text_generic",
  }, probeOptions);

  const selected = selectAgentDocumentExtractor(probe, extractors);
  assert.equal(selected?.name, "text");
  assert.equal(selected?.config.type, "text");

  const extracted = await extractAgentDocument({
    filePath,
    name: "server.output",
    declaredMime: "text/plain",
    size: stat.size,
    uploadUri: "senera://upload/upl_text_generic",
    extractors,
    probe: probeOptions,
  }, {
    parse: {
      ocr: false,
      extractAttachments: false,
      includeRawContent: false,
      ignoreNotes: false,
      ignoreComments: false,
      ignoreHeadersAndFooters: false,
      ignoreSlideMasters: true,
      ignoreInternalLinks: true,
      newlineDelimiter: "\n",
    },
    output: {
      maxFileBytes: 1024 * 1024,
      maxTextChars: 1024,
      maxMarkdownChars: 1024,
      maxChunks: 4,
      maxChunkChars: 16,
    },
  });

  assert.equal(extracted.parser, "text");
  assert.equal(extracted.fileType, "text");
  assert.equal(extracted.textLength, content.length);
  assert.equal(extracted.markdownPreview.includes("request accepted"), true);
  assert.equal(extracted.chunks.length > 0, true);
  assert.equal(extracted.metadata.lineCount, 3);

  console.log("Document generic text extractor verification passed.");
}
