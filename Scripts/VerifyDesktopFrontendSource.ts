import assert from "node:assert/strict";
import path from "node:path";
import {
  createDesktopFrontendSource,
  resolveDesktopFrontendUrl,
} from "../Apps/Desktop/DesktopFrontendSource.js";

const indexHtml = path.join(process.cwd(), "Frontend", "dist", "index.html");

assert.deepEqual(createDesktopFrontendSource({
  devServerUrl: "",
  frontendIndexHtml: indexHtml,
}), {
  kind: "file",
  filePath: indexHtml,
});

assert.deepEqual(createDesktopFrontendSource({
  devServerUrl: " http://127.0.0.1:5173/ ",
  frontendIndexHtml: indexHtml,
}), {
  kind: "url",
  url: "http://127.0.0.1:5173/",
});

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
  () => createDesktopFrontendSource({
    devServerUrl: "file:///tmp/index.html",
    frontendIndexHtml: indexHtml,
  }),
  /SENERA_DESKTOP_FRONTEND_URL must use http or https/,
);

console.log("Desktop frontend source verification passed.");
