import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export function readOptionalUtf8(filePath: string): string | undefined {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch (error) {
    if (nodeErrorCode(error) === "ENOENT") return undefined;
    throw error;
  }
}

export function writeUtf8Atomically(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  try {
    fs.writeFileSync(temporaryPath, content, { encoding: "utf8", flag: "wx" });
    fs.renameSync(temporaryPath, filePath);
  } catch (writeError) {
    try {
      fs.unlinkSync(temporaryPath);
    } catch (cleanupError) {
      if (nodeErrorCode(cleanupError) !== "ENOENT") {
        throw new AggregateError([writeError, cleanupError], `Could not replace generated file: ${filePath}`, {
          cause: cleanupError,
        });
      }
    }
    throw writeError;
  }
}

function nodeErrorCode(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;
}
