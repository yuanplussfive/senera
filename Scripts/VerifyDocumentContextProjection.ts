import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { AgentToolResultXmlRenderer } from "../Source/AgentSystem/Xml/AgentToolResultXmlRenderer.js";
import type { ExecutedToolCallResult } from "../Source/AgentSystem/Types/ToolRuntimeTypes.js";

const workspaceRoot = process.cwd();
const documentEvidenceUri = "senera://evidence/ev_444444444444444444444444";
const manifestPath = path.join(
  workspaceRoot,
  "Plugins",
  "AgentDocumentPlugin",
  "PluginManifest.json",
);
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
  Tools?: Array<{
    Artifacts?: {
      Evidence?: Array<{
        Slots?: Record<string, unknown>;
        ModelProjection?: {
          Slots?: string[];
        };
        Projection?: {
          ArtifactTemplate?: string;
        };
      }>;
    };
  }>;
};
const evidencePolicy = manifest.Tools?.[0]?.Artifacts?.Evidence?.[0];

assert.ok(evidencePolicy, "DocumentTool artifact evidence policy should exist");
assert.equal(
  Object.hasOwn(evidencePolicy.Slots ?? {}, "textPreview"),
  false,
  "DocumentTool evidence slots should not include textPreview",
);
assert.equal(
  evidencePolicy.ModelProjection?.Slots?.includes("textPreview"),
  false,
  "DocumentTool model projection should not include textPreview",
);
assert.equal(
  evidencePolicy.ModelProjection?.Slots?.includes("markdownPreview"),
  true,
  "DocumentTool model projection should include markdownPreview",
);
assert.equal(
  evidencePolicy.Projection?.ArtifactTemplate?.includes("textPreview"),
  false,
  "DocumentTool projection artifact should not include textPreview",
);

const toolResult: ExecutedToolCallResult = {
  callId: "call-1",
  name: "DocumentTool",
  arguments: {
    uploadUri: "senera://upload/upl_document",
  },
  process: {
    exitCode: 0,
    signal: null,
    stderr: "",
  },
  result: {
    documents: {
      item: [{
        uploadUri: "senera://upload/upl_document",
        status: "extracted",
        textPreview: "plain text preview should stay in raw artifact only",
        markdownPreview: "# Markdown preview visible to model",
        chunks: {
          item: [{
            index: 0,
            text: "chunk text should stay in raw artifact only",
          }],
        },
      }],
    },
  },
  artifact: {
    artifactId: "art_111111111111111111111111",
    artifactUri: "senera://artifact/art_111111111111111111111111",
    artifactPath: path.join(workspaceRoot, ".senera", "artifacts", "runs", "request", "steps", "001"),
    relativePath: ".senera/artifacts/runs/request/steps/001",
    manifestPath: path.join(workspaceRoot, ".senera", "artifacts", "runs", "request", "steps", "001", "manifest.json"),
    files: {},
    summary: "extracted uploaded.md mode=auto text=128 chunks=1",
    evidence: [{
      key: "uploaded_document:senera://upload/upl_document:auto:extracted",
      evidenceUri: documentEvidenceUri,
      kind: "uploaded_document",
      locator: "senera://upload/upl_document",
      display: "document extracted: uploaded.md",
      label: "uploaded.md",
      source: "officeparser",
      confidence: 0.9,
      slots: {
        markdownPreview: "# Markdown preview visible to model",
      },
      modelSlots: [
        { name: "status", value: "extracted" },
        { name: "name", value: "uploaded.md" },
        { name: "markdownPreview", value: "# Markdown preview visible to model" },
        { name: "chunkCount", value: "1" },
      ],
      plannerMemory: {
        facts: [
          { name: "status", value: "extracted" },
          { name: "name", value: "uploaded.md" },
          { name: "chunkCount", value: "1" },
        ],
        artifactRefs: ["projection", "raw"],
      },
    }],
    delta: [],
  },
};

const xml = new AgentToolResultXmlRenderer().render({
  kind: "ToolResults",
  value: [toolResult],
});

assert.equal(xml.includes("plain text preview should stay in raw artifact only"), false);
assert.equal(xml.includes("chunk text should stay in raw artifact only"), false);
assert.equal(xml.includes("<chunks>"), false);
assert.equal(xml.includes("textPreview"), false);
assert.equal(xml.includes("# Markdown preview visible to model"), true);
assert.equal(xml.includes("senera://artifact/art_111111111111111111111111"), true);

console.log("Document context projection verification passed.");
