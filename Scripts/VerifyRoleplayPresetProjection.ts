import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { AgentSystemRuntime } from "../Source/AgentSystem/AgentSystemRuntime.js";
import type { AgentSystemConfig } from "../Source/AgentSystem/Types/AgentConfigTypes.js";

const workspaceRoot = process.cwd();
const presetRunDir = fs.mkdtempSync(path.join(workspaceRoot, ".senera", "verify-roleplay-preset-"));
const presetRoot = path.relative(workspaceRoot, path.join(presetRunDir, "presets"));
const presetStateFile = path.relative(workspaceRoot, path.join(presetRunDir, "state.json"));

const config = {
  Defaults: {
    Presets: {
      Enabled: true,
      RootDir: presetRoot,
      StateFile: presetStateFile,
    },
  },
  DefaultModelProviderId: "verify",
  ModelProviderEndpoints: [{
    Id: "verify",
    BaseUrl: "https://example.invalid/v1",
    ApiKey: "test",
  }],
  ModelProviders: [{
    Id: "verify",
    ProviderId: "verify",
    Endpoint: "Responses",
    Model: "verify-model",
  }],
} satisfies AgentSystemConfig;

async function main(): Promise<void> {
  const runtime = AgentSystemRuntime.fromConfig({
    workspaceRoot,
    configPath: "senera.config.json",
    config,
  });

  await runtime.presetManager.save({
    name: "json-role",
    format: "json",
    content: JSON.stringify({
      character: {
        name: "林月",
        voice: "冷静 <soft>",
      },
      scene: {
        state: "调查失踪案",
      },
    }, null, 2),
    activate: true,
  });
  await runtime.presetManager.save({
    name: "markdown-role",
    format: "markdown",
    content: "# 林月\n\n用冷静 <soft> 的语气回应。",
  });
  await runtime.presetManager.save({
    name: "text-role",
    format: "text",
    content: "保持克制、简洁、连续。",
  });

  const snapshot = await runtime.presetManager.snapshot();
  assert.equal(snapshot.presets.length, 3);
  assert.equal(snapshot.activePresetName, "json-role.json");

  const jsonContext = await runtime.presetManager.promptContext();
  const jsonXml = jsonContext.documents[0]?.xml ?? "";
  assert.match(jsonXml, /<member name="character">/);
  assert.match(jsonXml, /<member name="voice">/);
  assert.match(jsonXml, /冷静 &lt;soft&gt;/);

  await runtime.presetManager.setActive({
    name: "markdown-role.md",
  });
  const markdownContext = await runtime.presetManager.promptContext();
  const markdownXml = markdownContext.documents[0]?.xml ?? "";
  assert.match(markdownXml, /<text format="markdown">/);
  assert.match(markdownXml, /&lt;soft&gt;/);

  await runtime.presetManager.setActive({
    name: "json-role.json",
  });
  const template = runtime.registry.getTemplate("BaseSystemPrompt");
  assert.ok(template);
  const rootCommand = runtime.promptContextBuilder.buildRootCommand({
    decision: {
      action: "answer",
    },
    loadedToolNames: [],
  });
  const prompt = await runtime.promptRenderer.renderFile(template.path, {
    ...runtime.promptContextBuilder.buildBaseContext({
      loadedToolNames: [],
      rootCommand,
      roleplayPreset: await runtime.presetManager.promptContext(),
    }),
  });

  const rootIndex = prompt.indexOf("<senera_root_command>");
  const presetIndex = prompt.indexOf("<roleplay_preset>");
  const guidanceIndex = prompt.indexOf("<prompt_guidance>");
  assert.ok(rootIndex >= 0);
  assert.ok(presetIndex > rootIndex);
  assert.ok(guidanceIndex > presetIndex);
  assert.match(prompt, /roleplay_preset_below_root_command/);
  assert.match(prompt, /user_configured_preset/);

  console.log("Roleplay preset projection verification passed.");
}

main().finally(() => {
  fs.rmSync(presetRunDir, { recursive: true, force: true });
});
