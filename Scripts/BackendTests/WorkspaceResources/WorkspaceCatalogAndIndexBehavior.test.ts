import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { afterEach, expect, test } from "vitest";
import { AgentWorkspaceCatalog } from "../../../Source/AgentSystem/WorkspaceResources/AgentWorkspaceCatalog.js";
import { AgentWorkspacePathIndex } from "../../../Source/AgentSystem/WorkspaceResources/AgentWorkspacePathIndex.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "senera-workspaces-"));
  roots.push(root);
  const a = path.join(root, "a"),
    b = path.join(root, "b");
  await Promise.all([fs.mkdir(a), fs.mkdir(b)]);
  return { root, a, b, stateRoot: path.join(root, "state") };
}

test("workspace identities and recent order survive reopening without copying configuration", async () => {
  const input = await fixture();
  const catalog = new AgentWorkspaceCatalog({ stateRoot: input.stateRoot, allowedRoots: [input.root] });
  const a = catalog.register(input.a),
    b = catalog.register(input.b);
  catalog.recordOpened(input.a);
  const reopened = new AgentWorkspaceCatalog({ stateRoot: input.stateRoot, allowedRoots: [input.root] });
  expect(reopened.list().map((record) => record.id)).toEqual([a.id, b.id]);
  expect(reopened.register(path.join(input.a, ".")).id).toBe(a.id);
  expect(await fs.readdir(input.b)).toEqual([]);
});

test("mounted-root containment and directory browsing use canonical paths", async () => {
  const input = await fixture();
  const catalog = new AgentWorkspaceCatalog({ stateRoot: input.stateRoot, allowedRoots: [input.a] });
  expect(() => catalog.register(input.b)).toThrow("outside");
  expect(catalog.browse(input.a).parent).toBeNull();
  await fs.mkdir(path.join(input.a, "child"));
  expect(catalog.browse(input.a).directories).toEqual([{ path: path.join(input.a, "child"), name: "child" }]);
});

test("file search covers unopened directories and nested ignore rules", async () => {
  const { a } = await fixture();
  await fs.mkdir(path.join(a, "src", "deep"), { recursive: true });
  await fs.mkdir(path.join(a, ".senera"));
  await Promise.all([
    fs.writeFile(path.join(a, "src", "deep", "weather.ts"), "export {}"),
    fs.writeFile(path.join(a, "src", ".gitignore"), "secret.ts\n"),
    fs.writeFile(path.join(a, "src", "secret.ts"), "private"),
    fs.writeFile(path.join(a, ".senera", "weather.json"), "private"),
  ]);
  const index = new AgentWorkspacePathIndex(a);
  expect(await index.search("weather")).toEqual(["src/deep/weather.ts"]);
  expect(await index.search("secret")).toEqual([]);
});

test("search reconciles additions, deletions and changed ignore rules across concurrent queries", async () => {
  const { a } = await fixture();
  const index = new AgentWorkspacePathIndex(a);
  await fs.writeFile(path.join(a, "old.txt"), "old");
  expect(await index.search("old")).toEqual(["old.txt"]);
  await Promise.all([fs.rm(path.join(a, "old.txt")), fs.writeFile(path.join(a, "new.txt"), "new")]);
  index.invalidate(["old.txt", "new.txt"]);
  expect(await Promise.all([index.search("old"), index.search("new")])).toEqual([[], ["new.txt"]]);
  await fs.writeFile(path.join(a, ".gitignore"), "new.txt\n");
  index.invalidate([".gitignore"]);
  expect(await index.search("new")).toEqual([]);
});
