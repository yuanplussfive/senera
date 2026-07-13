import { describe, expect, it } from "vitest";
import { highlightCode, readHighlightCacheKey, readHighlightedCode, resolveSupportedHighlightLanguage, } from "../../../Frontend/src/shared/code/CodeHighlighter.ts";
describe("CodeHighlighter", () => {
    it("normalizes highlight cache keys without loading the highlighter runtime", () => {
        expect(readHighlightCacheKey({ code: "const x = 1;", language: " TypeScript " }))
            .toBe("github-light+github-dark-dimmed\u0000typescript\u0000const x = 1;");
    });
    it("removes failed highlight requests from the cache", async () => {
        const request = { code: "const x = 1;", language: "not-a-real-language" };
        const highlighted = highlightCode(request);
        expect(readHighlightedCode(request)).toBe(highlighted);
        await expect(highlighted).rejects.toThrow("Unsupported code language");
        expect(readHighlightedCode(request)).toBeUndefined();
    });
    it("supports common code fence aliases through a bounded highlighter bundle", () => {
        expect(resolveSupportedHighlightLanguage("js")).toBe("javascript");
        expect(resolveSupportedHighlightLanguage("ts")).toBe("typescript");
        expect(resolveSupportedHighlightLanguage("tsx")).toBe("tsx");
        expect(resolveSupportedHighlightLanguage("sh")).toBe("shellscript");
        expect(resolveSupportedHighlightLanguage("ps1")).toBe("powershell");
        expect(resolveSupportedHighlightLanguage("rs")).toBe("rust");
        expect(resolveSupportedHighlightLanguage("golang")).toBe("go");
        expect(resolveSupportedHighlightLanguage("c++")).toBe("c");
        expect(resolveSupportedHighlightLanguage("rb")).toBe("shellscript");
        expect(resolveSupportedHighlightLanguage("yml")).toBe("yaml");
        expect(resolveSupportedHighlightLanguage("not-a-real-language")).toBeNull();
    });
    it("successfully highlights a supported language through the dynamic runtime", async () => {
        const html = await highlightCode({ code: "const x: number = 1;", language: "ts" });
        expect(html).toContain("<pre");
        expect(html).toContain("data-line");
        expect(html).toContain("const");
    });
});
