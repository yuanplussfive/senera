import {
  AgentToolPerceptionKinds,
  AgentToolPerceptionScopes,
  type AgentToolPerceptionDeclaration,
  type AgentToolPerceptionKind,
  type AgentToolPerceptionScope,
} from "../Types/AgentToolPerceptionTypes.js";
import { readAgentNonBlankString, readAgentString, readAgentUnknownRecord } from "../Core/AgentUnknownValue.js";

export interface AgentToolPerceptionComposerInput {
  /** Optional declaration carried by the tool contract. Absent for most MCP tools. */
  readonly declaration?: AgentToolPerceptionDeclaration;
  /** The redacted tool result (already safe to read, never instructions). */
  readonly result: unknown;
  /** The tool arguments, used to localize remote objects (e.g. a queried city). */
  readonly arguments?: unknown;
}

export interface AgentToolPerceptionComposition {
  readonly phrase: string;
  readonly kind: AgentToolPerceptionKind;
  readonly scope: AgentToolPerceptionScope;
  /** True when no declaration existed and kind/scope were inferred from shape. */
  readonly derived: boolean;
}

/**
 * Deterministically turns a tool result into a first-person, present-tense
 * perception line for the resident persona. All wording is medium-agnostic and
 * scope-aware: remote results are never narrated as "sensing" the surrounding
 * scene — only `scope: local` grants environment wording.
 */
export class AgentToolPerceptionComposer {
  compose(input: AgentToolPerceptionComposerInput): AgentToolPerceptionComposition {
    const declaration = input.declaration;
    const digest = this.digestResult(input.result);
    const objectLabel = declaration?.object ?? localizeAgentToolPerceptionObject(input.arguments);

    let kind: AgentToolPerceptionKind = declaration?.kind ?? inferKind(input.result);
    let scope: AgentToolPerceptionScope = declaration?.scope ?? AgentToolPerceptionScopes.Remote;

    // Scope honesty: only an explicit local environment declaration may narrate
    // sensing the surrounding scene. Anything unverified or inferred is remote.
    if (scope === AgentToolPerceptionScopes.Local && declaration?.kind !== AgentToolPerceptionKinds.Environment) {
      scope = AgentToolPerceptionScopes.Remote;
      kind = AgentToolPerceptionKinds.Retrieved;
    }

    const phrase = this.renderPhrase(declaration, kind, scope, digest, objectLabel);
    return { phrase, kind, scope, derived: declaration === undefined };
  }

  private renderPhrase(
    declaration: AgentToolPerceptionDeclaration | undefined,
    kind: AgentToolPerceptionKind,
    scope: AgentToolPerceptionScope,
    digest: string,
    objectLabel: string | undefined,
  ): string {
    // A declared template is a complete, self-contained sentence.
    if (declaration?.template) {
      if (digest !== "") return declaration.template.replace(/\{digest\}/gu, digest);
      return declaration.template.replace(/\{digest\}/gu, objectLabel ?? "");
    }
    const subject = objectLabel ?? digest;
    if (subject === "") return "";
    return this.preface(kind, scope, subject);
  }

  private preface(kind: AgentToolPerceptionKind, scope: AgentToolPerceptionScope, subject: string): string {
    switch (kind) {
      case AgentToolPerceptionKinds.Environment:
        return scope === AgentToolPerceptionScopes.Local
          ? `I look around—${subject}`
          : `I had a look around, ${subject}`;
      case AgentToolPerceptionKinds.Event:
        return `I just learned that ${subject}`;
      case AgentToolPerceptionKinds.Recall:
        return `I recalled that ${subject}`;
      case AgentToolPerceptionKinds.Action:
        return `I went ahead and ${subject}`;
      case AgentToolPerceptionKinds.Retrieved:
      default:
        return scope === AgentToolPerceptionScopes.Local ? `I look around at ${subject}` : `I had a look at ${subject}`;
    }
  }

  private digestResult(result: unknown): string {
    const record = readAgentUnknownRecord(result);
    if (!record) {
      const scalar = readAgentNonBlankString(result);
      return scalar ? trimTo(scalar, 96) : "";
    }
    const direct = compactSummaryRecord(record);
    if (direct !== "") return direct;
    const preferred = preferredDigest(record);
    if (preferred !== "") return preferred;
    return firstNonEmpty(record);
  }
}

const SummaryKeys = ["summary", "message", "text", "title", "result", "reason"];
const PreferredKeys = ["status", "temperature", "temp", "count", "total", "file", "path", "error"];

function compactSummaryRecord(record: Record<string, unknown>): string {
  for (const key of SummaryKeys) {
    const text = readAgentString(record[key]);
    if (text !== undefined && text !== "") return trimTo(text, 120);
  }
  return "";
}

function preferredDigest(record: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const key of PreferredKeys) {
    const value = record[key];
    if (typeof value === "string" && value !== "") {
      parts.push(`${key}=${value}`);
    } else if (typeof value === "number" && Number.isFinite(value)) {
      parts.push(`${key}=${value}`);
    }
    if (parts.length >= 3) break;
  }
  return parts.join(", ");
}

function firstNonEmpty(record: Record<string, unknown>): string {
  for (const key of Object.keys(record)) {
    const value = readAgentNonBlankString(record[key]);
    if (value !== undefined) return trimTo(value, 120);
  }
  return "";
}

function inferKind(result: unknown): AgentToolPerceptionKind {
  const record = readAgentUnknownRecord(result);
  if (!record) return AgentToolPerceptionKinds.Retrieved;
  const kindRaw = readAgentString(record.kind);
  if (kindRaw !== undefined) {
    for (const known of Object.values(AgentToolPerceptionKinds)) {
      if (known === kindRaw) return known;
    }
  }
  if (readAgentString(record.action) !== undefined || readAgentString(record.command) !== undefined) {
    return AgentToolPerceptionKinds.Action;
  }
  return AgentToolPerceptionKinds.Retrieved;
}

function trimTo(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

/** Deterministically resolves the concrete subject a tool call focuses on, from its arguments. */
export function localizeAgentToolPerceptionObject(args: unknown): string | undefined {
  const record = readAgentUnknownRecord(args);
  if (!record) return undefined;
  for (const key of ["city", "location", "query", "topic", "repo", "path"]) {
    const value = readAgentNonBlankString(record[key]);
    if (value !== undefined) return value;
  }
  return undefined;
}
