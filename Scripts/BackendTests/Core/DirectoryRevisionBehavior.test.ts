import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { AgentDirectoryRevisionCache } from "../../../Source/AgentSystem/Core/AgentDirectoryRevision.js";

const temporaryRoots: string[] = [];

afterEach(() => {
  temporaryRoots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true }));
});

describe("directory revision cache", () => {
  test("is stable until file content changes and reflects additions and removals", () => {
    const root = fixtureRoot();
    const cache = new AgentDirectoryRevisionCache();
    const file = path.join(root, "nested", "value.txt");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "first\n");

    const initial = cache.revision(root);
    expect(cache.revision(root)).toBe(initial);

    fs.writeFileSync(file, "second value\n");
    const changed = cache.revision(root);
    expect(changed).not.toBe(initial);

    fs.rmSync(file);
    expect(cache.revision(root)).not.toBe(changed);
  });

  test("drops cached state when a directory disappears", () => {
    const root = fixtureRoot();
    const cache = new AgentDirectoryRevisionCache();
    fs.writeFileSync(path.join(root, "value.txt"), "value\n");
    const populated = cache.revision(root);

    fs.rmSync(root, { recursive: true, force: true });
    const missing = cache.revision(root);
    fs.mkdirSync(root, { recursive: true });

    expect(missing).not.toBe(populated);
    expect(cache.revision(root)).toBe(missing);
  });
});

function fixtureRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "senera-directory-revision-"));
  temporaryRoots.push(root);
  return root;
}
