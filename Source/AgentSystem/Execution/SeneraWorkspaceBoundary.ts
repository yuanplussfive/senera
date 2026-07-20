import { constants } from "node:fs";
import { lstat, open, realpath, type FileHandle } from "node:fs/promises";
import path from "node:path";
import {
  AgentResourceAccessIntents,
  type AgentResourceAccessFacts,
  type AgentResourceAccessIntent,
  type SeneraResourceAccessAuthorizer,
} from "./SeneraResourceAccess.js";

declare const CanonicalWorkspacePathBrand: unique symbol;

export type CanonicalWorkspacePath = string & {
  readonly [CanonicalWorkspacePathBrand]: true;
};

export interface SeneraResolvedWorkspaceTarget {
  readonly addressedPath: string;
  readonly absolutePath: CanonicalWorkspacePath;
  readonly facts: AgentResourceAccessFacts;
}

export interface SeneraOpenedWorkspaceFile {
  readonly target: SeneraResolvedWorkspaceTarget;
  readonly handle: FileHandle;
}

export class SeneraWorkspaceBoundaryError extends Error {
  constructor(
    readonly code:
      "invalid_path" | "outside_workspace" | "link_not_allowed" | "unresolved_path" | "path_changed" | "policy_denied",
    message: string,
    readonly facts?: AgentResourceAccessFacts,
    cause?: Error,
  ) {
    super(message, cause ? { cause } : undefined);
    this.name = "SeneraWorkspaceBoundaryError";
  }
}

export interface SeneraWorkspaceBoundaryOptions {
  readonly workspaceRoot: string;
  readonly scope?: AgentResourceAccessFacts["scope"];
  readonly policy?: SeneraResourceAccessAuthorizer;
  readonly linkPolicy?: "allow_internal" | "deny";
}

export class SeneraWorkspaceBoundary {
  readonly workspaceRoot: string;
  private readonly canonicalRoot: Promise<CanonicalWorkspacePath>;

  constructor(private readonly options: SeneraWorkspaceBoundaryOptions) {
    this.workspaceRoot = path.resolve(options.workspaceRoot);
    this.canonicalRoot = realpath(this.workspaceRoot).then(asCanonicalPath);
  }

  async resolve(value: string | undefined, intent: AgentResourceAccessIntent): Promise<SeneraResolvedWorkspaceTarget> {
    const inspection = await this.inspect(value, intent);
    if (this.options.policy) {
      try {
        await this.options.policy.authorize(inspection.facts);
      } catch (error) {
        throw new SeneraWorkspaceBoundaryError(
          "policy_denied",
          error instanceof Error ? error.message : String(error),
          inspection.facts,
          error instanceof Error ? error : undefined,
        );
      }
    }
    if (!inspection.absolutePath) {
      const deniedLink = this.options.linkPolicy === "deny" && inspection.facts.linkTraversal !== "none";
      throw new SeneraWorkspaceBoundaryError(
        deniedLink
          ? "link_not_allowed"
          : inspection.facts.containment === "outside"
            ? "outside_workspace"
            : "unresolved_path",
        `路径不属于可执行工作区边界：${value ?? "."}`,
        inspection.facts,
      );
    }
    return {
      addressedPath: inspection.addressedPath ?? inspection.absolutePath,
      absolutePath: inspection.absolutePath,
      facts: inspection.facts,
    };
  }

  async openFile(value: string, intent: AgentResourceAccessIntent): Promise<SeneraOpenedWorkspaceFile> {
    const initial = await this.resolve(value, intent);
    const handle = await open(initial.absolutePath, constants.O_RDONLY | noFollowFlag());
    try {
      const current = await this.resolve(initial.addressedPath, intent);
      const [openedStat, currentStat] = await Promise.all([handle.stat(), lstat(current.absolutePath)]);
      if (
        !samePath(initial.absolutePath, current.absolutePath) ||
        currentStat.isSymbolicLink() ||
        !sameFileIdentity(openedStat, currentStat)
      ) {
        throw new SeneraWorkspaceBoundaryError("path_changed", `路径在打开期间发生变化：${value}`, current.facts);
      }
      return { target: current, handle };
    } catch (error) {
      await handle.close().catch(() => undefined);
      throw error;
    }
  }

