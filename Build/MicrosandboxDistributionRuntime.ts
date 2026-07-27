import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  createAgentMicrosandboxCli,
  createAgentMicrosandboxImageArchive,
  type AgentMicrosandboxCli,
  type AgentMicrosandboxPackageEntryResolver,
} from "../Source/AgentSystem/Sandbox/AgentMicrosandboxCli.js";

export interface MicrosandboxDistributionRuntime {
  prepareImage(input: {
    baseDir: string;
    reference: string;
    sandboxName: string;
    pullPolicy: "if-missing" | "never";
    probe: MicrosandboxDistributionProbe;
  }): Promise<void>;
  saveOciImage(input: { baseDir: string; reference: string; outputPath: string }): Promise<void>;
  loadOciImage(input: {
    baseDir: string;
    archivePath: string;
    reference: string;
    compression: "gzip";
    expectedUncompressedBytes: number;
    maxUncompressedBytes: number;
  }): Promise<void>;
}

export interface MicrosandboxDistributionProbe {
  command: string;
  arguments: readonly string[];
}

export interface MicrosandboxDistributionRuntimeOptions {
  workspaceRoot: string;
  cli?: AgentMicrosandboxCli;
  packageEntryResolver?: AgentMicrosandboxPackageEntryResolver;
  log?: (message: string) => void;
}

export function createMicrosandboxDistributionRuntime(
  options: MicrosandboxDistributionRuntimeOptions,
): MicrosandboxDistributionRuntime {
  const log = options.log ?? (() => undefined);
  const cli =
    options.cli ??
    createAgentMicrosandboxCli({
      cwd: options.workspaceRoot,
      packageEntryResolver: options.packageEntryResolver,
    });
  const imageArchive = createAgentMicrosandboxImageArchive(cli);
  const run = async (baseDir: string, arguments_: readonly string[]) => {
    await mkdir(baseDir, { recursive: true });
    await cli.run(baseDir, arguments_);
  };

  return {
    async prepareImage(input) {
      log(`Preparing sandbox image ${input.reference} with pull policy ${input.pullPolicy}...`);
      if (input.pullPolicy === "if-missing") {
        await run(input.baseDir, ["image", "pull", "--quiet", input.reference]);
      }
      await run(input.baseDir, [
        "run",
        "--quiet",
        "--pull",
        "never",
        "--name",
        input.sandboxName,
        "--replace",
        "--no-net",
        "--cpus",
        "1",
        "--memory",
        "256M",
        "--max-duration",
        "60s",
        input.reference,
        "--",
        input.probe.command,
        ...input.probe.arguments,
      ]);
    },

    async saveOciImage(input) {
      await mkdir(path.dirname(input.outputPath), { recursive: true });
      log(`Saving sandbox image ${input.reference} as a portable OCI archive...`);
      await imageArchive.save(input);
    },

    async loadOciImage(input) {
      log(`Loading compressed Sandbox Bundle as ${input.reference}...`);
      await imageArchive.load({
        ...input,
      });
    },
  };
}
