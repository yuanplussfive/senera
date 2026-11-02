import assert from "node:assert/strict";
import path from "node:path";
import { createDesktopFrontendSource, resolveDesktopFrontendUrl } from "../Apps/Desktop/DesktopFrontendSource.js";
import { AgentDevelopmentFrontendBase } from "../Source/AgentSystem/WebSocket/AgentDevelopmentFrontend.js";

const indexHtml = path.join(process.cwd(), "Frontend", "dist", "index.html");
const startupHtml = path.join(process.cwd(), "Frontend", "dist", "startup.html");

// Runtime windows use the ready service origin, so authentication and resource
// requests share the same HTTP context instead of an opaque file origin.
assert.deepEqual(
  createDesktopFrontendSource({
    devServerUrl: undefined,
    serverUrl: "http://127.0.0.1:49189/api/health?workspaceId=first",
    documentPath: indexHtml,
  }),
  { kind: "url", url: "http://127.0.0.1:49189/" },
);

assert.deepEqual(
  createDesktopFrontendSource({
    devServerUrl: "http://127.0.0.1:5173/",
    serverUrl: "http://127.0.0.1:49189/api/health",
    documentPath: indexHtml,
  }),
  { kind: "url", url: `http://127.0.0.1:5173${AgentDevelopmentFrontendBase}` },
);

assert.deepEqual(
  createDesktopFrontendSource({
    devServerUrl: "",
    documentPath: indexHtml,
  }),
  {
    kind: "file",
    filePath: indexHtml,
  },
);

// The startup surface is a second document on the same dev server; it must resolve
// to its own file there instead of the dev server root the app itself loads.
assert.deepEqual(
  createDesktopFrontendSource({
    devServerUrl: "http://127.0.0.1:5173",
    documentPath: startupHtml,
    devServerPath: "/startup.html",
  }),
  {
    kind: "url",
    url: `http://127.0.0.1:5173${AgentDevelopmentFrontendBase}startup.html`,
  },
);

assert.deepEqual(
  createDesktopFrontendSource({
    devServerUrl: undefined,
    documentPath: startupHtml,
    devServerPath: "/startup.html",
  }),
  {
    kind: "file",
    filePath: startupHtml,
  },
);

// A dev server mounted under a path keeps it for both documents.
assert.deepEqual(
  createDesktopFrontendSource({
    devServerUrl: "http://127.0.0.1:5173/app/",
    documentPath: startupHtml,
    devServerPath: "/startup.html",
  }),
  {
    kind: "url",
    url: "http://127.0.0.1:5173/app/startup.html",
  },
);

assert.deepEqual(
  createDesktopFrontendSource({
    devServerUrl: " http://127.0.0.1:5173/ ",
    documentPath: indexHtml,
  }),
  {
    kind: "url",
    url: `http://127.0.0.1:5173${AgentDevelopmentFrontendBase}`,
  },
);

assert.equal(
  resolveDesktopFrontendUrl({
    source: {
      kind: "url",
      url: "http://127.0.0.1:5173/",
    },
    query: {
      surface: "settings",
      section: "appearance",
    },
  }),
  "http://127.0.0.1:5173/?surface=settings&section=appearance",
);

assert.equal(
  resolveDesktopFrontendUrl({
    source: {
      kind: "url",
      url: "http://127.0.0.1:5173/?debug=1",
    },
    query: {
      surface: "settings",
      section: "appearance",
    },
  }),
  "http://127.0.0.1:5173/?debug=1&surface=settings&section=appearance",
);

assert.throws(
  () =>
    createDesktopFrontendSource({
      devServerUrl: "file:///tmp/index.html",
      documentPath: indexHtml,
    }),
  /Desktop frontend URLs must use http or https/,
);

assert.throws(
  () =>
    createDesktopFrontendSource({ devServerUrl: undefined, serverUrl: "file:///index.html", documentPath: indexHtml }),
  /Desktop frontend URLs must use http or https/,
);

console.log("Desktop frontend source verification passed.");
