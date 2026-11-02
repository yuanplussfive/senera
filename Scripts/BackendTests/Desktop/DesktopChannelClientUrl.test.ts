import { expect, test } from "vitest";
import { resolveDesktopChannelClientUrl } from "../../../Apps/Desktop/DesktopChannelClientUrl.js";

const workspaceId = "2951c867-4f7a-4eb1-bccf-567709ac5701";
const clientPath = `/api/channel-clients/onebot11/${workspaceId}/`;

test("opens development clients on the actual frontend origin with a workspace route", () => {
  expect(
    resolveDesktopChannelClientUrl(
      { kind: "url", url: "http://127.0.0.1:5197/?settings=channels" },
      "ws://127.0.0.1:8787",
      workspaceId,
    ),
  ).toBe(`http://127.0.0.1:5197${clientPath}`);
});

test.each([
  ["ws://127.0.0.1:9012", "http://127.0.0.1:9012"],
  ["wss://senera.example/socket", "https://senera.example"],
])("packaged clients use the server origin from %s", (socket, origin) => {
  expect(resolveDesktopChannelClientUrl({ kind: "file", filePath: "frontend/index.html" }, socket, workspaceId)).toBe(
    `${origin}${clientPath}`,
  );
});

test("rejects unsupported origins and invalid workspace identities", () => {
  expect(() =>
    resolveDesktopChannelClientUrl({ kind: "file", filePath: "frontend/index.html" }, "file:///tmp/qq", workspaceId),
  ).toThrow("HTTP origin");
  for (const invalid of ["", "../other", "workspace?redirect=evil", undefined]) {
    expect(() =>
      resolveDesktopChannelClientUrl({ kind: "url", url: "http://localhost:5197" }, "ws://localhost:8787", invalid!),
    ).toThrow();
  }
});
