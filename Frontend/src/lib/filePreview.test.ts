import { describe, expect, it } from "vitest";
import { resolveFilePreview } from "./filePreview";

describe("resolveFilePreview", () => {
  it.each([
    ["main.go", "code"],
    ["app.js", "code"],
    ["notes.txt", "text"],
    ["report.docx", "word"],
    ["brief.pdf", "pdf"],
    ["table.xlsx", "spreadsheet"],
    ["slides.pptx", "presentation"],
    ["archive.zip", "archive"],
  ])("resolves %s", (name, expected) => {
    expect(resolveFilePreview({ name }).id).toBe(expected);
  });

  it("uses MIME when the file name has no useful extension", () => {
    expect(resolveFilePreview({ name: "upload", mime: "image/png" }).id).toBe("image");
  });

  it("falls back to the default file preview", () => {
    expect(resolveFilePreview({ name: "unknown.custom" }).id).toBe("file");
  });
});
