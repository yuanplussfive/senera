import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { zipSync, unzipSync } from "fflate";
import { afterEach, expect, test } from "vitest";
import {
  AgentQqClientReleaseNotFoundError,
  resolveAgentQqClientResource,
} from "../../../Source/AgentSystem/Channels/Client/AgentQqClientResource.js";
import { AgentQqClientBuild } from "../../../Source/AgentSystem/Channels/Client/AgentQqClientBuildContract.js";
import { AgentClientExtensionStore } from "../../../Source/AgentSystem/Channels/Client/AgentClientExtensionStore.js";
import { prepareQqClientBuild, qqClientArchive } from "../Support/QqClientBuildFixture.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function createStore() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "senera-qq-extension-"));
  roots.push(root);
  return prepareQqClientBuild(root);
}

test("installed clients survive restart independently of the console build", async () => {
  const store = await createStore();
  const resource = resolveAgentQqClientResource(store);
  expect(await fs.readFile(resource.entryFile, "utf8")).toContain("QQ client");
  expect(resolveAgentQqClientResource(new AgentClientExtensionStore(store.root))).toEqual(resource);
  expect(() => resolveAgentQqClientResource(store, "f".repeat(64))).toThrow(AgentQqClientReleaseNotFoundError);
});

test("failed update preserves the active version and later updates keep pinned assets available", async () => {
  const store = await createStore();
  const original = resolveAgentQqClientResource(store);
  const corrupt = unzipSync(qqClientArchive().archive);
  corrupt["assets/client.js"] = Buffer.from("bad payload");
  await expect(store.install(AgentQqClientBuild.id, Buffer.from(zipSync(corrupt)))).rejects.toThrow();
  expect(resolveAgentQqClientResource(store)).toEqual(original);
  const next = qqClientArchive({ "qq/index.html": "<html><head></head><body>updated</body></html>" });
  await store.install(AgentQqClientBuild.id, next.archive);
  expect(resolveAgentQqClientResource(store).release).toBe(next.manifest.revision);
  expect(resolveAgentQqClientResource(store, original.release)).toEqual(original);
});

test("rejects traversal and undeclared archive entries", async () => {
  const store = await createStore();
  const unsafe = unzipSync(qqClientArchive().archive);
  unsafe["../outside.js"] = Buffer.from("escape");
  await expect(store.install(AgentQqClientBuild.id, Buffer.from(zipSync(unsafe)))).rejects.toThrow();
  await expect(fs.stat(path.join(store.root, "outside.js"))).rejects.toThrow();
});

test("removal affects only the optional client directory", async () => {
  const store = await createStore();
  await fs.writeFile(path.join(store.root, "conversations.sqlite"), "untouched");
  await store.remove(AgentQqClientBuild.id);
  expect(store.read(AgentQqClientBuild.id).installed).toBe(false);
  expect(await fs.readFile(path.join(store.root, "conversations.sqlite"), "utf8")).toBe("untouched");
});
