import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { AgentStaticFrontendHttpApi } from "../../../Source/AgentSystem/WebSocket/AgentStaticFrontendHttpApi.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("static frontend HTTP API", () => {
  test("serves index and immutable assets with appropriate cache headers", async () => {
    const root = createFrontendRoot();
    const server = await startServer(new AgentStaticFrontendHttpApi({ rootDir: root }));
    try {
      const index = await fetch(`${server.origin}/`);
      expect(await index.text()).toBe("<main>Senera</main>");
      expect(index.headers.get("cache-control")).toBe("no-cache");
      expect(index.headers.get("content-type")).toContain("text/html");

      const asset = await fetch(`${server.origin}/assets/app.js`);
      expect(await asset.text()).toBe("console.log('ready');");
      expect(asset.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
      expect(asset.headers.get("content-type")).toContain("javascript");
    } finally {
      await server.close();
    }
  });

  test("uses SPA fallback only for extensionless routes and handles HEAD without a body", async () => {
    const root = createFrontendRoot();
    const server = await startServer(new AgentStaticFrontendHttpApi({ rootDir: root }));
    try {
      const route = await fetch(`${server.origin}/settings/models`);
      expect(route.status).toBe(200);
      expect(await route.text()).toBe("<main>Senera</main>");

      const missingAsset = await fetch(`${server.origin}/assets/missing.js`);
      expect(missingAsset.status).toBe(404);
      expect(await missingAsset.json()).toMatchObject({ error: { code: "not_found" } });

      const head = await fetch(`${server.origin}/assets/app.js`, { method: "HEAD" });
      expect(head.status).toBe(200);
      expect(await head.text()).toBe("");
    } finally {
      await server.close();
    }
  });

  test("rejects malformed and traversal paths, including junction escapes", async () => {
    const root = createFrontendRoot();
    const outside = createTemporaryDirectory("senera-static-outside");
    fs.writeFileSync(path.join(outside, "secret.txt"), "outside", "utf8");
    fs.symlinkSync(outside, path.join(root, "linked"), process.platform === "win32" ? "junction" : "dir");
    const server = await startServer(new AgentStaticFrontendHttpApi({ rootDir: root }));
    try {
      expect((await fetch(`${server.origin}/%E0%A4%A`)).status).toBe(404);
      expect((await fetch(`${server.origin}/%2e%2e%2fsecret.txt`)).status).toBe(404);
      expect((await fetch(`${server.origin}/linked/secret.txt`)).status).toBe(404);
    } finally {
      await server.close();
    }
  });

  test("does not claim API routes or return success when the SPA entrypoint is absent", async () => {
    const root = createTemporaryDirectory("senera-static-empty");
    const api = new AgentStaticFrontendHttpApi({ rootDir: root });
    expect(api.canHandle({ method: "GET", url: "/api/config" } as http.IncomingMessage)).toBe(false);
    const server = await startServer(api);
    try {
      expect((await fetch(`${server.origin}/dashboard`)).status).toBe(404);
    } finally {
      await server.close();
    }
  });
});

function createFrontendRoot(): string {
  const root = createTemporaryDirectory("senera-static-root");
  fs.mkdirSync(path.join(root, "assets"), { recursive: true });
  fs.writeFileSync(path.join(root, "index.html"), "<main>Senera</main>", "utf8");
  fs.writeFileSync(path.join(root, "assets", "app.js"), "console.log('ready');", "utf8");
  return root;
}

function createTemporaryDirectory(prefix: string): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
  temporaryDirectories.push(directory);
  return directory;
}

async function startServer(api: AgentStaticFrontendHttpApi): Promise<{ origin: string; close: () => Promise<void> }> {
  const server = http.createServer((request, response) => api.handle(request, response));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test HTTP server did not expose a TCP address.");
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}
