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
  const url = new URL("/api/workspace-resources", baseUrl);
  url.searchParams.set("path", resourcePath);
  return url.toString();
}

function contentUrl(baseUrl: string, resourcePath: string): string {
  const url = new URL("/api/workspace-resources/content", baseUrl);
  url.searchParams.set("path", resourcePath);
  return url.toString();
}
