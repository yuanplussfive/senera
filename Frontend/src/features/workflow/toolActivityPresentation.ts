import { resolveFrontendLocalizedText } from "../../i18n/frontendLocaleModel";
import type { ToolEventOrigin, ToolResultPresentation } from "../../api/eventTypes";
import type { AgentExtensionLocalizedText } from "../../../../Source/AgentSystem/Extensions/AgentExtensionLocalization";
import type {
  AgentToolPresentation,
  AgentToolPresentationActivityV2,
  AgentToolPresentationMeasure,
  AgentToolPresentationMeasureValueType,
  AgentToolPresentationSign,
  AgentToolPresentationVariant,
  AgentToolPresentationZeroPolicy,
} from "../../../../Source/AgentSystem/Types/AgentToolPresentationTypes";
import {
  projectWorkspaceFileActivityRows,
  summarizeWorkspaceFileActivity,
  type WorkspaceFileActivitySummary,
} from "./workspaceChangeActivity";

export type ToolActivityStatus = "active" | "completed" | "failed" | "cancelled";

export interface ToolActivityInput {
  readonly toolName: string;
  readonly origin?: ToolEventOrigin;
  readonly arguments?: unknown;
  /** Result presentation object; absent contracts keep the v1 label pipeline. */
  readonly result?: ToolResultPresentation;
  /** Host duration fact addressable by an `env` measure. */
  readonly durationMs?: number;
  readonly status: ToolActivityStatus;
}

export interface ToolActivityRow {
  readonly label: string;
  readonly action?: string;
  readonly path?: string;
  readonly addedLines?: number;
  readonly removedLines?: number;
  readonly status?: string;
}

export interface ToolActivityInspection {
  readonly label: string;
  readonly category: string;
  /** The semantic action used by the compact activity renderer. */
  readonly action?: string;
  /** A compact identity shown before the action target when one exists. */
  readonly identity?: string;
  readonly subjects: readonly string[];
  readonly argumentPreview?: string;
  readonly argumentPreviewParts: readonly string[];
  /** Standardized workspace changes projected into concise file rows. */
  readonly rows?: readonly ToolActivityRow[];
  readonly workspaceSummary?: WorkspaceFileActivitySummary;
}

/** The subset of a measure or row field that decides how a value is rendered. */
export interface ToolActivityValueFormat {
  readonly type: AgentToolPresentationMeasureValueType;
  readonly unit?: string;
  readonly precision?: number;
  readonly sign: AgentToolPresentationSign;
  readonly zero: AgentToolPresentationZeroPolicy;
  readonly labels?: Readonly<Record<string, AgentExtensionLocalizedText>>;
}

const GenericSystemCategory = "system";
const GenericMcpCategory = "mcp";
const PlaceholderPattern = /\{\{\s*([^{}]+?)\s*\}\}/gu;
/** Typographic minus, matching the sign the contract asks for on `delta`. */
const DeltaMinus = "\u2212";

/**
 * Runtime events are authoritative. The workflow has no knowledge of
 * extension names, capability prefixes, or tool-name conventions; packages
 * describe their own presentation at registration time.
 */
export function projectToolActivity(input: ToolActivityInput): string {
  return projectToolActivityInspection(input).label;
}

/**
 * Vinyasa's ToolCallCard has one visible title slot. Activity presentation
 * titles are intentionally action-focused, but V2 contracts may fill that
 * slot with a file/path summary and omit the registered tool identity. Keep
 * the concise activity label while making the concrete tool being executed
 * unambiguous in the execution graph.
 */
export function projectToolCallCardLabel(input: ToolActivityInput): string {
  const label = projectToolActivityInspection(input).label.trim();
  const identity = displayToolName(input.toolName, input.origin).trim();
  if (!identity) return label;
  if (!label) return identity;
  if (label === identity || label.startsWith(`${identity} ·`) || label.includes(` · ${identity} ·`)) return label;
  if (label.endsWith(` · ${identity}`)) return label;
  return `${identity} · ${label}`;
}

