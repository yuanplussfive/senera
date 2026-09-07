export type AgentValidationIssuePathSegment = string | number;

export interface AgentZodIssueLike {
  readonly message: string;
  readonly path: readonly PropertyKey[];
}

export interface AgentAjvIssueLike {
  readonly instancePath: string;
  readonly message?: string | null;
  readonly params: Record<string, unknown>;
}

export interface FormatAgentZodIssueOptions {
  readonly rootLabel?: string;
}

export interface FormatAgentAjvIssueOptions {
  readonly rootPath?: readonly AgentValidationIssuePathSegment[];
  readonly rootLabel: string;
  readonly numericPathStyle?: "dot" | "brackets";
}

export function formatZodIssue(issue: AgentZodIssueLike, options: FormatAgentZodIssueOptions = {}): string {
  const path = issue.path.flatMap((part) => (typeof part === "string" || typeof part === "number" ? [part] : []));
  const location = path.length > 0 ? formatValidationPath(path, "dot") : (options.rootLabel ?? "root");
  return `${location}: ${issue.message}`;
}

export function formatAjvIssue(error: AgentAjvIssueLike, options: FormatAgentAjvIssueOptions): string {
  const path = [...(options.rootPath ?? []), ...jsonPointerPath(error.instancePath), ...ajvParameterPath(error.params)];
  const location = path.length > 0 ? formatValidationPath(path, options.numericPathStyle ?? "dot") : options.rootLabel;
  return `${location}: ${error.message ?? "JSON Schema validation failed"}`;
}

function ajvParameterPath(params: Record<string, unknown>): AgentValidationIssuePathSegment[] {
  const property = params.additionalProperty ?? params.missingProperty;
  return typeof property === "string" && property.length > 0 ? [property] : [];
}

function jsonPointerPath(pointer: string): AgentValidationIssuePathSegment[] {
  return pointer
    .split("/")
    .filter(Boolean)
    .map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"))
    .map((segment) => (/^(?:0|[1-9]\d*)$/u.test(segment) ? Number(segment) : segment));
}

function formatValidationPath(
  path: readonly AgentValidationIssuePathSegment[],
  numericPathStyle: "dot" | "brackets",
): string {
  return path
    .map((part) => (numericPathStyle === "brackets" && typeof part === "number" ? `[${part}]` : String(part)))
    .join(".");
}
