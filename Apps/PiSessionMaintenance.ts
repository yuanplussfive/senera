import path from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";
import { z } from "zod";
import { resolveAgentLoopConfig } from "../Source/AgentSystem/AgentDefaults.js";
import { AgentJsonFileLoader } from "../Source/AgentSystem/Config/AgentJsonFileLoader.js";
import { AgentPiSessionHistoryMaintenance } from "../Source/AgentSystem/Pi/AgentPiSessionHistoryMaintenance.js";

const argumentsSchema = {
  workspace: { type: "string" },
  config: { type: "string" },
  root: { type: "string" },
  apply: { type: "boolean", default: false },
  output: { type: "string", default: "text" },
} as const;

const PiSessionsPathSchema = z
  .object({
    Defaults: z
      .object({
        AgentLoop: z
          .object({
            PiSessions: z
              .object({ RootDir: z.string().trim().min(1).optional() })
              .passthrough()
              .optional(),
          })
          .passthrough()
          .optional(),
      })
      .passthrough()
      .optional(),
    AgentLoop: z
      .object({
        PiSessions: z
          .object({ RootDir: z.string().trim().min(1).optional() })
          .passthrough()
          .optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const { values } = parseArgs({ options: argumentsSchema, allowPositionals: false });
  const output = parseOutput(values.output);
  const workspaceRoot = path.resolve(values.workspace ?? process.cwd());
  const sessionsRoot = resolveSessionsRoot(workspaceRoot, values.config, values.root);
  const controller = new AbortController();
  const abort = (): void => controller.abort(new Error("Pi session maintenance was interrupted."));
  process.once("SIGINT", abort);
  process.once("SIGTERM", abort);
  try {
    const result = await new AgentPiSessionHistoryMaintenance().compact({
      sessionsRoot,
      dryRun: !values.apply,
      signal: controller.signal,
      onFile:
        output === "json"
          ? undefined
          : (progress) => {
              process.stdout.write(
                `\rfiles=${progress.scannedFiles} entries=${progress.scannedEntries} rewritable=${progress.rewritableEntries} reclaimable=${formatBytes(progress.reclaimableBytes)}`,
              );
            },
    });
    if (output === "text") process.stdout.write("\n");
    process.stdout.write(output === "json" ? `${JSON.stringify(result, null, 2)}\n` : formatResult(result));
  } finally {
    process.off("SIGINT", abort);
    process.off("SIGTERM", abort);
  }
}

function resolveSessionsRoot(workspaceRoot: string, configuredPath?: string, explicitRoot?: string): string {
  if (explicitRoot) return path.resolve(workspaceRoot, explicitRoot);
  const configPath = path.resolve(workspaceRoot, configuredPath ?? "senera.config.json");
  const config = new AgentJsonFileLoader().load(configPath, PiSessionsPathSchema);
  return path.resolve(
    workspaceRoot,
    config.AgentLoop?.PiSessions?.RootDir ??
      config.Defaults?.AgentLoop?.PiSessions?.RootDir ??
      resolveAgentLoopConfig({ ModelProviders: [] }).PiSessions.RootDir,
  );
}

function parseOutput(value: string): "text" | "json" {
  if (value === "text" || value === "json") return value;
  throw new Error("--output must be text or json.");
}

function formatResult(result: Awaited<ReturnType<AgentPiSessionHistoryMaintenance["compact"]>>): string {
  return [
    `Pi session history maintenance ${result.dryRun ? "analysis" : "applied"}.`,
    `root: ${result.sessionsRoot}`,
    `scanned files: ${result.scannedFiles}`,
    `rewritable files: ${result.rewritableFiles}`,
    `rewritable entries: ${result.rewritableEntries}`,
    `rewritten entries: ${result.rewrittenEntries}`,
    `invalid entries: ${result.invalidEntries}`,
    `reclaimable: ${formatBytes(result.reclaimableBytes)}`,
    `session bytes: ${formatBytes(result.bytesBefore)} -> ${formatBytes(result.bytesAfter)}`,
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
