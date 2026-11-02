import { AgentTokenProjector } from "../Text/AgentTokenProjection.js";
import { isAgentJsonPointer, readAgentJsonPointer } from "../Core/AgentJsonPointerOperations.js";

export type AgentArtifactSelection =
  | {
      readonly path: string;
      readonly status: "found";
      readonly value: unknown;
      readonly representation: "original";
      readonly complete: true;
    }
  | { readonly path: string; readonly status: "not_found" | "invalid_pointer"; readonly message: string };

export interface AgentArtifactStructureView {
  readonly outline: unknown;
  readonly complete: boolean;
}

/** RFC 6901 selection. Own-property checks keep JSON keys separate from prototypes. */
export function selectAgentArtifactValue(value: unknown, pointer: string): AgentArtifactSelection {
  const missing = (status: "not_found" | "invalid_pointer", message: string): AgentArtifactSelection => ({
    path: pointer,
    status,
    message,
  });
  if (!isAgentJsonPointer(pointer)) {
    return missing("invalid_pointer", "Expected an RFC 6901 JSON Pointer, or an empty string for the whole value.");
  }
  const selected = readAgentJsonPointer(value, pointer);
  return selected.found
    ? { path: pointer, status: "found", representation: "original", complete: true, value: selected.value }
    : missing("not_found", "The selected field does not exist.");
}

/** A separate structure view; descriptors never masquerade as source values. */
export class AgentArtifactResultView {
  private readonly tokens: AgentTokenProjector;
  constructor(readonly model: string) {
    this.tokens = new AgentTokenProjector(model);
  }

  structure(value: unknown, tokenLimit: number, pointer = ""): AgentArtifactStructureView {
    const sourceTokens = this.tokens.countJson(value);
    if (sourceTokens <= tokenLimit) return { outline: value, complete: true };
    const descriptor = {
      deferred: true,
      path: pointer,
      type: value === null ? "null" : Array.isArray(value) ? "array" : typeof value,
      tokens: sourceTokens,
      ...(Array.isArray(value) ? { length: value.length } : {}),
      ...(value !== null && typeof value === "object" && !Array.isArray(value)
        ? { fieldCount: Object.keys(value).length }
        : {}),
    };
    const descriptorTokens = this.tokens.countJson(descriptor);
    // A descriptor can cost more than a scalar or a small container. Keep the
    // cheaper exact value even when the enclosing caller is under pressure.
    if (sourceTokens <= descriptorTokens) return { outline: value, complete: true };
    if (value === null || typeof value !== "object" || tokenLimit <= descriptorTokens) {
      return { outline: descriptor, complete: false };
    }
    if (Array.isArray(value)) {
      const items: unknown[] = [];
      let remaining = tokenLimit - this.tokens.countJson({ ...descriptor, items, omittedItems: value.length });
      for (const [index, member] of value.entries()) {
        const child = this.structure(member, remaining, `${pointer}/${index}`);
        const cost = this.tokens.countJson(child.outline);
        if (cost > remaining) break;
        items.push(child.outline);
        remaining -= cost;
      }
      const outlined = { ...descriptor, items, omittedItems: value.length - items.length };
      return {
        outline: items.length && this.tokens.countJson(outlined) <= tokenLimit ? outlined : descriptor,
        complete: false,
      };
    }
    const entries = Object.entries(value).sort((left, right) => scalarPriority(left[1]) - scalarPriority(right[1]));
    const outline: Array<readonly [string, unknown]> = [];
    const partialEnvelope = { ...descriptor, fields: {}, omittedFields: entries.length };
    let remaining = Math.max(0, tokenLimit - this.tokens.countJson(partialEnvelope));
    for (const [index, [key, member]] of entries.entries()) {
      const path = `${pointer}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`;
      const keyCost = this.tokens.countJson({ [key]: null });
      const allocation = Math.floor(remaining / (entries.length - index)) - keyCost;
      const child = this.structure(member, allocation, path);
      const cost = this.tokens.countJson({ [key]: child.outline });
      if (cost > remaining) continue;
      outline.push([key, child.outline]);
      remaining -= cost;
    }
    const partial = () => ({
      ...descriptor,
      fields: Object.fromEntries(outline),
      omittedFields: entries.length - outline.length,
    });
    while (outline.length && this.tokens.countJson(partial()) > tokenLimit) outline.pop();
    return { outline: outline.length ? partial() : descriptor, complete: false };
  }

  /** Rebudget an existing outline without treating descriptor fields as source paths. */
  fit(view: AgentArtifactStructureView, tokenLimit: number, pointer = ""): AgentArtifactStructureView {
    if (this.tokens.countJson(view) <= tokenLimit) return view;
    if (view.complete) {
      return this.structure(
        view.outline,
        Math.max(0, tokenLimit - this.tokens.countJson({ outline: null, complete: false })),
        pointer,
      );
    }
    if (!isRecord(view.outline)) return view;
    const { fields, items, ...descriptor } = view.outline;
    delete descriptor.omittedFields;
    delete descriptor.omittedItems;
    const result = (outline: unknown): AgentArtifactStructureView => ({ outline, complete: false });
    if (isRecord(fields) && typeof descriptor.fieldCount === "number") {
      const entries = Object.entries(fields).sort((left, right) => scalarPriority(left[1]) - scalarPriority(right[1]));
      const candidate = () =>
        result({
          ...descriptor,
          fields: Object.fromEntries(entries),
          omittedFields: Number(descriptor.fieldCount) - entries.length,
        });
      while (entries.length && this.tokens.countJson(candidate()) > tokenLimit) entries.pop();
      if (entries.length) return candidate();
    }
    if (Array.isArray(items) && typeof descriptor.length === "number") {
      const selected = [...items];
      const candidate = () =>
        result({ ...descriptor, items: selected, omittedItems: Number(descriptor.length) - selected.length });
      while (selected.length && this.tokens.countJson(candidate()) > tokenLimit) selected.pop();
      if (selected.length) return candidate();
    }
    return result(descriptor);
  }
}

function scalarPriority(value: unknown): number {
  return value === null || typeof value === "number" || typeof value === "boolean" ? 0 : 1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
