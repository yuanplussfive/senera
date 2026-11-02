import assert from "node:assert/strict";
import http from "node:http";
import { probeDesktopLiveFrontend } from "../Apps/Desktop/DesktopLiveFrontendServer.js";
import { AgentDevelopmentFrontendBase } from "../Source/AgentSystem/WebSocket/AgentDevelopmentFrontend.js";

const frontendHtml = ["@vite/client", "senera-runtime-config.js", "src/main.tsx"]
  .map((entry) => `<script type="module" src="${AgentDevelopmentFrontendBase}${entry}"></script>`)
  .join("\n");

await withFrontendServer(
  {
    body: frontendHtml,
    statusCode: 200,
  },
  async (url) => {
    assert.deepEqual(await probeDesktopLiveFrontend(url), { kind: "ready" });
  },
);

await withFrontendServer(
  {
    body: "not the Senera frontend",
    statusCode: 200,
  },
  async (url) => {
    const probe = await probeDesktopLiveFrontend(url);
    assert.equal(probe.kind, "invalid");
    assert.match(probe.message, /Senera Vite entry page/);
  },
);

await withFrontendServer(
  {
    body: "not the Senera frontend",
    contentType: "application/json",
    statusCode: 200,
  },
  async (url) => {
    const probe = await probeDesktopLiveFrontend(url);
    assert.equal(probe.kind, "invalid");
    assert.match(probe.message, /content type application\/json/);
  },
);

await withFrontendServer(
  {
    body: frontendHtml,
    statusCode: 404,
  },
  async (url) => {
    const probe = await probeDesktopLiveFrontend(url);
    assert.equal(probe.kind, "invalid");
    assert.match(probe.message, /HTTP 404/);
  },
);

console.log("Desktop live frontend server verification passed.");

async function withFrontendServer(
  response: {
    body: string;
    contentType?: string;
    statusCode: number;
  },
  verify: (url: string) => Promise<void>,
): Promise<void> {
  const server = http.createServer((request, serverResponse) => {
    assert.equal(request.url, AgentDevelopmentFrontendBase);
    serverResponse.writeHead(response.statusCode, {
      "content-type": response.contentType ?? "text/html",
    });
    serverResponse.end(response.body);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  assert.ok(address && typeof address !== "string", "Expected a TCP server address.");

  try {
    await verify(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}