export function projectToolActivityInspection(input: ToolActivityInput): ToolActivityInspection {
  const presentation = input.origin?.presentation;
  const activity = presentation?.activity;
  const v2 = activity?.v2;
  const measureValues = v2 ? readMeasureValues(v2, input) : undefined;
  const variant = v2 ? selectActivityVariant(v2.variants, measureValues!) : undefined;

  // A variant may refine the argument pointers, so resolve them after selection.
  const command = readStringAtPointer(input.arguments, variant?.argumentPath ?? activity?.argumentPath);
  const subjects = uniqueStrings(
    (variant?.detailPaths ?? activity?.detailPaths ?? []).flatMap((pointer) =>
      readStringsAtPointer(input.arguments, pointer),
    ),
  );
  const argumentPreviewParts = readActivityArgumentPreviewParts({ command, subjects, arguments: input.arguments });
  const argumentPreview = compactArgumentValues(argumentPreviewParts);
  const action = variant?.action ?? activity?.action;
  const invocationName = variant?.invocationName ?? activity?.invocationName;
  const includeIdentity = !presentation || input.origin?.kind === "mcp";
  const resolvedAction = action ? resolveFrontendLocalizedText(action) : genericAction(input.origin);
  const identityParts = [
    invocationName ? resolveFrontendLocalizedText(invocationName) : undefined,
    includeIdentity ? displayToolIdentity(input.toolName, input.origin) : undefined,
  ].filter((value): value is string => Boolean(value));
  const identity = identityParts.length > 0 ? identityParts.join(" / ") : undefined;
  const fallbackLabel = [
    resolvedAction,
    invocationName ? resolveFrontendLocalizedText(invocationName) : undefined,
    includeIdentity ? displayToolName(input.toolName, input.origin) : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
  // Step 4 of the render order: an empty v2 title degrades to the v1 label,
  // never to a raw argument dump.
  const title = v2 ? renderActivityTitle(v2, variant, measureValues!) : undefined;
  const batchScopedWorkspaceObservation = isBatchScopedWorkspaceObservation(input.result?.workspaceObservation);
  const workspaceChanges = input.result?.changes ?? [];
  const workspaceRows = batchScopedWorkspaceObservation ? [] : projectWorkspaceFileActivityRows(workspaceChanges);
  const rows = workspaceRows.length > 0 ? workspaceRows : undefined;
  const workspaceSummary = batchScopedWorkspaceObservation
    ? undefined
    : summarizeWorkspaceFileActivity(workspaceRows, workspaceChanges);
  return {
    label:
      workspaceSummary?.accessibleLabel ??
      (title ? compactPreview(title) : appendArgumentPreview(fallbackLabel, argumentPreview)),
    category: presentation?.category ?? (input.origin?.kind === "mcp" ? GenericMcpCategory : GenericSystemCategory),
    ...(title ? {} : { action: resolvedAction, ...(identity ? { identity } : {}) }),
    subjects,
    argumentPreview,
    argumentPreviewParts,
    ...(rows ? { rows } : {}),
    ...(workspaceSummary ? { workspaceSummary } : {}),
  };
}

function isBatchScopedWorkspaceObservation(
  observation: ToolResultPresentation["workspaceObservation"] | undefined,
): boolean {
  return observation?.coverage === "observed" && observation.scope?.kind === "tool_batch";
}

export function projectToolBatchAction(
  input: Pick<ToolActivityInput, "toolName" | "origin" | "arguments" | "status">,
): {
  readonly category: string;
  readonly label: string;
} {
  const inspection = projectToolActivityInspection(input);
  return { category: inspection.category, label: inspection.label };
}

export function readToolPresentation(input: Pick<ToolActivityInput, "origin">): AgentToolPresentation | undefined {
  return input.origin?.presentation;
}

/**
 * Resolves every value an RFC 6901 pointer addresses. `*` fans out over array
 * entries or object values; a missing segment yields nothing rather than a
 * placeholder, so callers can tell "absent" from "empty".
 */
export function readTypedAtPointer(value: unknown, pointer: string): readonly unknown[] {
  const tokens = parsePointer(pointer);
  const visit = (current: unknown, index: number): unknown[] => {
    if (index >= tokens.length) return [current];
    const token = tokens[index]!;
    if (token === "*") {
      if (Array.isArray(current)) return current.flatMap((entry) => visit(entry, index + 1));
      return isRecord(current) ? Object.values(current).flatMap((entry) => visit(entry, index + 1)) : [];
    }
    if (Array.isArray(current)) {
      return /^(?:0|[1-9]\d*)$/u.test(token) && Number(token) < current.length
        ? visit(current[Number(token)], index + 1)
        : [];
    }
    return isRecord(current) && Object.hasOwn(current, token) ? visit(current[token], index + 1) : [];
  };
  return visit(value, 0);
}

/**
 * Reduces the entries a measure addresses into a single raw value. The value
 * stays unformatted so variant matching compares the same representation the
 * contract declared in `when.equals`.
 */
export function aggregateMeasureValues(measure: AgentToolPresentationMeasure, source: unknown): unknown {
  const resolved = readTypedAtPointer(source, measure.pointer);
  if (resolved.length === 0) return undefined;
  const entries = resolved.flatMap((value) => (Array.isArray(value) ? value : [value]));
  const matched = measure.where
    ? entries.filter((entry) => isRecord(entry) && entry[measure.where!.field] === measure.where!.equals)
    : entries;
  switch (measure.aggregate) {
    case "count":
      return matched.length;
    case "first":
      return matched.length > 0 ? readMeasureField(matched[0], measure) : undefined;
    case "join":
      return matched
        .map((entry) => readMeasureField(entry, measure))
        .filter((entry) => entry !== undefined && entry !== null)
        .map((entry) => String(entry))
        .join(measure.separator ?? "");
    case "sum":
      return reduceMeasureNumbers(matched, measure, (total, value) => total + value);
    case "max":
      return reduceMeasureNumbers(matched, measure, (best, value) => Math.max(best, value));
  }
}

/**
 * Deterministic per-type formatting. The same rule renders a measure
 * placeholder and a `rows` field, so a value cannot read differently in two
 * places of the same label.
 */
export function formatMeasureValue(value: unknown, format: ToolActivityValueFormat): string {
  if (value === undefined || value === null) return "";
  switch (format.type) {
    case "number":
      return formatNumberValue(value, format);
    case "delta":
      return formatDeltaValue(value, format);
    case "enum":
    case "boolean": {
      const key = String(value);
      const label = format.labels?.[key];
      return label ? resolveFrontendLocalizedText(label) : compactPreview(key);
    }
    case "path":
      return String(value).trim();
    default:
      return compactPreview(String(value));
  }
}

/**
 * Renders `{{id}}` placeholders, then drops every `·` segment that lost all of
 * its values. A segment whose placeholders are all empty is removed whole, so a
 * missing measure never strands its literal suffix (`· 个文件`) or a lone sign
 * (`+ −`). Segments without placeholders are prose and always survive.
 */
export function renderActivityTemplate(template: string, values: ReadonlyMap<string, string>): string {
  const surviving = template.split("·").filter((segment) => {
    const ids = [...segment.matchAll(PlaceholderPattern)].map((match) => match[1]!.trim());
    return ids.length === 0 || ids.some((id) => (values.get(id) ?? "").trim().length > 0);
  });
  const replaced = surviving
    .join(" · ")
    .replace(PlaceholderPattern, (_match, id: string) => values.get(id.trim()) ?? "");
  return cleanActivityText(replaced);
}

/**
 * Variants match in array order and the first hit wins. The entry without
 * `when` is the fallback; contract validation already guarantees it is last.
 */
export function selectActivityVariant(
  variants: readonly AgentToolPresentationVariant[],
  values: ReadonlyMap<string, unknown>,
): AgentToolPresentationVariant | undefined {
  for (const variant of variants) {
    if (variant.when === undefined) return variant;
    if (values.get(variant.when.measure) === variant.when.equals) return variant;
  }
  return undefined;
}

function readMeasureValues(
  v2: AgentToolPresentationActivityV2,
  input: ToolActivityInput,
): ReadonlyMap<string, unknown> {
  const values = new Map<string, unknown>();
  for (const measure of v2.measures) {
    values.set(measure.id, aggregateMeasureValues(measure, readMeasureSource(measure, input)));
  }
  return values;
}

function readMeasureSource(measure: AgentToolPresentationMeasure, input: ToolActivityInput): unknown {
  if (measure.from === "argument") return input.arguments;
  if (measure.from === "result") return input.result;
  return { status: input.status, durationMs: input.durationMs, toolName: input.toolName };
}

function readMeasureField(entry: unknown, measure: AgentToolPresentationMeasure): unknown {
  if (measure.field === undefined) return entry;
  return isRecord(entry) ? entry[measure.field] : undefined;
}

function reduceMeasureNumbers(
  entries: readonly unknown[],
  measure: AgentToolPresentationMeasure,
  combine: (accumulator: number, value: number) => number,
): number | undefined {
  const numbers = entries
    .map((entry) => Number(readMeasureField(entry, measure)))
    .filter((entry) => Number.isFinite(entry));
  return numbers.length > 0 ? numbers.reduce(combine) : undefined;
}

function formatNumberValue(value: unknown, format: ToolActivityValueFormat): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "";
  const magnitude = format.precision !== undefined ? numeric.toFixed(format.precision) : String(numeric);
  return `${magnitude}${format.unit ?? ""}`;
}

