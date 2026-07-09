import fs from "node:fs";
import path from "node:path";
import type { AgentRootCommand } from "../AgentRootCommand.js";
import { moduleDirPath } from "../Core/AgentPath.js";

interface AgentPiRootCommandPolicy {
  OutputMode: AgentRootCommand["outputMode"];
  ForbiddenOutputs: {
    Add: string[];
    Remove: string[];
  };
  IncludeToolCatalog: boolean;
  VisibleOutput: {
    Audience: string;
    Start: string;
    Format: string;
    Rules: Array<{
      Name: string;
      Value: string;
      Instruction?: string;
    }>;
    Repair: {
      Instruction: string;
      Rules: Array<{
        Name: string;
        Value: string;
        Instruction?: string;
      }>;
    };
  };
}

const PiRootCommandPolicy = readPiRootCommandPolicy();

export function projectPiToolAgentRootCommand(rootCommand: AgentRootCommand): AgentRootCommand {
  return {
    ...rootCommand,
    outputMode: PiRootCommandPolicy.OutputMode,
    forbiddenOutputs: mergeUnique(
      rootCommand.forbiddenOutputs,
      PiRootCommandPolicy.ForbiddenOutputs.Add,
    ).filter((item) => !PiRootCommandPolicy.ForbiddenOutputs.Remove.includes(item)),
    includeToolCatalog: PiRootCommandPolicy.IncludeToolCatalog,
    visibleOutput: {
      ...rootCommand.visibleOutput,
      audience: PiRootCommandPolicy.VisibleOutput.Audience,
      start: PiRootCommandPolicy.VisibleOutput.Start,
      format: PiRootCommandPolicy.VisibleOutput.Format,
      rules: PiRootCommandPolicy.VisibleOutput.Rules.map(projectRule),
      repair: {
        instruction: PiRootCommandPolicy.VisibleOutput.Repair.Instruction,
        rules: PiRootCommandPolicy.VisibleOutput.Repair.Rules.map(projectRule),
      },
    },
  };
}

function readPiRootCommandPolicy(): AgentPiRootCommandPolicy {
  return JSON.parse(
    fs.readFileSync(
      path.join(moduleDirPath(import.meta.url), "AgentPiRootCommandPolicy.json"),
      "utf8",
    ),
  ) as AgentPiRootCommandPolicy;
}

function projectRule(
  value: AgentPiRootCommandPolicy["VisibleOutput"]["Rules"][number],
): AgentRootCommand["visibleOutput"]["rules"][number] {
  return {
    name: value.Name,
    value: value.Value,
    instruction: value.Instruction,
  };
}

function mergeUnique<T>(left: readonly T[], right: readonly T[]): T[] {
  return [...new Set([...left, ...right])];
}
