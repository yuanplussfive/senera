import path from "node:path";
import { spawn } from "node:child_process";
import { rgPath } from "@vscode/ripgrep";
import fuzzysort from "fuzzysort";
import { resolveAsarUnpackedExecutablePath } from "../Core/AgentExecutablePath.js";
import { listAgentWorkspaceNonContentRoots } from "../Core/AgentWorkspaceLayout.js";

/** Names-only index. Ripgrep owns nested ignore rules; notifications invalidate its snapshot. */
export class AgentWorkspacePathIndex {
  private files?: readonly string[];
  private building?: Promise<readonly string[]>;
  private generation = 0;
  private indexedGeneration = -1;
  constructor(private readonly root: string) {}
  invalidate(_paths: readonly string[]): void {
    this.generation += 1;
  }
  async search(query: string): Promise<readonly string[]> {
    while (!this.files || this.indexedGeneration !== this.generation) {
      if (!this.building) {
        const generation = this.generation;
        this.building = this.scan()
          .then((files) => {
            this.files = files;
            this.indexedGeneration = generation;
            return files;
          })
          .finally(() => {
            this.building = undefined;
          });
      }
      await this.building;
    }
    return fuzzysort.go(query, this.files).map((result) => result.target);
  }
  private scan(): Promise<readonly string[]> {
    const excludes = listAgentWorkspaceNonContentRoots(this.root).flatMap((root) => [
      "--glob",
      `!${path.relative(this.root, root).split(path.sep).join("/")}/**`,
    ]);
    return new Promise((resolve, reject) => {
      const process = spawn(
        resolveAsarUnpackedExecutablePath(rgPath),
        ["--files", "--hidden", "--null", "--no-require-git", ...excludes],
        { cwd: this.root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
      );
      const files: string[] = [];
      let tail = Buffer.alloc(0);
      let diagnostic = "";
      process.stdout.on("data", (chunk: Buffer) => {
        const data = Buffer.concat([tail, chunk]);
        let start = 0;
        for (let index = data.indexOf(0); index >= 0; index = data.indexOf(0, start)) {
          files.push(data.subarray(start, index).toString("utf8").split(path.sep).join("/"));
          start = index + 1;
        }
        tail = data.subarray(start);
      });
      process.stderr.setEncoding("utf8").on("data", (chunk: string) => {
        diagnostic += chunk;
      });
      process.once("error", reject);
      process.once("close", (code) => {
        if (code !== 0 && code !== 1) reject(new Error(diagnostic || `Workspace indexing exited with code ${code}.`));
        else {
          if (tail.length > 0) files.push(tail.toString("utf8").split(path.sep).join("/"));
          resolve(files);
        }
      });
    });
  }
}
