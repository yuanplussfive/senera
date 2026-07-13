import { describe, expect, it } from "vitest";
import { applyCodePreviewTheme, createCodePreviewThemeVariables, resolveCodePreview, } from "../../../Frontend/src/shared/code/CodePreviewRegistry.ts";
describe("CodePreviewRegistry", () => {
    it("uses preview-local CSS variables for injected iframe scrollbars", () => {
        const preview = resolveCodePreview("html", "<main>Hello</main>");
        expect(preview?.source).toContain("--senera-preview-scrollbar-thumb");
        expect(preview?.source).toContain("var(--senera-preview-scrollbar-thumb");
        expect(preview?.source).not.toContain("rgba(28, 26, 23");
    });
    it("injects resolved appearance values into the isolated preview document", () => {
        const preview = resolveCodePreview("svg", "<svg viewBox=\"0 0 10 10\"><circle cx=\"5\" cy=\"5\" r=\"4\" /></svg>");
        const source = applyCodePreviewTheme(preview?.source ?? "", {
            scrollbarThumb: "rgb(1 2 3 / 0.4)",
            scrollbarThumbHover: "rgb(4 5 6 / 0.5)",
            scrollbarTrack: "transparent",
            scrollbarSize: "10px",
        });
        expect(source).toContain("data-senera-preview-theme");
        expect(source).toContain("--senera-preview-scrollbar-thumb: rgb(1 2 3 / 0.4)");
        expect(source).toContain("--senera-preview-scrollbar-thumb-hover: rgb(4 5 6 / 0.5)");
        expect(source).toContain("--senera-preview-scrollbar-size: 10px");
    });
    it("derives preview theme values from the appearance CSS variable map", () => {
        expect(createCodePreviewThemeVariables({
            "--scrollbar-thumb": "rgb(7 8 9 / 0.6)",
            "--scrollbar-thumb-hover": "rgb(10 11 12 / 0.7)",
            "--scrollbar-track": "transparent",
            "--scrollbar-size": "12px",
        })).toEqual({
            scrollbarThumb: "rgb(7 8 9 / 0.6)",
            scrollbarThumbHover: "rgb(10 11 12 / 0.7)",
            scrollbarTrack: "transparent",
            scrollbarSize: "12px",
        });
    });
});
