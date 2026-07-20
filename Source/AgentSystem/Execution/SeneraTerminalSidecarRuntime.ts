import { createRequire } from "node:module";
import path from "node:path";

export interface SeneraTerminalSidecarRuntime {
  readonly sourceRoot: string;
  readonly packageRoot: string;
  readonly entrypoint: string;
  readonly guestRoot: string;
  readonly guestEntrypoint: string;
  readonly guestNodeCommand: string;
}

const require = createRequire(import.meta.url);

export function resolveSeneraTerminalSidecarRuntime(): SeneraTerminalSidecarRuntime {
  const packageRoot = path.dirname(require.resolve("@senera/terminal-sidecar/package.json"));
  const dependencyRoots = [
    path.dirname(require.resolve("@lydell/node-pty/package.json")),
    path.dirname(require.resolve("@msgpack/msgpack/package.json")),
    path.dirname(require.resolve("zod/package.json")),
  ];
  const sourceRoot = commonAncestor([packageRoot, ...dependencyRoots]);
  const packageRelativePath = path.relative(sourceRoot, packageRoot);
  const relativeEntrypoint = path.join("bin", "senera-terminal-sidecar.js");
  const guestRoot = "/opt/senera-terminal";
  return {
    sourceRoot,
    packageRoot,
    entrypoint: path.join(packageRoot, relativeEntrypoint),
    guestRoot,
    guestEntrypoint: path.posix.join(
      guestRoot,
      ...packageRelativePath.split(path.sep),
      "bin",
      "senera-terminal-sidecar.js",
    ),
    guestNodeCommand: "/usr/local/bin/node",
  };
}

function commonAncestor(paths: readonly string[]): string {
  const [first, ...remaining] = paths.map((value) => path.resolve(value));
  let candidate = first;
  while (remaining.some((value) => !isPathInside(candidate, value))) {
    const parent = path.dirname(candidate);
    if (parent === candidate) throw new Error("Unable to resolve a common terminal runtime package root.");
    candidate = parent;
  }
  return candidate;
}

function isPathInside(root: string, value: string): boolean {
  const relative = path.relative(root, value);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