  async inspect(
    value: string | undefined,
    intent: AgentResourceAccessIntent,
  ): Promise<{
    readonly addressedPath?: string;
    readonly absolutePath?: CanonicalWorkspacePath;
    readonly facts: AgentResourceAccessFacts;
  }> {
    const requested = value?.trim() || ".";
    if (requested.includes("\0")) {
      throw new SeneraWorkspaceBoundaryError("invalid_path", "路径包含 NUL 字符。");
    }

    const candidate = path.isAbsolute(requested)
      ? path.resolve(requested)
      : path.resolve(this.workspaceRoot, requested);
    const lexicalRelative = path.relative(this.workspaceRoot, candidate);
    const relativePath = toPortableRelativePath(lexicalRelative);
    if (!isInsidePath(this.workspaceRoot, candidate)) {
      return {
        facts: this.resourceFacts(intent, relativePath, "outside", "none", "unknown"),
      };
    }

    const canonicalRoot = await this.canonicalRoot;
    const finalStat = await lstatIfPresent(candidate);
    if (finalStat.kind === "error") {
      return {
        facts: this.resourceFacts(intent, relativePath, "unknown", finalStat.linkTraversal, "unknown"),
      };
    }

    const finalEntry = finalStat.value ? entryKind(finalStat.value) : "missing";
    const anchor = finalStat.value ? candidate : await nearestExistingAncestor(candidate, this.workspaceRoot);
    if (!anchor) {
      return {
        facts: this.resourceFacts(intent, relativePath, "unknown", "broken", finalEntry),
      };
    }

    try {
      const canonicalAnchor = await realpath(anchor);
      const suffix = path.relative(anchor, candidate);
      const canonicalTarget = path.resolve(canonicalAnchor, suffix);
      const containment = isInsidePath(canonicalRoot, canonicalTarget) ? "inside" : "outside";
      const traversedLink = !samePath(anchor, canonicalAnchor) || finalEntry === "link";
      const linkTraversal = traversedLink ? (containment === "inside" ? "internal" : "external") : "none";
      const executable =
        containment === "inside" &&
        !(this.options.linkPolicy === "deny" && traversedLink) &&
        !(finalEntry === "link" && MutationIntents.has(intent));
      return {
        addressedPath: candidate,
        absolutePath: executable ? asCanonicalPath(canonicalTarget) : undefined,
        facts: this.resourceFacts(intent, relativePath, containment, linkTraversal, finalEntry),
      };
    } catch (error) {
      return {
        facts: this.resourceFacts(
          intent,
          relativePath,
          "unknown",
          isMissingError(error) ? "broken" : "none",
          finalEntry,
        ),
      };
    }
  }

  private resourceFacts(
    intent: AgentResourceAccessIntent,
    relativePath: string,
    containment: AgentResourceAccessFacts["containment"],
    linkTraversal: AgentResourceAccessFacts["linkTraversal"],
    finalEntry: AgentResourceAccessFacts["finalEntry"],
  ): AgentResourceAccessFacts {
    return {
      scope: this.options.scope ?? "workspace",
      intent,
      relativePath,
      containment,
      linkTraversal,
      finalEntry,
    };
  }
}

const MutationIntents = new Set<AgentResourceAccessIntent>([
  AgentResourceAccessIntents.Create,
  AgentResourceAccessIntents.Replace,
  AgentResourceAccessIntents.Remove,
]);

type LstatResult =
  | { readonly kind: "ok"; readonly value: Awaited<ReturnType<typeof lstat>> | undefined }
  | { readonly kind: "error"; readonly linkTraversal: "none" | "broken" };

async function lstatIfPresent(value: string): Promise<LstatResult> {
  try {
    return { kind: "ok", value: await lstat(value) };
  } catch (error) {
    return isMissingError(error) ? { kind: "ok", value: undefined } : { kind: "error", linkTraversal: "none" };
  }
}

async function nearestExistingAncestor(candidate: string, root: string): Promise<string | undefined> {
  let current = path.dirname(candidate);
  while (isInsidePath(root, current)) {
    const stat = await lstatIfPresent(current);
    if (stat.kind === "error") return undefined;
    if (stat.value) return current;
    if (samePath(current, root)) return undefined;
    current = path.dirname(current);
  }
  return undefined;
}

function entryKind(stat: Awaited<ReturnType<typeof lstat>>): AgentResourceAccessFacts["finalEntry"] {
  if (stat.isSymbolicLink()) return "link";
  if (stat.isFile()) return "file";
  if (stat.isDirectory()) return "directory";
  return "other";
}

function isInsidePath(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function samePath(left: string, right: string): boolean {
  return path.relative(left, right) === "";
}

function toPortableRelativePath(value: string): string {
  return (value || ".").split(path.sep).join("/");
}

function asCanonicalPath(value: string): CanonicalWorkspacePath {
  return value as CanonicalWorkspacePath;
}

function noFollowFlag(): number {
  return typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
}

function sameFileIdentity(
  left: Awaited<ReturnType<FileHandle["stat"]>>,
  right: Awaited<ReturnType<typeof lstat>>,
): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function isMissingError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT";
}
