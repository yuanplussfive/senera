import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { errorMessage, toError } from "../../../Source/AgentSystem/Core/AgentErrors.js";
import {
  readRegularTextFileSnapshotSync,
  readRegularTextFileSync,
  writeFileAtomic,
  writeFileAtomicSync,
} from "../../../Source/AgentSystem/Core/AgentFs.js";
import { sha256Hex, sha256HexOfCanonicalJson } from "../../../Source/AgentSystem/Core/AgentHash.js";
import {
  fileSystemPathIdentity,
  isPathWithin,
  isSamePath,
  relativePathWithin,
} from "../../../Source/AgentSystem/Core/AgentPath.js";
import { agentSql } from "../../../Source/AgentSystem/Database/AgentSql.js";
import { withDeadline } from "../../../Source/AgentSystem/Core/AgentTiming.js";
import { defineSeneraProtocol } from "../../../Source/AgentSystem/Core/AgentProtocolIdentity.js";
import {
  agentStringOrEmpty,
  agentUnknownRecordOrEmpty,
  isAgentUnknownRecord,
  readAgentNonBlankString,
  readAgentNonEmptyString,
  readAgentString,
  readAgentTrimmedString,
  readAgentUnknownRecord,
} from "../../../Source/AgentSystem/Core/AgentUnknownValue.js";
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
  test("projects unknown records without treating arrays or null as records", () => {
    const record = { value: 1 };

    expect(isAgentUnknownRecord(record)).toBe(true);
    expect(readAgentUnknownRecord(record)).toBe(record);
    expect(readAgentUnknownRecord([])).toBeUndefined();
    expect(readAgentUnknownRecord(null)).toBeUndefined();
    expect(agentUnknownRecordOrEmpty("not-a-record")).toEqual({});
  });

  test("makes string normalization policy explicit", () => {
    expect(readAgentString("")).toBe("");
    expect(readAgentString(1)).toBeUndefined();
    expect(readAgentNonEmptyString(" ")).toBe(" ");
    expect(readAgentNonEmptyString("")).toBeUndefined();
    expect(readAgentNonBlankString(" value ")).toBe(" value ");
    expect(readAgentNonBlankString(" \t ")).toBeUndefined();
    expect(readAgentTrimmedString(" value ")).toBe("value");
    expect(agentStringOrEmpty(undefined)).toBe("");
  });

  test("keeps SQL templates static and delegates values to bound parameters", () => {
    expect(agentSql`SELECT * FROM records WHERE status = @status`).toContain("@status");

    expect(() =>
      Reflect.apply(agentSql, undefined, [Object.assign(["SELECT ", ""], { raw: ["SELECT ", ""] }), "dynamic"]),
    ).toThrow(/bound parameters/u);
  });

  test("normalizes unknown error values", () => {
    const existing = new Error("failed");

    expect(errorMessage(existing)).toBe("failed");
    expect(errorMessage("failed")).toBe("failed");
    expect(toError(existing)).toBe(existing);
    expect(toError("failed")).toMatchObject({ message: "failed" });
  });

  test("defines one immutable identity for a versioned Senera protocol", () => {
    const protocol = defineSeneraProtocol("example_contract", 3);

    expect(protocol).toEqual({
      name: "example_contract",
      version: 3,
      type: "senera.example_contract.v3",
    });
    expect(Object.isFrozen(protocol)).toBe(true);
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

  test("reads regular text files through a reusable metadata snapshot", () => {
    const directory = createTemporaryDirectory();
    const filePath = path.join(directory, "resource.md");
    fs.writeFileSync(filePath, "resource body", "utf8");

    const first = readRegularTextFileSnapshotSync(filePath, "Resource");
    const unchanged = readRegularTextFileSnapshotSync(filePath, "Resource", first);

    expect(unchanged).toBe(first);
    expect(readRegularTextFileSync(filePath, "Resource")).toBe("resource body");
    expect(() => readRegularTextFileSync(directory, "Resource")).toThrow(/not a regular file/u);
  });

  test("uses path segments rather than string prefixes for containment", () => {
    const root = path.resolve("workspace");

    expect(relativePathWithin(root, path.join(root, "..cache", "value"))).toBe(path.join("..cache", "value"));
    expect(isPathWithin(root, path.join(root, "nested"))).toBe(true);
    expect(isPathWithin(root, path.resolve(root, "..", "outside"))).toBe(false);
    expect(isSamePath(root, path.join(root, "."))).toBe(true);
  });

  test("normalizes filesystem identities according to platform case semantics", () => {
    const mixedCase = path.resolve("Workspace", "Project");

    expect(fileSystemPathIdentity(mixedCase, "win32")).toBe(mixedCase.toLowerCase());
    expect(fileSystemPathIdentity(mixedCase, "linux")).toBe(mixedCase);
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
