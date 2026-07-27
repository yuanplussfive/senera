import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { errorMessage, toError } from "../../../Source/AgentSystem/Core/AgentErrors.js";
import { writeFileAtomic, writeFileAtomicSync } from "../../../Source/AgentSystem/Core/AgentFs.js";
import { sha256Hex, sha256HexOfCanonicalJson } from "../../../Source/AgentSystem/Core/AgentHash.js";
import { withDeadline } from "../../../Source/AgentSystem/Core/AgentTiming.js";
import { toPosixPath, toPosixRelative, walkFiles } from "../../Support/FileWalk.js";
import { inspectTextIncludes, inspectWorkflowNamedStep, workflowJobBlock } from "../../Support/WorkflowGovernance.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("core utilities", () => {
  test("normalizes unknown error values", () => {
    const existing = new Error("failed");

    expect(errorMessage(existing)).toBe("failed");
    expect(errorMessage("failed")).toBe("failed");
    expect(toError(existing)).toBe(existing);
    expect(toError("failed")).toMatchObject({ message: "failed" });
  });

  test("hashes data and canonical JSON deterministically", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256HexOfCanonicalJson({ alpha: 1, beta: 2 })).toBe(sha256HexOfCanonicalJson({ beta: 2, alpha: 1 }));
  });

  test("clears a deadline timer when the operation settles first", async () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");

    await expect(withDeadline(Promise.resolve("done"), 10_000, () => new Error("late"))).resolves.toBe("done");

    expect(clearTimeoutSpy).toHaveBeenCalledOnce();
  });

  test("rejects with the caller-provided deadline error", async () => {
    const deadlineError = new Error("deadline reached");

    await expect(withDeadline(new Promise<never>(() => {}), 1, () => deadlineError)).rejects.toBe(deadlineError);
  });

  test("atomically creates and replaces files without temporary artifacts", async () => {
    const directory = createTemporaryDirectory();
    const outputDirectory = path.join(directory, "nested");
    const filePath = path.join(outputDirectory, "state.json");

    writeFileAtomicSync(filePath, "first\n");
    await writeFileAtomic(filePath, "second\n");

    expect(fs.readFileSync(filePath, "utf8")).toBe("second\n");
    expect(fs.readdirSync(outputDirectory)).toEqual(["state.json"]);
  });
});

describe("file walking utilities", () => {
  test("filters extensions, prunes excluded directories, and sorts paths", () => {
    const directory = createTemporaryDirectory();
    writeFixture(path.join(directory, "z.ts"));
    writeFixture(path.join(directory, "keep", "a.ts"));
    writeFixture(path.join(directory, "keep", "ignored.json"));
    writeFixture(path.join(directory, "node_modules", "hidden.ts"));

    const files = walkFiles(directory, {
      extensions: [".ts"],
      excludeDirectoryNames: new Set(["node_modules"]),
    });

    expect(files.map((file) => toPosixRelative(directory, file))).toEqual(["keep/a.ts", "z.ts"]);
  });

  test("normalizes mixed path separators", () => {
    expect(toPosixPath("one\\two/three.ts")).toBe("one/two/three.ts");
  });
});

describe("workflow governance utilities", () => {
  const workflow = `
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - name: Run verification
        run: npm test
      - uses: actions/upload-artifact@v4
  release:
    runs-on: ubuntu-latest
`;

  test("isolates a job without consuming the following job", () => {
    const block = workflowJobBlock(workflow, "verify");

    expect(block).toContain("Run verification");
    expect(block).not.toContain("release:");
    expect(workflowJobBlock(workflow, "missing")).toBeUndefined();
  });

  test("checks required workflow and named-step terms", () => {
    const block = workflowJobBlock(workflow, "verify")!;

    expect(inspectTextIncludes(block, "verify job", ["npm test"])).toEqual([]);
    expect(inspectWorkflowNamedStep(block, "verify job", "Run verification", ["npm test"])).toEqual([]);
    expect(inspectWorkflowNamedStep(block, "verify job", "Missing step", [])).toEqual([
      "verify job must define step Missing step.",
    ]);
  });
});

function createTemporaryDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "senera-core-utilities-"));
  temporaryDirectories.push(directory);
  return directory;
}

function writeFixture(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, "fixture\n");
}
