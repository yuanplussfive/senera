import { spawn } from "node:child_process";
import path from "node:path";
import { rgPath } from "@vscode/ripgrep";
import { resolveAsarUnpackedExecutablePath } from "../Core/AgentExecutablePath.js";
import { relativePathWithin } from "../Core/AgentPath.js";
import { listAgentWorkspaceNonContentRoots } from "../Core/AgentWorkspaceLayout.js";

const RipgrepDiscoveryRuleFileNames = new Set([".gitignore", ".ignore", ".rgignore"]);
const GitExcludePath = ".git/info/exclude";

/**
 * Owns the filesystem visibility contract for workspace file discovery. Ripgrep remains the source
 * of truth for nested ignore rules; callers never reinterpret ignore files themselves.
 */
export class AgentWorkspaceFileDiscovery {
  readonly root: string;

  constructor(workspaceRoot: string) {
    this.root = path.resolve(workspaceRoot);
  }

  discoverAll(signal?: AbortSignal): Promise<readonly string[]> {
    return this.discover(".", signal);
  }

  discoverAt(workspacePath: string, signal?: AbortSignal): Promise<readonly string[]> {
    const normalizedPath = normalizeWorkspacePath(workspacePath);
    if (normalizedPath === ".") return this.discoverAll(signal);
    if (!this.resolveWorkspacePath(normalizedPath)) return Promise.resolve([]);
    return this.discover(normalizedPath, signal);
  }

  isDiscoveryRulePath(workspacePath: string): boolean {
    const normalizedPath = normalizeWorkspacePath(workspacePath);
    return RipgrepDiscoveryRuleFileNames.has(path.posix.basename(normalizedPath)) || normalizedPath === GitExcludePath;
  }

  isObservablePath(workspacePath: string): boolean {
    const normalizedPath = normalizeWorkspacePath(workspacePath);
    if (this.isDiscoveryRulePath(normalizedPath)) return true;
    const absolutePath = this.resolveWorkspacePath(normalizedPath);
    return Boolean(
      absolutePath &&
      listAgentWorkspaceNonContentRoots(this.root).every(
        (nonContentRoot) => relativePathWithin(nonContentRoot, absolutePath) === undefined,
      ),
    );
  }

  watchIgnoredRoots(): readonly string[] {
    const controlPaths = [path.join(this.root, ...GitExcludePath.split("/"))];
    return listAgentWorkspaceNonContentRoots(this.root).filter((nonContentRoot) =>
      controlPaths.every((controlPath) => relativePathWithin(nonContentRoot, controlPath) === undefined),
    );
  }

  private discover(scope: string, signal?: AbortSignal): Promise<readonly string[]> {
    if (signal?.aborted) return Promise.reject(signal.reason ?? new Error("Workspace file discovery was aborted."));
    return new Promise((resolve, reject) => {
      const child = spawn(
        resolveAsarUnpackedExecutablePath(rgPath),
        [
          "--files",
          "--hidden",
          "--null",
          "--no-require-git",
          ...workspaceContentExclusionArguments(this.root, this.root),
          "--",
          scope,
        ],
        { cwd: this.root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
      );
      const files: string[] = [];
      let tail = Buffer.alloc(0);
      let diagnostic = "";
      let settled = false;

      const settle = (action: () => void): void => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener("abort", onAbort);
        action();
      };
      const onAbort = (): void => {
        child.kill();
        settle(() => reject(signal?.reason ?? new Error("Workspace file discovery was aborted.")));
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      child.stdout.on("data", (chunk: Buffer) => {
        const data = Buffer.concat([tail, chunk]);
        let offset = 0;
        for (let boundary = data.indexOf(0); boundary >= 0; boundary = data.indexOf(0, offset)) {
          const entry = normalizeWorkspacePath(data.subarray(offset, boundary).toString("utf8"));
          if (entry !== ".") files.push(entry);
          offset = boundary + 1;
        }
        tail = data.subarray(offset);
      });
      child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
        diagnostic += chunk;
      });
      child.once("error", (error) => settle(() => reject(error)));
      child.once("close", (code) => {
        if (signal?.aborted) {
          settle(() => reject(signal.reason ?? new Error("Workspace file discovery was aborted.")));
          return;
        }
        if (code !== 0 && code !== 1) {
          settle(() => reject(new Error(diagnostic.trim() || `Workspace discovery exited with code ${String(code)}.`)));
          return;
        }
        if (tail.length > 0) {
          const entry = normalizeWorkspacePath(tail.toString("utf8"));
          if (entry !== ".") files.push(entry);
        }
        settle(() => resolve(files));
      });
    });
  }

  private resolveWorkspacePath(workspacePath: string): string | undefined {
    const absolutePath = path.resolve(this.root, workspacePath);
    return relativePathWithin(this.root, absolutePath) === undefined ? undefined : absolutePath;
  }
}

/** Converts layout-owned private roots into independent ripgrep exclusions without altering caller globs. */
export function workspaceContentExclusionArguments(workspaceRoot: string, searchRoot: string): string[] {
  return workspaceContentExclusionGlobs(workspaceRoot, searchRoot).flatMap((glob) => ["--glob", `!${glob}`]);
}

export function workspaceContentExclusionGlobs(workspaceRoot: string, searchRoot: string): readonly string[] {
  const resolvedSearchRoot = path.resolve(searchRoot);
  return [
    ...new Set(
      listAgentWorkspaceNonContentRoots(workspaceRoot).flatMap((protectedRoot) => {
        const relative = path.relative(resolvedSearchRoot, path.resolve(protectedRoot));
        if (relative === "" || path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`)) {
          return [];
        }
        return [`${relative.split(path.sep).join("/")}/**`];
      }),
    ),
  ];
}

export function normalizeWorkspacePath(value: string): string {
  const normalized = value
    .replaceAll("\\", "/")
    .replace(/^\.\//u, "")
    .replace(/\/{2,}/gu, "/");
  return normalized || ".";
}
