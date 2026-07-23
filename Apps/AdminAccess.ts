import path from "node:path";
import process from "node:process";
import readline from "node:readline/promises";
import {
  type AgentLocalAdminAccount,
  type AgentLocalAdminAccountInput,
  AgentLocalAdminAccountStore,
} from "../Source/AgentSystem/Auth/AgentLocalAdminAccount.js";
import {
  type AdminAccessInvocation,
  parseAdminAccessInvocation,
  readAdminAccessPassword,
} from "./AdminAccessCommand.js";

const DefaultAccountFile = ".senera/access/admin-account.json";

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const invocation = parseAdminAccessInvocation(process.argv.slice(2));
  const workspaceRoot = path.resolve(
    invocation.workspace ?? process.env.SENERA_WORKSPACE_ROOT?.trim() ?? process.cwd(),
  );
  const accountFile = path.resolve(
    workspaceRoot,
    invocation.accountFile ?? process.env.SENERA_ADMIN_ACCOUNT_FILE?.trim() ?? DefaultAccountFile,
  );
  const store = new AgentLocalAdminAccountStore(accountFile);
  const existing = store.read();

  if (invocation.command === "init" && existing) {
    throw new Error(`管理员账户已初始化：${accountFile}`);
  }
  if (invocation.command === "reset-password" && !existing) {
    throw new Error(`管理员账户尚未初始化：${accountFile}`);
  }

  const input = await readAccountInput(invocation, existing);
  const account = invocation.command === "init" ? await store.initialize(input) : await store.resetPassword(input);
  process.stdout.write(`管理员账户已${invocation.command === "init" ? "初始化" : "重置"}：${account.loginName}\n`);
  process.stdout.write(`账户文件：${accountFile}\n`);
}

async function readAccountInput(
  invocation: AdminAccessInvocation,
  existing: AgentLocalAdminAccount | undefined,
): Promise<AgentLocalAdminAccountInput> {
  if (invocation.passwordStdin) {
    return {
      loginName: invocation.loginName,
      displayName: invocation.displayName,
      password: await readAdminAccessPassword(process.stdin),
    };
  }

  const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    return {
      loginName: await promptValue(prompt, "登录用户名", invocation.loginName ?? existing?.loginName),
      displayName: await promptValue(prompt, "显示名称", invocation.displayName ?? existing?.displayName),
      password: await promptConfirmedPassword(),
    };
  } finally {
    prompt.close();
  }
}

async function promptConfirmedPassword(): Promise<string> {
  const password = await promptPassword("管理员密码");
  const confirmation = await promptPassword("确认管理员密码");
  if (password !== confirmation) {
    throw new Error("两次输入的密码不一致。");
  }
  return password;
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
