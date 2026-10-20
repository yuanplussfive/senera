import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import path from "node:path";
import { DEFAULT_MAX_BYTES, formatSize, truncateHead, truncateLine } from "@earendil-works/pi-coding-agent";
import { relativePathWithin } from "../Core/AgentPath.js";
import { workspaceContentExclusionArguments } from "./AgentWorkspaceFileDiscovery.js";

const DefaultWorkspaceGrepMatchLimit = 100;

export interface AgentWorkspaceContentSearchRequest {
  readonly pattern: string;
  readonly searchPath: string;
  readonly glob?: string;
  readonly ignoreCase?: boolean;
  readonly literal?: boolean;
  readonly context?: number;
  readonly limit?: number;
  readonly signal?: AbortSignal;
}

export interface AgentWorkspaceContentSearchOperations {
  isDirectory(absolutePath: string): Promise<boolean>;
  readFile(absolutePath: string): Promise<string>;
}

export interface AgentWorkspaceContentSearchResult {
  content: { type: "text"; text: string }[];
  details?: {
    truncation?: ReturnType<typeof truncateHead>;
    matchLimitReached?: number;
    linesTruncated?: true;
  };
}

/**
 * Runs a content search with Pi-compatible rendering while injecting layout-owned exclusions as
 * separate ripgrep arguments. A caller's positive glob therefore remains untouched.
 */
export async function searchWorkspaceContent(input: {
  readonly workspaceRoot: string;
  readonly ripgrepPath: string;
  readonly request: AgentWorkspaceContentSearchRequest;
  readonly operations: AgentWorkspaceContentSearchOperations;
}): Promise<AgentWorkspaceContentSearchResult> {
  const { request } = input;
  request.signal?.throwIfAborted();
  const isDirectory = await input.operations.isDirectory(request.searchPath);
  const workspaceRelativeSearchPath = relativePathWithin(input.workspaceRoot, request.searchPath);
  if (workspaceRelativeSearchPath === undefined) {
    throw new Error(`Workspace content search path is outside the workspace: ${request.searchPath}`);
  }
  const searchArgument = workspaceRelativeSearchPath || ".";
  const contextLines = request.context && request.context > 0 ? request.context : 0;
  const limit = Math.max(1, request.limit ?? DefaultWorkspaceGrepMatchLimit);
  const formatPath = (filePath: string): string => {
    if (isDirectory) {
      const relative = path.relative(request.searchPath, filePath);
      if (relative && !relative.startsWith("..")) return relative.replaceAll("\\", "/");
    }
    return path.basename(filePath);
  };
  const args = ["--json", "--line-number", "--color=never", "--hidden"];
  if (request.ignoreCase) args.push("--ignore-case");
  if (request.literal) args.push("--fixed-strings");
  if (request.glob?.trim()) args.push("--glob", request.glob);
  args.push(...workspaceContentExclusionArguments(input.workspaceRoot, input.workspaceRoot));
  args.push("--", request.pattern, searchArgument);

  const matches = await collectMatches({
    executable: input.ripgrepPath,
    args,
    limit,
    cwd: input.workspaceRoot,
    workspaceRoot: input.workspaceRoot,
    signal: request.signal,
  });
  if (!matches.items.length) return textResult("No matches found");

  let linesTruncated = false;
  const fileCache = new Map<string, readonly string[]>();
  const outputLines: string[] = [];
  for (const match of matches.items) {
    if (contextLines === 0 && match.lineText !== undefined) {
      const truncated = truncateLine(normalizeMatchLine(match.lineText));
      if (truncated.wasTruncated) linesTruncated = true;
      outputLines.push(`${formatPath(match.filePath)}:${match.lineNumber}: ${truncated.text}`);
      continue;
    }
    let lines = fileCache.get(match.filePath);
    if (!lines) {
      try {
        lines = (await input.operations.readFile(match.filePath))
          .replace(/\r\n/gu, "\n")
          .replace(/\r/gu, "\n")
          .split("\n");
      } catch {
        lines = [];
      }
      fileCache.set(match.filePath, lines);
    }
    if (!lines.length) {
      outputLines.push(`${formatPath(match.filePath)}:${match.lineNumber}: (unable to read file)`);
      continue;
    }
    const firstLine = contextLines > 0 ? Math.max(1, match.lineNumber - contextLines) : match.lineNumber;
    const lastLine = contextLines > 0 ? Math.min(lines.length, match.lineNumber + contextLines) : match.lineNumber;
    for (let currentLine = firstLine; currentLine <= lastLine; currentLine += 1) {
      const truncated = truncateLine((lines[currentLine - 1] ?? "").replace(/\r/gu, ""));
      if (truncated.wasTruncated) linesTruncated = true;
      outputLines.push(
        currentLine === match.lineNumber
          ? `${formatPath(match.filePath)}:${currentLine}: ${truncated.text}`
          : `${formatPath(match.filePath)}-${currentLine}- ${truncated.text}`,
      );
    }
  }

  const truncation = truncateHead(outputLines.join("\n"), { maxLines: Number.MAX_SAFE_INTEGER });
  const details: NonNullable<AgentWorkspaceContentSearchResult["details"]> = {};
  const notices: string[] = [];
  if (matches.limitReached) {
    details.matchLimitReached = limit;
    notices.push(`${limit} matches limit reached. Use limit=${limit * 2} for more, or refine pattern`);
  }
  if (truncation.truncated) {
    details.truncation = truncation;
    notices.push(`${formatSize(DEFAULT_MAX_BYTES)} limit reached`);
  }
  if (linesTruncated) {
    details.linesTruncated = true;
    notices.push("Some lines were truncated. Use read tool to see full lines");
  }
  return {
    content: [
      { type: "text", text: notices.length ? `${truncation.content}\n\n[${notices.join(". ")}]` : truncation.content },
    ],
    ...(Object.keys(details).length ? { details } : {}),
  };
}

