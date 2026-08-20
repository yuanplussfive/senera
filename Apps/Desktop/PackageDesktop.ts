import crossSpawn from "cross-spawn";
import process from "node:process";
import { isMainModule } from "../../Source/AgentSystem/Core/AgentPath.js";

const { sync: spawnSync } = crossSpawn;

interface CommandInvocation {
  command: string;
  arguments: string[];
}

const steps = [
  command("npm", ["run", "build"]),
  command("npm", ["--workspace", "senera-frontend", "run", "build"]),
  command("npm", ["run", "desktop.prepare-native"]),
  command("npm", ["run", "desktop.prepare-mcp-runtime"]),
  // Stable release publication is gated in the release workflow after all smoke checks.
  command("electron-builder", ["--publish", "never"]),
];

if (isMainModule(import.meta.url)) {
  process.exitCode = packageDesktop();
}

export function packageDesktop(): number {
  let exitCode = 0;
  for (const step of steps) {
    const result = run(step);
    if (result !== 0) {
      exitCode = result;
      break;
    }
  }
  return exitCode;
}

function run(invocation: CommandInvocation): number {
  process.stdout.write(`\n> ${[invocation.command, ...invocation.arguments].join(" ")}\n`);

  const result = spawnSync(invocation.command, invocation.arguments, {
    cwd: process.cwd(),
    stdio: "inherit",
    windowsHide: true,
  });

  if (result.error) {
    process.stderr.write(`${result.error.stack ?? result.error.message}\n`);
    return 1;
  }

  return result.status ?? 1;
}

function command(name: string, args: readonly string[] = []): CommandInvocation {
  return {
    command: name,
    arguments: [...args],
  };
}