function formatDeltaValue(value: unknown, format: ToolActivityValueFormat): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "";
  if (numeric === 0 && format.zero === "omit") return "";
  const magnitude =
    format.precision !== undefined ? Math.abs(numeric).toFixed(format.precision) : String(Math.abs(numeric));
  const negative = numeric < 0;
  const text =
    format.sign === "always"
      ? `${negative ? DeltaMinus : "+"}${magnitude}`
      : format.sign === "positive-only"
        ? negative
          ? magnitude
          : `+${magnitude}`
        : format.sign === "negative-only"
          ? `${DeltaMinus}${magnitude}`
          : `${negative ? DeltaMinus : ""}${magnitude}`;
  return `${text}${format.unit ?? ""}`;
}

function renderActivityTitle(
  v2: AgentToolPresentationActivityV2,
  variant: AgentToolPresentationVariant | undefined,
  values: ReadonlyMap<string, unknown>,
): string | undefined {
  const template = variant?.title ?? v2.title;
  if (!template) return undefined;
  const texts = new Map<string, string>();
  for (const measure of v2.measures) {
    texts.set(measure.id, formatMeasureValue(values.get(measure.id), measure));
  }
  return renderActivityTemplate(template, texts) || undefined;
}

function cleanActivityText(value: string): string {
  return value
    .replace(/\s+/gu, " ")
    .split("·")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .join(" · ");
}

