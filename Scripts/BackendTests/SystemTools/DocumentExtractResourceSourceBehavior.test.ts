import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentResourceResolver } from "../../../Source/AgentSystem/Resources/AgentResourceResolver.js";
import { SeneraLocalExecutionEnv } from "../../../Source/AgentSystem/Execution/SeneraLocalExecutionEnv.js";
import { createDocumentExtractSystemTool } from "../../../Source/AgentSystem/SystemTools/DocumentExtractSystemTool.js";
import type { AgentHostToolContext } from "../../../Source/AgentSystem/ToolRuntime/AgentToolHostCapabilityRegistry.js";
import type { AgentSystemConfig } from "../../../Source/AgentSystem/Types/AgentConfigTypes.js";
import { createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";
import { loadSystemToolContractByCapability } from "./SystemToolContractTestSupport.js";

describe("DocumentExtract resource sources", () => {
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const directory of temporaryDirectories.splice(0)) removeDirectory(directory);
  });

  it("extracts from relative and absolute paths inside the active workspace", async () => {
    const workspaceRoot = createTemporaryDirectory("senera-document-local-source");
    temporaryDirectories.push(workspaceRoot);
    fs.writeFileSync(path.join(workspaceRoot, "notes.txt"), "A local document for extraction.");
    const context = createContext(workspaceRoot);
    const tool = createDocumentExtractSystemTool();

    const relative = await tool.execute({ source: { kind: "local_path", path: "notes.txt" }, mode: "auto" }, context);
    const absolute = await tool.execute(
      { source: { kind: "local_path", path: path.join(workspaceRoot, "notes.txt") }, mode: "probe" },
      context,
    );

    expect(relative).toMatchObject({
      document: {
        source: { kind: "local_path", path: "notes.txt" },
        status: "extracted",
        extraction: { textPreview: "A local document for extraction." },
      },
    });
    expect(absolute).toMatchObject({
      document: { source: { kind: "local_path", path: "notes.txt" }, status: "probed" },
    });
  });

  it("downloads HTTP(S) sources through the shared web safety policy", async () => {
    const workspaceRoot = createTemporaryDirectory("senera-document-http-source");
    temporaryDirectories.push(workspaceRoot);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("Downloaded document text.", {
          headers: { "content-type": "text/plain; charset=utf-8" },
        }),
      ),
    );
    const tool = createDocumentExtractSystemTool();
    expect(loadSystemToolContractByCapability(tool.capability).contract.execution.Network).toBe("Allow");
    const output = await tool.execute(
      { source: { kind: "http_url", url: "http://127.0.0.1/document.txt" }, mode: "auto" },
      createContext(workspaceRoot, {
        Extensions: { "web-tools": { Configuration: { fetch: { allowPrivateNetworks: true } } } },
      }),
    );

    expect(output).toMatchObject({
      document: {
        source: { kind: "http_url", url: "http://127.0.0.1/document.txt" },
        extraction: { textPreview: "Downloaded document text." },
      },
    });
  });

  it("resolves canonical Senera resources through the same source contract", async () => {
    const workspaceRoot = createTemporaryDirectory("senera-document-resource-source");
    temporaryDirectories.push(workspaceRoot);
    const filePath = path.join(workspaceRoot, "uploaded.txt");
    fs.writeFileSync(filePath, "A canonical resource document.");
    const resourceUri = "senera://resource/upload-document";
    const tool = createDocumentExtractSystemTool();
    const output = await tool.execute({ source: { kind: "senera_resource", uri: resourceUri }, mode: "auto" }, {
      workspaceRoot,
      config: createContext(workspaceRoot).config,
      resourceResolver: {
        resolve: vi.fn().mockResolvedValue({
          resourceUri,
          filePath,
          name: "uploaded.txt",
          mime: "text/plain",
          size: fs.statSync(filePath).size,
          sha256: "a".repeat(64),
          origin: "upload",
        }),
      },
    } as unknown as AgentHostToolContext);

    expect(output).toMatchObject({
      document: {
        source: { kind: "senera_resource", uri: resourceUri, path: "uploaded.txt" },
        extraction: { textPreview: "A canonical resource document." },
      },
    });
  });

  it("keeps the URI alone when a resource lives outside the active workspace", async () => {
    const workspaceRoot = createTemporaryDirectory("senera-document-resource-external");
    const storeRoot = createTemporaryDirectory("senera-document-external-store");
    temporaryDirectories.push(workspaceRoot, storeRoot);
    const filePath = path.join(storeRoot, "external.txt");
    fs.writeFileSync(filePath, "external bytes");
    const resourceUri = "senera://resource/external-document";
    const output = await createDocumentExtractSystemTool().execute(
      { source: { kind: "senera_resource", uri: resourceUri }, mode: "auto" },
      {
        workspaceRoot,
        config: createContext(workspaceRoot).config,
        resourceResolver: {
          resolve: vi.fn().mockResolvedValue({
            resourceUri,
            filePath,
            name: "external.txt",
            mime: "text/plain",
            size: fs.statSync(filePath).size,
            sha256: "b".repeat(64),
            origin: "upload",
          }),
        },
      } as unknown as AgentHostToolContext,
    );

    expect((output as { document: { source: unknown } }).document.source).toEqual({
      kind: "senera_resource",
      uri: resourceUri,
    });
  });

  it("rejects a local path outside the active workspace", async () => {
    const workspaceRoot = createTemporaryDirectory("senera-document-local-boundary");
    const outsideRoot = createTemporaryDirectory("senera-document-outside-boundary");
    temporaryDirectories.push(workspaceRoot, outsideRoot);
    const outsidePath = path.join(outsideRoot, "private.txt");
    fs.writeFileSync(outsidePath, "private");

    await expect(
      createDocumentExtractSystemTool().execute(
        { source: { kind: "local_path", path: outsidePath }, mode: "auto" },
        createContext(workspaceRoot),
      ),
    ).rejects.toMatchObject({ code: "permission_denied" });
  });
});

function createContext(workspaceRoot: string, overrides: Partial<AgentSystemConfig> = {}): AgentHostToolContext {
  const config = {
    DefaultModelProviderId: "test-provider",
    ModelProviderEndpoints: [],
    ModelProviders: [],
    ...overrides,
  } as AgentSystemConfig;
  const uploadStore = { resolve: vi.fn().mockResolvedValue(undefined) };
  return {
    workspaceRoot,
    config,
    uploadStore,
    executionEnv: new SeneraLocalExecutionEnv({ workspaceRoot }),
    resourceResolver: new AgentResourceResolver({ workspaceRoot, config, uploadStore }),
  } as unknown as AgentHostToolContext;
}
