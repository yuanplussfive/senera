const TagStart = "\u{E0001}";
const TagEnd = "\u{E007F}";
const MinimumAscii = 0x20;
const MaximumAscii = 0x7e;
const TagBase = 0xe0000;
const WatermarkPrefix = "senera:";

export function createAgentContinuityWatermark(anchorId: string): string {
  const payload = `${WatermarkPrefix}${anchorId}`;
  if (!/^[\x20-\x7e]+$/u.test(payload)) {
    throw new Error("Continuity watermark payload must be printable ASCII.");
  }
  return `${TagStart}${[...payload].map(toTagCharacter).join("")}${TagEnd}`;
}

export function attachAgentContinuityWatermark(text: string, anchorId: string): string {
  return `${stripAgentContinuityWatermarks(text)}${createAgentContinuityWatermark(anchorId)}`;
}

export function readAgentContinuityWatermarks(text: string): string[] {
  const values: string[] = [];
  const expression = new RegExp(`${TagStart}([\\u{E0020}-\\u{E007E}]+)${TagEnd}`, "gu");
  for (const match of text.matchAll(expression)) {
    const decoded = [...match[1]].map(fromTagCharacter).join("");
    if (decoded.startsWith(WatermarkPrefix)) values.push(decoded.slice(WatermarkPrefix.length));
  }
  return values;
}

export function stripAgentContinuityWatermarks(text: string): string {
  return text.replace(new RegExp(`${TagStart}[\\u{E0020}-\\u{E007E}]+${TagEnd}`, "gu"), "");
}

function toTagCharacter(value: string): string {
  const codePoint = value.codePointAt(0);
  if (codePoint === undefined || codePoint < MinimumAscii || codePoint > MaximumAscii) {
    throw new Error("Continuity watermark payload contains an unsupported character.");
  }
  return String.fromCodePoint(TagBase + codePoint);
}

function fromTagCharacter(value: string): string {
  const codePoint = value.codePointAt(0);
  if (codePoint === undefined) throw new Error("Invalid continuity watermark.");
  const decoded = codePoint - TagBase;
  if (decoded < MinimumAscii || decoded > MaximumAscii) throw new Error("Invalid continuity watermark tag character.");
  return String.fromCodePoint(decoded);
}
