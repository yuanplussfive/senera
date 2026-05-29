import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

export interface AgentEnvironmentOptions {
  workspaceRoot: string;
  files?: string[];
}

export class AgentEnvironment {
  static load(options: AgentEnvironmentOptions): void {
    const files = options.files ?? [".env.local", ".env"];

    for (const file of files) {
      const envPath = path.resolve(options.workspaceRoot, file);
      if (!fs.existsSync(envPath)) {
        continue;
      }

      dotenv.config({
        path: envPath,
        override: false,
        quiet: true,
      });
    }
  }
}
