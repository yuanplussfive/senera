import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { documentHostTool } from "../Source/AgentSystem/Documents/AgentDocumentRuntime.js";
import { AgentUploadStore } from "../Source/AgentSystem/Uploads/AgentUploadStore.js";
import type { AgentSystemConfig } from "../Source/AgentSystem/Types/AgentConfigTypes.js";
import type { RegisteredTool } from "../Source/AgentSystem/Types/PluginRuntimeTypes.js";

const workspaceRoot = process.cwd();
const pluginRoot = path.join(workspaceRoot, "Plugins", "AgentDocumentPlugin");
const pluginConfigPath = path.join(pluginRoot, "PluginConfig.toml");
const uploadRootDir = ".senera/tmp/document-tool-runtime/uploads";
const content = [
  "service started",
  "request accepted",
  "request completed",
].join("\n");

void main();

async function main(): Promise<void> {
  const toml = await fs.readFile(pluginConfigPath, "utf8");
  const uploadStore = new AgentUploadStore({
    workspaceRoot,
    rootDir: uploadRootDir,
    maxFileBytes: 1024 * 1024,
  });
  const attachment = await uploadStore.save({
    stream: Readable.from([Buffer.from(content, "utf8")]),
    originalName: "server.output",
    declaredMime: "text/plain",
  });

  const result = await documentHostTool({
    uploadUri: attachment.uploadUri,
    mode: "extract",
  }, {
    workspaceRoot,
    config: documentToolConfig(),
    registry: {
      getTool: () => undefined,
    },
    tool: documentTool(toml),
  });

  assert.equal(result.response.ok, true);
  const item = readDocumentItem(result.response.result);
  assert.equal(item.status, "extracted");
  assert.equal(item.parser, "text");
  assert.equal(item.fileType, "text");
  assert.equal(item.contentAvailable, true);
  assert.equal(item.textAvailable, true);
  assert.equal(item.markdownPreview.includes("request accepted"), true);
  assert.equal(item.probe.file.name, "server.output");

  console.log("DocumentTool runtime generic text verification passed.");
}

function documentToolConfig(): AgentSystemConfig {
  return {
    ModelProviders: [],
    Defaults: {
      Uploads: {
        RootDir: uploadRootDir,
        MaxFileBytes: 1024 * 1024,
      },
    },
  };
}

function documentTool(toml: string): RegisteredTool {
  return {
    name: "DocumentTool",
    permissions: [],
    handler: {
      kind: "HostCapability",
      capability: "document.process",
    },
    evidenceCapabilities: [],
    plugin: {
      rootPath: pluginRoot,
      rootKind: "System",
      manifestPath: path.join(pluginRoot, "PluginManifest.json"),
      manifest: {
        Plugin: {
          Name: "AgentDocumentPlugin",
          Version: "0.1.0",
          Kind: "Tool",
        },
      },
      config: {
        fileName: "PluginConfig.toml",
        path: pluginConfigPath,
        exists: true,
        source: "file",
        templateExists: false,
        needsUserConfig: false,
        toml,
        sections: [],
        runtime: {
          enabled: true,
          tools: {},
        },
        diagnostics: [],
      },
    },
  };
}

function readDocumentItem(result: unknown): {
  status: string;
  parser: string;
  fileType: string;
  contentAvailable: boolean;
  textAvailable: boolean;
  markdownPreview: string;
  probe: {
    file: {
      name: string;
    };
  };
} {
  assert.equal(typeof result, "object");
  assert.notEqual(result, null);
  const item = (result as {
    documents?: {
      item?: unknown[];
    };
  }).documents?.item?.[0];
  assert.equal(typeof item, "object");
  assert.notEqual(item, null);
  return item as ReturnType<typeof readDocumentItem>;
}
