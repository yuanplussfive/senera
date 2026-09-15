export type AgentJsonPath = readonly (string | number)[];

export function agentJsonPathToPointer(path: AgentJsonPath): string {
  return path.length === 0 ? "" : `/${path.map(encodePointerSegment).join("/")}`;
}

export function agentJsonPointerToPath(pointer: string): Array<string | number> {
  if (pointer === "") return [];
  if (!pointer.startsWith("/")) throw new TypeError(`Invalid JSON Pointer: ${pointer}`);
  return pointer.slice(1).split("/").map(decodePointerSegment).map(projectArrayIndex);
}

function encodePointerSegment(segment: string | number): string {
  return String(segment).replaceAll("~", "~0").replaceAll("/", "~1");
}

function decodePointerSegment(segment: string): string {
  return segment.replaceAll("~1", "/").replaceAll("~0", "~");
}

function projectArrayIndex(segment: string): string | number {
  const value = Number(segment);
  return Number.isSafeInteger(value) && value >= 0 && String(value) === segment ? value : segment;
}
