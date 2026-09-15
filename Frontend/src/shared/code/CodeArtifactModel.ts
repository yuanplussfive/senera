import { LruCache } from "../../lib/LruCache";
import { defaultCodeFilename, resolveCodePreview } from "./CodePreviewRegistry";

export interface CodeArtifact {
  code: string;
  language: string;
  lineCount: number;
  filename: string;
  preview: ReturnType<typeof resolveCodePreview>;
}

const codeArtifactCache = new LruCache<string, CodeArtifact>(160);

export function readCodeArtifact(language: string, code: string): CodeArtifact {
  const cacheKey = [language, code].join("\u0000");
  const cached = codeArtifactCache.get(cacheKey);
  if (cached) return cached;

  const artifact = {
    code,
    language,
    lineCount: countCodeLines(code),
    filename: defaultCodeFilename(language),
    preview: resolveCodePreview(language, code),
  };

  codeArtifactCache.set(cacheKey, artifact);
  return artifact;
}

function countCodeLines(text: string): number {
  if (!text) return 0;
  return text.split("\n").length;
}
