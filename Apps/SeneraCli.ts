#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { isMainModule } from "../Source/AgentSystem/Core/AgentPath.js";
import { AgentUpgradeJournal } from "../Source/AgentSystem/Upgrade/AgentUpgradeJournal.js";
import { rollbackAgentUpgrade } from "../Source/AgentSystem/Upgrade/AgentUpgradeSession.js";
import { errorMessage } from "../Source/AgentSystem/Core/AgentErrors.js";

export type SeneraCliInvocation =
  | {
      command: "upgrade-status";
      workspaceRoot: string;
      stateRoot?: string;
      json: boolean;
    }
  | {
      command: "rollback";
      workspaceRoot: string;
      stateRoot?: string;
      dataRoots: string[];
      upgradeId?: string;
      confirmed: boolean;
      json: boolean;
    }
  | { command: "help" };

export function parseSeneraCliInvocation(
  args: readonly string[],
  environment: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
): SeneraCliInvocation {
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) return { command: "help" };
  const command = args[0];
  const subcommand = args[1];
  const workspaceRoot = path.resolve(readOption(args, "--workspace") ?? environment.SENERA_WORKSPACE_ROOT ?? cwd);
  const stateRootValue = readOption(args, "--state-root");
  const stateRoot = stateRootValue ? path.resolve(workspaceRoot, stateRootValue) : undefined;
  const json = args.includes("--json");

  if (command === "upgrade" && subcommand === "status") {
    assertKnownArguments(args.slice(2), ["--workspace", "--state-root"], ["--json"]);
    return { command: "upgrade-status", workspaceRoot, stateRoot, json };
  }
  if (command === "rollback") {
    assertKnownArguments(
      args.slice(1),
      ["--workspace", "--state-root", "--data-root", "--upgrade"],
      ["--yes", "--json"],
    );
    return {
      command: "rollback",
      workspaceRoot,
      stateRoot,
      dataRoots: readOptions(args, "--data-root").map((root) => path.resolve(workspaceRoot, root)),
      upgradeId: readOption(args, "--upgrade"),
      confirmed: args.includes("--yes"),
      json,
    };
  }
  throw new Error(`Unknown Senera command: ${args.join(" ")}`);
}

export function runSeneraCli(invocation: SeneraCliInvocation): void {
  if (invocation.command === "help") {
    process.stdout.write(
      [
        "Usage:",
        "  senera upgrade status [--workspace PATH] [--state-root PATH] [--json]",
        "  senera rollback --yes [--upgrade ID] [--workspace PATH] [--state-root PATH] [--data-root PATH] [--json]",
        "",
      ].join("\n"),
    );
    return;
  }
  if (invocation.command === "upgrade-status") {
    const journal = new AgentUpgradeJournal(invocation.stateRoot ?? path.join(invocation.workspaceRoot, ".senera"));
    const report = {
      runtime: journal.readRuntimeMarker() ?? null,
      upgrades: journal.listManifests(),
    };
    writeResult(report, invocation.json);
    return;
  }
  if (!invocation.confirmed) {
    throw new Error("Rollback changes persistent data. Re-run with --yes after stopping every Senera process.");
  }
  const manifest = rollbackAgentUpgrade({
    workspaceRoot: invocation.workspaceRoot,
    stateRoot: invocation.stateRoot,
    allowedDataRoots: invocation.dataRoots,
    upgradeId: invocation.upgradeId,
  });
  writeResult(
    {
      upgradeId: manifest.upgradeId,
      status: manifest.status,
      restoredRuntime: manifest.source,
      retainedFailedState: path.join(
        invocation.stateRoot ?? path.join(invocation.workspaceRoot, ".senera"),
        "upgrades",
        manifest.upgradeId,
        "failed-state",
      ),
    },
    invocation.json,
  );
}

function writeResult(value: unknown, json: boolean): void {
  if (json) {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
    return;
  }
  process.stdout.write(`${formatHumanResult(value)}\n`);
}

function formatHumanResult(value: unknown): string {
  if (!value || typeof value !== "object") return String(value);
  return Object.entries(value)
    .map(([key, item]) => `${key}: ${typeof item === "object" ? JSON.stringify(item) : String(item)}`)
    .join("\n");
}

function readOption(args: readonly string[], name: string): string | undefined {
  return readOptions(args, name).at(-1);
}

function readOptions(args: readonly string[], name: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument.startsWith(`${name}=`)) {
      values.push(requireOptionValue(name, argument.slice(name.length + 1)));
      continue;
    }
    if (argument !== name) continue;
    values.push(requireOptionValue(name, args[index + 1]));
    index += 1;
  }
  return values;
}

function requireOptionValue(name: string, value: string | undefined): string {
  const normalized = value?.trim();
  if (!normalized || normalized.startsWith("--")) throw new Error(`${name} requires a value.`);
  return normalized;
}

function assertKnownArguments(
  args: readonly string[],
  valueOptions: readonly string[],
  flags: readonly string[],
): void {
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (flags.includes(argument)) continue;
    const option = valueOptions.find((name) => argument === name || argument.startsWith(`${name}=`));
    if (!option) throw new Error(`Unknown Senera option: ${argument}`);
    if (argument === option) index += 1;
  }
}

if (isMainModule(import.meta.url)) {
  try {
    runSeneraCli(parseSeneraCliInvocation(process.argv.slice(2)));
  } catch (error) {
    process.stderr.write(`${errorMessage(error)}\n`);
    process.exitCode = 1;
  }
}
