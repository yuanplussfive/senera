import { readAgentUnknownRecord } from "../Core/AgentUnknownValue.js";

export interface AgentPiToolResultMediaSanitization {
  readonly result: unknown;
  readonly notice?: string;
}

/**
 * Final model-boundary guard for tool results. Artifact publication normally
 * turns inline image data into resources first. If publication was unavailable
 * or a nonconforming caller bypassed that boundary, this guard guarantees that
 * model-facing tool content still never contains an image payload.
 */
export function sanitizeAgentPiToolResultMedia(value: unknown): AgentPiToolResultMediaSanitization {
  let removedImageCount = 0;
  const result = sanitizeValue(value, new WeakSet<object>(), () => {
    removedImageCount += 1;
  });
  return {
    result,
    ...(removedImageCount > 0
      ? {
          notice:
            removedImageCount === 1
              ? "A tool image was withheld because it was not published as a durable resource."
              : `${removedImageCount} tool images were withheld because they were not published as durable resources.`,
        }
      : {}),
  };
}

function sanitizeValue(value: unknown, ancestors: WeakSet<object>, onImage: () => void): unknown {
  if (value === null || typeof value !== "object") return value;
  if (ancestors.has(value)) return value;

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      let changed = false;
      const projected = value.map((entry) => {
        const next = sanitizeValue(entry, ancestors, onImage);
        changed ||= next !== entry;
        return next;
      });
      return changed ? projected : value;
    }

    const record = readAgentUnknownRecord(value);
    if (!record) return value;
    if (isDeclaredInlineImage(record)) {
      onImage();
      return {
        type: "media_unavailable",
        reason: "unpublished_inline_image",
        message:
          "The tool returned inline image data outside the durable resource boundary, so no image bytes were sent to the model.",
      };
    }

    let changed = false;
    const entries = Object.entries(record).map(([key, entry]) => {
      const next = sanitizeValue(entry, ancestors, onImage);
      changed ||= next !== entry;
      return [key, next] as const;
    });
    return changed ? Object.fromEntries(entries) : value;
  } finally {
    ancestors.delete(value);
  }
}

function isDeclaredInlineImage(record: Record<string, unknown>): boolean {
  return record.type === "image" && (Object.hasOwn(record, "data") || Object.hasOwn(record, "mimeType"));
}
