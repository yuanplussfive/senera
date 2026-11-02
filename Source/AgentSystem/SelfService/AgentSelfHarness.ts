import { listAgentSelfCommandSpecs } from "./AgentSelfCommandRegistry.js";

export interface AgentSelfHarnessDisclosure {
  readonly protocol: "senera.harness/v2";
  readonly tool: "ShellCommandTool";
  readonly command: "senera";
  readonly executionTarget: "Local";
  readonly domains: readonly string[];
  readonly discovery: "capabilities DOMAIN [ACTION] --json";
  readonly skillRead: "senera skills read NAME SKILL.md";
  readonly workflow: "read -> smallest command -> verify";
}

/** Only the entry point is resident. Commands and schemas are read on demand. */
export function projectAgentSelfHarnessDisclosure(): AgentSelfHarnessDisclosure {
  return {
    protocol: "senera.harness/v2",
    tool: "ShellCommandTool",
    command: "senera",
    executionTarget: "Local",
    domains: [...new Set(listAgentSelfCommandSpecs().map((spec) => spec.command))].sort(),
    discovery: "capabilities DOMAIN [ACTION] --json",
    skillRead: "senera skills read NAME SKILL.md",
    workflow: "read -> smallest command -> verify",
  };
}
