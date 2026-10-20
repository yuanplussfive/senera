import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { AgentWorkspaceResourceHttpApi } from "../../../Source/AgentSystem/WorkspaceResources/AgentWorkspaceResourceHttpApi.js";

const roots: string[] = [];
const servers: http.Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        }),
    ),
  );
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("workspace resource HTTP API", () => {
  test("reads and atomically saves an editable workspace text file", async () => {
    const harness = await createHarness();
    await fs.mkdir(path.join(harness.root, "Source"));
    await fs.writeFile(path.join(harness.root, "Source", "sample.ts"), "export const value = 1;\n");

    const read = await fetch(resourceUrl(harness.baseUrl, "Source/sample.ts"));
    const initial = await read.json();
    expect(read.status).toBe(200);
    expect(initial).toMatchObject({
      ok: true,
      resource: {
        path: "Source/sample.ts",
        name: "sample.ts",
        kind: "text",
        editable: true,
        content: "export const value = 1;\n",
      },
    });
    const etag = read.headers.get("etag");
    expect(etag).toMatch(/^"sha256-/u);

    const saved = await fetch(resourceUrl(harness.baseUrl, "Source/sample.ts"), {
      method: "PUT",
      headers: { "Content-Type": "text/plain", "If-Match": etag! },
      body: "export const value = 2;\n",
    });
    expect(saved.status).toBe(200);
    expect(await fs.readFile(path.join(harness.root, "Source", "sample.ts"), "utf8")).toBe("export const value = 2;\n");
  });

  test("rejects stale saves without overwriting the current file", async () => {
    const harness = await createHarness();
    const filePath = path.join(harness.root, "README.md");
    await fs.writeFile(filePath, "first\n");
    const read = await fetch(resourceUrl(harness.baseUrl, "README.md"));
    const etag = read.headers.get("etag")!;

    await fs.writeFile(filePath, "changed elsewhere\n");
    const saved = await fetch(resourceUrl(harness.baseUrl, "README.md"), {
      method: "PUT",
      headers: { "Content-Type": "text/plain", "If-Match": etag },
      body: "stale editor\n",
    });

    expect(saved.status).toBe(412);
    expect(await saved.json()).toMatchObject({ ok: false, error: { code: "resource_changed" } });
    expect(await fs.readFile(filePath, "utf8")).toBe("changed elsewhere\n");
  });

  test("rejects resources outside the configured workspace", async () => {
    const harness = await createHarness();
    const response = await fetch(resourceUrl(harness.baseUrl, path.join(harness.root, "..", "outside.txt")));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ ok: false, error: { code: "outside_workspace" } });
  });

  test("streams browser-safe images with a non-executable response policy", async () => {
    const harness = await createHarness();
    const png = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex");
    await fs.writeFile(path.join(harness.root, "pixel.png"), png);

    const metadata = await fetch(resourceUrl(harness.baseUrl, "pixel.png"));
    expect(await metadata.json()).toMatchObject({ ok: true, resource: { kind: "image", mime: "image/png" } });

    const response = await fetch(contentUrl(harness.baseUrl, "pixel.png"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("content-security-policy")).toContain("sandbox");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(png);
  });

  test("exposes SVG workspace files as editable source", async () => {
    const harness = await createHarness();
    const source = '<svg viewBox="0 0 20 20"></svg>\n';
    await fs.writeFile(path.join(harness.root, "diagram.svg"), source, "utf8");

    const response = await fetch(resourceUrl(harness.baseUrl, "diagram.svg"));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      resource: {
        name: "diagram.svg",
        mime: "image/svg+xml",
        kind: "text",
        editable: true,
        content: source,
      },
    });
  });

  test("downloads workspace files as their original file with the original name and media type", async () => {
    const harness = await createHarness();
    const source = "export const answer = 42;\n";
    await fs.writeFile(path.join(harness.root, "answer.ts"), source, "utf8");

    const response = await fetch(contentUrl(harness.baseUrl, "answer.ts"));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("video/mp2t");
    expect(response.headers.get("content-disposition")).toContain("filename*=UTF-8''answer.ts");
    expect(await response.text()).toBe(source);
  });

  test("lists directories lazily and supports workspace file lifecycle mutations", async () => {
    const harness = await createHarness();
    await fs.mkdir(path.join(harness.root, "src"));
    await fs.writeFile(path.join(harness.root, "src", "index.ts"), "export {}\n");

    const root = await fetch(treeUrl(harness.baseUrl, "."));
    expect(root.status).toBe(200);
    expect(await root.json()).toMatchObject({
      ok: true,
      path: "",
      entries: [{ path: "src", name: "src", kind: "directory" }],
    });

    const directory = await fetch(treeUrl(harness.baseUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operation: "directory", path: "notes" }),
    });
    expect(directory.status).toBe(201);
    expect(await directory.json()).toMatchObject({
      ok: true,
      entry: { path: "notes", name: "notes", kind: "directory" },
    });

    const created = await fetch(treeUrl(harness.baseUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operation: "file", path: "notes/todo.md", content: "- test\n" }),
    });
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({
      ok: true,
      entry: { path: "notes/todo.md", name: "todo.md", kind: "text", editable: true },
    });

    const renamed = await fetch(treeUrl(harness.baseUrl), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: "notes/todo.md", destination: "notes/plan.md" }),
    });
    expect(renamed.status).toBe(200);
    expect(await renamed.json()).toMatchObject({ ok: true, entry: { path: "notes/plan.md", name: "plan.md" } });
    await expect(fs.readFile(path.join(harness.root, "notes", "plan.md"), "utf8")).resolves.toBe("- test\n");

    const removed = await fetch(treeUrl(harness.baseUrl, "notes/plan.md"), { method: "DELETE" });
    expect(removed.status).toBe(200);
    await expect(fs.stat(path.join(harness.root, "notes", "plan.md"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("protects the workspace root and requires recursive removal for directories", async () => {
    const harness = await createHarness();
    await fs.mkdir(path.join(harness.root, "nested"));
    await fs.writeFile(path.join(harness.root, "nested", "file.txt"), "content\n");

    const rootDelete = await fetch(treeUrl(harness.baseUrl, "."), { method: "DELETE" });
    expect(rootDelete.status).toBe(400);
    expect(await rootDelete.json()).toMatchObject({ ok: false, error: { code: "workspace_root_forbidden" } });

    const nonRecursive = await fetch(treeUrl(harness.baseUrl, "nested"), { method: "DELETE" });
    expect(nonRecursive.status).toBe(409);
    expect(await nonRecursive.json()).toMatchObject({ ok: false, error: { code: "directory_not_empty" } });

    const recursive = await fetch(`${treeUrl(harness.baseUrl, "nested")}&recursive=true`, { method: "DELETE" });
    expect(recursive.status).toBe(200);
    await expect(fs.stat(path.join(harness.root, "nested"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("keeps tree mutations relative to the workspace root", async () => {
    const harness = await createHarness();
    const response = await fetch(treeUrl(harness.baseUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operation: "file", path: path.join(harness.root, "outside.txt") }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ ok: false, error: { code: "invalid_path" } });
  });
});

async function createHarness(): Promise<{ root: string; baseUrl: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "senera-workspace-resource-"));
  roots.push(root);
  const api = new AgentWorkspaceResourceHttpApi({
    workspaceRoot: root,
    maxTextBytes: 1024 * 1024,
    isOriginAllowed: (origin) => origin === "http://frontend.test",
  });
  const server = http.createServer((request, response) => void api.handle(request, response));
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Unable to start workspace resource test server.");
  return { root, baseUrl: `http://127.0.0.1:${address.port}` };
}

function resourceUrl(baseUrl: string, resourcePath: string): string {
  const url = new URL("/api/resources", baseUrl);
  url.searchParams.set("path", resourcePath);
  return url.toString();
}

function contentUrl(baseUrl: string, resourcePath: string): string {
  const url = new URL("/api/resources/content", baseUrl);
  url.searchParams.set("path", resourcePath);
  return url.toString();
}

function treeUrl(baseUrl: string, resourcePath?: string): string {
  const url = new URL("/api/resources/tree", baseUrl);
  if (resourcePath !== undefined) url.searchParams.set("path", resourcePath);
  return url.toString();
}
