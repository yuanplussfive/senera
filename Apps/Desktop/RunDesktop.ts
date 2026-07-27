import { sync as spawnSync } from "cross-spawn";
import process from "node:process";
import { DesktopNativeModuleMaintenance } from "../../Build/DesktopNativeModuleMaintenance.js";

interface CommandInvocation {
  command: string;
  arguments: string[];
}

const steps = [
  command("npm", ["run", "build"]),
  command("npm", ["--workspace", "senera-frontend", "run", "build"]),
  command("electron-builder", ["install-app-deps", "--platform=win32", "--arch=x64"]),
  command("electron", ["Dist/Apps/Desktop/Main.js"]),
];

void runDesktop().then(
  (exitCode) => {
    process.exitCode = exitCode;
  },
  (error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  },
);

async function runDesktop(): Promise<number> {
  const nativeMaintenance = new DesktopNativeModuleMaintenance(process.cwd());
  let exitCode = 0;
  await nativeMaintenance.clearRebuildMetadata();
  try {
    for (const step of steps) {
      const result = run(step);
      if (result !== 0) {
        exitCode = result;
        break;
      }
    }
  } finally {
    await nativeMaintenance.restoreNodeCompatibility();
  }
  return exitCode;
}

function run(invocation: CommandInvocation): number {
  console.log(`\n> ${[invocation.command, ...invocation.arguments].join(" ")}`);

  const result = spawnSync(invocation.command, invocation.arguments, {
    cwd: process.cwd(),
    stdio: "inherit",
    windowsHide: true,
  });

  if (result.error) {
    console.error(result.error);
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
