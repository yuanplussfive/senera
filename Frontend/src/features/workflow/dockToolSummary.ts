import type { TimelineStep } from "../../store/sessionStore";
import type {
  AgentToolPresentationPreview,
  AgentToolPresentationPreviewResult,
} from "../../../../Source/AgentSystem/Types/AgentToolPresentationTypes";
import type { ToolResultPresentation } from "../../api/eventTypes";
import { resolveFrontendLocalizedText } from "../../i18n/frontendLocaleModel";
import { getFrontendLocale } from "../../i18n/frontendLocaleStore";
import { readToolFailureMessage, readToolResultValue } from "./toolResultProjection";
import { projectToolActivityInspection, readTypedAtPointer, type ToolActivityStatus } from "./toolActivityPresentation";
import { readWorkflowStepDurationMs } from "./workflowPresentationProjection";

export interface DockToolSummaryRow {
  readonly title: string;
  readonly description?: string;
  readonly meta?: string;
  readonly href?: string;
}

export interface DockToolSummaryParameter {
  readonly label: string;
  readonly values: readonly string[];
}

export interface DockToolResultMore {
  readonly label: string;
  readonly count: number;
}

export type DockToolResultBody =
  | { readonly kind: "rows"; readonly rows: readonly DockToolSummaryRow[]; readonly more?: DockToolResultMore }
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "values"; readonly values: readonly string[] }
  | { readonly kind: "pairs"; readonly pairs: readonly { readonly key: string; readonly value: string }[] }
  | { readonly kind: "resources"; readonly resources: readonly string[] };

export interface DockToolSummary {
  readonly label: string;
  readonly subject?: string;
  readonly detail?: string;
  readonly parameters?: readonly DockToolSummaryParameter[];
  readonly failure?: string;
  readonly result?: DockToolResultBody;
  readonly accessibleLabel: string;
}

/**
 * Produces the dock's compact tool view solely from the registered
 * presentation contract and the runtime payloads it names. No tool names,
 * extension identifiers, or result-field conventions participate here.
 */
export function projectDockToolSummary(step: TimelineStep & { readonly toolName: string }): DockToolSummary {
  const rawResult = readToolResultValue(step);
  const inspection = projectToolActivityInspection({
    toolName: step.toolName,
    origin: step.toolOrigin,
    arguments: step.toolArgs,
    rawResult,
    result: step.toolPresentation,
    durationMs: readWorkflowStepDurationMs(step),
    status: readToolActivityStatus(step.status),
  });
  const presentation = step.toolOrigin?.presentation;
  const parameters = projectDeclaredParameters(step.toolArgs, presentation?.preview?.parameters);
  const failure = readToolFailureMessage(step);
  const rows = failure ? undefined : projectDeclaredRows(rawResult, presentation?.preview?.result);
  const body =
    rows ?? (failure ? undefined : projectDeclaredBody(rawResult, step.toolPresentation, presentation?.preview?.body));
  const result = body ?? (failure ? undefined : projectResources(step.toolPresentation?.resources));
  // An activity label is permitted to include its argument preview because it
  // serves compact call sites elsewhere. The dock has distinct action and
  // subject slots, so it takes the declared action when available instead of
  // presenting the same argument twice.
  const label = inspection.action || inspection.label || step.toolName;
  const subjectCandidate = inspection.identity ?? inspection.argumentPreview;
  const subject = isContainedDockText(label, subjectCandidate) ? undefined : subjectCandidate;
  const detail =
    isContainedDockText(label, inspection.argumentPreview) || isContainedDockText(subject, inspection.argumentPreview)
      ? undefined
      : inspection.argumentPreview;
  return {
    label,
    ...(subject ? { subject } : {}),
    ...(detail ? { detail } : {}),
    ...(parameters.length > 0 ? { parameters } : {}),
    ...(failure ? { failure } : {}),
    ...(result ? { result } : {}),
    accessibleLabel: [
      label,
      subject,
      detail,
      ...parameters.flatMap((parameter) => [parameter.label, ...parameter.values]),
      failure,
      result ? describeResult(result) : undefined,
    ]
      .filter(Boolean)
      .join(" · "),
  };
}

function isContainedDockText(container: string | undefined, value: string | undefined): boolean {
  if (!container || !value) return false;
  const normalizedContainer = normalizeDockText(container);
  const normalizedValue = normalizeDockText(value);
  return normalizedValue.length > 0 && normalizedContainer.includes(normalizedValue);
}

function normalizeDockText(value: string): string {
  return value.replace(/\s+/gu, " ").trim().toLocaleLowerCase();
}

function projectDeclaredParameters(
  argumentsValue: unknown,
  declarations: AgentToolPresentationPreview["parameters"] | undefined,
): DockToolSummaryParameter[] {
  if (argumentsValue === undefined || !declarations?.length) return [];
  return declarations.flatMap((declaration) => {
    const values = uniqueStrings(
      readTypedAtPointer(argumentsValue, declaration.pointer)
        .map(readScalarValue)
        .filter((value): value is string => value !== undefined),
    );
    if (values.length === 0) return [];
    return [{ label: resolveFrontendLocalizedText(declaration.label, getFrontendLocale()), values }];
  });
}