interface RipgrepMatch {
  readonly filePath: string;
  readonly lineNumber: number;
  readonly lineText?: string;
}

async function collectMatches(input: {
  readonly executable: string;
  readonly args: readonly string[];
  readonly limit: number;
  readonly cwd: string;
  readonly workspaceRoot: string;
  readonly signal?: AbortSignal;
}): Promise<{ readonly items: readonly RipgrepMatch[]; readonly limitReached: boolean }> {
  if (input.signal?.aborted) throw input.signal.reason ?? new Error("Workspace content search was aborted.");
  return new Promise((resolve, reject) => {
    const child = spawn(input.executable, input.args, {
      cwd: input.cwd,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const reader = createInterface({ input: child.stdout });
    const items: RipgrepMatch[] = [];
    let diagnostic = "";
    let aborted = false;
    let limitReached = false;
    let settled = false;
    const settle = (action: () => void): void => {
      if (settled) return;
      settled = true;
      reader.close();
      input.signal?.removeEventListener("abort", onAbort);
      action();
    };
    const onAbort = (): void => {
      aborted = true;
      child.kill();
    };
    input.signal?.addEventListener("abort", onAbort, { once: true });
    child.stderr.on("data", (chunk: Buffer) => {
      diagnostic += chunk.toString();
    });
    reader.on("line", (line) => {
      if (!line.trim() || items.length >= input.limit) return;
      const match = parseRipgrepMatch(line, input.workspaceRoot);
      if (!match) return;
      items.push(match);
      if (items.length >= input.limit) {
        limitReached = true;
        child.kill();
      }
    });
    child.once("error", (error) => settle(() => reject(new Error(`Failed to run ripgrep: ${error.message}`))));
    child.once("close", (code) => {
      if (aborted) {
        settle(() => reject(input.signal?.reason ?? new Error("Workspace content search was aborted.")));
        return;
      }
      if (!limitReached && code !== 0 && code !== 1) {
        settle(() => reject(new Error(diagnostic.trim() || `ripgrep exited with code ${String(code)}.`)));
        return;
      }
      settle(() => resolve({ items, limitReached }));
    });
  });
}

function parseRipgrepMatch(line: string, workspaceRoot: string): RipgrepMatch | undefined {
  let event: unknown;
  try {
    event = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!event || typeof event !== "object" || (event as { type?: unknown }).type !== "match") return undefined;
  const data = (event as { data?: unknown }).data;
  if (!data || typeof data !== "object") return undefined;
  const record = data as {
    path?: { text?: unknown };
    line_number?: unknown;
    lines?: { text?: unknown };
  };
  return typeof record.path?.text === "string" && typeof record.line_number === "number"
    ? {
        filePath: path.resolve(workspaceRoot, record.path.text),
        lineNumber: record.line_number,
        ...(typeof record.lines?.text === "string" ? { lineText: record.lines.text } : {}),
      }
    : undefined;
}

function normalizeMatchLine(value: string): string {
  return value.replace(/\r\n/gu, "\n").replace(/\r/gu, "").replace(/\n$/u, "");
}

function textResult(text: string): AgentWorkspaceContentSearchResult {
  return { content: [{ type: "text", text }] };
}
