import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { loadVerificationConfig } from "./VerificationConfig.js";
import { createDefaultHostCapabilityRegistry } from "../Source/AgentSystem/AgentDefaultHostCapabilities.js";
import { AgentPluginScanner } from "../Source/AgentSystem/Plugin/AgentPluginScanner.js";
import { AgentPluginRegistry } from "../Source/AgentSystem/Plugin/AgentPluginRegistry.js";
import { AgentToolRunner } from "../Source/AgentSystem/ToolRuntime/AgentToolRunner.js";
import { createXmlProtocolSpec } from "../Source/AgentSystem/Xml/AgentXmlPolicy.js";

async function main(): Promise<void> {
  const workspaceRoot = process.cwd();
  const config = loadVerificationConfig(workspaceRoot);
  const protocol = createXmlProtocolSpec(config);
  const registry = new AgentPluginRegistry();
  for (const plugin of new AgentPluginScanner(workspaceRoot, config).scan()) {
    registry.registerPlugin(plugin);
  }

  const tool = registry.getTool("ApplyPatchTool");
  assert.ok(tool, "ApplyPatchTool should be registered");

  const runner = new AgentToolRunner(
    config,
    protocol,
    workspaceRoot,
    createDefaultHostCapabilityRegistry(),
    registry,
  );
  const fixtureDir = path.join(workspaceRoot, ".senera", "verify-apply-patch");
  const fixtureFile = path.join(workspaceRoot, "Scripts", "VerifyApplyPatchTool.fixture.txt");
  await fsp.rm(fixtureDir, { recursive: true, force: true });
  await fsp.rm(fixtureFile, { force: true });

  const protectedPathResult = await runner.run(tool, {
    dryRun: true,
    operations: {
      item: [{
        action: "create_file",
        path: ".senera/verify-apply-patch/example.txt",
        content: "alpha\nbeta",
      }],
    },
  });
  assert.equal(protectedPathResult.response.ok, false, "protected .senera path should fail");

  const createResult = await runner.run(tool, {
    operations: {
      item: [{
        action: "create_file",
        path: "Scripts/VerifyApplyPatchTool.fixture.txt",
        content: "alpha\nbeta",
      }],
    },
  });
  assert.equal(createResult.response.ok, true);
  assert.equal(fs.readFileSync(fixtureFile, "utf8"), "alpha\nbeta\n");

  const replaceLineResult = await runner.run(tool, {
    operations: {
      item: [{
        action: "replace_range",
        path: "Scripts/VerifyApplyPatchTool.fixture.txt",
        startLine: "2",
        endLine: "2",
        content: "gamma",
      }],
    },
  });
  assert.equal(replaceLineResult.response.ok, true);
  assert.equal(fs.readFileSync(fixtureFile, "utf8"), "alpha\ngamma\n");

  const insertResult = await runner.run(tool, {
    operations: {
      item: [{
        action: "insert_after",
        path: "Scripts/VerifyApplyPatchTool.fixture.txt",
        startLine: 2,
        content: "delta",
      }],
    },
  });
  assert.equal(insertResult.response.ok, true);
  assert.equal(fs.readFileSync(fixtureFile, "utf8"), "alpha\ngamma\ndelta\n");

  const rangeErrorResult = await runner.run(tool, {
    operations: {
      item: [{
        action: "delete_range",
        path: "Scripts/VerifyApplyPatchTool.fixture.txt",
        startLine: 9,
        endLine: 9,
      }],
    },
  });
  assert.equal(rangeErrorResult.response.ok, false);

  const deleteResult = await runner.run(tool, {
    operations: {
      item: [{
        action: "delete_file",
        path: "Scripts/VerifyApplyPatchTool.fixture.txt",
      }],
    },
  });
  assert.equal(deleteResult.response.ok, true);
  assert.equal(fs.existsSync(fixtureFile), false);

  const escapeResult = await runner.run(tool, {
    operations: {
      item: [{
        action: "create_file",
        path: "../outside.txt",
        content: "nope",
      }],
    },
  });
  assert.equal(escapeResult.response.ok, false);

  await fsp.rm(fixtureDir, { recursive: true, force: true });
  console.log("ApplyPatchTool verification passed.");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
