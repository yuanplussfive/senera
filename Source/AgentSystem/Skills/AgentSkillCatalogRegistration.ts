import type { AgentExtensionRegistry } from "../Extensions/AgentExtensionRegistry.js";
import type { AgentExtensionDiagnostic } from "../ManagedExtensions/AgentExtensionDiagnostic.js";
import { AgentSkillScanner } from "./AgentSkillScanner.js";

/** Shared discovery policy for execution and settings; invalid packages retain diagnostics. */
export function registerAgentSkillCatalog(
  registry: AgentExtensionRegistry,
  options: {
    readonly systemRoot: string;
    readonly workspaceRoot: string;
    readonly systemToolBindings: ReadonlyMap<string, readonly string[]>;
  },
): readonly AgentExtensionDiagnostic[] {
  const scanner = new AgentSkillScanner();
  const system = scanner.scanCatalog(options.systemRoot);
  const workspace = scanner.scanCatalog(options.workspaceRoot);
  for (const skill of system.skills) {
    registry.registerSkill({
      ...skill,
      source: { kind: "system", id: skill.name, displayName: "Senera", priority: 10 },
      recommendedTools: [
        ...new Set([...skill.recommendedTools, ...(options.systemToolBindings.get(skill.name) ?? [])]),
      ],
    });
  }
  for (const skill of workspace.skills) registry.registerSkill(skill);
  return [...system.diagnostics, ...workspace.diagnostics];
}
