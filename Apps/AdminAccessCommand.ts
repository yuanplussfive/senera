import { parseArgs } from "node:util";

export const AdminAccessCommandNames = ["init", "reset-password"] as const;
export const AdminAccessUsage = `用法：senera-admin-access <${AdminAccessCommandNames.join(
  "|",
)}> [--workspace <path>] [--account-file <path>]`;

export type AdminAccessCommandName = (typeof AdminAccessCommandNames)[number];

export interface AdminAccessInvocation {
  readonly command: AdminAccessCommandName;
  readonly workspace?: string;
  readonly accountFile?: string;
}

const AdminAccessOptions = {
  workspace: { type: "string" },
  "account-file": { type: "string" },
} as const;

export function parseAdminAccessInvocation(args: readonly string[]): AdminAccessInvocation {
  let parsed: ReturnType<typeof parseAdminAccessArguments>;
  try {
    parsed = parseAdminAccessArguments(args);
  } catch (error) {
    throw adminAccessArgumentError(error instanceof Error ? error.message : String(error), error);
  }

  if (parsed.positionals.length !== 1) {
    throw adminAccessArgumentError(`管理员命令必须且只能提供一个，实际收到：${JSON.stringify(parsed.positionals)}。`);
  }

  const command = parseAdminAccessCommand(parsed.positionals[0]);
  return {
    command,
    workspace: parsed.values.workspace,
    accountFile: parsed.values["account-file"],
  };
}

function parseAdminAccessArguments(args: readonly string[]) {
  return parseArgs({
    args: [...args],
    options: AdminAccessOptions,
    allowPositionals: true,
    strict: true,
  });
}

function parseAdminAccessCommand(value: string): AdminAccessCommandName {
  const normalized = value.trim();
  if (isAdminAccessCommand(normalized)) {
    return normalized;
  }
  throw adminAccessArgumentError(`不支持的管理员命令：${JSON.stringify(value)}。`);
}

function isAdminAccessCommand(value: string): value is AdminAccessCommandName {
  return AdminAccessCommandNames.some((command) => command === value);
}

function adminAccessArgumentError(message: string, cause?: unknown): TypeError {
  return new TypeError(`${message}\n${AdminAccessUsage}`, cause === undefined ? undefined : { cause });
}
