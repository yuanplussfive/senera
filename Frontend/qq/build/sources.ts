import { createHash } from "node:crypto";
import path from "node:path";
import { readFile, readdir, stat } from "node:fs/promises";

/** Preserve the actual application layout and lockfile so the hosted client can be rebuilt. */
export async function collectQqSourceFiles(root: string): Promise<string[]> {
  return collectPackageFiles(
    root,
    [
      "Frontend",
      "Packages/ResourceLinks",
      "Packages/TerminalSidecar",
      "Source",
      "Apps",
      "Build",
      "Scripts",
      "System",
      "baml_src",
      "package.json",
      "package-lock.json",
      "tsconfig.json",
      "senera.config.example.json",
      "LICENSE",
    ],
    ["Apps/Mobile/android"],
  );
}

/** Enumerates declared sources, rejecting links and paths outside the package. */
export async function collectPackageFiles(
  root: string,
  entries: readonly string[],
  excludedPaths: readonly string[] = [],
): Promise<string[]> {
  const files = new Set<string>();
  const excluded = new Set(["node_modules", ".git", ".vite", ".ladle", "dist", "Dist", ".cache", "coverage"]);
  async function visit(relative: string): Promise<void> {
    if (excludedPaths.some((entry) => relative === entry || relative.startsWith(`${entry}/`))) return;
    const name = path.basename(relative);
    if (name === ".env" || name.startsWith(".env.") || name.endsWith(".tsbuildinfo") || name.endsWith(".log")) return;
    const absolute = path.resolve(root, relative);
    const containment = path.relative(root, absolute);
    if (containment === ".." || containment.startsWith(`..${path.sep}`) || path.isAbsolute(containment)) {
      throw new Error(`Source path escapes the package: ${relative}`);
    }
    const info = await stat(absolute);
    if (info.isDirectory()) {
      for (const entry of await readdir(absolute, { withFileTypes: true })) {
        if (entry.isSymbolicLink())
          throw new Error(`Package source contains a symbolic link: ${relative}/${entry.name}`);
        if (!excluded.has(entry.name)) await visit(`${relative}/${entry.name}`);
      }
    } else if (info.isFile()) files.add(relative);
  }
  for (const entry of entries) await visit(entry);
  return [...files].sort();
}

export async function hashPackageFiles(root: string, files: readonly string[]): Promise<string> {
  const hash = createHash("sha256");
  for (const file of files)
    hash
      .update(file)
      .update("\0")
      .update(await readFile(path.join(root, file)))
      .update("\0");
  return hash.digest("hex");
}

export async function qqSourceFingerprint(root: string): Promise<string> {
  return hashPackageFiles(root, await collectQqSourceFiles(root));
}
