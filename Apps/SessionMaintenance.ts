import path from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";
import { z } from "zod";
import { resolvePersistenceConfig } from "../Source/AgentSystem/AgentDefaults.js";
import { AgentJsonFileLoader } from "../Source/AgentSystem/Config/AgentJsonFileLoader.js";
import { AgentSessionHistoryMaintenance } from "../Source/AgentSystem/SessionPersistence/AgentSessionHistoryMaintenance.js";

const argumentsSchema = {
  workspace: { type: "string" },
  config: { type: "string" },
  database: { type: "string" },
  "batch-size": { type: "string" },
  "max-transaction-mib": { type: "string" },
  apply: { type: "boolean", default: false },
  vacuum: { type: "boolean", default: false },
  output: { type: "string", default: "text" },
} as const;

const PersistencePathSchema = z
  .object({
    Defaults: z
      .object({
        Persistence: z
          .object({ DatabasePath: z.string().trim().min(1).optional() })
          .passthrough()
          .optional(),
      })
      .passthrough()
      .optional(),
    Persistence: z
      .object({ DatabasePath: z.string().trim().min(1).optional() })
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
  if (values.vacuum && !values.apply) throw new Error("--vacuum must be used with --apply.");
  const output = parseOutput(values.output);

  const workspaceRoot = path.resolve(values.workspace ?? process.cwd());
  const databasePath = resolveDatabasePath(workspaceRoot, values.config, values.database);
  const controller = new AbortController();
  const abort = (): void => controller.abort(new Error("Session maintenance was interrupted."));
  process.once("SIGINT", abort);
  process.once("SIGTERM", abort);
  try {
    const result = await new AgentSessionHistoryMaintenance().compact({
      databasePath,
      batchSize: parseBatchSize(values["batch-size"]),
      maxTransactionBytes: parseMebibytes(values["max-transaction-mib"]),
      dryRun: !values.apply,
      vacuum: values.vacuum,
      signal: controller.signal,
      onBatch:
        output === "json"
          ? undefined
          : (progress) => {
              process.stdout.write(
                `\rscanned=${progress.scannedEvents} rewritable=${progress.rewritableEvents} reclaimable=${formatBytes(progress.reclaimableBytes)}`,
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

function resolveDatabasePath(workspaceRoot: string, configuredPath?: string, explicitPath?: string): string {
  if (explicitPath) return path.resolve(workspaceRoot, explicitPath);
  const configPath = path.resolve(workspaceRoot, configuredPath ?? "senera.config.json");
  const config = new AgentJsonFileLoader().load(configPath, PersistencePathSchema);
  const databasePath =
    config.Persistence?.DatabasePath ??
    config.Defaults?.Persistence?.DatabasePath ??
    resolvePersistenceConfig({ ModelProviders: [] }).DatabasePath;
  return path.resolve(workspaceRoot, databasePath);
}

function parseBatchSize(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error("--batch-size must be a positive integer.");
  return parsed;
}

function parseMebibytes(value: string | undefined): number | undefined {
  const mebibytes = parsePositiveIntegerOption(value, "--max-transaction-mib");
  return mebibytes === undefined ? undefined : mebibytes * 1024 * 1024;
}

function parsePositiveIntegerOption(value: string | undefined, option: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${option} must be a positive integer.`);
  return parsed;
}

function parseOutput(value: string): "text" | "json" {
  if (value === "text" || value === "json") return value;
  throw new Error("--output must be text or json.");
}

function formatResult(result: Awaited<ReturnType<AgentSessionHistoryMaintenance["compact"]>>): string {
  const mode = result.dryRun ? "analysis" : "applied";
  return [
    `Session history maintenance ${mode}.`,
    `database: ${result.databasePath}`,
    `scanned Pi traces: ${result.scannedEvents}`,
    `rewritable traces: ${result.rewritableEvents}`,
    `rewritten traces: ${result.rewrittenEvents}`,
    `estimated reclaimable: ${formatBytes(result.reclaimableBytes)}`,
    `database size: ${formatBytes(result.databaseBytesBefore)} -> ${formatBytes(result.databaseBytesAfter)}`,
    `vacuumed: ${result.vacuumed}`,
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
