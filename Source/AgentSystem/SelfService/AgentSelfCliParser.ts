import { AgentSelfCommandSchema } from "./AgentSelfCommandSchema.js";
import {
  AgentSelfCommandRegistry,
  type AgentSelfCommandArgSpec,
  type AgentSelfCommandSpec,
} from "./AgentSelfCommandRegistry.js";
import type { AgentSelfCommand } from "./AgentSelfServiceTypes.js";

export interface AgentSelfCliPluginCommand {
  readonly command: string;
  readonly action?: string;
  readonly args: string[];
}

export type AgentSelfCliCommand = AgentSelfCommand | AgentSelfCliPluginCommand;

/** Parses the human CLI vocabulary from the same registry used by help text,
 * tool metadata, and runtime capability introspection. Unknown roots remain a
 * plugin envelope; known roots never fall through to an untyped command. */
export function parseAgentSelfCliCommand(args: readonly string[]): AgentSelfCliCommand {
  const [root, action, ...rest] = args;
  if (!root) throw new Error(`Unknown senera command: ${args.join(" ")}`);

  const candidates = AgentSelfCommandRegistry.filter((spec) => spec.command === root);
  if (candidates.length === 0) {
    return { command: root, action: action ?? undefined, args: rest };
  }

  const exact = candidates.find((spec) => (spec.action ?? undefined) === (action ?? undefined));
  const alias = candidates.find((spec) => spec.actionAliases?.includes(action ?? ""));
  const spec = exact ?? alias;
  if (!spec) {
    const kind = candidates.some((candidate) => candidate.action === undefined) ? "argument" : "action";
    throw new Error(`Unknown ${root} ${kind}: ${action ?? "(none)"}`);
  }

  const values = parsePositionalValues(spec, rest);
  return AgentSelfCommandSchema.parse({
    command: spec.command,
    ...(spec.action ? { action: spec.action } : {}),
    ...values,
  });
}

function parsePositionalValues(spec: AgentSelfCommandSpec, tokens: readonly string[]): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  let cursor = 0;
  for (let index = 0; index < spec.args.length; index += 1) {
    const argument = spec.args[index]!;
    if (!isArgumentApplicable(argument, values)) continue;
    const optional = argument.kind === "optional-string" || argument.kind === "optional-number";
    if (cursor >= tokens.length) {
      if (argument.kind === "nullable-string") values[argument.key] = null;
      else if (!optional) throw new Error(argument.missingMessage ?? `${spec.usage} requires ${argument.name}.`);
      continue;
    }

    const lastJson = argument.kind === "json" && index === spec.args.length - 1;
    const raw = lastJson ? tokens.slice(cursor).join(" ") : tokens[cursor];
    cursor = lastJson ? tokens.length : cursor + 1;
    values[argument.key] = parseArgumentValue(argument, raw);
  }
  if (cursor < tokens.length) {
    throw new Error(`Unexpected arguments for ${spec.usage}: ${tokens.slice(cursor).join(" ")}`);
  }
  return values;
}

function isArgumentApplicable(argument: AgentSelfCommandArgSpec, values: Readonly<Record<string, unknown>>): boolean {
  return (argument.appliesWhen ?? []).every(({ key, value }) => values[key] === value);
}

function parseArgumentValue(argument: AgentSelfCommandArgSpec, raw: string | undefined): unknown {
  if (raw === undefined || raw.trim() === "") {
    throw new Error(argument.missingMessage ?? `Argument ${argument.name} must not be empty.`);
  }
  if (argument.choices && !argument.choices.includes(raw)) {
    throw new Error(`Unknown ${argument.name} value: ${raw} (expected ${argument.choices.join(" or ")}).`);
  }
  if (argument.kind === "json") {
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return raw.trim();
    }
  }
  if (argument.kind !== "number" && argument.kind !== "optional-number") return raw;

  const value = Number(raw);
  const valid =
    Number.isSafeInteger(value) &&
    (argument.minimum === undefined || value >= argument.minimum) &&
    (argument.maximum === undefined || value <= argument.maximum);
  if (!valid) {
    const range = describeIntegerRange(argument);
    throw new Error(`${argument.invalidMessage ?? `Invalid ${argument.name.toLowerCase()}`}: "${raw}"${range}.`);
  }
  return value;
}

function describeIntegerRange(argument: AgentSelfCommandArgSpec): string {
  if (argument.minimum === 1 && argument.maximum === undefined) return "（需要正整数）";
  if (argument.minimum !== undefined && argument.maximum !== undefined) {
    return `（需要 ${argument.minimum}-${argument.maximum} 的整数）`;
  }
  if (argument.minimum !== undefined) return `（需要不小于 ${argument.minimum} 的整数）`;
  if (argument.maximum !== undefined) return `（需要不大于 ${argument.maximum} 的整数）`;
  return "";
}
