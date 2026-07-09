import { isUtf8 } from "node:buffer";
import { detect } from "chardet";
import iconv from "iconv-lite";

export type SeneraProcessOutputEncoding = "utf8" | "auto";

export interface SeneraProcessOutputDecoderOptions {
  encoding?: SeneraProcessOutputEncoding;
}

export function decodeSeneraProcessOutput(
  buffer: Buffer,
  options: SeneraProcessOutputDecoderOptions = {},
): string {
  if (buffer.length === 0) {
    return "";
  }

  if ((options.encoding ?? "utf8") === "utf8" || isUtf8(buffer)) {
    return buffer.toString("utf8");
  }

  const detected = normalizeDetectedEncoding(detect(buffer));
  const candidates = buildEncodingCandidates(detected);

  for (const candidate of candidates) {
    if (iconv.encodingExists(candidate)) {
      return iconv.decode(buffer, candidate);
    }
  }

  return buffer.toString("utf8");
}

function normalizeDetectedEncoding(value: string | null): string | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.toLowerCase().replace(/[_\s]/g, "-");
  const aliases: Record<string, string> = {
    "gb-18030": "gb18030",
    "gb-2312": "gb18030",
    gbk: "gb18030",
    "windows-936": "gb18030",
    "iso-8859-1": "latin1",
  };
  return aliases[normalized] ?? normalized;
}

function buildEncodingCandidates(detected: string | undefined): string[] {
  const candidates = [
    process.platform === "win32" ? "gb18030" : undefined,
    isLikelyMisdetectedGb18030(detected) ? "gb18030" : undefined,
    detected,
    "utf8",
  ].filter((value): value is string => Boolean(value));

  return Array.from(new Set(candidates));
}

function isLikelyMisdetectedGb18030(detected: string | undefined): boolean {
  return detected === "big5";
}
