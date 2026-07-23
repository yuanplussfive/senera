import readline from "node:readline";
import { parseArgs } from "node:util";

export const AdminAccessCommandNames = ["init", "reset-password"] as const;
export const AdminAccessUsage = `用法：senera-admin-access <${AdminAccessCommandNames.join(
  "|",
)}> [--workspace <path>] [--account-file <path>] [--login-name <name>] [--display-name <name>] [--password-stdin]`;

export type AdminAccessCommandName = (typeof AdminAccessCommandNames)[number];

interface AdminAccessInvocationBase {
  readonly command: AdminAccessCommandName;
  readonly workspace?: string;
  readonly accountFile?: string;
}

export type AdminAccessInvocation = AdminAccessInvocationBase &
  (
    | {
        readonly loginName?: string;
        readonly displayName?: string;
        readonly passwordStdin: false;
      }
    | {
        readonly loginName: string;
        readonly displayName: string;
        readonly passwordStdin: true;
      }
  );

const AdminAccessOptions = {
  workspace: { type: "string" },
  "account-file": { type: "string" },
  "login-name": { type: "string" },
  "display-name": { type: "string" },
  "password-stdin": { type: "boolean" },
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
  const passwordStdin = parsed.values["password-stdin"] ?? false;
  const loginName = parsed.values["login-name"];
  const displayName = parsed.values["display-name"];
  const base = {
    command,
    workspace: parsed.values.workspace,
    accountFile: parsed.values["account-file"],
  };
  if (passwordStdin) {
    if (!loginName?.trim() || !displayName?.trim()) {
      throw adminAccessArgumentError("--password-stdin 必须同时提供 --login-name 和 --display-name。");
    }
    return {
      ...base,
      loginName,
      displayName,
      passwordStdin: true,
    };
  }
  return {
    ...base,
    loginName,
    displayName,
    passwordStdin: false,
  };
}

export async function readAdminAccessPassword(input: NodeJS.ReadableStream): Promise<string> {
  const lines = readline.createInterface({ input, crlfDelay: Infinity, terminal: false });
  let password: string | undefined;
  try {
    for await (const line of lines) {
      if (password !== undefined) {
        throw new Error("--password-stdin 只能接收一行密码。");
      }
      password = line;
    }
  } finally {
    lines.close();
  }
  if (password === undefined) {
    throw new Error("--password-stdin 未收到密码。");
  }
  return password;
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