function projectDeclaredRows(
  result: unknown,
  declaration: AgentToolPresentationPreviewResult | undefined,
): DockToolResultBody | undefined {
  if (!declaration || result === undefined) return undefined;
  const projected = declaration.rows.flatMap((row) =>
    readTypedAtPointer(result, row.pointer).flatMap((entry) => {
      const title = readScalar(entry, row.titlePath);
      if (!title) return [];
      const description = row.descriptionPath ? readScalar(entry, row.descriptionPath) : undefined;
      const meta = row.metaPath ? readScalar(entry, row.metaPath) : undefined;
      const href = row.hrefPath ? readExternalHref(readScalar(entry, row.hrefPath)) : undefined;
      return [{ title, ...(description ? { description } : {}), ...(meta ? { meta } : {}), ...(href ? { href } : {}) }];
    }),
  );
  const unique = uniqueRows(projected);
  const more = projectRowsMore(result, declaration, unique.length);
  return unique.length > 0 || more?.count ? { kind: "rows", rows: unique, ...(more ? { more } : {}) } : undefined;
}

function projectRowsMore(
  result: unknown,
  declaration: AgentToolPresentationPreviewResult,
  visibleCount: number,
): DockToolResultMore | undefined {
  const more = declaration.more;
  if (!more) return undefined;
  const values = readTypedAtPointer(result, more.pointer);
  const count = more.countPath
    ? values
        .flatMap((value) => readTypedAtPointer(value, more.countPath!))
        .map(Number)
        .filter((value) => Number.isFinite(value) && value > 0)
        .reduce((total, value) => total + value, 0)
    : values.flatMap((value) => (Array.isArray(value) ? value : [value])).length;
  const rowsCountCollection = declaration.rows.some((row) => collectionPointer(row.pointer) === more.pointer);
  const remaining = rowsCountCollection ? Math.max(0, count - visibleCount) : count;
  return { label: resolveFrontendLocalizedText(more.label, getFrontendLocale()), count: remaining };
}

function projectDeclaredBody(
  rawResult: unknown,
  presentationResult: TimelineStep["toolPresentation"],
  declaration: NonNullable<AgentToolPresentationPreview["body"]> | undefined,
): DockToolResultBody | undefined {
  if (!declaration) return undefined;
  const source = declaration.from === "presentation" ? presentationResult : rawResult;
  if (source === undefined) return undefined;
  return classifyBodyValues(readTypedAtPointer(source, declaration.pointer));
}

function classifyBodyValues(values: readonly unknown[]): DockToolResultBody | undefined {
  if (values.length === 0) return undefined;
  const contentBlocks = flattenContainerValues(values).filter(isStandardContentBlock);
  if (contentBlocks.length > 0) {
    const texts = uniqueStrings(
      contentBlocks.flatMap((block) => (block.type === "text" && typeof block.text === "string" ? [block.text] : [])),
    );
    return texts.length > 0 ? { kind: "text", text: texts.join("\n") } : undefined;
  }
  if (values.length === 1) {
    const [value] = values;
    const scalar = readScalarValue(value);
    if (scalar) return { kind: "text", text: scalar };
    if (isRecord(value)) {
      const pairs = Object.entries(value).flatMap(([key, entry]) => {
        const text = readScalarValue(entry);
        return text ? [{ key, value: text }] : [];
      });
      if (pairs.length > 0) return { kind: "pairs", pairs };
    }
    if (Array.isArray(value)) return projectValueList(value);
  }
  return projectValueList(values);
}

function flattenContainerValues(values: readonly unknown[]): unknown[] {
  return values.flatMap((value) => (Array.isArray(value) ? flattenContainerValues(value) : [value]));
}

/** Standard tool content blocks have a fixed, tool-independent wire contract. */
function isStandardContentBlock(value: unknown): value is { readonly type: string; readonly text?: unknown } {
  return isRecord(value) && typeof value.type === "string" && (value.type === "text" || value.type === "image");
}

function projectValueList(values: readonly unknown[]): DockToolResultBody | undefined {
  const items = values.flatMap(readValueLabel);
  return items.length > 0 ? { kind: "values", values: uniqueStrings(items) } : undefined;
}

function readValueLabel(value: unknown): string[] {
  const scalar = readScalarValue(value);
  if (scalar) return [scalar];
  if (Array.isArray(value)) return value.flatMap(readValueLabel);
  if (!isRecord(value)) return [];
  const values = Object.values(value).flatMap(readValueLabel);
  return values.length > 0 ? [values.join(" · ")] : [];
}

function projectResources(resources: ToolResultPresentation["resources"] | undefined): DockToolResultBody | undefined {
  if (!resources?.length) return undefined;
  const names = uniqueStrings(resources.map((resource) => resource.name || resource.uri));
  return names.length > 0 ? { kind: "resources", resources: names } : undefined;
}

function readScalar(value: unknown, pointer: string): string | undefined {
  return readTypedAtPointer(value, pointer)
    .map(readScalarValue)
    .find((candidate): candidate is string => Boolean(candidate));
}

function readScalarValue(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") return undefined;
  const text = String(value).replace(/\s+/gu, " ").trim();
  return text || undefined;
}

function readExternalHref(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function uniqueRows(rows: readonly DockToolSummaryRow[]): DockToolSummaryRow[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = `${row.title}\u0000${row.description ?? ""}\u0000${row.meta ?? ""}\u0000${row.href ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function collectionPointer(pointer: string): string {
  return pointer.endsWith("/*") ? pointer.slice(0, -2) : pointer;
}

function describeResult(result: DockToolResultBody): string {
  switch (result.kind) {
    case "text":
      return result.text;
    case "rows":
      return result.rows.map((row) => row.title).join(" · ");
    case "values":
      return result.values.join(" · ");
    case "pairs":
      return result.pairs.map((pair) => `${pair.key}: ${pair.value}`).join(" · ");
    case "resources":
      return result.resources.join(" · ");
  }
}

function readToolActivityStatus(status: TimelineStep["status"]): ToolActivityStatus {
  if (status === "failed") return "failed";
  if (status === "cancelled") return "cancelled";
  return status === "pending" || status === "running" || status === "cancelling" ? "active" : "completed";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
