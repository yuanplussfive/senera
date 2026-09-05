import { existsSync, statSync } from "node:fs";
import path from "node:path";

const AgentPiSessionSystemPromptTemplateName = "PiSessionBaseSystemPrompt";

/** Resolves Senera's base prompt that replaces Pi Coding Agent's default prompt. */
export function resolveAgentPiSessionSystemPrompt(resourcesRoot: string): string {
  const promptPath = path.join(
    path.resolve(resourcesRoot),
    "System",
    "Prompts",
    "Templates",
    `${AgentPiSessionSystemPromptTemplateName}.liquid`,
  );
  if (!existsSync(promptPath) || !statSync(promptPath).isFile()) {
    throw new Error(`Senera Pi session system prompt is missing: ${promptPath}`);
  }
  return promptPath;
}
