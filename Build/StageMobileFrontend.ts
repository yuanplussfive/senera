import { copyFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "parse5";
import { resolveWorkspaceRoot } from "../Scripts/WorkspaceRoot.js";
import { MobileAssetManifestFile } from "../Frontend/src/build/mobileAssetManifestPlugin.js";

const root = resolveWorkspaceRoot(import.meta.url);
const source = path.join(root, "Frontend/dist");
const cache = path.join(root, "Frontend/.cache");
const destination = path.join(cache, "mobile-web");
const manifest: unknown = JSON.parse(await readFile(path.join(source, MobileAssetManifestFile), "utf8"));
if (!Array.isArray(manifest) || manifest.length === 0 || manifest.some((file) => typeof file !== "string")) {
  throw new Error("Mobile frontend asset manifest is invalid. Rebuild the frontend before staging.");
}
const files = new Set<string>();

function addFile(relative: string): void {
  if (relative.split("/").some((part) => part === "..") || path.isAbsolute(relative) || relative.includes("\\")) {
    throw new Error(`Mobile asset escapes the frontend distribution: ${relative}`);
  }
  files.add(relative);
}

for (const file of manifest) addFile(file);

// Vite can emit shared startup scripts directly into each document. Preserve
// those references too. Every app document uses the APK's versioned build.
for (const document of ["index.html", "mobile/index.html"]) {
  addFile(document);
  const tree = parse(await readFile(path.join(source, document), "utf8"));
  function visit(node: typeof tree | (typeof tree.childNodes)[number]): void {
    if ("attrs" in node) {
      const reference = node.attrs.find((attr) =>
        node.nodeName === "script" ? attr.name === "src" : node.nodeName === "link" && attr.name === "href",
      )?.value;
      if (reference) {
        const url = new URL(reference, `https://assets.local/${document}`);
        if (url.origin === "https://assets.local") addFile(decodeURIComponent(url.pathname).slice(1));
      }
    }
    if ("childNodes" in node) for (const child of node.childNodes) visit(child);
  }
  visit(tree);
}

// The base APK owns the console only. Optional client assets are installed separately.
for (const directory of ["icons", "licenses"]) {
  for (const entry of await readdir(path.join(source, directory), { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const relative = path.relative(source, path.join(entry.parentPath, entry.name)).split(path.sep).join("/");
    if (relative.split("/").some((part) => part.startsWith("."))) continue;
    if (/\.(?:gz|br)$/u.test(relative)) continue;
    addFile(relative);
  }
}
addFile("favicon.svg");

// cap sync runs only after staging succeeds, so incomplete copies cannot ship.
await rm(destination, { recursive: true, force: true });
for (const relative of files) {
  const target = path.join(destination, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await copyFile(path.join(source, relative), target);
}
await writeFile(
  path.join(destination, "client-assets.json"),
  JSON.stringify({
    assets: [...files].map((file) => `/${file}`),
    documents: { "/": "index.html", "/index.html": "index.html" },
    workspaceClients: [],
  }),
);
process.stdout.write(`Mobile frontend staged: ${files.size} entry resources and shared public assets.\n`);