function genericAction(origin: ToolEventOrigin | undefined): string {
  return origin?.kind === "mcp" ? "Call" : "Use";
}

function displayToolName(toolName: string, origin: ToolEventOrigin | undefined): string {
  if (origin?.kind !== "mcp") return toolName;
  const tool = origin.tool?.trim() || toolName;
  const server = origin.server?.trim();
  return server ? `${server} · ${tool}` : tool;
}

function displayToolIdentity(toolName: string, origin: ToolEventOrigin | undefined): string {
  if (origin?.kind !== "mcp") return toolName;
  const tool = origin.tool?.trim() || toolName;
  const server = origin.server?.trim();
  return server ? `${server}/${tool}` : tool;
}

function readStringAtPointer(value: unknown, pointer: string | undefined): string | undefined {
  return pointer ? readStringsAtPointer(value, pointer)[0] : undefined;
}

function readStringsAtPointer(value: unknown, pointer: string): string[] {
  const tokens = parsePointer(pointer);
  const visit = (current: unknown, index: number): string[] => {
    if (index >= tokens.length) {
      return typeof current === "string" && current.trim() ? [current.trim()] : [];
    }
    const token = tokens[index];
    if (token === "*") {
      if (Array.isArray(current)) return current.flatMap((entry) => visit(entry, index + 1));
      return isRecord(current) ? Object.values(current).flatMap((entry) => visit(entry, index + 1)) : [];
    }
    if (Array.isArray(current)) {
      return /^(?:0|[1-9]\d*)$/u.test(token) && Number(token) < current.length
        ? visit(current[Number(token)], index + 1)
        : [];
    }
    return isRecord(current) && Object.hasOwn(current, token) ? visit(current[token], index + 1) : [];
  };
  return visit(value, 0);
}

