import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";
import { AgentArtifactRetentionService } from "../Source/AgentSystem/Artifacts/AgentArtifactRetentionService.js";
import { loadConfigFile } from "../Source/AgentSystem/Config/AgentConfigService.js";
import { resolveArtifactsConfig } from "../Source/AgentSystem/Defaults/AgentAppDefaults.js";
import type { AgentSystemConfig } from "../Source/AgentSystem/Types/AgentSystemConfigTypes.js";

const argumentsSchema = {
  workspace: { type: "string" },
  config: { type: "string" },
  root: { type: "string" },
  apply: { type: "boolean", default: false },
  output: { type: "string", default: "text" },
} as const;

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const { values } = parseArgs({ options: argumentsSchema, allowPositionals: false });
  const output = parseOutput(values.output);
  const workspaceRoot = path.resolve(values.workspace ?? process.cwd());
  const config = loadConfiguredSystemConfig(workspaceRoot, values.config);
  const defaults = resolveArtifactsConfig(config);
  const artifactConfig = values.root === undefined ? defaults : { ...defaults, RootDir: values.root };
  const service = new AgentArtifactRetentionService({ workspaceRoot, config: () => artifactConfig });
  const report = values.apply ? await service.cleanup() : await service.inspect();
  process.stdout.write(output === "json" ? `${JSON.stringify(report, null, 2)}\n` : formatReport(report));
}

function loadConfiguredSystemConfig(workspaceRoot: string, configuredPath?: string): AgentSystemConfig {
  const configPath = path.resolve(workspaceRoot, configuredPath ?? "senera.config.json");
  return fs.existsSync(configPath) ? loadConfigFile(configPath) : { ModelProviders: [] };
}

function parseOutput(value: string): "text" | "json" {
  if (value === "text" || value === "json") return value;
  throw new Error("--output must be text or json.");
}

function formatReport(report: Awaited<ReturnType<AgentArtifactRetentionService["inspect"]>>): string {
  return [
    `Artifact maintenance ${report.dryRun ? "analysis" : "applied"}.`,
    `root: ${report.artifactRoot}`,
    `scanned artifacts: ${report.scannedArtifacts}`,
    `scanned incomplete directories: ${report.scannedIncompleteDirectories}`,
    `scanned spools: ${report.scannedSpools}`,
    `retained artifacts: ${report.retainedArtifacts}`,
    `retained incomplete directories: ${report.retainedIncompleteDirectories}`,
    `retained spools: ${report.retainedSpools}`,
    `retained bytes: ${formatBytes(report.retainedBytes)}`,
    `removed artifacts: ${report.removedArtifacts}`,
    `removed incomplete directories: ${report.removedIncompleteDirectories}`,
    `removed spools: ${report.removedSpools}`,
    `removed bytes: ${formatBytes(report.removedBytes)}`,
    "",
  ].join("\n");
}

function formatBytes(value: number): string {
  const units = ["B", "KiB", "MiB", "GiB"] as const;
  let amount = value;
  let unit = 0;
  while (amount >= 1024 && unit < units.length - 1) {
    amount /= 1024;
    unit += 1;
  }
  return `${amount.toFixed(unit === 0 ? 0 : 2)} ${units[unit]}`;
}
