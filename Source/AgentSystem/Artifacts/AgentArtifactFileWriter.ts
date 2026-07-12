import fs from "node:fs/promises";
import path from "node:path";

export async function writeArtifactJson(filePath: string, value: unknown): Promise<void> {
  await writeArtifactText(filePath, `${JSON.stringify(value, null, 2)}\n`, Number.MAX_SAFE_INTEGER);
}

export async function writeBoundedArtifactJson(filePath: string, value: unknown, maxBytes: number): Promise<void> {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  if (byteLength(text) <= maxBytes) {
    await writeArtifactText(filePath, text, maxBytes + 64);
    return;
  }

  await writeArtifactJson(filePath, {
    truncated: true,
    originalBytes: byteLength(text),
    preview: truncateArtifactText(text, maxBytes),
  });
}

export async function writeArtifactText(filePath: string, value: string, maxBytes: number): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  const text =
    byteLength(value) > maxBytes
      ? `${Buffer.from(value).subarray(0, maxBytes).toString("utf8")}\n[truncated]\n`
      : value;
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, text, "utf8");
  await fs.rename(tempPath, filePath);
}

export function truncateArtifactText(value: string, maxChars: number): string {
  return value.length > maxChars ? `${value.slice(0, Math.max(0, maxChars - 13))}\n[truncated]` : value;
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}