function parsePointer(pointer: string): string[] {
  return pointer === ""
    ? []
    : pointer
        .slice(1)
        .split("/")
        .map((token) => token.replace(/~1/gu, "/").replace(/~0/gu, "~"));
}

function appendArgumentPreview(label: string, argumentPreview: string | undefined): string {
  return argumentPreview ? `${label} · ${argumentPreview}` : label;
}

function readActivityArgumentPreviewParts({
  command,
  subjects,
  arguments: value,
}: {
  readonly command?: string;
  readonly subjects: readonly string[];
  readonly arguments?: unknown;
}): readonly string[] {
  const supplemental = command ? subjects.filter((subject) => subject !== command) : subjects;
  // A legacy truncation envelope carries no readable arguments, and enumerating
  // it prints the marker itself (`__truncated=true · preview=…`). Treat it as
  // "arguments unavailable" so the label falls back to the declared action.
  const readable = readLegacyTruncatedEnvelope(value) ? undefined : value;
  const values = [
    ...(command ? [command] : []),
    ...(supplemental.length > 0
      ? supplemental
      : !command && subjects.length === 0
        ? collectArgumentValues(readable)
        : []),
  ];
  const normalized = [...new Set(values.map(compactPreview).filter(Boolean))].slice(0, 3);
  const joined = normalized.join(" · ");
  return joined && compactPreview(joined) !== joined ? [compactPreview(joined)] : normalized;
}

function collectArgumentValues(value: unknown): string[] {
  const entries: string[] = [];
  const visit = (current: unknown, path: string[], depth: number): void => {
    if (entries.length >= 3 || depth > 2 || current === null || current === undefined) return;
    if (typeof current === "string" || typeof current === "number" || typeof current === "boolean") {
      const text = String(current).trim();
      if (text) entries.push(path.length > 0 ? `${path.join(".")}=${text}` : text);
      return;
    }
    if (Array.isArray(current)) {
      current.slice(0, 2).forEach((entry, index) => visit(entry, [...path, String(index + 1)], depth + 1));
      return;
    }
    if (!isRecord(current)) return;
    Object.entries(current).forEach(([key, entry]) => {
      if (!isSensitiveArgumentKey(key)) visit(entry, [...path, key], depth + 1);
    });
  };
  visit(value, [], 0);
  return entries;
}

/** The legacy byte-slice envelope, written by builds before shape-preserving projection. */
const LegacyTruncationEnvelopeKey = "__truncated";

/**
 * Recognizes the retired `{ __truncated, preview }` marker. Only historical
 * step traces contain it; new writes never do. It must be identified rather
 * than enumerated, because the envelope is dead data that merely resembles a
 * record — flattening it is what once put raw JSON on the row.
 */
export function readLegacyTruncatedEnvelope(value: unknown): { readonly preview: string } | undefined {
  if (!isRecord(value) || value[LegacyTruncationEnvelopeKey] !== true) return undefined;
  return { preview: typeof value.preview === "string" ? value.preview : "" };
}

function isSensitiveArgumentKey(key: string): boolean {
  return /authorization|credential|cookie|password|secret|token|api[-_]?key/iu.test(key);
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map(compactPreview).filter(Boolean))];
}

function compactArgumentValues(values: readonly string[]): string | undefined {
  return values.length > 0 ? compactPreview(values.join(" · ")) : undefined;
}

function compactPreview(value: string): string {
  const normalized = value.replace(/\s+/gu, " ").trim();
  return normalized.length > 96 ? `${normalized.slice(0, 93)}...` : normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
