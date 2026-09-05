import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { resolveWorkspaceRoot } from "./WorkspaceRoot.js";

interface DocumentationIssue {
  readonly file: string;
  readonly line: number;
  readonly message: string;
}

const workspaceRoot = resolveWorkspaceRoot(import.meta.url);
const rootPackage = readPackage(path.join(workspaceRoot, "package.json"));
const frontendPackage = readPackage(path.join(workspaceRoot, "Frontend", "package.json"));
const markdownFiles = readMarkdownFiles();
const issues = markdownFiles.flatMap((file) => inspectMarkdown(file, rootPackage, frontendPackage));
issues.push(...inspectNodeVersion(rootPackage, markdownFiles));

if (issues.length > 0) {
  for (const issue of issues) console.error(`${issue.file}:${issue.line}: ${issue.message}`);
  process.exitCode = 1;
} else {
  console.log(`Documentation governance verified (${markdownFiles.length} Markdown files).`);
}

function inspectMarkdown(relativePath: string, root: PackageDocument, frontend: PackageDocument): DocumentationIssue[] {
  const absolutePath = path.join(workspaceRoot, relativePath);
  const text = fs.readFileSync(absolutePath, "utf8");
  return [...inspectLinks(relativePath, absolutePath, text), ...inspectNpmScripts(relativePath, text, root, frontend)];
}

function inspectLinks(relativePath: string, absolutePath: string, text: string): DocumentationIssue[] {
  const issues: DocumentationIssue[] = [];
  for (const match of text.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/gu)) {
    let target = match[1]?.trim() ?? "";
    if (target.startsWith("<") && target.endsWith(">")) target = target.slice(1, -1);
    else target = target.split(/\s+["']/u)[0] ?? "";
    if (!target || target.includes("{{") || /^(?:[a-z][a-z0-9+.-]*:|#)/iu.test(target)) continue;
    target = target.split("#", 1)[0]?.split("?", 1)[0] ?? "";
    if (!target) continue;
    try {
      target = decodeURIComponent(target);
    } catch {
      issues.push(issue(relativePath, text, match.index, `link target is not valid URI text: ${target}`));
      continue;
    }
    if (!fs.existsSync(path.resolve(path.dirname(absolutePath), target))) {
      issues.push(issue(relativePath, text, match.index, `local link target does not exist: ${target}`));
    }
  }
  return issues;
}

function inspectNpmScripts(
  relativePath: string,
  text: string,
  root: PackageDocument,
  frontend: PackageDocument,
): DocumentationIssue[] {
  const issues: DocumentationIssue[] = [];
  const pattern = /\bnpm\s+(?:(?:--workspace|-w)\s+([^\s`]+)\s+)?run\s+([a-z0-9][a-z0-9_.:-]*)/giu;
  for (const match of text.matchAll(pattern)) {
    const command = match[2] ?? "";
    const nextCharacter = text[(match.index ?? 0) + match[0].length];
    if (!command || nextCharacter === "*" || command.endsWith(".")) continue;
    const workspace = match[1];
    const scripts = workspace ? frontend.scripts : root.scripts;
    if (workspace && workspace !== "senera-frontend" && workspace !== "Frontend") {
      issues.push(issue(relativePath, text, match.index, `unknown npm workspace in documented command: ${workspace}`));
    } else if (!Object.hasOwn(scripts, command)) {
      issues.push(issue(relativePath, text, match.index, `documented npm script does not exist: ${command}`));
    }
  }
  return issues;
}

function inspectNodeVersion(root: PackageDocument, files: readonly string[]): DocumentationIssue[] {
  const engine = root.engines?.node;
  const requiredMajor = engine?.match(/>=\s*(\d+)/u)?.[1];
  if (!requiredMajor) return [];
  const issues: DocumentationIssue[] = [];
  const nvmVersion = fs
    .readFileSync(path.join(workspaceRoot, ".nvmrc"), "utf8")
    .trim()
    .replace(/^v/u, "")
    .split(".")[0];
  if (nvmVersion !== requiredMajor) {
    issues.push({
      file: ".nvmrc",
      line: 1,
      message: `Node major ${nvmVersion} does not match package engines ${engine}.`,
    });
  }
  for (const relativePath of files) {
    const text = fs.readFileSync(path.join(workspaceRoot, relativePath), "utf8");
    for (const match of text.matchAll(/\bNode(?:\.js)?\s+(\d+)(?:\.x|\+)?/giu)) {
      if (match[1] !== requiredMajor) {
        issues.push(
          issue(
            relativePath,
            text,
            match.index,
            `documented Node major ${match[1]} does not match package engines ${engine}`,
          ),
        );
      }
    }
  }
  return issues;
}

function readMarkdownFiles(): string[] {
  const result = spawnSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", "*.md"], {
    cwd: workspaceRoot,
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`Unable to enumerate Markdown files: ${result.error?.message ?? result.stderr ?? "unknown error"}`);
  }
  return [...new Set(result.stdout.split("\0").filter(Boolean))]
    .filter((relativePath) => fs.existsSync(path.join(workspaceRoot, relativePath)))
    .sort();
}

function issue(file: string, text: string, index: number | undefined, message: string): DocumentationIssue {
  return { file, line: text.slice(0, index ?? 0).split(/\r?\n/u).length, message };
}

interface PackageDocument {
  readonly engines?: { readonly node?: string };
  readonly scripts: Readonly<Record<string, string>>;
}

function readPackage(filePath: string): PackageDocument {
  const value = JSON.parse(fs.readFileSync(filePath, "utf8")) as Partial<PackageDocument>;
  return { engines: value.engines, scripts: value.scripts ?? {} };
}
