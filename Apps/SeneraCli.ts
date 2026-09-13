#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { isMainModule } from "../Source/AgentSystem/Core/AgentPath.js";
import { AgentUpgradeJournal } from "../Source/AgentSystem/Upgrade/AgentUpgradeJournal.js";
import { rollbackAgentUpgrade } from "../Source/AgentSystem/Upgrade/AgentUpgradeSession.js";
import { errorMessage } from "../Source/AgentSystem/Core/AgentErrors.js";
import type {
  AgentSelfCommand,
  AgentSelfCommandOutput,
} from "../Source/AgentSystem/SelfService/AgentSelfServiceTypes.js";
import { executeSeneraSelfCommandViaHttp, SeneraSelfServiceOfflineError } from "./SeneraCliHttpClient.js";
import { renderAgentSelfCliHelp } from "../Source/AgentSystem/SelfService/AgentSelfCommandRegistry.js";
import {
  parseAgentSelfCliCommand,
  type AgentSelfCliPluginCommand,
} from "../Source/AgentSystem/SelfService/AgentSelfCliParser.js";

/** Raw trailing arguments envelope for a plugin-registered `senera` command.
 * Known roots parse into the strict schema; everything else is dispatched to
 * the live service, which resolves plugin commands against the running host. */
export type SeneraCliPluginCommand = AgentSelfCliPluginCommand;
export type SeneraCliSelfCommand = AgentSelfCommand | SeneraCliPluginCommand;

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
  | {
      command: "self";
      self: SeneraCliSelfCommand;
      workspaceRoot: string;
      json: boolean;
      yes: boolean;
      no: boolean;
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
  // Every remaining root is a self-service command. Known roots parse into the
  // strict schema; unknown roots become a plugin command envelope that the
  // live service resolves against its plugin registry — a typo or a
  // plugin-less command fails there with a deterministic error.
  const self = parseSeneraSelfCommand(stripCliOptions(args));
  const yes = args.includes("--yes");
  const no = args.includes("--no");
  if (yes && no) throw new Error("--yes and --no cannot be used together.");
  return { command: "self", self, workspaceRoot, json, yes, no };
}

const SeneraCliValueOptions = ["--workspace", "--state-root", "--data-root", "--upgrade"];

const SeneraCliFlagOptions = new Set(["--json", "--yes", "--no"]);

function stripCliOptions(args: readonly string[]): string[] {
  const positional: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument.startsWith("--")) {
      const valueOption = SeneraCliValueOptions.find((name) => argument === name || argument.startsWith(`${name}=`));
      if (valueOption) {
        if (argument === valueOption) index += 1;
        continue;
      }
      if (SeneraCliFlagOptions.has(argument)) continue;
      throw new Error(`Unknown Senera option: ${argument}`);
    }
    positional.push(argument);
  }
  return positional;
}

export function parseSeneraSelfCommand(args: readonly string[]): SeneraCliSelfCommand {
  return parseAgentSelfCliCommand(args);
}

export function runSeneraCli(invocation: SeneraCliInvocation): void {
  if (invocation.command === "help") {
    process.stdout.write(
      [
        "Local upgrade commands:",
        "  senera upgrade status [--workspace PATH] [--state-root PATH] [--json]",
        "  senera rollback --yes [--upgrade ID] [--workspace PATH] [--state-root PATH] [--data-root PATH] [--json]",
        "",
      ].join("\n") + renderAgentSelfCliHelp(),
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
  if (invocation.command === "self") {
    void runSeneraSelfCommand(invocation);
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

async function runSeneraSelfCommand(invocation: Extract<SeneraCliInvocation, { command: "self" }>): Promise<void> {
  try {
    let output = await executeSeneraSelfCommandViaHttp(invocation.workspaceRoot, invocation.self);
    if (output.approvalRequired) {
      const decision = await decideSeneraApproval(invocation, output.approvalRequired);
      if (decision === "skip") {
        writeResult(
          {
            ok: false,
            error: "approval_required",
            approvalRequired: output.approvalRequired,
          },
          true,
        );
        process.exitCode = 1;
        return;
      }
      if (decision === "deny") {
        if (invocation.json) {
          writeResult({ ok: false, error: "approval_denied", approvalId: output.approvalRequired.approvalId }, true);
        } else {
          process.stdout.write("已拒绝该操作，命令未执行。\n");
        }
        process.exitCode = 1;
        return;
      }
      output = await executeSeneraSelfCommandViaHttp(invocation.workspaceRoot, {
        command: "approval",
        action: "resolve",
        approvalId: output.approvalRequired.approvalId,
        decision: "approve",
      });
    }
    if (invocation.json) {
      writeResult(
        {
          ok: output.ok,
          ...(output.data !== undefined ? { data: output.data } : {}),
          ...(output.error ? { error: output.error } : {}),
        },
        true,
      );
      return;
    }
    process.stdout.write(`${output.text}\n`);
    if (!output.ok) process.exitCode = 1;
  } catch (error) {
    if (error instanceof SeneraSelfServiceOfflineError) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
      return;
    }
    process.stderr.write(`${errorMessage(error)}\n`);
    process.exitCode = 1;
  }
}

async function decideSeneraApproval(
  invocation: Extract<SeneraCliInvocation, { command: "self" }>,
  required: NonNullable<AgentSelfCommandOutput["approvalRequired"]>,
): Promise<"approve" | "deny" | "skip"> {
  if (invocation.yes) return "approve";
  if (invocation.no) return "deny";
  if (invocation.json) return "skip";
  if (!process.stdin.isTTY) {
    throw new Error("该操作需要审批，但当前不是交互终端。请使用 --json --yes 显式批准，或 --json --no 拒绝。");
  }
  process.stderr.write(
    [`该操作需要审批: ${required.reason}`, `命令: ${describeApprovalCommand(required)}`, "是否继续? [Y/n] "].join("\n"),
  );
  const answer = (await readLineStdin()).trim().toLowerCase();
  if (answer === "n" || answer === "no") return "deny";
  if (answer === "" || answer === "y" || answer === "yes") return "approve";
  throw new Error(`无法识别的确认输入: "${answer}"（请输入 y 或 n）。`);
}

function describeApprovalCommand(required: NonNullable<AgentSelfCommandOutput["approvalRequired"]>): string {
  const command = required.command;
  if (command.command === "config" && command.action === "update") {
    return `senera config update ${command.path} ${JSON.stringify(command.value)}`;
  }
  if (command.command === "config" && command.action === "rollback") {
    return `senera config rollback ${command.revision}`;
  }
  return JSON.stringify(command);
}

function readLineStdin(): Promise<string> {
  return new Promise((resolve) => {
    let buffer = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk: string) => {
      buffer += chunk;
      const newline = buffer.indexOf("\n");
      if (newline >= 0) {
        process.stdin.pause();
        resolve(buffer.slice(0, newline));
      }
    });
    process.stdin.on("end", () => resolve(buffer));
  });
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
