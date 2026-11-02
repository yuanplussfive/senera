import { expect, test } from "vitest";
import { rewriteModuleAnchors } from "../../../Build/BundleDesktopServer.js";

test("module anchors preserve original module location without touching strings or local variables", () => {
  const source = `
    const url = import.meta.url;
    const directory = import.meta.dirname;
    const file = import.meta.filename;
    function local(__dirname, __filename) { return { __dirname, __filename }; }
    const description = "import.meta.url __dirname";
    // import.meta.filename
  `;
  const rewritten = rewriteModuleAnchors(source, "module.js", "../../Source/a.js");
  expect(rewritten?.anchors).toBe(3);
  expect(rewritten?.contents).toContain('__seneraModuleUrl("../../Source/a.js")');
  expect(rewritten?.contents).toContain('__seneraModuleDir("../../Source/a.js")');
  expect(rewritten?.contents).toContain('__seneraModuleFile("../../Source/a.js")');
  expect(rewritten?.contents).toContain("function local(__dirname, __filename) { return { __dirname, __filename }; }");
  expect(rewritten?.contents).toContain('"import.meta.url __dirname"');
  expect(rewritten?.contents).toContain("// import.meta.filename");
});

test("files without module anchors are left to esbuild unchanged", () => {
  expect(rewriteModuleAnchors('const text = "import.meta.url";', "a.js", "a.js")).toBeUndefined();
});
