import crypto from "node:crypto";

export interface AgentTextPreview {
  text: string;
  originalChars: number;
  truncated: boolean;
  omittedChars: number;
  sha1?: string;
}

export function projectAgentTextPreview(
  value: string,
  maxChars: number,
): AgentTextPreview {
  const text = String(value);
  const limit = Math.max(0, Math.floor(maxChars));
  if (text.length <= limit) {
    return {
      text,
      originalChars: text.length,
      truncated: false,
      omittedChars: 0,
    };
  }

  const sha1 = crypto.createHash("sha1").update(text).digest("hex").slice(0, 16);
  const suffix = `[truncated originalChars=${text.length} omittedChars=${Math.max(0, text.length - limit)} sha1=${sha1}]`;
  const separator = limit > suffix.length + 1 ? "\n" : "";
  const bodyChars = Math.max(0, limit - suffix.length - separator.length);
  const preview = bodyChars > 0 ? text.slice(0, bodyChars).trimEnd() : "";
  return {
    text: `${preview}${separator}${suffix}`,
    originalChars: text.length,
    truncated: true,
    omittedChars: text.length - bodyChars,
    sha1,
  };
}

export function previewAgentText(value: string, maxChars: number): string {
  return projectAgentTextPreview(value, maxChars).text;
}
