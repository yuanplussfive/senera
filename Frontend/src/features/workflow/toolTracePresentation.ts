import { resolveFrontendLocalizedText } from "../../i18n/frontendLocaleModel";
import type { ToolEventOrigin, ToolResultPresentationEvidence } from "../../api/eventTypes";
import { readTypedAtPointer } from "./toolActivityPresentation";

/**
 * One contract-declared argument rendered for the trace detail. The label comes
 * from the package, the value from the declared pointer — raw arguments never
 * reach the DOM on their own.
 */
export interface ToolTraceParameter {
  readonly label: string;
  readonly value: string;
}

/**
 * One evidence row from a tool result, reduced to what a trace line shows.
 * `source` carries the host for a link and stays as declared otherwise.
 */
export interface ToolTraceSource {
  readonly id: string;
  readonly label: string;
  readonly href?: string;
  readonly source: string;
}

/**
 * Resolves `preview.parameters` against the live arguments. Values are read
 * only through the pointers the contract declared, so a tool that declares
 * nothing renders nothing rather than a raw dump.
 */
export function projectToolTraceParameters(
  origin: ToolEventOrigin | undefined,
  args: unknown,
): readonly ToolTraceParameter[] {
  const presentation = origin?.presentation;
  const parameters = presentation?.preview?.parameters ?? [];
  return parameters.flatMap((parameter) => {
    // The activity's own argument path already renders as the row's target;
    // repeating it here would print the same value twice in one detail block.
    if (parameter.pointer === presentation?.activity.argumentPath) return [];
    // A parameter is a scalar leaf. A container would print as "[object
    // Object]" or a JSON blob on a single trace line.
    const values = readTypedAtPointer(args, parameter.pointer).flatMap((value) =>
      typeof value === "string"
        ? value.trim()
          ? [value.trim()]
          : []
        : typeof value === "number" || typeof value === "boolean"
          ? [String(value)]
          : [],
    );
    return values.length ? [{ label: resolveFrontendLocalizedText(parameter.label), value: values.join(" · ") }] : [];
  });
}

/**
 * Projects result evidence into trace rows, de-duplicating by link so a tool
 * that reports the same page repeatedly lists it once.
 */
export function projectToolTraceSources(
  evidence: readonly ToolResultPresentationEvidence[],
): readonly ToolTraceSource[] {
  const byHref = new Map<string, ToolTraceSource>();
  for (const entry of evidence) {
    const url = readEvidenceUrl(entry);
    const id = url?.href ?? entry.evidenceUri;
    if (byHref.has(id)) continue;
    byHref.set(id, {
      id,
      label: entry.label || entry.display,
      source: url?.hostname ?? entry.source,
      ...(url ? { href: url.href } : {}),
    });
  }
  return [...byHref.values()];
}

/** Only an absolute http(s) locator becomes a link; anything else stays text. */
function readEvidenceUrl(entry: ToolResultPresentationEvidence): URL | undefined {
  const locator = entry.locator?.trim();
  if (!locator || !URL.canParse(locator)) return undefined;
  const url = new URL(locator);
  return url.protocol === "https:" || url.protocol === "http:" ? url : undefined;
}
