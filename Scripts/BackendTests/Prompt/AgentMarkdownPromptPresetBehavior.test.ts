import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { readAgentMarkdownPromptPreset } from "../../../Source/AgentSystem/Prompt/AgentMarkdownPromptPreset.js";

const temporaryRoots: string[] = [];

afterEach(() => {
  while (temporaryRoots.length > 0) {
    const root = temporaryRoots.pop();
    if (root) fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("workspace Markdown prompt presets", () => {
  test("reads the active Markdown file from workspace state", () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "senera-markdown-preset-"));
    temporaryRoots.push(workspaceRoot);
    fs.mkdirSync(path.join(workspaceRoot, ".senera"), { recursive: true });
    fs.writeFileSync(
      path.join(workspaceRoot, ".senera", "prompt-preset.json"),
      JSON.stringify({ version: 1, activePath: "prompts/reviewer.md" }),
      "utf8",
    );
    fs.mkdirSync(path.join(workspaceRoot, "prompts"));
    fs.writeFileSync(path.join(workspaceRoot, "prompts", "reviewer.md"), "# Review\n\nBe direct.", "utf8");

    expect(readAgentMarkdownPromptPreset(workspaceRoot, 1024)).toEqual({
      context: {
        enabled: true,
        card: { markdown: "# Review\n\nBe direct.", sourcePath: "prompts/reviewer.md" },
      },
      path: "prompts/reviewer.md",
    });
  });

  test("re-reads content and rejects non-Markdown or unsafe selections", () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "senera-markdown-preset-"));
    temporaryRoots.push(workspaceRoot);
    fs.mkdirSync(path.join(workspaceRoot, ".senera"), { recursive: true });
    const statePath = path.join(workspaceRoot, ".senera", "prompt-preset.json");
    fs.writeFileSync(statePath, JSON.stringify({ version: 1, activePath: "prompts/prompt.md" }), "utf8");
    fs.mkdirSync(path.join(workspaceRoot, "prompts"));
    const promptPath = path.join(workspaceRoot, "prompts", "prompt.md");
    fs.writeFileSync(promptPath, "first", "utf8");
    expect(readAgentMarkdownPromptPreset(workspaceRoot, 1024).context.card.markdown).toBe("first");
    fs.writeFileSync(promptPath, "second", "utf8");
    expect(readAgentMarkdownPromptPreset(workspaceRoot, 1024).context.card.markdown).toBe("second");

    fs.writeFileSync(statePath, JSON.stringify({ version: 1, activePath: "prompts/prompt.txt" }), "utf8");
    expect(readAgentMarkdownPromptPreset(workspaceRoot, 1024).context.enabled).toBe(false);
    expect(readAgentMarkdownPromptPreset(workspaceRoot, 1024).error).toContain("Markdown");

    fs.writeFileSync(statePath, JSON.stringify({ version: 1, activePath: "../outside.md" }), "utf8");
    expect(readAgentMarkdownPromptPreset(workspaceRoot, 1024).context.enabled).toBe(false);
    expect(readAgentMarkdownPromptPreset(workspaceRoot, 1024).error).toContain("Markdown");

    fs.writeFileSync(statePath, JSON.stringify({ version: 1, activePath: "outside.md" }), "utf8");
    expect(readAgentMarkdownPromptPreset(workspaceRoot, 1024).context.enabled).toBe(false);
    expect(readAgentMarkdownPromptPreset(workspaceRoot, 1024).error).toContain("prompt preset directory");
  });

  test("does not inject a selected preset while it is explicitly disabled", () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "senera-markdown-preset-"));
    temporaryRoots.push(workspaceRoot);
    fs.mkdirSync(path.join(workspaceRoot, ".senera"), { recursive: true });
    fs.mkdirSync(path.join(workspaceRoot, "prompts"));
    fs.writeFileSync(
      path.join(workspaceRoot, ".senera", "prompt-preset.json"),
      JSON.stringify({ version: 1, activePath: "prompts/disabled.md", enabled: false }),
      "utf8",
    );
    fs.writeFileSync(path.join(workspaceRoot, "prompts", "disabled.md"), "# Do not inject", "utf8");

    expect(readAgentMarkdownPromptPreset(workspaceRoot, 1024)).toEqual({
      context: { enabled: false, card: { markdown: "" } },
      path: "prompts/disabled.md",
    });
  });

  test("rejects an active preset that exceeds the existing workspace text limit", () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "senera-markdown-preset-"));
    temporaryRoots.push(workspaceRoot);
    fs.mkdirSync(path.join(workspaceRoot, ".senera"), { recursive: true });
    fs.mkdirSync(path.join(workspaceRoot, "prompts"));
    fs.writeFileSync(
      path.join(workspaceRoot, ".senera", "prompt-preset.json"),
      JSON.stringify({ version: 1, activePath: "prompts/large.md" }),
      "utf8",
    );
    fs.writeFileSync(path.join(workspaceRoot, "prompts", "large.md"), "12345", "utf8");

    const result = readAgentMarkdownPromptPreset(workspaceRoot, 4);
    expect(result.context.enabled).toBe(false);
    expect(result.error).toContain("exceeds the 4 byte limit");
  });
});
