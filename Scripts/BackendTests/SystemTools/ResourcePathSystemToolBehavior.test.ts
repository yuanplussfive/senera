import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveUploadsConfig } from "../../../Source/AgentSystem/Defaults/AgentAppDefaults.js";
import { AgentResourceResolver } from "../../../Source/AgentSystem/Resources/AgentResourceResolver.js";
import { ResourcePathSystemTool } from "../../../Source/AgentSystem/SystemTools/ResourcePathSystemTool.js";
import type { AgentHostToolContext } from "../../../Source/AgentSystem/ToolRuntime/AgentToolHostCapabilityRegistry.js";
import { AgentUploadStore } from "../../../Source/AgentSystem/Uploads/AgentUploadStore.js";
import { createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";

describe("ResourcePath system tool", () => {
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) removeDirectory(directory);
  });

  it("resolves a Senera upload to its existing workspace-relative file path", async () => {
    const workspaceRoot = createTemporaryDirectory("senera-resource-path");
    temporaryDirectories.push(workspaceRoot);
    const config = { ModelProviders: [] };
    const uploadStore = new AgentUploadStore({ workspaceRoot, config: resolveUploadsConfig(config) });
    const published = await uploadStore.publishBytes({
      bytes: Buffer.from('{"ok":true}'),
      name: "result.json",
      mime: "application/json",
    });
    const resourceResolver = new AgentResourceResolver({ workspaceRoot, config, uploadStore });
    const context = {
      workspaceRoot,
      config,
      uploadStore,
      resourceResolver,
    } as unknown as AgentHostToolContext;

    const result = await ResourcePathSystemTool.execute({ resourceUri: published.resourceUri }, context);

    expect(result).toMatchObject({
      source: {
        kind: "local_path",
        path: expect.stringMatching(/^\.senera\/uploads\/upl_[a-f0-9]{32}\/original\.json$/u),
      },
      name: "result.json",
      mime: "application/json",
      size: 11,
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    expect(fs.existsSync(path.join(workspaceRoot, result.source.path))).toBe(true);
    expect(JSON.stringify(result)).not.toContain("senera://");
  });

  it("is exposed as a bootstrap resource capability", () => {
    expect(ResourcePathSystemTool.metadata.loading).toBe("Bootstrap");
    expect(ResourcePathSystemTool.metadata.permissions).toContain("resources:read");
  });
});
