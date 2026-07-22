import fs from "node:fs";
import path from "node:path";

export interface AgentMcpRuntimeModuleResolution {
  readonly entryPath: string;
  readonly nodeImports: readonly string[];
}

export interface AgentMcpRuntimeModuleResolver {
  resolve(modulePath: string): AgentMcpRuntimeModuleResolution;
}

export function createCompiledAgentMcpRuntimeModuleResolver(applicationRoot: string): AgentMcpRuntimeModuleResolver {
  const compiledRoot = path.resolve(applicationRoot, "Dist");
  return {
    resolve(modulePath) {
      const entryPath = resolveRuntimeModulePath(compiledRoot, modulePath, "compiled");
      assertRuntimeModuleExists(entryPath, "compiled");
      return { entryPath, nodeImports: [] };
    },
  };
}

export function createSourceAgentMcpRuntimeModuleResolver(sourceRoot: string): AgentMcpRuntimeModuleResolver {
  const resolvedSourceRoot = path.resolve(sourceRoot);
  return {
    resolve(modulePath) {
      const entryPath = resolveRuntimeModulePath(resolvedSourceRoot, sourceModulePath(modulePath), "source");
      assertRuntimeModuleExists(entryPath, "source");
      return { entryPath, nodeImports: ["tsx"] };
    },
  };
}

function sourceModulePath(modulePath: string): string {
  return modulePath.endsWith(".js") ? `${modulePath.slice(0, -3)}.ts` : modulePath;
}

function resolveRuntimeModulePath(root: string, modulePath: string, kind: "compiled" | "source"): string {
  if (!modulePath || path.isAbsolute(modulePath)) {
    throw new TypeError(`MCP ${kind} runtime module path must be a non-empty relative path: ${modulePath}`);
  }
  const entryPath = path.resolve(root, modulePath);
  const relative = path.relative(root, entryPath);
  if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new TypeError(`MCP ${kind} runtime module escapes its root: ${modulePath}`);
  }
  return entryPath;
}

function assertRuntimeModuleExists(entryPath: string, kind: "compiled" | "source"): void {
  if (!fs.statSync(entryPath, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`MCP ${kind} runtime module is missing: ${entryPath}`);
  }
}
