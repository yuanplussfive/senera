import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { readOptionalUtf8, writeUtf8Atomically } from "../../../Build/GeneratedTextFile.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("generated text files", () => {
  test("reads missing files without a separate existence check", () => {
    const directory = createTemporaryDirectory();

    expect(readOptionalUtf8(path.join(directory, "missing.json"))).toBeUndefined();
  });

  test("creates and replaces generated files without leaving temporary artifacts", () => {
    const directory = createTemporaryDirectory();
    const outputDirectory = path.join(directory, "generated");
    const filePath = path.join(outputDirectory, "contract.json");

    writeUtf8Atomically(filePath, "first\n");
    writeUtf8Atomically(filePath, "second\n");

    expect(fs.readFileSync(filePath, "utf8")).toBe("second\n");
    expect(fs.readdirSync(outputDirectory)).toEqual(["contract.json"]);
  });
});

function createTemporaryDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "senera-generated-text-"));
  temporaryDirectories.push(directory);
  return directory;
}
