import path from "node:path";
import process from "node:process";
import readline from "node:readline/promises";
import { AgentLocalAdminAccountStore } from "../Source/AgentSystem/Auth/AgentLocalAdminAccount.js";

const DefaultAccountFile = ".senera/access/admin-account.json";

void main();

async function main(): Promise<void> {
  const command = process.argv[2];
  if (command !== "init" && command !== "reset-password") {
    throw new Error("用法：senera-admin-access <init|reset-password> [--workspace <path>] [--account-file <path>]");
  }

  const options = readOptions(process.argv.slice(3));
  const workspaceRoot = path.resolve(options.workspace ?? process.env.SENERA_WORKSPACE_ROOT?.trim() ?? process.cwd());
  const accountFile = path.resolve(
    workspaceRoot,
    options.accountFile ?? process.env.SENERA_ADMIN_ACCOUNT_FILE?.trim() ?? DefaultAccountFile,
  );
  const store = new AgentLocalAdminAccountStore(accountFile);
  const existing = store.read();

  if (command === "init" && existing) {
    throw new Error(`管理员账户已初始化：${accountFile}`);
  }
  if (command === "reset-password" && !existing) {
    throw new Error(`管理员账户尚未初始化：${accountFile}`);
  }

  const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const loginName = await promptValue(prompt, "登录用户名", existing?.loginName);
    const displayName = await promptValue(prompt, "显示名称", existing?.displayName);
    const password = await promptPassword("管理员密码");
    const confirmation = await promptPassword("确认管理员密码");
    if (password !== confirmation) {
      throw new Error("两次输入的密码不一致。");
    }

    const account =
      command === "init"
        ? await store.initialize({ loginName, displayName, password })
        : await store.resetPassword({ loginName, displayName, password });
    process.stdout.write(`管理员账户已${command === "init" ? "初始化" : "重置"}：${account.loginName}\n`);
    process.stdout.write(`账户文件：${accountFile}\n`);
  } finally {
    prompt.close();
  }
}

function readOptions(values: readonly string[]): { workspace?: string; accountFile?: string } {
  const result: { workspace?: string; accountFile?: string } = {};
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    const value = values[index + 1];
    if (!key || !value) {
      throw new Error("参数必须使用 --workspace <path> 或 --account-file <path> 的形式。");
    }
    if (key === "--workspace") {
      result.workspace = value;
      continue;
    }
    if (key === "--account-file") {
      result.accountFile = value;
      continue;
    }
    throw new Error(`未知参数：${key}`);
  }
  return result;
}

async function promptValue(prompt: readline.Interface, label: string, fallback?: string): Promise<string> {
  const value = (await prompt.question(`${label}${fallback ? ` [${fallback}]` : ""}：`)).trim();
  return value || fallback || "";
}

async function promptPassword(label: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("管理员密码初始化必须在交互式终端中执行。");
  }
  process.stdout.write(`${label}：`);
  process.stdin.setRawMode(true);
  process.stdin.resume();

  return new Promise<string>((resolve, reject) => {
    let value = "";
    const onData = (chunk: Buffer): void => {
      const input = chunk.toString("utf8");
      if (input === "\u0003") {
        cleanup();
        reject(new Error("已取消管理员密码输入。"));
        return;
      }
      if (input === "\r" || input === "\n") {
        cleanup();
        process.stdout.write("\n");
        resolve(value);
        return;
      }
      if (input === "\u0008" || input === "\u007f") {
        value = value.slice(0, -1);
        return;
      }
      value += input;
    };
    const cleanup = (): void => {
      process.stdin.off("data", onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
    };
    process.stdin.on("data", onData);
  });
}
